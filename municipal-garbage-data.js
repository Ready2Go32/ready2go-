// 町田市の自治体公式ページから確認した内蔵データ（APIキー不要）
// 地区1: https://www.city.machida.tokyo.jp/kurashi/kankyo/gomi/gominowakekata/gomi-dashikata/syuusyuu/1.html
const MunicipalGarbageData = (() => {
  const SOURCE_URL = "https://www.city.machida.tokyo.jp/kurashi/kankyo/gomi/gominowakekata/gomi-dashikata/syuusyuu/1.html";
  const CHECKED_AT = "2026-09-01T00:00:00+09:00";
  const ORIGINAL_START = "2025-10-01";
  const NEXT_START = "2026-10-01";
  const END = "2027-09-30";

  const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const uniqueSorted = values => [...new Set(values)].sort();

  function between(start, end, test, excluded = []) {
    const output = [];
    const blocked = new Set(excluded);
    for (const date = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`);
      date <= last; date.setDate(date.getDate() + 1)) {
      const dateKey = key(date);
      if (test(date, dateKey) && !blocked.has(dateKey)) output.push(dateKey);
    }
    return output;
  }

  const weekdays = (start, end, days, excluded = []) => between(start, end, date => days.includes(date.getDay()), excluded);
  const biweekly = (start, end, anchor, excluded = []) => {
    const anchorDate = new Date(`${anchor}T12:00:00`);
    return between(start, end, date => Math.round((date - anchorDate) / 86400000) % 14 === 0, excluded);
  };
  const monthly = (start, end, day, week, excluded = []) => between(
    start,
    end,
    date => date.getDay() === day && Math.ceil(date.getDate() / 7) === week,
    excluded
  );

  const nonBurnableNext = [
    "2026-10-14", "2026-10-28", "2026-11-11", "2026-11-25", "2026-12-09", "2026-12-23",
    "2027-01-06", "2027-01-20", "2027-02-03", "2027-02-17", "2027-03-03", "2027-03-17", "2027-03-31",
    "2027-04-14", "2027-04-28", "2027-05-12", "2027-05-26", "2027-06-09", "2027-06-23",
    "2027-07-07", "2027-07-21", "2027-08-04", "2027-08-18", "2027-09-01", "2027-09-15", "2027-09-29"
  ];
  const bottlesNext = [
    "2026-10-07", "2026-10-21", "2026-11-04", "2026-11-18", "2026-12-02", "2026-12-16", "2026-12-30",
    "2027-01-13", "2027-01-27", "2027-02-10", "2027-02-24", "2027-03-10", "2027-03-24",
    "2027-04-07", "2027-04-21", "2027-05-05", "2027-05-19", "2027-06-02", "2027-06-16", "2027-06-30",
    "2027-07-14", "2027-07-28", "2027-08-11", "2027-08-25", "2027-09-08", "2027-09-22"
  ];

  const schedule = {
    garbageTypes: [
      {
        name: "燃やせるごみ", icon: "🔥", color: "#eab308", schedule: "毎週月・木曜日（指定除外日あり）",
        dates: weekdays(ORIGINAL_START, END, [1, 4], ["2026-01-01", "2026-12-31"]), days: []
      },
      {
        name: "古紙・古着", icon: "📰", color: "#f59e0b", schedule: "毎週火曜日",
        dates: weekdays(ORIGINAL_START, END, [2]), days: []
      },
      {
        name: "燃やせないごみ", icon: "🟢", color: "#10b981", schedule: "隔週水曜日（指定日）",
        dates: uniqueSorted([
          ...biweekly("2025-10-01", "2025-12-31", "2025-10-08"),
          ...biweekly("2026-01-01", "2026-03-31", "2026-01-07"),
          ...biweekly("2026-04-01", "2026-09-30", "2026-04-01"),
          ...nonBurnableNext
        ]), days: []
      },
      {
        name: "ペットボトル", icon: "🧴", color: "#38bdf8", schedule: "隔週水曜日（指定日）",
        dates: uniqueSorted([
          ...biweekly("2025-10-01", "2025-12-31", "2025-10-01"),
          ...biweekly("2026-01-01", "2026-03-31", "2026-01-14"),
          ...biweekly("2026-04-01", "2026-09-30", "2026-04-08"),
          ...bottlesNext
        ]), days: []
      },
      {
        name: "剪定枝", icon: "🌿", color: "#84cc16", schedule: "指定金曜日（2026年10月以降は第1・第3金曜日）",
        dates: uniqueSorted([
          ...biweekly("2025-10-01", "2025-12-31", "2025-10-03"),
          ...biweekly("2026-01-01", "2026-03-31", "2026-01-16"),
          ...biweekly("2026-04-01", "2026-09-30", "2026-04-03"),
          ...monthly(NEXT_START, END, 5, 1, ["2027-01-01"]),
          ...monthly(NEXT_START, END, 5, 3)
        ]), days: []
      },
      {
        name: "ビン・カン・スプレー缶", icon: "♻️", color: "#0ea5e9", schedule: "毎週土曜日（指定除外日あり）",
        dates: weekdays(ORIGINAL_START, END, [6], ["2026-01-03", "2027-01-02"]), days: []
      },
      {
        name: "電池・充電式小型家電", icon: "🔋", color: "#8b5cf6", schedule: "第2土曜日",
        dates: monthly(ORIGINAL_START, END, 6, 2), days: []
      },
      {
        name: "蛍光管・ライター・水銀体温計", icon: "💡", color: "#ec4899", schedule: "第4土曜日",
        dates: monthly(ORIGINAL_START, END, 6, 4), days: []
      },
      {
        name: "容器包装プラスチック", icon: "📦", color: "#f472b6", schedule: "毎週金曜日（2026年4月開始・指定除外日あり）",
        dates: weekdays("2026-04-01", END, [5], ["2027-01-01"]), days: []
      }
    ],
    sourceUrl: SOURCE_URL,
    checkedAt: CHECKED_AT,
    validFrom: ORIGINAL_START,
    validUntil: END,
    note: "町田市 地区1の公式日程です。2026年10月から地区1に金森2・3・7丁目が加わります。荒天や臨時変更は町田市公式ページも確認してください。",
    confidence: "official-registered",
    _verifiedOfficial: true,
    _municipalRegistered: true,
    district: "地区1"
  };

  function normalize(value) {
    const digitMap = { "１":"1", "２":"2", "３":"3", "４":"4", "５":"5", "６":"6", "７":"7", "８":"8", "一":"1", "二":"2", "三":"3", "四":"4", "五":"5", "六":"6", "七":"7", "八":"8" };
    let normalized = String(value || "").trim().replace(/[\s　]/g, "").replace(/[１２３４５６７８一二三四五六七八]/g, char => digitMap[char]);
    if (/^(忠生[1-4]|玉川学園[1-8]|金森[237])$/.test(normalized)) normalized += "丁目";
    return normalized;
  }

  function cloneForStart(validFrom) {
    const copy = JSON.parse(JSON.stringify(schedule));
    copy.validFrom = validFrom;
    if (validFrom > ORIGINAL_START) {
      copy.garbageTypes.forEach(type => { type.dates = (type.dates || []).filter(date => date >= validFrom); });
      copy.note = "町田市 地区1の2026年10月～2027年9月公式日程です。金森2・3・7丁目は2026年10月から地区1です。荒天や臨時変更は町田市公式ページも確認してください。";
    }
    return copy;
  }

  function find(pref, region, area) {
    if (pref !== "東京都" || region !== "町田市") return null;
    const normalized = normalize(area);
    if (/^(忠生[1-4]丁目|玉川学園[1-8]丁目)$/.test(normalized)) return cloneForStart(ORIGINAL_START);
    if (/^金森[237]丁目$/.test(normalized)) return cloneForStart(NEXT_START);
    return null;
  }

  function list() {
    return [
      {
        pref: "東京都", region: "町田市", areas: ["忠生1～4丁目", "玉川学園1～8丁目"], district: "地区1",
        sourceUrl: SOURCE_URL, checkedAt: CHECKED_AT, validFrom: ORIGINAL_START, validUntil: END, note: schedule.note
      },
      {
        pref: "東京都", region: "町田市", areas: ["金森2・3・7丁目"], district: "地区1（2026年10月から）",
        sourceUrl: SOURCE_URL, checkedAt: CHECKED_AT, validFrom: NEXT_START, validUntil: END, note: schedule.note
      }
    ];
  }

  return { find, list };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MunicipalGarbageData;
