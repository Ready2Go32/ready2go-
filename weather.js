// weather.js — 天気取得モジュール（位置情報対応版）

const Weather = (() => {

  const PREF_MAP = {
    "北海道":"Sapporo","青森県":"Aomori","岩手県":"Morioka","宮城県":"Sendai",
    "秋田県":"Akita","山形県":"Yamagata","福島県":"Fukushima","茨城県":"Mito",
    "栃木県":"Utsunomiya","群馬県":"Maebashi","埼玉県":"Saitama","千葉県":"Chiba",
    "東京都":"Tokyo","神奈川県":"Yokohama","新潟県":"Niigata","富山県":"Toyama",
    "石川県":"Kanazawa","福井県":"Fukui","山梨県":"Kofu","長野県":"Nagano",
    "岐阜県":"Gifu","静岡県":"Shizuoka","愛知県":"Nagoya","三重県":"Tsu",
    "滋賀県":"Otsu","京都府":"Kyoto","大阪府":"Osaka","兵庫県":"Kobe",
    "奈良県":"Nara","和歌山県":"Wakayama","鳥取県":"Tottori","島根県":"Matsue",
    "岡山県":"Okayama","広島県":"Hiroshima","山口県":"Yamaguchi","徳島県":"Tokushima",
    "香川県":"Takamatsu","愛媛県":"Matsuyama","高知県":"Kochi","福岡県":"Fukuoka",
    "佐賀県":"Saga","長崎県":"Nagasaki","熊本県":"Kumamoto","大分県":"Oita",
    "宮崎県":"Miyazaki","鹿児島県":"Kagoshima","沖縄県":"Naha"
  };

  const PREF_COORDS = {
    "北海道":{lat:43.06,lon:141.35},"青森県":{lat:40.82,lon:140.74},
    "岩手県":{lat:39.70,lon:141.15},"宮城県":{lat:38.27,lon:140.87},
    "秋田県":{lat:39.72,lon:140.10},"山形県":{lat:38.24,lon:140.36},
    "福島県":{lat:37.75,lon:140.47},"茨城県":{lat:36.34,lon:140.45},
    "栃木県":{lat:36.57,lon:139.88},"群馬県":{lat:36.39,lon:139.06},
    "埼玉県":{lat:35.86,lon:139.65},"千葉県":{lat:35.61,lon:140.12},
    "東京都":{lat:35.69,lon:139.69},"神奈川県":{lat:35.45,lon:139.64},
    "新潟県":{lat:37.90,lon:139.02},"富山県":{lat:36.70,lon:137.21},
    "石川県":{lat:36.59,lon:136.63},"福井県":{lat:36.07,lon:136.22},
    "山梨県":{lat:35.67,lon:138.57},"長野県":{lat:36.65,lon:138.18},
    "岐阜県":{lat:35.39,lon:136.72},"静岡県":{lat:34.98,lon:138.38},
    "愛知県":{lat:35.18,lon:136.91},"三重県":{lat:34.73,lon:136.51},
    "滋賀県":{lat:35.00,lon:135.87},"京都府":{lat:35.02,lon:135.76},
    "大阪府":{lat:34.69,lon:135.50},"兵庫県":{lat:34.69,lon:135.20},
    "奈良県":{lat:34.69,lon:135.83},"和歌山県":{lat:34.23,lon:135.17},
    "鳥取県":{lat:35.50,lon:134.24},"島根県":{lat:35.47,lon:133.05},
    "岡山県":{lat:34.66,lon:133.93},"広島県":{lat:34.40,lon:132.46},
    "山口県":{lat:34.19,lon:131.47},"徳島県":{lat:34.07,lon:134.56},
    "香川県":{lat:34.34,lon:134.04},"愛媛県":{lat:33.84,lon:132.77},
    "高知県":{lat:33.56,lon:133.53},"福岡県":{lat:33.61,lon:130.42},
    "佐賀県":{lat:33.25,lon:130.30},"長崎県":{lat:32.74,lon:129.87},
    "熊本県":{lat:32.79,lon:130.74},"大分県":{lat:33.24,lon:131.61},
    "宮崎県":{lat:31.91,lon:131.42},"鹿児島県":{lat:31.56,lon:130.56},
    "沖縄県":{lat:26.21,lon:127.68}
  };

  let weatherMap = {};
  let detailData = {};
  // 位置情報で取得した場合の座標
  let gpsCoords  = null;

  function getWeatherMap() { return weatherMap; }
  function getDetailData() { return detailData; }
  function getGpsCoords()  { return gpsCoords; }

  function wmoEmoji(code) {
    if (code <= 1)  return "☀️";
    if (code <= 3)  return "☁️";
    if (code <= 49) return "🌫️";
    if (code <= 67) return "☔";
    if (code <= 77) return "☃️";
    if (code <= 82) return "🌧️";
    if (code <= 99) return "⚡";
    return "☀️";
  }

  // GPS位置情報を取得して都道府県セレクトに反映
  async function requestLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        pos => {
          gpsCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          localStorage.setItem("gpsLat", gpsCoords.lat);
          localStorage.setItem("gpsLon", gpsCoords.lon);
          resolve(gpsCoords);
        },
        () => resolve(null),
        { timeout: 8000 }
      );
    });
  }

  // 保存済みGPS座標を復元
  function loadSavedGps() {
    const lat = parseFloat(localStorage.getItem("gpsLat"));
    const lon = parseFloat(localStorage.getItem("gpsLon"));
    if (!isNaN(lat) && !isNaN(lon)) {
      gpsCoords = { lat, lon };
      return gpsCoords;
    }
    return null;
  }

  function getCoords() {
    if (gpsCoords) return gpsCoords;
    const saved = loadSavedGps();
    if (saved) return saved;
    const pref = document.getElementById("pref")?.value || "東京都";
    return PREF_COORDS[pref] || { lat: 35.69, lon: 139.69 };
  }

  async function loadOpenMeteo() {
    const hourlyEl = document.getElementById("hourlyWeather");
    const coords   = getCoords();

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}`
        + `&hourly=temperature_2m,weathercode,precipitation,windspeed_10m,relativehumidity_2m,surface_pressure`
        + `&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum`
        + `&timezone=Asia%2FTokyo&forecast_days=7`;

      const res  = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      weatherMap = {};
      (data.daily?.time || []).forEach((dt, i) => {
        weatherMap[dt] = {
          icon: wmoEmoji(data.daily.weathercode[i]),
          temp: Math.round(data.daily.temperature_2m_max[i])
        };
      });

      const today = new Date().toISOString().split("T")[0];
      const todayIdx = (data.hourly?.time || []).findIndex(t => t.startsWith(today));
      if (todayIdx >= 0) {
        const nowH = new Date().getHours();
        const idx  = todayIdx + nowH;
        detailData = {
          icon:     wmoEmoji(data.hourly.weathercode[idx] ?? 0),
          desc:     "",
          temp:     Math.round(data.hourly.temperature_2m[idx] ?? 0),
          tempMax:  Math.round(data.daily.temperature_2m_max[(data.daily?.time||[]).indexOf(today)] ?? 0),
          tempMin:  Math.round(data.daily.temperature_2m_min[(data.daily?.time||[]).indexOf(today)] ?? 0),
          humidity: Math.round(data.hourly.relativehumidity_2m[idx] ?? 0),
          pressure: Math.round(data.hourly.surface_pressure[idx] ?? 0),
          wind:     Math.round((data.hourly.windspeed_10m[idx] ?? 0)),
          rain:     data.hourly.precipitation[idx] ?? 0,
          source:   gpsCoords ? "GPS位置情報" : "Open-Meteo"
        };
      }

      let hourlyHTML = "";
      (data.hourly?.time || []).forEach((dtStr, i) => {
        const [dt, timeRaw] = dtStr.split("T");
        if (dt !== today) return;
        const hour  = timeRaw.slice(0, 5);
        const emoji = wmoEmoji(data.hourly.weathercode[i]);
        const temp  = Math.round(data.hourly.temperature_2m[i]);
        const rain  = data.hourly.precipitation[i] ?? 0;
        hourlyHTML += `
          <div class="hourBox">
            <div class="hour-label">${hour}</div>
            <div class="hour-icon">${emoji}</div>
            <div class="hour-temp">${temp}℃</div>
            <div class="hour-rain">${rain > 0 ? rain.toFixed(1)+'mm' : ''}</div>
          </div>`;
      });

      if (hourlyEl) hourlyEl.innerHTML = hourlyHTML || '<p class="weather-error">本日のデータなし</p>';

    } catch (err) {
      console.error("[Open-Meteo]", err);
      if (hourlyEl) hourlyEl.innerHTML = '<p class="weather-error">⚠️ 天気の取得に失敗しました。</p>';
    }
  }

  function getWindDirLabel(deg) {
    if (deg == null) return "";
    const dirs = ["北","北北東","北東","東北東","東","東南東","南東","南南東",
                  "南","南南西","南西","西南西","西","西北西","北西","北北西"];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  async function load() {
    return loadOpenMeteo();
  }

  return { load, getWeatherMap, getDetailData, getGpsCoords, requestLocation, loadSavedGps, getCoords, PREF_MAP, PREF_COORDS, getWindDirLabel };
})();
