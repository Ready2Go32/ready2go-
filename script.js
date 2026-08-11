// script.js — アプリ初期化・イベント登録

(async () => {
  // DOM確実に待つ
  if (document.readyState === "loading") {
    await new Promise(r => document.addEventListener("DOMContentLoaded", r));
  }

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
        localStorage.setItem("locationMode", allowLocation ? "gps" : "address");
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

    prefSel.onchange = () => {
      localStorage.setItem("pref", prefSel.value);
      updateRegionSelect(prefSel.value);
      loadAndDraw();
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
      Calendar.draw();
      Dashboard?.refresh?.();
    };
  }

  // ── 設定パネルを初期化 ─────────────────────────────────
  Settings.init();
  if (new URLSearchParams(location.search).get("open") === "settings") Settings.togglePanel();

  document.querySelectorAll(".view-btn").forEach(btn => btn.addEventListener("click", () => Calendar.setView(btn.dataset.view)));
  document.querySelectorAll(".view-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === (localStorage.getItem("calendarView") || "month")));

  document.querySelectorAll(".bottom-nav-item[data-target]").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".bottom-nav-item").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.target)?.scrollIntoView({ behavior:"smooth" });
  }));
  document.getElementById("bottomGarbage")?.addEventListener("click", () => location.href = "garbage-calendar.html");
  document.getElementById("bottomSettings")?.addEventListener("click", () => Settings.togglePanel());

  // ── 週送りボタン ──────────────────────────────────────
  document.getElementById("prevWeek")?.addEventListener("click", (e) => {
    e.preventDefault();
    Calendar.moveWeek(-1);
  });
  document.getElementById("nextWeek")?.addEventListener("click", (e) => {
    e.preventDefault();
    Calendar.moveWeek(1);
  });

  // ── ハンバーガーメニュー ───────────────────────────────
  document.getElementById("menuTrigger")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    Settings.togglePanel();
  });

  // ── 通知許可（一度聞いたら次からは出さない） ───────────
  if ("Notification" in window && Notification.permission === "default") {
    if (!localStorage.getItem("notifAsked")) {
      Notification.requestPermission().then(() => {
        localStorage.setItem("notifAsked", "1");
      });
    }
  }
  setInterval(() => Calendar.checkNotifications(), 60_000);

  // ── パネル外クリックで閉じる ───────────────────────────
  document.addEventListener("click", e => {
    const settings  = document.getElementById("settings");
    const trigger   = document.getElementById("menuTrigger");
    const wdPanel   = document.getElementById("weatherDetailPanel");

    if (settings?.classList.contains("open")
        && !settings.contains(e.target) && !trigger.contains(e.target)) {
      settings.classList.remove("open");
    }
    if (wdPanel?.classList.contains("open") && !wdPanel.contains(e.target)) {
      wdPanel.classList.remove("open");
    }
  });

  // ── 初回ロード ─────────────────────────────────────────
  await loadAndDraw();
  await Dashboard.init();

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
