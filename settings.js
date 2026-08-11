// settings.js — 設定画面の管理
// 依存: なし（DOM が存在すること）

const Settings = (() => {

  function applyAll() {
    applyBackground();
    applyTheme();
    applyFontSize();
    applyDarkMode();
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
    const theme = localStorage.getItem("theme");
    if (!theme) return;
    document.documentElement.style.setProperty("--accent", theme);
    const sel = document.getElementById("themeSelect");
    if (sel) sel.value = theme;
  }

  function onThemeChange(value) {
    localStorage.setItem("theme", value);
    document.documentElement.style.setProperty("--accent", value);
  }

  function applyFontSize() {
    const size = localStorage.getItem("fontSize");
    if (!size) return;
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
  }

  function togglePanel() {
    const panel = document.getElementById("settings");
    if (!panel) return;
    const isOpen = panel.classList.contains("open");
    panel.classList.toggle("open", !isOpen);
  }

  function openGarbageCalendar() {
    // ゴミ収集カレンダーページを別タブで開く
    const pref   = document.getElementById("pref")?.value || "";
    const region = document.getElementById("region")?.value || "";
    const params = new URLSearchParams();
    if (pref)   params.set("pref",   pref);
    if (region) params.set("region", region);
    const url = "garbage-calendar.html" + (params.toString() ? "?" + params.toString() : "");
    window.open(url, "_blank");
    // 設定パネルを閉じる
    togglePanel();
  }

  function init() {
    applyAll();

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
        todayNotifyTimes: todayTimes,
        previousNotifyTimes: previousTimes,
        pauseUntil: pauseUntil?.value || "",
        garbageReminder: garbageReminder?.checked !== false,
        garbageReminderTime: garbageReminderTime?.value || "20:00",
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
    if (garbageReminder) garbageReminder.checked = saved.garbageReminder !== false;
    if (garbageReminderTime) garbageReminderTime.value = saved.garbageReminderTime || "20:00";
    if (locationMode) locationMode.value = localStorage.getItem("locationMode") || "address";

    if (bgPicker)    bgPicker.onchange    = onBgPickerChange;
    if (themeSelect) themeSelect.onchange = () => onThemeChange(themeSelect.value);
    if (fontSizeSel) fontSizeSel.onchange = () => onFontSizeChange(fontSizeSel.value);
    if (darkToggle)  darkToggle.onchange  = toggleDarkMode;
    if (resetBtn)    resetBtn.onclick     = resetBackground;
    if (gcBtn)       gcBtn.onclick        = openGarbageCalendar;
    pauseUntil?.addEventListener("change", autoSaveNotifications);
    garbageReminder?.addEventListener("change", autoSaveNotifications);
    garbageReminderTime?.addEventListener("change", autoSaveNotifications);
    document.getElementById("testLineBtn")?.addEventListener("click", async () => {
      try { await Storage.testLineNotification(); alert("LINEへテスト通知を送りました"); }
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
    locationMode?.addEventListener("change", () => {
      localStorage.setItem("locationMode", locationMode.value);
      if (locationMode.value === "address") {
        localStorage.removeItem("gpsLat"); localStorage.removeItem("gpsLon");
      }
      location.reload();
    });
    Storage.updateSyncStatus();
  }

  return { init, togglePanel, applyAll };
})();
