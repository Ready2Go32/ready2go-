// features.js — 初回ガイド、明日の準備、通知履歴、テスト報告、グループ共有
const Ready2GoFeatures = (() => {
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const tomorrow = () => { const value = new Date(); value.setDate(value.getDate() + 1); return value; };

  function toast(message) {
    document.querySelector(".app-toast")?.remove();
    const el = document.createElement("div");
    el.className = "app-toast"; el.textContent = message;
    el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 250); }, 2200);
  }

  function modal(title, html) {
    const previousFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "modal feature-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "featureModalTitle");
    overlay.innerHTML = `<div class="card feature-modal-card"><div class="card-header"><h3 id="featureModalTitle">${escapeHtml(title)}</h3><button type="button" class="card-close" aria-label="閉じる">✕</button></div><div class="feature-modal-body">${html}</div></div>`;
    document.body.appendChild(overlay);
    document.body.classList.add("modal-open");
    const onKeydown = event => { if (event.key === "Escape") close(); };
    const close = () => {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      document.body.classList.remove("modal-open");
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
    overlay.querySelector(".card-close").onclick = close;
    overlay.onclick = event => { if (event.target === overlay) close(); };
    document.addEventListener("keydown", onKeydown);
    requestAnimationFrame(() => overlay.querySelector(".card-close")?.focus());
    return overlay;
  }

  async function renderSetup() {
    const guide = document.getElementById("setupGuide");
    if (!guide) return;
    const settings = JSON.parse(localStorage.getItem("userSettings") || "{}");
    const pref = document.getElementById("pref")?.value || localStorage.getItem("pref") || "";
    const region = document.getElementById("region")?.value || localStorage.getItem(`region_${pref}`) || "";
    const area = localStorage.getItem(`area_${pref}_${region}`) || settings.area || "";
    const steps = [
      { label:"LINEログイン", done:!!Storage.getLineIdToken(), action:"login" },
      { label:"住所・地区の選択", done:!!(pref && region && area), action:"location" },
      { label:"通知時刻の設定", done:Array.isArray(settings.todayNotifyTimes) && settings.todayNotifyTimes.length > 0, action:"notification" },
      { label:"LINEテスト通知", done:localStorage.getItem("lineTestSucceeded") === "yes", action:"test" },
      { label:"設定完了", done:localStorage.getItem("setupComplete") === "yes", action:"complete" }
    ];
    const completed = steps.filter(step => step.done).length;
    guide.hidden = completed === steps.length && localStorage.getItem("showSetupGuide") !== "yes";
    document.getElementById("setupProgressText").textContent = `${completed}/5完了`;
    document.getElementById("setupProgressBar").style.width = `${completed * 20}%`;
    document.getElementById("setupSteps").innerHTML = steps.map((step, index) => `<button type="button" data-setup="${step.action}" class="${step.done ? "done" : ""}"><span>${step.done ? "✓" : index + 1}</span><b>${step.label}</b><small>${step.done ? "完了" : "設定する"}</small></button>`).join("");
    guide.querySelectorAll("[data-setup]").forEach(button => button.addEventListener("click", async () => {
      const action = button.dataset.setup;
      if (action === "login") location.href = "liff-init.html";
      if (action === "location") location.href = "garbage-calendar.html";
      if (action === "notification") Settings.togglePanel();
      if (action === "test") document.getElementById("testLineBtn")?.click();
      if (action === "complete") {
        localStorage.setItem("setupComplete", "yes"); localStorage.removeItem("showSetupGuide");
        toast("初回設定が完了しました"); await renderSetup();
      }
    }));
  }

  async function renderTomorrow() {
    const target = tomorrow(), key = dateKey(target);
    const events = await Storage.getEvents(key).catch(() => []);
    const shared = await Storage.getGroupEventsForDates([key]).catch(() => ({}));
    const allEvents = [...events, ...(shared[key] || [])].sort((a,b) => String(a.time || "").localeCompare(String(b.time || "")));
    document.getElementById("tomorrowDateLabel").textContent = target.toLocaleDateString("ja-JP", { month:"long", day:"numeric", weekday:"short" });
    const weather = Weather.getWeatherMap()[key];
    document.getElementById("tomorrowWeatherBadge").textContent = weather ? `${weather.icon} 最高${weather.temp}℃` : "天気未取得";
    const advice = [];
    if (["☔","🌧️","⚡","☃️"].includes(weather?.icon)) advice.push("傘や雨具を準備しましょう");
    if (weather?.temp >= 30) advice.push("水分を忘れず、暑さに気をつけましょう");
    if (weather?.temp <= 8) advice.push("上着を準備しましょう");
    const adviceEl = document.getElementById("weatherAdvice");
    adviceEl.hidden = !advice.length; adviceEl.textContent = advice.length ? `💡 ${advice.join("・")}` : "";
    document.getElementById("tomorrowEvents").innerHTML = allEvents.length
      ? allEvents.map(event => `<div><b>${escapeHtml(event.time || "--:--")}</b><span>${escapeHtml(event.title)}${event._shared ? ` <small>👥${escapeHtml(event._groupName)}</small>` : ""}</span></div>`).join("")
      : '<p class="empty-note">予定はありません</p>';

    const itemRows = [];
    events.forEach((event, eventIndex) => (event.items || []).forEach((item, itemIndex) => {
      const normalized = typeof item === "string" ? { text:item, done:false } : item;
      if (!normalized.text) return;
      itemRows.push(`<label class="check-item"><input type="checkbox" data-event="${eventIndex}" data-item="${itemIndex}" ${normalized.done ? "checked" : ""}><span>${escapeHtml(normalized.text)}</span><small>${escapeHtml(event.title)}</small></label>`);
    }));
    document.getElementById("tomorrowItems").innerHTML = itemRows.length ? itemRows.join("") : '<p class="empty-note">予定の編集から持ち物を追加できます</p>';
    document.querySelectorAll("#tomorrowItems input[data-event]").forEach(input => input.addEventListener("change", async () => {
      const eventIndex = Number(input.dataset.event), itemIndex = Number(input.dataset.item);
      const event = events[eventIndex];
      event.items = (event.items || []).map(item => typeof item === "string" ? { text:item, done:false } : item);
      event.items[itemIndex].done = input.checked;
      await Storage.updateEvent(key, eventIndex, event);
      toast("持ち物を更新しました");
    }));

    const pref = document.getElementById("pref")?.value || "", region = document.getElementById("region")?.value || "";
    let garbage = [];
    if (region) {
      const schedule = await Garbage.getSchedule(pref, region).catch(() => null);
      if (schedule) garbage = Garbage.getGarbageTypesForDate(target, schedule);
    }
    document.getElementById("tomorrowGarbage").innerHTML = garbage.length
      ? garbage.map(item => `<div><b>${item.icon || "🗑️"}</b><span>${escapeHtml(item.name)}</span></div>`).join("")
      : '<p class="empty-note">収集予定はありません</p>';
  }

  async function openNotifications() {
    const view = modal("🔔 通知履歴とサーバー", '<div id="notificationStatus" class="loading-note">確認中…</div><div id="notificationLogList" class="feature-list"></div>');
    try {
      const [status, logs] = await Promise.all([Storage.getServerStatus(), Storage.getNotificationLogs()]);
      view.querySelector("#notificationStatus").innerHTML = `<div class="status-panel status-good"><b>● サーバー稼働中</b><small>保存先: ${escapeHtml(status.storage)}／確認: ${new Date(status.checkedAt).toLocaleString("ja-JP")}</small></div>`;
      const list = view.querySelector("#notificationLogList");
      list.innerHTML = logs.length ? logs.map(log => `<article><span class="log-status ${log.status}">${log.status === "sent" ? "送信済み" : log.status === "retried" ? "再送済み" : "失敗"}</span><b>${escapeHtml(log.type)}</b><small>${new Date(log.createdAt).toLocaleString("ja-JP")}</small><p>${escapeHtml(log.text).slice(0,160)}</p>${log.error ? `<em>${escapeHtml(log.error)}</em>` : ""}<button type="button" class="btn-outline-sm" data-resend="${escapeHtml(log.id)}">再送する</button></article>`).join("") : '<p class="empty-note">通知履歴はまだありません。LINEテスト通知を送ると表示されます。</p>';
      list.querySelectorAll("[data-resend]").forEach(button => button.onclick = async () => {
        button.disabled = true;
        try { await Storage.resendNotification(button.dataset.resend); toast("LINE通知を再送しました"); }
        catch (error) { alert(error.message); }
        finally { button.disabled = false; }
      });
    } catch (error) {
      view.querySelector("#notificationStatus").innerHTML = `<div class="status-panel status-bad"><b>確認できません</b><small>${escapeHtml(error.message)}</small></div>`;
    }
  }

  function openMunicipal() {
    const entries = MunicipalGarbageData.list();
    const nowKey = dateKey(new Date());
    modal("🏢 自治体データ管理", `<div class="feature-list municipal-list">${entries.map(entry => {
      const daysLeft = Math.ceil((new Date(`${entry.validUntil}T23:59:59`) - new Date()) / 86400000);
      const expired = nowKey > entry.validUntil, soon = !expired && daysLeft <= 45;
      const label = expired ? "更新必要" : soon ? `更新まで${daysLeft}日` : "利用可能";
      return `<article><span class="log-status ${expired || soon ? "failed" : "sent"}">${label}</span><b>${escapeHtml(entry.pref)} ${escapeHtml(entry.region)} ${escapeHtml(entry.district)}</b><p>${escapeHtml(entry.areas.join("、"))}</p><small>有効期間: ${escapeHtml(entry.validFrom)}〜${escapeHtml(entry.validUntil)}<br>最終確認: ${escapeHtml(entry.checkedAt.slice(0,10))}</small><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener">自治体公式情報を確認</a></article>`;
    }).join("")}</div><button type="button" class="btn-outline-sm" id="municipalReport">情報の間違いを報告</button>`).querySelector("#municipalReport").onclick = openFeedback;
  }

  async function fileToDataUrl(file) {
    if (!file) return "";
    if (file.size > 500000) throw new Error("画像は500KB以下にしてください");
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  }

  async function openFeedback() {
    const view = modal("🧪 テスト報告・改善投票", `<form id="feedbackForm" class="feature-form"><label>種類<select name="type"><option value="bug">不具合</option><option value="idea">改善アイデア</option></select></label><label>内容<textarea name="message" rows="4" maxlength="500" required placeholder="どの画面で何が起きたか、または欲しい機能"></textarea></label><label>スクリーンショット（任意・500KB以下）<input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp"><small class="form-help">氏名・顔・学校名など、不要な個人情報が写っていない画像だけを選んでください。</small></label><button type="submit" class="btn-primary">報告を送る</button></form><h4>みんなの改善案</h4><div id="feedbackList" class="feature-list"><p class="loading-note">読み込み中…</p></div>`);
    const load = async () => {
      try {
        const items = await Storage.getFeedback();
        const list = view.querySelector("#feedbackList");
        list.innerHTML = items.length ? items.map(item => `<article><span class="log-status ${item.type === "bug" ? "failed" : "sent"}">${item.type === "bug" ? "不具合" : "アイデア"}</span><p>${escapeHtml(item.message)}</p><small>${new Date(item.createdAt).toLocaleDateString("ja-JP")}${item.hasScreenshot ? "・画像あり" : ""}</small><button type="button" class="vote-btn ${item.voted ? "active" : ""}" data-vote="${escapeHtml(item.id)}">👍 ${item.votes}</button></article>`).join("") : '<p class="empty-note">報告はまだありません</p>';
        list.querySelectorAll("[data-vote]").forEach(button => button.onclick = async () => { await Storage.voteFeedback(button.dataset.vote); await load(); });
      } catch (error) { view.querySelector("#feedbackList").innerHTML = `<p class="empty-note">${escapeHtml(error.message)}</p>`; }
    };
    view.querySelector("#feedbackForm").onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector("button"); button.disabled = true;
      try {
        const screenshot = await fileToDataUrl(form.screenshot.files[0]);
        await Storage.submitFeedback({ type:form.type.value, message:form.message.value, screenshot });
        form.reset(); toast("報告を送信しました"); await load();
      } catch (error) { alert(error.message); }
      finally { button.disabled = false; }
    };
    await load();
  }

  async function openGroups() {
    const view = modal("👥 家族・グループ共有", `<div class="group-actions"><form id="createGroup"><input name="name" maxlength="40" placeholder="グループ名（例：家族）" required><button class="btn-primary">作成</button></form><form id="joinGroup"><input name="code" maxlength="20" placeholder="招待コード" required><button class="btn-secondary">参加</button></form></div><p class="settings-note">共有予定を作るときは、予定追加画面の「保存先」でグループを選びます。個人予定は共有されません。</p><div id="groupList" class="feature-list"><p class="loading-note">読み込み中…</p></div>`);
    const load = async () => {
      try {
        const groups = await Storage.getGroups();
        const list = view.querySelector("#groupList");
        list.innerHTML = groups.length ? groups.map(group => `<article><b>${escapeHtml(group.name)}</b><small>${group.memberCount}人${group.isOwner ? "・管理者" : ""}</small>${group.inviteCode ? `<p class="invite-code">招待コード <strong>${escapeHtml(group.inviteCode)}</strong></p>` : ""}<button type="button" class="btn-outline-sm" data-group-remove="${escapeHtml(group.id)}" data-owner="${group.isOwner ? "yes" : "no"}">${group.isOwner ? "グループを削除" : "グループから退出"}</button></article>`).join("") : '<p class="empty-note">参加中のグループはありません</p>';
        list.querySelectorAll("[data-group-remove]").forEach(button => button.onclick = async () => {
          const owner = button.dataset.owner === "yes";
          const message = owner
            ? "グループと共有予定を削除します。参加者からも見えなくなります。続けますか？"
            : "このグループから退出しますか？";
          if (!confirm(message)) return;
          button.disabled = true;
          try {
            if (owner) await Storage.deleteGroup(button.dataset.groupRemove);
            else await Storage.leaveGroup(button.dataset.groupRemove);
            toast(owner ? "グループを削除しました" : "グループから退出しました");
            await load();
            window.dispatchEvent(new CustomEvent("ready2go:datachange"));
          } catch (error) { alert(error.message); button.disabled = false; }
        });
      } catch (error) { view.querySelector("#groupList").innerHTML = `<p class="empty-note">${escapeHtml(error.message)}</p>`; }
    };
    view.querySelector("#createGroup").onsubmit = async event => { event.preventDefault(); try { await Storage.createGroup(event.currentTarget.name.value); event.currentTarget.reset(); toast("グループを作成しました"); await load(); } catch (error) { alert(error.message); } };
    view.querySelector("#joinGroup").onsubmit = async event => { event.preventDefault(); try { await Storage.joinGroup(event.currentTarget.code.value); event.currentTarget.reset(); toast("グループに参加しました"); await load(); } catch (error) { alert(error.message); } };
    await load();
  }

  async function checkTestAccess() {
    if (!Storage.hasServer()) return;
    try {
      const status = await Storage.getTestAccess();
      if (!status.required || status.allowed) return;
      const view = modal("🔒 テスト版への招待", '<p>このアプリは公開前のテスト中です。グループから受け取った招待コードを入力してください。</p><form id="testJoin" class="feature-form"><input name="code" required placeholder="招待コード"><button class="btn-primary">テストに参加</button></form>');
      view.querySelector(".card-close").hidden = true;
      view.querySelector("#testJoin").onsubmit = async event => { event.preventDefault(); try { await Storage.joinTest(event.currentTarget.code.value); toast("テストに参加しました"); location.reload(); } catch (error) { alert(error.message); } };
    } catch (error) { if (error.code === "TEST_ACCESS_REQUIRED") return; }
  }

  async function init() {
    document.querySelectorAll("[data-feature]").forEach(button => button.addEventListener("click", () => {
      if (button.dataset.feature === "notifications") openNotifications();
      if (button.dataset.feature === "municipal") openMunicipal();
      if (button.dataset.feature === "feedback") openFeedback();
      if (button.dataset.feature === "groups") openGroups();
    }));
    window.addEventListener("ready2go:datachange", () => { renderTomorrow(); Dashboard?.refresh?.(); });
    await Promise.all([renderSetup(), renderTomorrow(), checkTestAccess()]);
  }

  return { init, refresh: async () => Promise.all([renderSetup(), renderTomorrow()]), toast, openFeedback };
})();
