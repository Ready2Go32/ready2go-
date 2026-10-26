// calendar.js — カレンダー描画・予定管理
// 依存: storage.js, weather.js, garbage.js

const Calendar = (() => {

  let weekStart = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const savedView = localStorage.getItem("calendarView");
  let viewMode = ["month", "week", "agenda"].includes(savedView) ? savedView : "month";

  // タブ切替のたびに通信しないよう、変更があったときだけ描き直す。
  let dirty = true;
  let drawToken = 0;
  window.addEventListener("ready2go:datachange", () => { dirty = true; });

  const DAY_NAMES = ["日","月","火","水","木","金","土"];

  const CATEGORIES = [
    { value:"other",    label:"その他" },
    { value:"school",   label:"学校" },
    { value:"work",     label:"仕事・バイト" },
    { value:"play",     label:"遊び" },
    { value:"hospital", label:"病院" }
  ];
  const CATEGORY_VALUES = CATEGORIES.map(c => c.value);

  // ごみ名を短く表示する（スマホの月表示で絵文字だけにならないように）。
  const GARBAGE_SHORT = [
    [/燃やせない|燃えない|不燃/, "不燃"],
    [/燃やせる|燃える|可燃/, "可燃"],
    [/ペット/, "ペット"],
    [/プラ/, "プラ"],
    [/ビン|カン|びん|かん|缶|瓶/, "ビン缶"],
    [/古紙|古着|紙/, "古紙"],
    [/電池|小型家電/, "電池"],
    [/蛍光管|ライター|体温計/, "蛍光管"],
    [/剪定|枝|草/, "枝"],
    [/粗大/, "粗大"],
    [/資源/, "資源"]
  ];
  function garbageShortName(name) {
    const hit = GARBAGE_SHORT.find(([pattern]) => pattern.test(name));
    return hit ? hit[1] : String(name).slice(0, 3);
  }

  function keyFromDate(d) {
    return d.getFullYear() + "-"
      + String(d.getMonth() + 1).padStart(2, "0") + "-"
      + String(d.getDate()).padStart(2, "0");
  }

  function moveWeek(n) {
    if (viewMode === "month") weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth() + n, 1);
    else if (viewMode === "week") weekStart.setDate(weekStart.getDate() + n * 7);
    else weekStart.setDate(weekStart.getDate() + n * 30);
    draw();
  }

  function setView(mode) {
    viewMode = ["month", "week", "agenda"].includes(mode) ? mode : "month";
    localStorage.setItem("calendarView", viewMode);
    document.querySelectorAll(".view-btn").forEach(b => b.classList.toggle("active", b.dataset.view === viewMode));
    draw();
  }

  function goToday() {
    weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    draw();
  }

  function markDirty() { dirty = true; }
  function drawIfNeeded() { return dirty ? draw() : Promise.resolve(); }

  // ── カレンダー描画 ────────────────────────────────────
  async function draw() {
    const calEl   = document.getElementById("calendar");
    const labelEl = document.getElementById("weekLabel");
    if (!calEl || !labelEl) return;
    const token = ++drawToken;
    dirty = false;

    const wMap = Weather.getWeatherMap();
    const weatherSummary = document.getElementById("calendarWeatherSummary");
    const todayWeather = wMap[keyFromDate(new Date())];
    if (weatherSummary) weatherSummary.textContent = todayWeather ? `今日の天気：${todayWeather.icon} ${todayWeather.text || ""} ${todayWeather.temp ?? "--"}℃` : "今日の天気：天気タブで予報を確認できます";
    const pref   = document.getElementById("pref")?.value || "東京都";
    const region = document.getElementById("region")?.value || "";

    let garbageSchedule = null;
    if (region) {
      try { garbageSchedule = await Garbage.getSchedule(pref, region); } catch(e) {}
    }

    const dates = [];
    let label = "";
    if (viewMode === "month") {
      const first = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
      first.setDate(first.getDate() - first.getDay());
      for (let i=0;i<42;i++) { const d=new Date(first); d.setDate(d.getDate()+i); dates.push(d); }
      label = weekStart.toLocaleDateString("ja-JP", { year:"numeric", month:"long" });
    } else if (viewMode === "week") {
      const start = new Date(weekStart);
      start.setDate(start.getDate() - start.getDay());
      for (let i=0;i<7;i++) { const d=new Date(start); d.setDate(d.getDate()+i); dates.push(d); }
      label = `${dates[0].toLocaleDateString("ja-JP",{month:"numeric",day:"numeric"})} 〜 ${dates[6].toLocaleDateString("ja-JP",{month:"numeric",day:"numeric"})}`;
    } else {
      const start = new Date(weekStart);
      for (let i=0;i<30;i++) { const d=new Date(start); d.setDate(d.getDate()+i); dates.push(d); }
      label = `${dates[0].toLocaleDateString("ja-JP",{month:"numeric",day:"numeric"})} 〜 ${dates[29].toLocaleDateString("ja-JP",{month:"numeric",day:"numeric"})}`;
    }

    const todayKey = keyFromDate(new Date());
    const dateKeys = dates.map(keyFromDate);
    // 個人予定と共有予定を同時に取りに行く。
    const [eventsByDate, sharedByDate] = await Promise.all([
      Storage.getEventsForDates(dateKeys).catch(() => ({})),
      Storage.getGroupEventsForDates(dateKeys).catch(() => ({}))
    ]);
    // 待っている間に別の描画が始まっていたら、古い結果は捨てる。
    if (token !== drawToken) return;

    const eventLists = dateKeys.map(dateKey => [
      ...(eventsByDate[dateKey] || []).map((event, index) => ({ ...event, _localIndex: index })),
      ...(sharedByDate[dateKey] || [])
    ]);

    const fragment = document.createDocumentFragment();
    const usedGarbage = new Map();
    let renderedDays = 0;
    for (let dateIndex = 0; dateIndex < dates.length; dateIndex++) {
      const d = dates[dateIndex];
      const key = keyFromDate(d);
      const isToday = key === todayKey;
      const isSun = d.getDay() === 0;
      const isSat = d.getDay() === 6;

      const box = document.createElement("div");
      const outsideMonth = viewMode === "month" && d.getMonth() !== weekStart.getMonth();
      box.className = "day" + (isToday ? " today" : "") + (isSun ? " sunday" : "") + (isSat ? " saturday" : "") + (outsideMonth ? " outside-month" : "");

      const weather = wMap[key];
      const weatherStr = weather
        ? `${weather.icon} ${weather.temp != null ? weather.temp + "℃" : ""}`
        : "—";

      const header = document.createElement("div");
      header.className = "day-header";
      header.innerHTML = `
        <span class="day-name">${DAY_NAMES[d.getDay()]}</span>
        <span class="day-date">${d.getMonth()+1}/${d.getDate()}</span>
        <span class="day-weather">${weatherStr}</span>
      `;
      if (isToday) {
        const todayBadge = document.createElement("span");
        todayBadge.className = "today-badge";
        todayBadge.textContent = "今日";
        header.prepend(todayBadge);
      }
      box.appendChild(header);

      // ゴミ収集：絵文字だけでは分からないので、短い名前も必ず表示する。
      let garbageTypes = [];
      if (garbageSchedule) {
        garbageTypes = Garbage.getGarbageTypesForDate(d, garbageSchedule);
        if (garbageTypes.length > 0) {
          const gDiv = document.createElement("div");
          gDiv.className = "garbage-row";
          garbageTypes.forEach(g => {
            usedGarbage.set(g.name, g);
            const span = document.createElement("span");
            span.className = "garbage-tag";
            span.style.background = g.color;
            span.title = g.name;
            span.setAttribute("aria-label", `ごみ：${g.name}`);
            const icon = document.createElement("span");
            icon.className = "garbage-icon";
            icon.textContent = g.icon || "🗑️";
            const full = document.createElement("span");
            full.className = "garbage-name";
            full.textContent = g.name;
            const short = document.createElement("span");
            short.className = "garbage-short";
            short.textContent = garbageShortName(g.name);
            span.append(icon, full, short);
            gDiv.appendChild(span);
          });
          box.appendChild(gDiv);
        }
      }

      const events = eventLists[dateIndex]
        .map(ev => ({ ev, originalIdx: ev._localIndex }))
        .sort((a, b) => String(a.ev.time || "").localeCompare(String(b.ev.time || "")));
      if (viewMode === "agenda" && events.length === 0 && garbageTypes.length === 0) continue;

      const visibleEvents = viewMode === "month" ? events.slice(0, 3) : events;
      visibleEvents.forEach(({ ev, originalIdx }) => {
        const div = document.createElement("div");
        const category = CATEGORY_VALUES.includes(ev.category) ? ev.category : "";
        div.className = `event${category ? " " + category : ""}${ev._shared ? " shared-event" : ""}`;
        const timeText = ev.endTime ? `${ev.time || "--:--"}–${ev.endTime}` : (ev.time || "--:--");
        div.innerHTML =
          `<span class="event-text"><span class="event-time">${escapeHtml(timeText)}</span><span class="event-title">${escapeHtml(ev.title)}${ev._shared ? ` <small>👥${escapeHtml(ev._groupName || "共有")}</small>` : ""}</span></span>`
          + `${!ev._shared || ev._canDelete ? '<span class="del-btn" title="削除">✕</span>' : ""}`;

        div.onclick = e => {
          e.stopPropagation();
          ev._shared ? openSharedModal(key, ev) : openModal(key, originalIdx);
        };
        div.querySelector(".del-btn")?.addEventListener("click", async e => {
          e.stopPropagation();
          if (ev._shared) await Storage.deleteGroupEvent(ev._groupId, key, ev.id);
          else await Storage.deleteEvent(key, originalIdx);
          window.dispatchEvent(new Event("ready2go:datachange"));
          draw();
        });
        box.appendChild(div);
      });
      if (viewMode === "month" && events.length > visibleEvents.length) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "month-more";
        more.textContent = `ほか${events.length - visibleEvents.length}件`;
        more.onclick = e => { e.stopPropagation(); weekStart = new Date(d); setView("agenda"); };
        box.appendChild(more);
      }

      box.onclick = () => openModal(key);
      box.setAttribute("title", `${key}に予定を追加（複数登録できます）`);
      fragment.appendChild(box);
      renderedDays++;
    }
    if (viewMode === "agenda" && renderedDays === 0) {
      const empty = document.createElement("div");
      empty.className = "agenda-empty";
      empty.innerHTML = "<b>この期間の予定はありません</b><span>右下の＋から予定を追加できます</span>";
      fragment.appendChild(empty);
    }

    // DOMの入れ替えは最後に1回だけ行い、画面のちらつきと再計算を減らす。
    labelEl.textContent = label;
    calEl.className = `calendar-grid view-${viewMode}`;
    calEl.replaceChildren(fragment);
    renderGarbageLegend([...usedGarbage.values()]);
  }

  function renderGarbageLegend(types) {
    let legend = document.getElementById("calendarGarbageLegend");
    const calEl = document.getElementById("calendar");
    if (!legend && calEl) {
      legend = document.createElement("div");
      legend.id = "calendarGarbageLegend";
      legend.className = "garbage-legend";
      calEl.after(legend);
    }
    if (!legend) return;
    legend.hidden = !types.length;
    legend.innerHTML = types.length
      ? `<b>ごみの見方</b>${types.map(g => `<span><i style="background:${/^#[0-9a-f]{6}$/i.test(g.color || "") ? g.color : "#64748b"}"></i>${escapeHtml(g.icon || "🗑️")} ${escapeHtml(garbageShortName(g.name))}＝${escapeHtml(g.name)}</span>`).join("")}`
      : "";
  }

  // ── よく使う予定 ─────────────────────────────────────
  function frequentEvents() {
    try {
      const list = JSON.parse(localStorage.getItem("frequentEvents") || "[]");
      return Array.isArray(list) ? list.sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 6) : [];
    } catch (_) { return []; }
  }
  function rememberFrequent(event) {
    let list;
    try { list = JSON.parse(localStorage.getItem("frequentEvents") || "[]"); } catch (_) { list = []; }
    if (!Array.isArray(list)) list = [];
    const existing = list.find(item => item.title === event.title);
    const entry = {
      title: event.title, time: event.time, endTime: event.endTime || "",
      category: event.category || "other",
      items: (event.items || []).map(item => item.text || item).filter(Boolean).slice(0, 30),
      count: (existing?.count || 0) + 1
    };
    list = [entry, ...list.filter(item => item.title !== event.title)].slice(0, 20);
    try { localStorage.setItem("frequentEvents", JSON.stringify(list)); } catch (_) {}
  }

  // ── 予定追加・編集モーダル ────────────────────────────
  async function openModal(dateKey, eventIdx = null) {
    const previousFocus = document.activeElement;
    const isEdit  = eventIdx !== null;
    const list    = isEdit ? await Storage.getEvents(dateKey) : [];
    const current = isEdit
      ? list[eventIdx]
      : { title: "", time: "09:00", endTime: "", category: "other", repeat: "none", repeatUntil: dateKey, items: [] };
    if (!current) return;
    const groups = !isEdit ? await Storage.getGroups().catch(() => []) : [];
    const groupOptions = groups.map(group => `<option value="${escapeHtml(group.id)}">👥 ${escapeHtml(group.name)}</option>`).join("");
    const presets = !isEdit ? frequentEvents() : [];
    const categoryOptions = CATEGORIES.map(c => `<option value="${c.value}">${c.label}</option>`).join("");

    const overlay = document.createElement("div");
    overlay.className = "modal event-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "eventModalTitle");
    overlay.innerHTML = `
      <div class="card event-card">
        <div class="card-header">
          <h3 id="eventModalTitle">${isEdit ? "✏️ 予定の編集" : "➕ 予定を追加"}</h3>
          <button type="button" class="card-close" id="cardClose" aria-label="閉じる">✕</button>
        </div>
        <div class="event-card-body">
          <div class="form-row">
            <div class="form-group"><label for="m-title">予定名</label>
              <input id="m-title" placeholder="例: 授業、バイト" maxlength="120" value="${escapeHtml(current.title)}"></div>
            <div class="form-group"><label for="m-date">日付</label>
              <input type="date" id="m-date" value="${dateKey}"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label for="m-time">開始時間</label>
              <input type="time" id="m-time" value="${escapeHtml(current.time || "09:00")}" step="300"></div>
            <div class="form-group"><label for="m-end">終了時刻</label>
              <input type="time" id="m-end" value="${escapeHtml(current.endTime || "")}" step="300"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label for="m-category">カテゴリ</label>
              <select id="m-category">${categoryOptions}</select></div>
            <div class="form-group"><label for="m-repeat">繰り返し</label>
              <select id="m-repeat">
                <option value="none">なし</option><option value="daily">毎日</option>
                <option value="weekly">毎週</option><option value="monthly">毎月</option>
              </select></div>
          </div>
          ${presets.length ? `<div class="form-group"><label>よく使う予定</label><div class="preset-chips">${presets.map((p, i) => `<button type="button" class="preset-chip ${CATEGORY_VALUES.includes(p.category) ? p.category : "other"}" data-preset="${i}">${escapeHtml(p.title)}<small>${escapeHtml(p.time || "")}</small></button>`).join("")}</div></div>` : ""}
          <div class="form-group"><label for="m-items">持ち物・準備（1行に1つ）</label>
            <textarea id="m-items" rows="3" placeholder="受験票&#10;筆記用具&#10;傘">${escapeHtml((current.items || []).map(item => typeof item === "string" ? item : item.text).filter(Boolean).join("\n"))}</textarea></div>
          <details class="more-settings" id="m-more">
            <summary>その他の設定</summary>
            <div class="form-group"><label for="m-repeat-until">繰り返し終了日</label>
              <input type="date" id="m-repeat-until" value="${current.repeatUntil || dateKey}">
              <small class="form-help">「繰り返し」を選んだときだけ使います</small></div>
            ${!isEdit && groups.length ? `<div class="form-group"><label for="m-group">保存先</label><select id="m-group"><option value="">自分だけの予定</option>${groupOptions}</select><small class="form-help">共有先を選ぶと、そのグループのメンバーにも表示されます。</small></div>` : ""}
            ${isEdit ? '<button id="m-delete" class="btn-danger" type="button">この予定を削除</button>' : ""}
          </details>
        </div>
        <div class="event-card-footer">
          <button type="button" id="m-cancel" class="btn-secondary">キャンセル</button>
          <button type="button" id="m-save" class="btn-primary">${isEdit ? "保存する" : "追加する"}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    document.body.classList.add("modal-open");
    const onKeydown = event => { if (event.key === "Escape") closeModal(); };
    const closeModal = () => {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      document.body.classList.remove("modal-open");
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
    document.addEventListener("keydown", onKeydown);
    requestAnimationFrame(() => overlay.querySelector("#m-title")?.focus());

    const $ = selector => overlay.querySelector(selector);
    $("#m-repeat").value = current.repeat || "none";
    $("#m-category").value = CATEGORY_VALUES.includes(current.category) ? current.category : "other";
    // 繰り返しを選んだら、終了日がある「その他の設定」を開いて気付けるようにする。
    $("#m-repeat").addEventListener("change", () => { if ($("#m-repeat").value !== "none") $("#m-more").open = true; });

    overlay.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => {
      const preset = presets[Number(button.dataset.preset)];
      if (!preset) return;
      $("#m-title").value = preset.title;
      if (preset.time) $("#m-time").value = preset.time;
      $("#m-end").value = preset.endTime || "";
      $("#m-category").value = CATEGORY_VALUES.includes(preset.category) ? preset.category : "other";
      if (preset.items?.length && !$("#m-items").value.trim()) $("#m-items").value = preset.items.join("\n");
      overlay.querySelectorAll(".preset-chip").forEach(chip => chip.classList.toggle("selected", chip === button));
    }));

    $("#m-cancel").onclick = closeModal;
    $("#cardClose").onclick = closeModal;
    overlay.onclick = e => { if (e.target === overlay) closeModal(); };
    $("#m-delete")?.addEventListener("click", async () => {
      if (!confirm(`「${current.title}」を削除しますか？`)) return;
      await Storage.deleteEvent(dateKey, eventIdx);
      closeModal();
      window.dispatchEvent(new Event("ready2go:datachange"));
      draw();
    });

    $("#m-save").onclick = async () => {
      const saveButton = $("#m-save");
      const newTitle    = $("#m-title").value.trim();
      const newDate     = $("#m-date").value;
      const newTime     = $("#m-time").value;
      const endTime     = $("#m-end").value;
      const category    = $("#m-category").value;
      const repeat      = $("#m-repeat").value;
      const repeatUntil = $("#m-repeat-until").value;
      const oldItems = Array.isArray(current.items) ? current.items : [];
      const itemTexts = $("#m-items").value.split(/[\n、,]+/).map(value => value.trim()).filter(Boolean).slice(0, 30);
      const items = itemTexts.map(text => ({
        text,
        done: !!oldItems.find(item => (typeof item === "string" ? item : item.text) === text)?.done
      }));
      const groupId = $("#m-group")?.value || "";

      overlay.querySelectorAll(".input-error").forEach(el => el.classList.remove("input-error"));
      if (!newTitle) { $("#m-title").classList.add("input-error"); $("#m-title").focus(); return; }
      if (!newDate) { $("#m-date").classList.add("input-error"); $("#m-date").focus(); return; }
      if (!newTime) { $("#m-time").classList.add("input-error"); $("#m-time").focus(); return; }
      if (endTime && endTime <= newTime) {
        $("#m-end").classList.add("input-error"); $("#m-end").focus();
        alert("終了時刻は開始時間より後にしてください"); return;
      }

      const newEvent = { title: newTitle, time: newTime, endTime, category, repeat, repeatUntil, items };
      saveButton.disabled = true;
      try {
        if (!isEdit && groupId) {
          await addRecurringGroupEvent(groupId, newDate, newEvent);
        } else if (isEdit && newDate !== dateKey) {
          await Storage.deleteEvent(dateKey, eventIdx);
          await Storage.addRecurringEvent(newDate, newEvent);
        } else if (isEdit) {
          await Storage.updateEvent(dateKey, eventIdx, newEvent);
        } else {
          await Storage.addRecurringEvent(newDate, newEvent);
        }
        if (!isEdit) rememberFrequent(newEvent);
      } catch (error) {
        saveButton.disabled = false;
        alert(error.message || "保存できませんでした");
        return;
      }

      closeModal();
      window.dispatchEvent(new Event("ready2go:datachange"));
      draw();
    };
  }

  async function addRecurringGroupEvent(groupId, startKey, event) {
    const until = event.repeatUntil || startKey;
    let date = new Date(`${startKey}T00:00:00`);
    const end = new Date(`${until}T23:59:59`);
    let count = 0;
    while (date <= end && count < 370) {
      await Storage.addGroupEvent(groupId, keyFromDate(date), { ...event, recurrenceStart: startKey });
      count++;
      if (event.repeat === "none") break;
      if (event.repeat === "daily") date.setDate(date.getDate() + 1);
      else if (event.repeat === "weekly") date.setDate(date.getDate() + 7);
      else if (event.repeat === "monthly") date.setMonth(date.getMonth() + 1);
      else break;
    }
  }

  function openSharedModal(dateKey, event) {
    const previousFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "sharedModalTitle");
    const items = (event.items || []).map(item => typeof item === "string" ? item : item.text).filter(Boolean);
    const timeText = event.endTime ? `${event.time || "--:--"}–${event.endTime}` : (event.time || "--:--");
    overlay.innerHTML = `<div class="card"><div class="card-header"><h3 id="sharedModalTitle">👥 共有予定</h3><button type="button" class="card-close" aria-label="閉じる">✕</button></div>
      <p><b>${escapeHtml(timeText)} ${escapeHtml(event.title)}</b></p>
      <p class="form-help">${escapeHtml(event._groupName || "共有グループ")}・${escapeHtml(dateKey)}</p>
      ${items.length ? `<div class="shared-items"><b>🎒 持ち物</b><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      ${event._canDelete ? '<button type="button" class="btn-danger" id="sharedDelete">この共有予定を削除</button>' : ""}
      <div class="form-actions"><button type="button" class="btn-primary" id="sharedClose">閉じる</button></div></div>`;
    document.body.appendChild(overlay);
    document.body.classList.add("modal-open");
    const onKeydown = keyEvent => { if (keyEvent.key === "Escape") close(); };
    const close = () => {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      document.body.classList.remove("modal-open");
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
    overlay.querySelector(".card-close").onclick = close;
    overlay.querySelector("#sharedClose").onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };
    document.addEventListener("keydown", onKeydown);
    requestAnimationFrame(() => overlay.querySelector("#sharedClose")?.focus());
    overlay.querySelector("#sharedDelete")?.addEventListener("click", async () => {
      if (!confirm(`「${event.title}」をグループから削除しますか？`)) return;
      await Storage.deleteGroupEvent(event._groupId, dateKey, event.id);
      close(); window.dispatchEvent(new Event("ready2go:datachange")); draw();
    });
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── 通知チェック ──────────────────────────────────────
  // LINE内ブラウザなどNotification自体が無い環境では何もしない。
  async function checkNotifications() {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const now     = new Date();
    const dateKey = keyFromDate(now);
    const timeKey = String(now.getHours()).padStart(2, "0") + ":"
                  + String(now.getMinutes()).padStart(2, "0");
    const list = await Storage.getEvents(dateKey);
    list.forEach(ev => {
      if (ev.time === timeKey) {
        new Notification("📘 予定の時間です！", {
          body: `[${ev.time}] ${ev.title}`,
          icon: "icon-192.png"
        });
      }
    });
  }

  return { draw, drawIfNeeded, markDirty, moveWeek, setView, goToday, openModal, checkNotifications, keyFromDate, garbageShortName };
})();
