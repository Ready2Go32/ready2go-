const Dashboard = (() => {
  function key(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  async function nextEvent() {
    const now = new Date();
    for (let offset = 0; offset < 31; offset++) {
      const d = new Date(now); d.setDate(d.getDate() + offset);
      const events = await Storage.getEvents(key(d));
      const sorted = events.filter(e => offset > 0 || (e.time || "23:59") >= now.toTimeString().slice(0,5))
        .sort((a,b) => (a.time || "").localeCompare(b.time || ""));
      if (sorted[0]) return { event: sorted[0], date: d, offset };
    }
    return null;
  }

  async function nextGarbage() {
    const pref = document.getElementById("pref")?.value || "";
    const region = document.getElementById("region")?.value || "";
    if (!region) return { message: "市区町村を選択してください" };
    const schedule = await Garbage.getSchedule(pref, region);
    if (!schedule) return { message: "ごみカレンダーで地域情報を取得してください" };
    const result = Garbage.getNextCollection(new Date(), schedule, 31);
    return result || { message: "31日以内の収集予定がありません" };
  }

  async function refresh() {
    const now = new Date();
    document.getElementById("todayDateLabel").textContent = now.toLocaleDateString("ja-JP", { month:"long", day:"numeric", weekday:"short" });
    const eventResult = await nextEvent();
    document.getElementById("nextEventText").textContent = eventResult
      ? `${eventResult.offset === 0 ? "今日" : `${eventResult.offset}日後`} ${eventResult.event.time} ${eventResult.event.title}`
      : "今後31日間の予定はありません";

    const garbage = await nextGarbage();
    document.getElementById("nextGarbageText").textContent = garbage.message ||
      `${garbage.offset === 0 ? "今日" : garbage.offset === 1 ? "明日" : `${garbage.offset}日後`} ${garbage.types.map(x => `${x.icon || ""}${x.name}`).join("・")}`;

    const weather = Weather.getDetailData();
    document.getElementById("todayWeatherIcon").textContent = weather.icon || "☁️";
    document.getElementById("todayWeatherText").textContent = weather.temp != null
      ? `${weather.temp}℃　最高${weather.tempMax}℃／最低${weather.tempMin}℃${weather.rain > 0 ? `　雨${weather.rain}mm` : ""}`
      : "天気を取得できませんでした";

    const linked = !!Storage.getLineIdToken();
    document.getElementById("lineStatusText").textContent = linked ? "LINE連携済み" : "連携ページからログインしてください";
    const badge = document.getElementById("connectionBadge");
    badge.textContent = navigator.onLine ? (linked ? "同期可能" : "オンライン") : "オフライン保存中";
    badge.className = `status-chip ${navigator.onLine ? "status-ok" : "status-warn"}`;
  }

  function init() {
    document.getElementById("nextEventCard")?.addEventListener("click", () => document.getElementById("calendarSection")?.scrollIntoView({ behavior:"smooth" }));
    document.getElementById("nextGarbageCard")?.addEventListener("click", () => location.href = "garbage-calendar.html");
    document.getElementById("lineStatusCard")?.addEventListener("click", () => Settings.togglePanel());
    window.addEventListener("online", refresh); window.addEventListener("offline", refresh);
    return refresh();
  }
  return { init, refresh };
})();
