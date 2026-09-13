// weather.js — 現在天気・時間別・週間・花粉・生活アラート
const Weather = (() => {
  const PREF_NAMES = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
  const PREF_MAP = Object.fromEntries(PREF_NAMES.map(name => [name, name]));
  const PREF_COORDS = {
    "北海道":{lat:43.06,lon:141.35},"青森県":{lat:40.82,lon:140.74},"岩手県":{lat:39.70,lon:141.15},"宮城県":{lat:38.27,lon:140.87},"秋田県":{lat:39.72,lon:140.10},"山形県":{lat:38.24,lon:140.36},"福島県":{lat:37.75,lon:140.47},
    "茨城県":{lat:36.34,lon:140.45},"栃木県":{lat:36.57,lon:139.88},"群馬県":{lat:36.39,lon:139.06},"埼玉県":{lat:35.86,lon:139.65},"千葉県":{lat:35.61,lon:140.12},"東京都":{lat:35.69,lon:139.69},"神奈川県":{lat:35.45,lon:139.64},
    "新潟県":{lat:37.90,lon:139.02},"富山県":{lat:36.70,lon:137.21},"石川県":{lat:36.59,lon:136.63},"福井県":{lat:36.07,lon:136.22},"山梨県":{lat:35.67,lon:138.57},"長野県":{lat:36.65,lon:138.18},"岐阜県":{lat:35.39,lon:136.72},
    "静岡県":{lat:34.98,lon:138.38},"愛知県":{lat:35.18,lon:136.91},"三重県":{lat:34.73,lon:136.52},"滋賀県":{lat:35.00,lon:135.87},"京都府":{lat:35.02,lon:135.76},"大阪府":{lat:34.69,lon:135.50},"兵庫県":{lat:34.69,lon:135.20},
    "奈良県":{lat:34.69,lon:135.83},"和歌山県":{lat:34.23,lon:135.17},"鳥取県":{lat:35.50,lon:134.24},"島根県":{lat:35.47,lon:133.05},"岡山県":{lat:34.66,lon:133.93},"広島県":{lat:34.40,lon:132.46},"山口県":{lat:34.19,lon:131.47},
    "徳島県":{lat:34.07,lon:134.56},"香川県":{lat:34.34,lon:134.04},"愛媛県":{lat:33.84,lon:132.76},"高知県":{lat:33.56,lon:133.53},"福岡県":{lat:33.61,lon:130.42},"佐賀県":{lat:33.25,lon:130.30},"長崎県":{lat:32.74,lon:129.87},
    "熊本県":{lat:32.79,lon:130.74},"大分県":{lat:33.24,lon:131.61},"宮崎県":{lat:31.91,lon:131.42},"鹿児島県":{lat:31.56,lon:130.56},"沖縄県":{lat:26.21,lon:127.68}
  };

  let weatherMap = {}, detailData = {}, weeklyData = [], gpsCoords = null, locationSource = "選択した都道府県";
  const localDateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const num = (array,index,fallback=0) => Number.isFinite(Number(array?.[index])) ? Number(array[index]) : fallback;
  const setText = (id,value) => { const element=document.getElementById(id); if(element) element.textContent=value; };

  function wmoEmoji(code) { if(code<=1)return"☀️";if(code<=3)return"☁️";if(code<=49)return"🌫️";if(code<=67)return"☔";if(code<=77)return"☃️";if(code<=82)return"🌧️";if(code<=99)return"⚡";return"☀️"; }
  function wmoText(code) { if(code===0)return"快晴";if(code<=2)return"晴れ時々くもり";if(code===3)return"くもり";if(code<=49)return"霧";if(code<=57)return"霧雨";if(code<=67)return"雨";if(code<=77)return"雪";if(code<=82)return"強い雨";if(code<=99)return"雷雨";return"天気不明"; }
  function uvLabel(value) { if(value>=8)return"非常に強い";if(value>=6)return"強い";if(value>=3)return"中程度";return"弱い"; }
  function pollenLabel(value) { if(value==null)return"取得不可";if(value>=100)return"非常に多い";if(value>=50)return"多い";if(value>=10)return"やや多い";return"少ない"; }
  function heatGuidance(value) {
    const note = `今日の最高体感温度${Math.round(value)}℃を基にした参考表示です。公式の熱中症警戒アラートではありません。`;
    if(value>=35)return{level:"非常に暑い",className:"alert-warning",text:`涼しい場所での休憩と、こまめな水分補給を意識してください。${note}`};
    if(value>=31)return{level:"厳しい暑さ",className:"alert-warning",text:`長時間の屋外活動を避け、無理をしないようにしてください。${note}`};
    if(value>=28)return{level:"暑さに注意",className:"alert-caution",text:`水分補給と休憩を忘れないようにしてください。${note}`};
    if(value>=25)return{level:"水分補給を意識",className:"alert-caution",text:`活動中はこまめに水分をとりましょう。${note}`};
    return{level:"現在は過ごしやすい体感",className:"alert-safe",text:`活動場所や体調によって感じ方は変わります。${note}`};
  }

  function windGuide(kmh) {
    const ms = kmh / 3.6;
    if(ms < 1.5)return"ほぼ穏やか";
    if(ms < 3.4)return"弱い風";
    if(ms < 5.5)return"風を感じる程度";
    if(ms < 8)return"少し強め";
    if(ms < 10)return"強めの風";
    if(ms < 15)return"やや強い風";
    if(ms < 20)return"強い風";
    return"非常に強い風";
  }

  function getWeatherMap(){return weatherMap;} function getDetailData(){return detailData;} function getGpsCoords(){return gpsCoords;}
  function requestLocation(){return new Promise(resolve=>{if(!navigator.geolocation)return resolve(null);navigator.geolocation.getCurrentPosition(pos=>{gpsCoords={lat:pos.coords.latitude,lon:pos.coords.longitude};localStorage.setItem("gpsLat",gpsCoords.lat);localStorage.setItem("gpsLon",gpsCoords.lon);resolve(gpsCoords);},()=>resolve(null),{timeout:8000});});}
  function loadSavedGps(){const lat=parseFloat(localStorage.getItem("gpsLat")),lon=parseFloat(localStorage.getItem("gpsLon"));if(!Number.isNaN(lat)&&!Number.isNaN(lon)){gpsCoords={lat,lon};return gpsCoords;}return null;}
  async function getCoords(){
    const useGps=localStorage.getItem("locationMode")==="gps"&&localStorage.getItem("consentLocation")==="yes";
    if(useGps){const saved=gpsCoords||loadSavedGps();if(saved){locationSource="GPS位置情報";return{...saved,cacheKey:`gps:${saved.lat.toFixed(3)}:${saved.lon.toFixed(3)}`};}}
    const pref=document.getElementById("pref")?.value||localStorage.getItem("pref")||"東京都";
    const region=document.getElementById("region")?.value||localStorage.getItem(`region_${pref}`)||"";
    const cacheKey=`address:${pref}:${region}`;
    if(region){
      try{
        const saved=JSON.parse(localStorage.getItem("weatherGeocodeCache")||"null");
        if(saved?.cacheKey===cacheKey&&Number.isFinite(saved.lat)&&Number.isFinite(saved.lon)){locationSource=`${region}付近`;return{lat:saved.lat,lon:saved.lon,cacheKey};}
        const url=`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(region)}&count=10&language=ja&format=json&countryCode=JP`;
        const response=await fetch(url);if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const data=await response.json();
        const result=(data.results||[]).find(item=>String(item.admin1||"").includes(pref.replace(/[都府県]$/, "")))||(data.results||[])[0];
        if(result){const coords={lat:Number(result.latitude),lon:Number(result.longitude),cacheKey};localStorage.setItem("weatherGeocodeCache",JSON.stringify(coords));locationSource=`${region}付近`;return coords;}
      }catch(error){console.warn("[Weather geocoding]",error);}
    }
    locationSource=`${pref}の代表地点`;
    return{...(PREF_COORDS[pref]||PREF_COORDS["東京都"]),cacheKey};
  }
  function getWindDirLabel(deg){if(deg==null)return"--";const dirs=["北","北北東","北東","東北東","東","東南東","南東","南南東","南","南南西","南西","西南西","西","西北西","北西","北北西"];return dirs[Math.round(deg/22.5)%16];}

  async function loadPollen(coords,today){
    try{
      const url=`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${coords.lat}&longitude=${coords.lon}&hourly=alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,ragweed_pollen&timezone=Asia%2FTokyo&forecast_days=3`;
      const response=await fetch(url);if(!response.ok)throw new Error(`HTTP ${response.status}`);const data=await response.json();
      const indices=(data.hourly?.time||[]).map((time,index)=>time.startsWith(today)?index:-1).filter(index=>index>=0);
      const names=["alder_pollen","birch_pollen","grass_pollen","mugwort_pollen","ragweed_pollen"];
      const peaks=names.map(name=>Math.max(0,...indices.map(index=>num(data.hourly?.[name],index,0))));
      const total=Math.round(peaks.reduce((sum,value)=>sum+value,0));
      return{total,label:pollenLabel(total),breakdown:`ハンノキ${Math.round(peaks[0])}・シラカバ${Math.round(peaks[1])}・イネ科${Math.round(peaks[2])}`};
    }catch(error){console.warn("[Pollen]",error);return{total:null,label:"取得不可",breakdown:"主要花粉の参考値を取得できませんでした"};}
  }

  function buildNews(){
    const news=[];
    if(detailData.rainChance>=50)news.push({icon:"☔",title:"雨具があると安心",text:`今日の最大降水確率は${detailData.rainChance}%です。`});
    if(detailData.uv>=6)news.push({icon:"☀️",title:"日差しが強い予報",text:"長時間外にいる場合は、日陰や休憩を意識しましょう。"});
    if(detailData.windMax>=36||detailData.windGust>=54)news.push({icon:"💨",title:"風に注意",text:`最大風速は約${(detailData.windMax/3.6).toFixed(1)}m/s（${detailData.windMax}km/h）の予報です。`});
    if(detailData.tempMax-detailData.tempMin>=10)news.push({icon:"🧥",title:"一日の寒暖差が大きめ",text:`最高と最低の差は約${Math.round(detailData.tempMax-detailData.tempMin)}℃です。`});
    if(detailData.pollen?.total>=10)news.push({icon:"🌲",title:"花粉の参考値が上昇",text:"主要花粉の予測です。スギ・ヒノキ専用情報ではありません。"});
    if(!news.length)news.push({icon:"✅",title:"大きな注意情報はありません",text:"予定の前に最新予報をもう一度確認すると安心です。"});
    return news;
  }

  function renderDetails(){
    if(detailData.temp==null)return;
    const pref=document.getElementById("pref")?.value||"東京都",region=document.getElementById("region")?.value||"";
    setText("weatherLocationLabel",`${pref}${region?`・${region}`:""}の天気`);setText("weatherHeroIcon",detailData.icon);setText("weatherHeroCondition",detailData.desc);
    setText("weatherHeroTemp",`${detailData.temp}℃`);setText("weatherHeroRange",`最高${detailData.tempMax}℃／最低${detailData.tempMin}℃`);setText("weatherFeelsLike",`${detailData.feelsLike}℃`);
    setText("weatherUpdatedAt",`${detailData.updatedAt.slice(11,16)}更新・${detailData.source}`);setText("weatherRainChance",`${detailData.rainChance}%`);setText("weatherRainAmount",`現在の降水量 ${detailData.rain.toFixed(1)}mm`);
    setText("weatherHumidity",`${detailData.humidity}%`);setText("weatherWind",`${(detailData.wind/3.6).toFixed(1)}m/s`);setText("weatherWindDetail",`約${detailData.wind}km/h・${getWindDirLabel(detailData.windDirection)}`);setText("weatherWindGuide",`${windGuide(detailData.wind)}（最大${(detailData.windMax/3.6).toFixed(1)}m/s）`);
    setText("weatherPressure",`${detailData.pressure}hPa`);setText("weatherUv",detailData.uv.toFixed(1));setText("weatherUvLabel",uvLabel(detailData.uv));
    setText("weatherPollen",detailData.pollen.label);setText("weatherPollenDetail",detailData.pollen.breakdown);setText("weatherSunrise",detailData.sunrise.slice(11,16));setText("weatherSunset",`日の入 ${detailData.sunset.slice(11,16)}`);setText("weatherCloud",`${detailData.cloud}%`);
    const heat=heatGuidance(detailData.apparentMax ?? detailData.feelsLike),alert=document.getElementById("heatAlertCard");if(alert){alert.classList.remove("alert-safe","alert-caution","alert-warning","alert-danger");alert.classList.add(heat.className);}setText("heatAlertLevel",heat.level);setText("heatAlertText",heat.text);
    const weekly=document.getElementById("weeklyWeather");if(weekly)weekly.innerHTML=weeklyData.map((day,index)=>`<article class="weekly-weather-day"><span>${index===0?"今日":new Date(`${day.date}T12:00:00`).toLocaleDateString("ja-JP",{weekday:"short",month:"numeric",day:"numeric"})}</span><b>${day.icon} ${day.text}</b><em><strong>${day.max}℃</strong> / ${day.min}℃</em><small>降水 ${day.rainChance}%</small></article>`).join("");
    const news=document.getElementById("weatherNews");if(news)news.innerHTML=buildNews().map(item=>`<article><span>${item.icon}</span><div><b>${item.title}</b><p>${item.text}</p></div></article>`).join("");
  }

  async function loadOpenMeteo(){
    const hourlyEl=document.getElementById("hourlyWeather"),coords=await getCoords(),today=localDateKey(new Date());
    try{
      const url=`https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,weather_code,precipitation,precipitation_probability,wind_speed_10m,relative_humidity_2m,surface_pressure,uv_index,apparent_temperature&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,weather_code,precipitation_sum,precipitation_probability_max,uv_index_max,sunrise,sunset,wind_speed_10m_max,wind_gusts_10m_max&timezone=Asia%2FTokyo&forecast_days=7`;
      const response=await fetch(url);if(!response.ok)throw new Error(`HTTP ${response.status}`);const data=await response.json(),todayIndex=(data.daily?.time||[]).indexOf(today),current=data.current||{},pollen=await loadPollen(coords,today);
      weatherMap={};weeklyData=[];(data.daily?.time||[]).forEach((date,index)=>{const code=num(data.daily.weather_code,index),entry={date,icon:wmoEmoji(code),text:wmoText(code),max:Math.round(num(data.daily.temperature_2m_max,index)),min:Math.round(num(data.daily.temperature_2m_min,index)),rainChance:Math.round(num(data.daily.precipitation_probability_max,index))};weatherMap[date]={icon:entry.icon,temp:entry.max,tempMin:entry.min,rainChance:entry.rainChance};weeklyData.push(entry);});
      detailData={icon:wmoEmoji(Number(current.weather_code||0)),desc:wmoText(Number(current.weather_code||0)),temp:Math.round(Number(current.temperature_2m||0)),feelsLike:Math.round(Number(current.apparent_temperature||0)),tempMax:Math.round(num(data.daily?.temperature_2m_max,todayIndex)),tempMin:Math.round(num(data.daily?.temperature_2m_min,todayIndex)),apparentMax:Math.round(num(data.daily?.apparent_temperature_max,todayIndex)),humidity:Math.round(Number(current.relative_humidity_2m||0)),pressure:Math.round(Number(current.surface_pressure||0)),wind:Number(Number(current.wind_speed_10m||0).toFixed(1)),windDirection:Number(current.wind_direction_10m||0),windGust:Number(Number(current.wind_gusts_10m||0).toFixed(1)),windMax:Number(num(data.daily?.wind_speed_10m_max,todayIndex).toFixed(1)),rain:Number(current.precipitation||0),rainChance:Math.round(num(data.daily?.precipitation_probability_max,todayIndex)),uv:num(data.daily?.uv_index_max,todayIndex),sunrise:data.daily?.sunrise?.[todayIndex]||`${today}T--:--`,sunset:data.daily?.sunset?.[todayIndex]||`${today}T--:--`,cloud:Math.round(Number(current.cloud_cover||0)),pollen,updatedAt:current.time||new Date().toISOString(),source:locationSource};
      const indices=(data.hourly?.time||[]).map((time,index)=>time.startsWith(today)?index:-1).filter(index=>index>=0);if(hourlyEl)hourlyEl.innerHTML=indices.map(index=>{const hour=data.hourly.time[index].slice(11,16),code=num(data.hourly.weather_code,index),temp=Math.round(num(data.hourly.temperature_2m,index)),chance=Math.round(num(data.hourly.precipitation_probability,index));return`<div class="hourBox"><div class="hour-label">${hour}</div><div class="hour-icon">${wmoEmoji(code)}</div><div class="hour-temp">${temp}℃</div><div class="hour-rain">☔${chance}%</div></div>`;}).join("")||'<p class="weather-error">本日の時間別データがありません</p>';
      renderDetails();
      try {
        localStorage.setItem("weatherDetailCache", JSON.stringify({
          weatherMap, detailData, weeklyData,
          hourlyHtml: hourlyEl?.innerHTML || "",
          cachedAt: new Date().toISOString(), locationKey: coords.cacheKey
        }));
      } catch (cacheError) { console.warn("[Weather cache]", cacheError); }
    }catch(error){
      console.error("[Open-Meteo]",error);
      let restored = false;
      try {
        const cache = JSON.parse(localStorage.getItem("weatherDetailCache") || "null");
        if (cache?.detailData && cache?.weatherMap && cache.locationKey === coords.cacheKey) {
          weatherMap = cache.weatherMap;
          detailData = cache.detailData;
          weeklyData = cache.weeklyData || [];
          if (hourlyEl) hourlyEl.innerHTML = cache.hourlyHtml || '<p class="weather-error">時間別予報の保存データはありません</p>';
          renderDetails();
          const cachedTime = cache.cachedAt ? new Date(cache.cachedAt).toLocaleString("ja-JP", {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "前回";
          setText("weatherUpdatedAt",`${cachedTime}取得・保存データ`);
          restored = true;
        }
      } catch (cacheError) { console.warn("[Weather cache restore]", cacheError); }
      if (!restored) {
        if(hourlyEl)hourlyEl.innerHTML='<p class="weather-error">⚠️ 天気の取得に失敗しました。更新ボタンを押してください。</p>';
        setText("weatherHeroCondition","天気を取得できませんでした");
      }
    }
  }
  async function load(){return loadOpenMeteo();}
  return{load,renderDetails,getWeatherMap,getDetailData,getGpsCoords,requestLocation,loadSavedGps,getCoords,PREF_MAP,PREF_COORDS,getWindDirLabel};
})();
