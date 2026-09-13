// settings.js — 設定画面の管理
// 依存: なし（DOM が存在すること）

const Settings = (() => {
  const THEME_PALETTES = {
    "#2f7de1": { light:"#dbeafe", dark:"#1d4ed8", soft:"#eff6ff" },
    "#9333ea": { light:"#f3e8ff", dark:"#7e22ce", soft:"#faf5ff" },
    "#ec4899": { light:"#fce7f3", dark:"#be185d", soft:"#fdf2f8" },
    "#10b981": { light:"#d1fae5", dark:"#047857", soft:"#ecfdf5" }
  };
  let lastFocusedElement = null;

  function applyThemeColor(value) {
    const theme = THEME_PALETTES[value] || THEME_PALETTES["#2f7de1"];
    const root = document.documentElement;
    const darkMode = root.getAttribute("data-theme") === "dark";
    root.style.setProperty("--accent", value);
    root.style.setProperty("--accent-light", darkMode ? `${value}33` : theme.light);
    root.style.setProperty("--accent-dark", theme.dark);
    root.style.setProperty("--accent-soft", darkMode ? `${value}24` : theme.soft);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", value);
  }

  function applyAll() {
    applyBackground();
    applyFontSize();
    applyDarkMode();
    applyTheme();
  }

  function applyBackground() {
    const bg = localStorage.getItem("bg");
    document.body.style.backgroundImage = bg ? `url(${bg})` : "";
  }

  function resetBackground() {
    localStorage.removeItem("bg");
    document.body.style.backgroundImage = "";
  }

  function onBgPickerChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = x => {
      localStorage.setItem("bg", x.target.result);
      applyBackground();
    };
    r.readAsDataURL(f);
  }

  function applyTheme() {
    const theme = localStorage.getItem("theme") || "#2f7de1";
    applyThemeColor(theme);
    const sel = document.getElementById("themeSelect");
    if (sel) sel.value = theme;
  }

  function onThemeChange(value) {
    localStorage.setItem("theme", value);
    applyThemeColor(value);
  }

  function applyFontSize() {
    const oldToNew = { "13":"14", "15":"16", "17":"18", "19":"20" };
    const saved = localStorage.getItem("fontSize") || "16";
    const size = oldToNew[saved] || saved;
    localStorage.setItem("fontSize", size);
    document.body.style.fontSize = size + "px";
    const sel = document.getElementById("fontSize");
    if (sel) sel.value = size;
  }

  function onFontSizeChange(value) {
    localStorage.setItem("fontSize", value);
    document.body.style.fontSize = value + "px";
  }

  function applyDarkMode() {
    const dark = localStorage.getItem("darkMode") === "true";
    if (dark) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    const toggle = document.getElementById("darkToggle");
    if (toggle) toggle.checked = dark;
  }

  function toggleDarkMode() {
    const toggle = document.getElementById("darkToggle");
    const isDark = toggle && toggle.checked;
    if (isDark) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("darkMode", "true");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("darkMode", "false");
    }
    applyThemeColor(localStorage.getItem("theme") || "#2f7de1");
  }

  function setPanelOpen(open) {
    const panel = document.getElementById("settings");
    if (!panel) return;
    const wasOpen = panel.classList.contains("open");
    if (open === wasOpen) return;
    const scrim = document.getElementById("settingsScrim");
    const trigger = document.getElementById("menuTrigger");
    if (open) lastFocusedElement = document.activeElement;
    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", String(!open));
    if (scrim) scrim.hidden = !open;
    trigger?.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("settings-open", open);
    window.dispatchEvent(new CustomEvent("ready2go:settingschange", { detail:{ open } }));
    if (open) {
      requestAnimationFrame(() => panel.querySelector("#closeSettingsBtn")?.focus());
    } else if (wasOpen && lastFocusedElement instanceof HTMLElement) {
      lastFocusedElement.focus();
    }
  }

  function togglePanel() {
    const panel = document.getElementById("settings");
    setPanelOpen(!panel?.classList.contains("open"));
  }

  function closePanel() {
    setPanelOpen(false);
  }

  function openGarbageCalendar() {
    // LINE内ブラウザでも迷子にならないよう、同じタブで開く。
    const pref   = document.getElementById("pref")?.value || "";
    const region = document.getElementById("region")?.value || "";
    const params = new URLSearchParams();
    if (pref)   params.set("pref",   pref);
    if (region) params.set("region", region);
    const url = "garbage-calendar.html" + (params.toString() ? "?" + params.toString() : "");
    location.href = url;
  }

  function init() {
    applyAll();

    // 長い設定画面は見出しをタップして折りたためる。
    document.querySelectorAll(".settings-section").forEach(section => {
      const title = section.querySelector(":scope > .settings-section-title");
      if (!title) return;
      title.tabIndex = 0;
      title.setAttribute("role", "button");
      title.setAttribute("aria-expanded", "true");
      const toggle = () => {
        const collapsed = section.classList.toggle("collapsed");
        title.setAttribute("aria-expanded", String(!collapsed));
      };
      title.addEventListener("click", toggle);
      title.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } });
    });

    const bgPicker    = document.getElementById("bgPicker");
    const themeSelect = document.getElementById("themeSelect");
    const fontSizeSel = document.getElementById("fontSize");
    const darkToggle  = document.getElementById("darkToggle");
    const resetBtn    = document.getElementById("resetBgBtn");
    const gcBtn       = document.getElementById("garbageCalBtn");
    const saved = JSON.parse(localStorage.getItem("userSettings") || "{}");
    const todayPicker = document.getElementById("todayNotifyTimePicker");
    const previousPicker = document.getElementById("previousNotifyTimePicker");
    const todayList = document.getElementById("todayNotifyTimeList");
    const previousList = document.getElementById("previousNotifyTimeList");
    let todayTimes = Array.isArray(saved.todayNotifyTimes) ? [...new Set(saved.todayNotifyTimes)] : ["07:00"];
    let previousTimes = Array.isArray(saved.previousNotifyTimes) ? [...new Set(saved.previousNotifyTimes)] : ["20:00"];
    const pauseUntil = document.getElementById("pauseUntil");
    const garbageReminder = document.getElementById("garbageReminder");
    const garbageReminderTime = document.getElementById("garbageReminderTime");
    const eventReminderEnabled = document.getElementById("eventReminderEnabled");
    const notifyEnabled = document.getElementById("notifyEnabled");
    const locationMode = document.getElementById("locationMode");
    const saveStatus = document.getElementById("notificationSaveStatus");
    const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");
    todayTimes = todayTimes.filter(validTime).sort();
    previousTimes = previousTimes.filter(validTime).sort();

    function renderTimeList(container, values, onRemove) {
      if (!container) return;
      container.innerHTML = "";
      if (!values.length) {
        const empty = document.createElement("span");
        empty.className = "time-list-empty";
        empty.textContent = "通知なし";
        container.appendChild(empty);
        return;
      }
      values.forEach(time => {
        const chip = document.createElement("span");
        chip.className = "time-chip";
        const label = document.createElement("span");
        label.textContent = time;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.setAttribute("aria-label", `${time}の通知を削除`);
        remove.textContent = "×";
        remove.onclick = () => onRemove(time);
        chip.append(label, remove);
        container.appendChild(chip);
      });
    }

    function renderToday() {
      renderTimeList(todayList, todayTimes, time => {
        todayTimes = todayTimes.filter(value => value !== time);
        renderToday();
        autoSaveNotifications();
      });
    }
    function renderPrevious() {
      renderTimeList(previousList, previousTimes, time => {
        previousTimes = previousTimes.filter(value => value !== time);
        renderPrevious();
        autoSaveNotifications();
      });
    }
    renderToday();
    renderPrevious();

    function notificationSettings() {
      return {
        notifyEnabled: notifyEnabled?.checked !== false,
        todayNotifyTimes: todayTimes,
        previousNotifyTimes: previousTimes,
        pauseUntil: pauseUntil?.value || "",
        garbageReminder: garbageReminder?.checked !== false,
        garbageReminderTime: garbageReminderTime?.value || "20:00",
        eventReminderEnabled: eventReminderEnabled?.checked !== false,
        pref: document.getElementById("pref")?.value || "",
        region: document.getElementById("region")?.value || "",
        gpsLat: localStorage.getItem("gpsLat"),
        gpsLon: localStorage.getItem("gpsLon")
      };
    }

    let saveTimer = null;
    function autoSaveNotifications() {
      if (saveStatus) saveStatus.textContent = "保存中…";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        const synced = await Storage.syncUserSettings(notificationSettings());
        if (saveStatus) saveStatus.textContent = synced
          ? "✓ 自動保存しました"
          : "端末に保存済み・オンライン時に同期します";
      }, 350);
    }

    document.getElementById("addTodayNotifyTime")?.addEventListener("click", () => {
      if (!validTime(todayPicker.value)) return alert("時計から時刻を選んでください");
      todayTimes = [...new Set([...todayTimes, todayPicker.value])].sort();
      todayPicker.value = ""; renderToday(); autoSaveNotifications();
    });
    document.getElementById("addPreviousNotifyTime")?.addEventListener("click", () => {
      if (!validTime(previousPicker.value)) return alert("時計から時刻を選んでください");
      previousTimes = [...new Set([...previousTimes, previousPicker.value])].sort();
      previousPicker.value = ""; renderPrevious(); autoSaveNotifications();
    });
    if (pauseUntil) pauseUntil.value = saved.pauseUntil || "";
    if (notifyEnabled) notifyEnabled.checked = saved.notifyEnabled !== false;
    if (garbageReminder) garbageReminder.checked = saved.garbageReminder !== false;
    if (garbageReminderTime) garbageReminderTime.value = saved.garbageReminderTime || "20:00";
    if (eventReminderEnabled) eventReminderEnabled.checked = saved.eventReminderEnabled !== false;
    if (locationMode) locationMode.value = localStorage.getItem("locationMode") || "address";

    if (bgPicker)    bgPicker.onchange    = onBgPickerChange;
    if (themeSelect) themeSelect.onchange = () => onThemeChange(themeSelect.value);
    if (fontSizeSel) fontSizeSel.onchange = () => onFontSizeChange(fontSizeSel.value);
    if (darkToggle)  darkToggle.onchange  = toggleDarkMode;
    if (resetBtn)    resetBtn.onclick     = resetBackground;
    if (gcBtn)       gcBtn.onclick        = openGarbageCalendar;
    document.getElementById("closeSettingsBtn")?.addEventListener("click", closePanel);
    document.getElementById("settingsScrim")?.addEventListener("click", closePanel);
    document.addEventListener("keydown", event => {
      const panel = document.getElementById("settings");
      if (!panel?.classList.contains("open")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...panel.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.closest(".collapsed"));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    notifyEnabled?.addEventListener("change", autoSaveNotifications);
    pauseUntil?.addEventListener("change", autoSaveNotifications);
    garbageReminder?.addEventListener("change", autoSaveNotifications);
    garbageReminderTime?.addEventListener("change", autoSaveNotifications);
    eventReminderEnabled?.addEventListener("change", autoSaveNotifications);
    document.getElementById("testLineBtn")?.addEventListener("click", async () => {
      try {
        await Storage.testLineNotification();
        localStorage.setItem("lineTestSucceeded", "yes");
        Ready2GoFeatures?.refresh?.();
        alert("LINEへテスト通知を送りました");
      }
      catch(e) { alert(e.message); }
    });
    document.getElementById("exportBtn")?.addEventListener("click", async () => {
      try {
        const method = await Storage.exportData();
        alert(method === "shared"
          ? "共有先へバックアップを保存しました"
          : "バックアップをダウンロードしました");
      }
      catch(e) { alert(e.message); }
    });
    const importFile = document.getElementById("importFile");
    document.getElementById("importBtn")?.addEventListener("click", () => {
      if (confirm("現在の予定と設定を、バックアップの内容で置き換えます。続けますか？")) importFile?.click();
    });
    importFile?.addEventListener("change", async () => {
      const file = importFile.files?.[0];
      if (!file) return;
      try {
        await Storage.importData(file);
        alert("バックアップを復元しました。画面を再読み込みします");
        location.reload();
      } catch(e) { alert(e.message); }
      finally { importFile.value = ""; }
    });
    const authStatus = document.getElementById("authStatus");
    if (authStatus) {
      const connected = Storage.hasServer();
      authStatus.textContent = connected ? "✓ LINEログイン済み・同期できます" : "LINEログインが必要です（端末保存は利用できます）";
      authStatus.classList.toggle("connected", connected);
      authStatus.classList.toggle("required", !connected);
    }
    const version = document.getElementById("appVersion");
    if (version) version.textContent = `Ready2Go v${window.APP_CONFIG?.version || "1.1.0"}`;
    document.getElementById("reloginBtn")?.addEventListener("click", () => {
      sessionStorage.removeItem("lineIdToken");
      location.href = "liff-init.html";
    });
    document.getElementById("deleteAccountBtn")?.addEventListener("click", async event => {
      if (!Storage.hasServer()) return alert("LINEでログインしてから削除してください");
      if (!confirm("サーバー上の予定・設定・通知履歴を削除します。管理中のグループと共有予定も削除され、この操作は元に戻せません。続けますか？")) return;
      if (prompt("確認のため「削除」と入力してください") !== "削除") return alert("削除を中止しました");
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await Storage.deleteAccount();
        await Storage.clearLocalData();
        alert("アカウントと保存データを削除しました");
        location.href = "liff-init.html";
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });
    locationMode?.addEventListener("change", () => {
      localStorage.setItem("locationMode", locationMode.value);
      if (locationMode.value === "address") {
        localStorage.removeItem("gpsLat"); localStorage.removeItem("gpsLon");
      }
      location.reload();
    });
    Storage.updateSyncStatus();
  }

  return { init, togglePanel, closePanel, applyAll };
})();
