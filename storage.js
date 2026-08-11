// storage.js — IndexedDB ラッパー + サーバー同期対応
// 依存: なし

const Storage = (() => {
  let db = null;
  let memStore  = {};
  let useMemory = false;

  // 同一サーバーから配信するため、公開時は自動設定される。
  const SERVER_URL = window.APP_CONFIG?.serverUrl
    || (location.protocol === "http:" || location.protocol === "https:" ? location.origin : null);

  function getLineIdToken() {
    return sessionStorage.getItem("lineIdToken") || null;
  }

  function hasServer() {
    return !!SERVER_URL && !!getLineIdToken();
  }

  function authHeaders(extra = {}) {
    return { ...extra, "Authorization": `Bearer ${getLineIdToken()}` };
  }

  function queueSync() { localStorage.setItem("pendingServerSync", "1"); updateSyncStatus(); }
  function updateSyncStatus(message) {
    const el = document.getElementById("syncStatus");
    if (el) el.textContent = message || (navigator.onLine
      ? (localStorage.getItem("pendingServerSync") ? "未同期の変更があります" : "オンライン・同期済み")
      : "オフライン・端末に保存中");
  }

  // ── IndexedDB ─────────────────────────────────────────
  function open() {
    return new Promise((resolve, reject) => {
      if (db)         { resolve(db); return; }
      if (useMemory)  { resolve(null); return; }
      if (!window.indexedDB) { useMemory = true; resolve(null); return; }

      const req = indexedDB.open("CalendarDB", 2);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains("events")) {
          d.createObjectStore("events", { keyPath: "dateKey" });
        }
        if (!d.objectStoreNames.contains("garbage")) {
          d.createObjectStore("garbage", { keyPath: "regionKey" });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = e => {
        console.warn("IndexedDB open failed, using memory store:", e.target.error);
        useMemory = true;
        resolve(null);
      };
    });
  }

  // ── Events ────────────────────────────────────────────

  async function getEvents(dateKey) {
    // サーバー優先
    if (hasServer()) {
      try {
        const res = await fetch(`${SERVER_URL}/api/events/${dateKey}`, {
          headers: authHeaders()
        });
        if (res.ok) return await res.json();
      } catch(e) { console.warn("サーバー取得失敗、ローカルにフォールバック", e); }
    }

    // ローカル（IndexedDB / メモリ）
    await open();
    if (useMemory || !db) return (memStore["ev_" + dateKey] || []).slice();
    return new Promise(resolve => {
      try {
        const req = db.transaction("events","readonly")
                     .objectStore("events").get(dateKey);
        req.onsuccess = () => resolve(req.result ? req.result.list : []);
        req.onerror   = () => resolve([]);
      } catch(e) { resolve([]); }
    });
  }

  async function saveEvents(dateKey, list) {
    // サーバーがある場合は全件送信
    if (hasServer()) {
      // 一括同期は別途 syncAllToServer() で行う
    }

    // ローカル保存
    await open();
    if (useMemory || !db) { memStore["ev_" + dateKey] = list.slice(); return; }
    return new Promise(resolve => {
      try {
        const tx = db.transaction("events","readwrite");
        tx.objectStore("events").put({ dateKey, list });
        tx.oncomplete = () => resolve();
        tx.onerror    = () => resolve();
      } catch(e) { resolve(); }
    });
  }

  async function getAllEvents() {
    await open();
    if (useMemory || !db) {
      return Object.fromEntries(Object.entries(memStore)
        .filter(([k]) => k.startsWith("ev_"))
        .map(([k,v]) => [k.slice(3), v]));
    }
    return new Promise(resolve => {
      const result = {};
      const req = db.transaction("events", "readonly").objectStore("events").openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) return resolve(result);
        result[cursor.value.dateKey] = cursor.value.list || [];
        cursor.continue();
      };
      req.onerror = () => resolve(result);
    });
  }

  async function replaceAllEvents(events) {
    await open();
    if (useMemory || !db) {
      for (const key of Object.keys(memStore)) if (key.startsWith("ev_")) delete memStore[key];
      for (const [key, list] of Object.entries(events || {})) memStore["ev_" + key] = list;
      return;
    }
    return new Promise(resolve => {
      const tx = db.transaction("events", "readwrite");
      const store = tx.objectStore("events");
      store.clear();
      for (const [dateKey, list] of Object.entries(events || {})) store.put({ dateKey, list });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async function syncAllToServer() {
    if (!hasServer() || !navigator.onLine) { queueSync(); return false; }
    try {
      const res = await fetch(`${SERVER_URL}/api/events-bulk`, {
        method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ events: await getAllEvents() })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      localStorage.removeItem("pendingServerSync"); updateSyncStatus(); return true;
    } catch(e) { queueSync(); return false; }
  }

  async function deleteEvent(dateKey, idx) {
    const list = await getEvents(dateKey);
    list.splice(idx, 1);
    await saveEvents(dateKey, list);
    // サーバー同期
    if (hasServer()) {
      fetch(`${SERVER_URL}/api/events/${dateKey}/${idx}`, {
        method: "DELETE",
        headers: authHeaders()
      }).then(r => { if (!r.ok) queueSync(); }).catch(queueSync);
    } else if (SERVER_URL) { queueSync(); }
  }

  async function addEvent(dateKey, event) {
    const list = await getEvents(dateKey);
    list.push(event);
    await saveEvents(dateKey, list);
    // サーバー同期
    if (hasServer()) {
      fetch(`${SERVER_URL}/api/events/${dateKey}`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(event)
      }).then(r => { if (!r.ok) queueSync(); }).catch(queueSync);
    } else if (SERVER_URL) { queueSync(); }
  }

  async function updateEvent(dateKey, idx, event) {
    const list = await getEvents(dateKey);
    list[idx] = event;
    await saveEvents(dateKey, list);
    // サーバー同期
    if (hasServer()) {
      fetch(`${SERVER_URL}/api/events/${dateKey}/${idx}`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(event)
      }).then(r => { if (!r.ok) queueSync(); }).catch(queueSync);
    } else if (SERVER_URL) { queueSync(); }
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  async function addRecurringEvent(startKey, event) {
    const repeat = event.repeat || "none";
    const until = event.repeatUntil || startKey;
    let d = new Date(`${startKey}T00:00:00`);
    const end = new Date(`${until}T23:59:59`);
    let count = 0;
    while (d <= end && count < 370) {
      await addEvent(dateKey(d), { ...event, recurrenceStart: startKey });
      count++;
      if (repeat === "none") break;
      if (repeat === "daily") d.setDate(d.getDate() + 1);
      else if (repeat === "weekly") d.setDate(d.getDate() + 7);
      else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
      else break;
    }
  }

  // ── Garbage ───────────────────────────────────────────

  async function saveGarbageSchedule(regionKey, schedule) {
    await open();
    if (useMemory || !db) { memStore["gb_" + regionKey] = schedule; return; }
    return new Promise(resolve => {
      try {
        const tx = db.transaction("garbage","readwrite");
        tx.objectStore("garbage").put({ regionKey, schedule });
        tx.oncomplete = () => resolve();
        tx.onerror    = () => resolve();
      } catch(e) { resolve(); }
    });
  }

  async function getGarbageSchedule(regionKey) {
    await open();
    if (useMemory || !db) return memStore["gb_" + regionKey] || null;
    return new Promise(resolve => {
      try {
        const req = db.transaction("garbage","readonly")
                     .objectStore("garbage").get(regionKey);
        req.onsuccess = () => resolve(req.result ? req.result.schedule : null);
        req.onerror   = () => resolve(null);
      } catch(e) { resolve(null); }
    });
  }

  // ── ユーザー設定の同期 ────────────────────────────────
  async function syncUserSettings(settings) {
    localStorage.setItem("userSettings", JSON.stringify(settings));
    if (!hasServer()) return;
    try {
      await fetch(`${SERVER_URL}/api/user-settings`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(settings)
      });
    } catch(e) { console.warn("設定同期失敗", e); }
  }

  async function testLineNotification() {
    if (!hasServer()) throw new Error("LINE連携ページからログインしてください");
    const res = await fetch(`${SERVER_URL}/api/test-notification`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "送信できませんでした");
  }

  async function exportData() {
    let data;
    if (hasServer()) {
      const response = await fetch(`${SERVER_URL}/api/backup`, { headers: authHeaders() });
      if (!response.ok) throw new Error("サーバーからバックアップを取得できませんでした");
      data = await response.json();
    } else {
      data = {
        app: "Ready2Go", version: 1, exportedAt: new Date().toISOString(),
        events: await getAllEvents(),
        settings: JSON.parse(localStorage.getItem("userSettings") || "{}")
      };
    }
    const filename = `ready2go-backup-${new Date().toISOString().slice(0,10)}.json`;
    const content = JSON.stringify(data, null, 2);
    const file = new File([content], filename, { type: "application/json" });

    // スマホのLINE内ブラウザでは通常ダウンロードが保存されないことがある。
    // Web Share対応端末では共有画面から「ファイルに保存」を選べるようにする。
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: "Ready2Goバックアップ",
        text: "Ready2Goの予定・設定バックアップです",
        files: [file]
      });
      return "shared";
    }

    const blob = new Blob([content], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return "downloaded";
  }

  async function importData(file) {
    const backup = JSON.parse(await file.text());
    if (!backup || backup.app !== "Ready2Go" || Number(backup.version) !== 1
      || !backup.events || typeof backup.events !== "object") {
      throw new Error("Ready2Goのバックアップファイルではありません");
    }
    if (hasServer()) {
      const response = await fetch(`${SERVER_URL}/api/restore`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(backup)
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "復元できませんでした");
      }
    }
    await replaceAllEvents(backup.events);
    if (backup.settings && typeof backup.settings === "object") {
      localStorage.setItem("userSettings", JSON.stringify(backup.settings));
      if (backup.settings.pref) localStorage.setItem("pref", backup.settings.pref);
      if (backup.settings.locationMode) localStorage.setItem("locationMode", backup.settings.locationMode);
    }
    localStorage.removeItem("pendingServerSync");
    return true;
  }

  window.addEventListener("online", syncAllToServer);
  window.addEventListener("offline", () => updateSyncStatus());

  return {
    open, getEvents, getAllEvents, saveEvents, deleteEvent, addEvent, addRecurringEvent, updateEvent,
    saveGarbageSchedule, getGarbageSchedule,
    syncUserSettings, syncAllToServer, testLineNotification, exportData, importData,
    getLineIdToken, hasServer, updateSyncStatus
  };
})();
