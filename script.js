// script.js — アプリ初期化・イベント登録

(async () => {
  // DOM確実に待つ
  if (document.readyState === "loading") {
    await new Promise(r => document.addEventListener("DOMContentLoaded", r));
  }

  let authNoticeShown = false;
  window.addEventListener("ready2go:authrequired", () => {
    const status = document.getElementById("authStatus");
    if (status) {
      status.textContent = "LINEログインの期限が切れました。ログインし直してください";
      status.classList.remove("connected");
      status.classList.add("required");
    }
    if (!authNoticeShown) {
      authNoticeShown = true;
      Ready2GoFeatures?.toast?.("LINEログインの更新が必要です");
    }
  });

  // IndexedDB を開く（エラーでも続行）
  try { await Storage.open(); } catch(e) { console.warn("Storage open failed:", e); }

  // ログイン済みなら、端末を替えてもサーバー側の設定を復元する。
  try { await Storage.loadUserSettings(); } catch(e) { console.warn("設定の復元に失敗:", e); }
  try { await Storage.syncAllToServer(); } catch(e) { console.warn("未同期データの送信に失敗:", e); }

  // 保存・LINE連携・位置情報について最初に説明し、同意後だけ利用する。
  if (localStorage.getItem("consentData") !== "yes") {
    const modal = document.getElementById("consentModal");
    modal.hidden = false;
    await new Promise(resolve => {
      document.getElementById("consentStart").onclick = () => {
        if (!document.getElementById("consentData").checked) {
          alert("予定を保存するため、データ保存への同意が必要です"); return;
        }
        localStorage.setItem("consentData", "yes");
        const allowLocation = document.getElementById("consentLocation").checked;
        localStorage.setItem("consentLocation", allowLocation ? "yes" : "no");
        // 位置情報への同意はGPS優先の設定を意味しない。住所を既定値にする。
        localStorage.setItem("locationMode", "address");
        modal.hidden = true; resolve();
      };
    });
  }

  if (localStorage.getItem("locationMode") === "gps" && localStorage.getItem("consentLocation") === "yes") {
    if (!Weather.loadSavedGps()) await Weather.requestLocation();
  }

  // ── 都道府県セレクト ──────────────────────────────────
  const prefSel = document.getElementById("pref");
  if (prefSel) {
    Object.keys(Weather.PREF_MAP).forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      prefSel.appendChild(opt);
    });
    const savedPref = localStorage.getItem("pref") || "東京都";
    prefSel.value = savedPref;

    prefSel.onchange = async () => {
      localStorage.setItem("pref", prefSel.value);
      updateRegionSelect(prefSel.value);
      await loadAndDraw();
      await Dashboard?.refresh?.();
      await Ready2GoFeatures?.refresh?.();
    };

    // 初期地域リスト
    updateRegionSelect(savedPref);
  }

  // ── 市区町村セレクト ──────────────────────────────────
  function updateRegionSelect(pref) {
    const regionSel = document.getElementById("region");
    if (!regionSel) return;
    regionSel.innerHTML = '<option value="">地域を選択（ゴミ収集日表示）</option>';
    const regions = Garbage.getRegions(pref);
    regions.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      regionSel.appendChild(opt);
    });
    const saved = localStorage.getItem("region_" + pref);
    if (saved && regions.includes(saved)) regionSel.value = saved;
  }

  const regionSel = document.getElementById("region");
  if (regionSel) {
    regionSel.onchange = () => {
      const pref = prefSel?.value || "東京都";
      localStorage.setItem("region_" + pref, regionSel.value);
      // 予定タブが見えていなければ、次に開いたときに描き直す。
      Calendar.markDirty();
      if (!document.getElementById("calendarSection")?.hidden) Calendar.draw();
      Dashboard?.refresh?.();
      Ready2GoFeatures?.refresh?.();
    };
  }

  // ── 設定パネルを初期化 ─────────────────────────────────
  Settings.init();

  document.querySelectorAll(".view-btn").forEach(btn => btn.addEventListener("click", () => Calendar.setView(btn.dataset.view)));
  document.querySelectorAll(".view-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === (localStorage.getItem("calendarView") || "month")));

  let currentTab = "todaySection";
  function updateBottomNavigation(settingsOpen = false) {
    document.querySelectorAll(".bottom-nav-item").forEach(button => {
      const active = settingsOpen ? button.id === "bottomSettings" : button.dataset.target === currentTab;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }
  // ごみ画面は同じアプリ内のタブとして埋め込む。初回だけ読み込み、地域が変わったら再読み込み。
  let garbageFrameRegion = null;
  function currentRegionKey() {
    const pref = document.getElementById("pref")?.value || "";
    return `${pref}::${document.getElementById("region")?.value || ""}`;
  }
  function loadGarbageFrame() {
    const frame = document.getElementById("garbageFrame");
    if (!frame) return;
    const regionKey = currentRegionKey();
    if (garbageFrameRegion === regionKey && frame.src) return;
    garbageFrameRegion = regionKey;
    const params = new URLSearchParams({ embed: "1" });
    const pref = document.getElementById("pref")?.value, region = document.getElementById("region")?.value;
    if (pref) params.set("pref", pref);
    if (region) params.set("region", region);
    frame.src = `garbage-calendar.html?${params}`;
  }
  // 埋め込んだごみ画面で地域や収集日が変わったら、ホームと予定にも反映する。
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.data?.type !== "ready2go:garbagechange") return;
    const savedPref = localStorage.getItem("pref");
    if (prefSel && savedPref && prefSel.value !== savedPref) {
      prefSel.value = savedPref;
      updateRegionSelect(savedPref);
    }
    const savedRegion = localStorage.getItem("region_" + (prefSel?.value || ""));
    const regionSelect = document.getElementById("region");
    if (regionSelect && savedRegion && regionSelect.value !== savedRegion
      && [...regionSelect.options].some(option => option.value === savedRegion)) {
      regionSelect.value = savedRegion;
    }
    garbageFrameRegion = currentRegionKey();
    Calendar.markDirty();
    Dashboard?.refresh?.();
    Ready2GoFeatures?.refresh?.();
  });

  let gpsCheckedAt = 0;
  function showTab(targetId, smooth = false) {
    const target = document.getElementById(targetId);
    if (!target?.classList.contains("app-tab-panel")) return;
    const changed = currentTab !== targetId;
    currentTab = targetId;
    document.querySelectorAll(".app-tab-panel").forEach(panel => { panel.hidden = panel.id !== targetId; });
    document.body.dataset.tab = targetId;
    updateBottomNavigation(false);
    const addButton = document.getElementById("quickAddEvent");
    if (addButton) addButton.hidden = targetId !== "calendarSection";
    Settings.closePanel();
    // 変更があったときだけ描き直す（毎回の通信と再描画をしない）。
    if (targetId === "calendarSection") Calendar.drawIfNeeded();
    if (targetId === "weatherSection") {
      Weather.renderDetails();
      // 現在地の取得は重いので10分に1回まで。
      if (Date.now() - gpsCheckedAt > 10 * 60_000) {
        gpsCheckedAt = Date.now();
        Weather.loadGpsComparison().catch(console.warn);
      }
    }
    if (targetId === "garbageSection") loadGarbageFrame();
    localStorage.setItem("ready2goCurrentTab", targetId);
    if (changed) window.scrollTo({ top:0, behavior:smooth ? "smooth" : "auto" });
  }
  window.openAppTab = showTab;
  document.querySelectorAll(".bottom-nav-item[data-target]").forEach(btn => btn.addEventListener("click", () => showTab(btn.dataset.target)));
  document.getElementById("bottomSettings")?.addEventListener("click", e => {
    // 開いた直後にdocument側の「パネル外クリック」で閉じないようにする。
    e.preventDefault();
    e.stopPropagation();
    Settings.togglePanel();
  });
  window.addEventListener("ready2go:settingschange", event => updateBottomNavigation(!!event.detail?.open));
  document.getElementById("weatherRefreshBtn")?.addEventListener("click", async event => {
    const button = event.currentTarget; button.disabled = true; button.textContent = "更新中…";
    document.getElementById("weatherSection")?.setAttribute("aria-busy", "true");
    try { await Weather.load(); await Dashboard.refresh(); }
    finally {
      button.disabled = false;
      button.textContent = "↻ 更新";
      document.getElementById("weatherSection")?.setAttribute("aria-busy", "false");
    }
  });
  document.getElementById("todayBtn")?.addEventListener("click", () => Calendar.goToday());
  document.getElementById("quickAddEvent")?.addEventListener("click", () => Calendar.openModal(Calendar.keyFromDate(new Date())));

  // ── 週送りボタン ──────────────────────────────────────
  document.getElementById("prevWeek")?.addEventListener("click", (e) => {
    e.preventDefault();
    Calendar.moveWeek(-1);
  });
  document.getElementById("nextWeek")?.addEventListener("click", (e) => {
    e.preventDefault();
    Calendar.moveWeek(1);
  });

  // カレンダー上の横スワイプで前後の期間へ移動する。
  const calendarSection = document.getElementById("calendarSection");
  const calendarSwipeArea = calendarSection?.querySelector(".calendar-section");
  let swipeStartX = null;
  let swipeStartY = null;
  calendarSwipeArea?.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
  }, { passive:true });
  calendarSwipeArea?.addEventListener("touchend", e => {
    if (swipeStartX == null || swipeStartY == null) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - swipeStartX;
    const dy = touch.clientY - swipeStartY;
    swipeStartX = null;
    swipeStartY = null;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    Calendar.moveWeek(dx < 0 ? 1 : -1);
  }, { passive:true });
  calendarSwipeArea?.addEventListener("touchcancel", () => {
    swipeStartX = null;
    swipeStartY = null;
  }, { passive:true });

  // ── ハンバーガーメニュー ───────────────────────────────
  document.getElementById("menuTrigger")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    Settings.togglePanel();
  });

  setInterval(() => Calendar.checkNotifications(), 60_000);

  // ── パネル外クリックで閉じる ───────────────────────────
  document.addEventListener("click", e => {
    const wdPanel   = document.getElementById("weatherDetailPanel");
    if (wdPanel?.classList.contains("open") && !wdPanel.contains(e.target)) {
      wdPanel.classList.remove("open");
    }
  });

  // Direct navigation: select requested tab before waiting for weather or synchronization.
  const requestedPage = new URLSearchParams(location.search).get("open");
  const TAB_BY_PARAM = { calendar:"calendarSection", weather:"weatherSection", garbage:"garbageSection", home:"todaySection" };
  const desiredTab = TAB_BY_PARAM[requestedPage] || null;
  if (desiredTab) showTab(desiredTab, false);
  // ── 初回ロード ─────────────────────────────────────────
  await loadAndDraw();
  await Dashboard.init();
  gpsCheckedAt = Date.now();
  Weather.loadGpsComparison().catch(console.warn);
  await Ready2GoFeatures.init();

  const openTarget = requestedPage;
  if (TAB_BY_PARAM[openTarget]) showTab(TAB_BY_PARAM[openTarget], false);
  else {
    const savedTab = localStorage.getItem("ready2goCurrentTab");
    showTab(Object.values(TAB_BY_PARAM).includes(savedTab) ? savedTab : "todaySection", false);
  }
  if (openTarget === "settings") {
    Settings.togglePanel();
  }
  if (openTarget === "tomorrow") document.getElementById("tomorrowSection")?.scrollIntoView();

  async function loadAndDraw() {
    try { await Weather.load(); } catch(e) { console.warn("Weather load failed:", e); }
    try { await Calendar.draw(); } catch(e) { console.warn("Calendar draw failed:", e); }
  }

  // PWA: 対応ブラウザではホーム画面へ追加できる。
  let installPrompt = null;
  const installBtn = document.getElementById("installAppBtn");
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); installPrompt = e; installBtn.hidden = false;
  });
  installBtn?.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; installBtn.hidden = true;
  });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("service-worker.js").catch(e => console.warn("PWA登録失敗", e));
  }

  // グローバル公開
  window.toggleSettings  = () => Settings.togglePanel();
  window.moveWeek        = (n) => Calendar.moveWeek(n);
  window.resetBackground = () => {
    localStorage.removeItem("bg");
    document.body.style.backgroundImage = "";
  };
})();
