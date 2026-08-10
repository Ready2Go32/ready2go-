// calendar.js — カレンダー描画・予定管理
// 依存: storage.js, weather.js, garbage.js

const Calendar = (() => {

  let weekStart = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  let viewMode = localStorage.getItem("calendarView") || "month";

  const DAY_NAMES = ["日","月","火","水","木","金","土"];

  function keyFromDate(d) {
    return d.getFullYear() + "-"
      + String(d.getMonth() + 1).padStart(2, "0") + "-"
      + String(d.getDate()).padStart(2, "0");
  }

  function moveWeek(n) {
    if (viewMode === "month") weekStart.setMonth(weekStart.getMonth() + n);
    else weekStart.setDate(weekStart.getDate() + n * 7);
    draw();
  }

  function setView(mode) {
    viewMode = mode === "list" ? "list" : "month";
    localStorage.setItem("calendarView", viewMode);
    document.querySelectorAll(".view-btn").forEach(b => b.classList.toggle("active", b.dataset.view === viewMode));
    draw();
  }

  // ── カレンダー描画 ────────────────────────────────────
  async function draw() {
    const calEl   = document.getElementById("calendar");
    const labelEl = document.getElementById("weekLabel");
    if (!calEl || !labelEl) return;

    const wMap = Weather.getWeatherMap();
    const pref   = document.getElementById("pref")?.value || "東京都";
    const region = document.getElementById("region")?.value || "";

    let garbageSchedule = null;
    if (region) {
      try { garbageSchedule = await Garbage.getSchedule(pref, region); } catch(e) {}
    }

    calEl.innerHTML = "";
    calEl.className = `calendar-grid view-${viewMode}`;
    const dates = [];
    if (viewMode === "month") {
      const first = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
      first.setDate(first.getDate() - first.getDay());
      for (let i=0;i<42;i++) { const d=new Date(first); d.setDate(d.getDate()+i); dates.push(d); }
      labelEl.textContent = weekStart.toLocaleDateString("ja-JP", { year:"numeric", month:"long" });
    } else {
      const start = new Date(weekStart);
      const today = new Date();
      if (Math.abs(start - today) < 8 * 86400000) { start.setTime(today.getTime()); start.setHours(0,0,0,0); }
      for (let i=0;i<7;i++) { const d=new Date(start); d.setDate(d.getDate()+i); dates.push(d); }
      const end = dates[6];
      labelEl.textContent = `${dates[0].toLocaleDateString("ja-JP",{month:"numeric",day:"numeric"})} 〜 ${end.toLocaleDateString("ja-JP",{month:"numeric",day:"numeric"})}`;
    }

    const todayKey = keyFromDate(new Date());
    const eventLists = await Promise.all(dates.map(d => Storage.getEvents(keyFromDate(d)).catch(() => [])));

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

      // 曜日ヘッダー
      const header = document.createElement("div");
      header.className = "day-header";
      header.innerHTML = `
        <span class="day-name ${isSun?'text-red':isSat?'text-blue':''}">${DAY_NAMES[d.getDay()]}</span>
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

      // ゴミ収集
      if (garbageSchedule) {
        const gTypes = Garbage.getGarbageTypesForDate(d, garbageSchedule);
        if (gTypes.length > 0) {
          const gDiv = document.createElement("div");
          gDiv.className = "garbage-row";
          gTypes.forEach(g => {
            const span = document.createElement("span");
            span.className = "garbage-tag";
            span.style.background = g.color;
            span.textContent = `${g.icon} ${g.name}`;
            gDiv.appendChild(span);
          });
          box.appendChild(gDiv);
        }
      }

      // 予定一覧
      const events = eventLists[dateIndex];
      events.sort((a, b) => a.time.localeCompare(b.time));
      events.forEach((ev, idx) => {
        const div = document.createElement("div");
        div.className = `event ${ev.category}`;
        div.innerHTML =
          `<span class="event-text">${ev.time} ${ev.title}</span>`
          + `<span class="del-btn" title="削除">✕</span>`;

        div.querySelector(".event-text").onclick = e => {
          e.stopPropagation();
          openModal(key, idx);
        };
        div.querySelector(".del-btn").onclick = async e => {
          e.stopPropagation();
          await Storage.deleteEvent(key, idx);
          draw();
        };
        box.appendChild(div);
      });

      box.onclick = () => openModal(key);
      calEl.appendChild(box);
    }
  }

  // ── 予定追加・編集モーダル ────────────────────────────
  async function openModal(dateKey, eventIdx = null) {
    const list    = await Storage.getEvents(dateKey);
    const isEdit  = eventIdx !== null;
    const current = isEdit
      ? list[eventIdx]
      : { title: "", time: "09:00", category: "school", repeat: "none", repeatUntil: dateKey };

    const overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${isEdit ? "✏️ 予定の編集" : "➕ 予定の追加"}</h3>
          <button class="card-close" id="cardClose">✕</button>
        </div>
        <div class="form-group">
          <label>予定名</label>
          <input id="m-title" placeholder="例: 授業、会議..." value="${escapeHtml(current.title)}">
        </div>
        <div class="form-group">
          <label>日付</label>
          <input type="date" id="m-date" value="${dateKey}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>時間</label>
            <select id="m-time"></select>
          </div>
          <div class="form-group">
            <label>カテゴリ</label>
            <select id="m-cat">
              <option value="school"   ${current.category==="school"   ?"selected":""}>🏫 学校</option>
              <option value="work"     ${current.category==="work"     ?"selected":""}>💼 仕事</option>
              <option value="play"     ${current.category==="play"     ?"selected":""}>🎮 遊び</option>
              <option value="hospital" ${current.category==="hospital" ?"selected":""}>🏥 病院</option>
              <option value="other"    ${current.category==="other"    ?"selected":""}>📌 その他</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>繰り返し</label><select id="m-repeat">
            <option value="none">なし</option><option value="daily">毎日</option>
            <option value="weekly">毎週</option><option value="monthly">毎月</option>
          </select></div>
          <div class="form-group"><label>繰り返し終了日</label><input type="date" id="m-repeat-until" value="${current.repeatUntil || dateKey}"></div>
        </div>
        <div class="form-actions">
          <button id="m-cancel" class="btn-secondary">キャンセル</button>
          <button id="m-save" class="btn-primary">保存</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const tmSel = overlay.querySelector("#m-time");
    overlay.querySelector("#m-repeat").value = current.repeat || "none";
    for (let h = 0; h <= 23; h++) {
      const t = String(h).padStart(2, "0") + ":00";
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (t === current.time) opt.selected = true;
      tmSel.appendChild(opt);
    }

    overlay.querySelector("#m-cancel").onclick = () => overlay.remove();
    overlay.querySelector("#cardClose").onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    overlay.querySelector("#m-save").onclick = async () => {
      const newTitle    = overlay.querySelector("#m-title").value.trim();
      const newDate     = overlay.querySelector("#m-date").value;
      const newTime     = tmSel.value;
      const newCategory = overlay.querySelector("#m-cat").value;
      const repeat = overlay.querySelector("#m-repeat").value;
      const repeatUntil = overlay.querySelector("#m-repeat-until").value;

      if (!newTitle) {
        overlay.querySelector("#m-title").classList.add("input-error");
        overlay.querySelector("#m-title").focus();
        return;
      }

      const newEvent = { title: newTitle, time: newTime, category: newCategory, repeat, repeatUntil };

      if (isEdit && newDate !== dateKey) {
        await Storage.deleteEvent(dateKey, eventIdx);
        await Storage.addRecurringEvent(newDate, newEvent);
      } else if (isEdit) {
        await Storage.updateEvent(dateKey, eventIdx, newEvent);
      } else {
        await Storage.addRecurringEvent(newDate, newEvent);
      }

      overlay.remove();
      draw();
    };
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── 通知チェック ──────────────────────────────────────
  async function checkNotifications() {
    if (Notification.permission !== "granted") return;
    const now     = new Date();
    const dateKey = keyFromDate(now);
    const timeKey = String(now.getHours()).padStart(2, "0") + ":"
                  + String(now.getMinutes()).padStart(2, "0");
    const list = await Storage.getEvents(dateKey);
    list.forEach(ev => {
      if (ev.time === timeKey) {
        new Notification("📘 予定の時間です！", {
          body: `[${ev.time}] ${ev.title}`,
          icon: "https://fav.farm/📘"
        });
      }
    });
  }

  return { draw, moveWeek, setView, openModal, checkNotifications };
})();
