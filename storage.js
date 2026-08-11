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

  function pendingDates() {
    try { return JSON.parse(localStorage.getItem("pendingEventDates") || "[]"); }
    catch (_) { return []; }
  }
  function markDatePending(dateKey) {
    localStorage.setItem("pendingEventDates", JSON.stringify([...new Set([...pendingDates(), dateKey])]));
    localStorage.setItem("pendingServerSync", "1"); updateSyncStatus();
  }
  function clearDatePending(dateKey) {
    const remaining = pendingDates().filter(key => key !== dateKey);
    localStorage.setItem("pendingEventDates", JSON.stringify(remaining));
    if (!remaining.length && localStorage.getItem("pendingSettingsSync") !== "1") {
      localStorage.removeItem("pendingServerSync");
    }
    updateSyncStatus();
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
        if (res.ok) {
          const list = await res.json();
          // オフラインでも閲覧・編集できるよう、取得結果を端末にも保存する。
          await saveEvents(dateKey, list);
          return list;
        }
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

  async function getEventsForDates(dateKeys) {
    if (!Array.isArray(dateKeys) || !dateKeys.length) return {};
    const keys = [...new Set(dateKeys)].sort();
    const result = {};
    if (hasServer() && navigator.onLine) {
      try {
        const query = new URLSearchParams({ start: keys[0], end: keys[keys.length - 1] });
        const response = await fetch(`${SERVER_URL}/api/events-range?${query}`, { headers: authHeaders() });
        if (response.ok) {
          const serverEvents = await response.json();
          for (const dateKey of keys) {
            // 未同期の端末変更はサーバー取得結果で上書きしない。
            if (pendingDates().includes(dateKey)) {
              result[dateKey] = await getLocalEvents(dateKey);
            } else {
              result[dateKey] = Array.isArray(serverEvents[dateKey]) ? serverEvents[dateKey] : [];
              await saveEvents(dateKey, result[dateKey]);
            }
          }
          return result;
        }
      } catch (error) {
        console.warn("予定の一括取得に失敗、端末保存を使用", error);
      }
    }
    for (const dateKey of keys) result[dateKey] = await getLocalEvents(dateKey);
    return result;
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
    const dates = pendingDates();
    const settingsPending = localStorage.getItem("pendingSettingsSync") === "1";
    if (!dates.length && !settingsPending) { updateSyncStatus(); return true; }
    if (!hasServer() || !navigator.onLine) { queueSync(); return false; }
    try {
      for (const dateKey of dates) {
        const list = await getLocalEvents(dateKey);
        const res = await fetch(`${SERVER_URL}/api/events/${dateKey}`, {
          method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ events: list })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        clearDatePending(dateKey);
      }
      if (settingsPending) {
        const settings = JSON.parse(localStorage.getItem("userSettings") || "{}");
        const response = await sendUserSettings(settings);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        localStorage.removeItem("pendingSettingsSync");
      }
      localStorage.removeItem("pendingServerSync"); updateSyncStatus(); return true;
    } catch(e) { queueSync(); return false; }
  }

  async function deleteEvent(dateKey, idx) {
    const list = await getEvents(dateKey);
    list.splice(idx, 1);
    await saveEvents(dateKey, list);
    // サーバー同期
    await syncDate(dateKey, list);
  }

  async function addEvent(dateKey, event) {
    const list = await getEvents(dateKey);
    list.push(event);
    await saveEvents(dateKey, list);
    // サーバー同期
    await syncDate(dateKey, list);
  }

  async function updateEvent(dateKey, idx, event) {
    const list = await getEvents(dateKey);
    list[idx] = event;
    await saveEvents(dateKey, list);
    // サーバー同期
    await syncDate(dateKey, list);
  }

  async function getLocalEvents(dateKey) {
    await open();
    if (useMemory || !db) return (memStore["ev_" + dateKey] || []).slice();
    return new Promise(resolve => {
      const req = db.transaction("events", "readonly").objectStore("events").get(dateKey);
      req.onsuccess = () => resolve(req.result ? req.result.list : []);
      req.onerror = () => resolve([]);
    });
  }

  async function syncDate(dateKey, list) {
    markDatePending(dateKey);
    if (!hasServer() || !navigator.onLine) return false;
    try {
      const response = await fetch(`${SERVER_URL}/api/events/${dateKey}`, {
        method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ events: list })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      clearDatePending(dateKey);
      return true;
    } catch (_) { queueSync(); return false; }
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
  function sendUserSettings(settings) {
    return fetch(`${SERVER_URL}/api/user-settings`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(settings)
    });
  }

  async function loadUserSettings() {
    const local = JSON.parse(localStorage.getItem("userSettings") || "{}");
    if (!hasServer() || !navigator.onLine) return local;
    try {
      const response = await fetch(`${SERVER_URL}/api/user-settings`, { headers: authHeaders() });
      if (!response.ok) return local;
      const serverSettings = await response.json();
      const merged = { ...local, ...serverSettings };
      localStorage.setItem("userSettings", JSON.stringify(merged));
      if (merged.pref) localStorage.setItem("pref", merged.pref);
      if (merged.region && merged.pref) localStorage.setItem("region_" + merged.pref, merged.region);
      if (merged.locationMode) localStorage.setItem("locationMode", merged.locationMode);
      if (merged.gpsLat != null) localStorage.setItem("gpsLat", merged.gpsLat);
      if (merged.gpsLon != null) localStorage.setItem("gpsLon", merged.gpsLon);
      return merged;
    } catch (_) { return local; }
  }

  async function syncUserSettings(settings) {
    localStorage.setItem("userSettings", JSON.stringify(settings));
    localStorage.setItem("pendingSettingsSync", "1"); queueSync();
    if (!hasServer() || !navigator.onLine) return false;
    try {
      const response = await sendUserSettings(settings);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      localStorage.removeItem("pendingSettingsSync");
      if (!pendingDates().length) localStorage.removeItem("pendingServerSync");
      updateSyncStatus(); return true;
    } catch(e) { console.warn("設定同期失敗", e); return false; }
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
    open, getEvents, getEventsForDates, getAllEvents, saveEvents, deleteEvent, addEvent, addRecurringEvent, updateEvent,
    saveGarbageSchedule, getGarbageSchedule,
    loadUserSettings, syncUserSettings, syncAllToServer, testLineNotification, exportData, importData,
    getLineIdToken, hasServer, updateSyncStatus
  };
})();
