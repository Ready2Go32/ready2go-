// 自治体公式カレンダーから確認した内蔵データ（API不要）
const MunicipalGarbageData = (() => {
  const SOURCE_URL = "https://www.city.machida.tokyo.jp/kurashi/kankyo/gomi/gominowakekata/gomi-dashikata/syuusyuu/index.html";
  const key = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  function between(start,end,test,excluded=[]) { const out=[], blocked=new Set(excluded); for(const d=new Date(`${start}T12:00:00`), last=new Date(`${end}T12:00:00`);d<=last;d.setDate(d.getDate()+1)){const k=key(d);if(test(d,k)&&!blocked.has(k))out.push(k);}return out; }
  const weekdays=(start,end,dows,excluded=[])=>between(start,end,d=>dows.includes(d.getDay()),excluded);
  const biweekly=(start,end,anchor,excluded=[])=>{const a=new Date(`${anchor}T12:00:00`);return between(start,end,d=>Math.round((d-a)/86400000)%14===0,excluded);};
  const monthly=(start,end,dow,week)=>between(start,end,d=>d.getDay()===dow&&Math.ceil(d.getDate()/7)===week);
  const start="2025-10-01", end="2026-09-30";
  const schedule={
    garbageTypes:[
      {name:"燃やせるごみ",icon:"🔥",color:"#eab308",schedule:"月・木曜日",dates:weekdays(start,end,[1,4],["2026-01-01"]),days:[]},
      {name:"古紙・雑がみ・古着",icon:"📰",color:"#f59e0b",schedule:"火曜日",dates:weekdays(start,end,[2]),days:[]},
      {name:"燃やせないごみ",icon:"🟢",color:"#10b981",schedule:"隔週水曜日（指定日）",dates:[...biweekly("2025-10-01","2025-12-30","2025-10-08"),...biweekly("2026-01-01","2026-03-31","2026-01-07"),...biweekly("2026-04-01",end,"2026-04-01")],days:[]},
      {name:"ペットボトル",icon:"🧴",color:"#38bdf8",schedule:"隔週水曜日（指定日）",dates:[...biweekly("2025-10-01","2025-12-30","2025-10-01"),...biweekly("2026-01-01","2026-03-31","2026-01-14"),...biweekly("2026-04-01",end,"2026-04-08")],days:[]},
      {name:"剪定枝",icon:"🌿",color:"#84cc16",schedule:"隔週金曜日（指定日）",dates:[...biweekly("2025-10-01","2025-12-31","2025-10-03"),...biweekly("2026-01-01","2026-03-31","2026-01-16"),...biweekly("2026-04-01",end,"2026-04-03")],days:[]},
      {name:"ビン・カン・スプレー缶",icon:"♻️",color:"#0ea5e9",schedule:"土曜日",dates:weekdays(start,end,[6],["2026-01-03"]),days:[]},
      {name:"電池・充電式小型家電",icon:"🔋",color:"#8b5cf6",schedule:"第2土曜日",dates:monthly(start,end,6,2),days:[]},
      {name:"蛍光管・ライター・水銀体温計",icon:"💡",color:"#ec4899",schedule:"第4土曜日",dates:monthly(start,end,6,4),days:[]},
      {name:"容器包装プラスチック",icon:"📦",color:"#f472b6",schedule:"2026年4月から金曜日",dates:weekdays("2026-04-01",end,[5]),days:[]}
    ],sourceUrl:SOURCE_URL,checkedAt:"2025-10-01T00:00:00+09:00",validFrom:start,validUntil:end,
    note:"町田市 地区1（忠生1～4丁目・玉川学園1～8丁目）の2025年10月～2026年9月版です。2026年10月以降は新しい公式カレンダーへの更新が必要です。",
    confidence:"official-registered",_verifiedOfficial:true,_municipalRegistered:true,district:"地区1"
  };
  function normalize(v){const value=String(v||"").trim().replace(/[\s　]/g,"").replace(/[一１]丁目$/,"1丁目").replace(/[二２]丁目$/,"2丁目").replace(/[三３]丁目$/,"3丁目").replace(/[四４]丁目$/,"4丁目").replace(/[五５]丁目$/,"5丁目").replace(/[六６]丁目$/,"6丁目").replace(/[七７]丁目$/,"7丁目").replace(/[八８]丁目$/,"8丁目");return /^(忠生[1-4]|玉川学園[1-8])$/.test(value)?`${value}丁目`:value;}
  function find(pref,region,area){if(pref!=="東京都"||region!=="町田市")return null;return /^(忠生[1-4]丁目|玉川学園[1-8]丁目)$/.test(normalize(area))?JSON.parse(JSON.stringify(schedule)):null;}
  return {find};
})();
