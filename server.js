// server.js — Ready2Go LINE連携サーバー
// 役割:
//   1. LINEユーザーのWebhookを受け取りユーザーIDを登録
//   2. 毎朝、各ユーザーの予定＋天気を通知
//   3. フロントエンドからの予定CRUD APIを提供

require("dotenv").config();
process.env.TZ = process.env.TZ || "Asia/Tokyo";
const express    = require("express");
const line       = require("@line/bot-sdk");
const cron       = require("node-cron");
const fetch      = require("node-fetch");
const fs         = require("fs");
const path       = require("path");

const app = express();

// ── LINE SDK設定 ──────────────────────────────────────────
const lineConfig = {
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// ── データストア（本番ではDBを使用してください） ─────────────
// ファイルベースの簡易ストア。Renderでは DATA_DIR=/var/data と永続ディスクを使用。
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "data.json");

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch(e) { console.error("データ読み込みエラー:", e); }
  return { users: {}, events: {} };
}

function saveData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

let store = loadData();

// ── ミドルウェア ─────────────────────────────────────────
// LINE Webhookの署名検証（rawBodyが必要）
app.use("/webhook", line.middleware(lineConfig));
app.use(express.json());

// CORS（同一URLで公開する構成。APP_URL以外の外部サイトには許可しない）
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (!process.env.APP_URL || origin === process.env.APP_URL)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  if (req.method === "OPTIONS") { res.sendStatus(200); return; }
  next();
});
app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ブラウザへ公開してよい設定だけを環境変数から配信する。
app.get("/app-config.js", (req, res) => {
  res.type("application/javascript");
  res.header("Cache-Control", "no-store");
  res.send(`window.APP_CONFIG=${JSON.stringify({
    serverUrl: process.env.APP_URL || `${req.protocol}://${req.get("host")}`,
    liffId: process.env.LIFF_ID || "",
  })};`);
});
app.use(express.static(__dirname));

// ── LINE Webhook ─────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // LINEには即座に200を返す

  const events = req.body.events || [];
  for (const event of events) {
    const userId = event.source?.userId;
    if (!userId) continue;

    // フォローイベント（友だち追加）
    if (event.type === "follow") {
      await handleFollow(userId);
    }

    // メッセージイベント
    if (event.type === "message" && event.message.type === "text") {
      await handleMessage(userId, event.message.text, event.replyToken);
    }
  }
});

// 友だち追加時の処理
async function handleFollow(userId) {
  if (!store.users[userId]) {
    store.users[userId] = {
      userId,
      registeredAt: new Date().toISOString(),
      notifyEnabled: true,
    };
    saveData(store);
    console.log(`新規ユーザー登録: ${userId}`);
  }

  await lineClient.replyMessage({
    replyToken: undefined, // followイベントにはreplyTokenがないのでpushを使う
  }).catch(() => {});

  // プッシュメッセージで歓迎
  await lineClient.pushMessage({
    to: userId,
    messages: [{
      type: "text",
      text: `📘 Ready2Goへようこそ！\n\nあなたのLINEアカウントと連携しました。\n毎朝7時に今日の予定と天気をお知らせします。\n\n「通知オフ」と送ると通知を停止できます。`
    }]
  });
}

// メッセージ受信時の処理
async function handleMessage(userId, text, replyToken) {
  const trimmed = text.trim();

  if (trimmed === "通知オフ" || trimmed === "通知OFF") {
    if (store.users[userId]) {
      store.users[userId].notifyEnabled = false;
      saveData(store);
    }
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: "朝の通知をオフにしました。「通知オン」で再度有効にできます。" }]
    });
    return;
  }

  if (trimmed === "通知オン" || trimmed === "通知ON") {
    if (store.users[userId]) {
      store.users[userId].notifyEnabled = true;
      saveData(store);
    }
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: "朝の通知をオンにしました。毎朝7時にお知らせします。" }]
    });
    return;
  }

  if (trimmed === "今日の予定" || trimmed === "予定") {
    const message = await buildDailyMessage(userId);
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: message }]
    });
    return;
  }

  // デフォルト応答
  await lineClient.replyMessage({
    replyToken,
    messages: [{
      type: "text",
      text: "コマンド一覧:\n・「今日の予定」— 今日のスケジュール確認\n・「通知オフ」— 朝の通知を停止\n・「通知オン」— 朝の通知を再開"
    }]
  });
}

// ── 予定CRUD API（フロントエンドから呼び出し） ───────────────

// ユーザー確認・登録
function ensureUser(userId) {
  if (!store.users[userId]) {
    store.users[userId] = {
      userId,
      registeredAt: new Date().toISOString(),
      notifyEnabled: true,
    };
  }
  if (!store.events[userId]) {
    store.events[userId] = {};
  }
}

function getBearerToken(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

async function verifyLineIdToken(idToken) {
  if (!process.env.LINE_LOGIN_CHANNEL_ID) {
    throw new Error("LINE_LOGIN_CHANNEL_ID が設定されていません");
  }
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: process.env.LINE_LOGIN_CHANNEL_ID,
  });
  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("無効または期限切れのLINE IDトークンです");
  const payload = await response.json();
  if (!payload.sub || String(payload.aud) !== String(process.env.LINE_LOGIN_CHANNEL_ID)) {
    throw new Error("LINE IDトークンの対象が一致しません");
  }
  return payload;
}

async function requireUserAuth(req, res, next) {
  const idToken = getBearerToken(req);
  if (!idToken) return res.status(401).json({ error: "LINE認証が必要です" });
  try {
    const payload = await verifyLineIdToken(idToken);
    req.userId = payload.sub;
    ensureUser(req.userId);
    next();
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
}

// 予定一覧取得
app.get("/api/events/:dateKey", requireUserAuth, (req, res) => {
  const { dateKey } = req.params;
  const list = store.events[req.userId][dateKey] || [];
  res.json(list);
});

// 予定追加
app.post("/api/events/:dateKey", requireUserAuth, (req, res) => {
  const { dateKey } = req.params;
  const event = req.body;
  if (!event || !event.title) {
    res.status(400).json({ error: "タイトルが必要です" });
    return;
  }
  if (!store.events[req.userId][dateKey]) {
    store.events[req.userId][dateKey] = [];
  }
  store.events[req.userId][dateKey].push(event);
  saveData(store);
  res.json({ ok: true });
});

// 予定更新
app.put("/api/events/:dateKey/:idx", requireUserAuth, (req, res) => {
  const { dateKey, idx } = req.params;
  const list = store.events[req.userId][dateKey] || [];
  const i = parseInt(idx, 10);
  if (i < 0 || i >= list.length) {
    res.status(404).json({ error: "見つかりません" });
    return;
  }
  list[i] = req.body;
  store.events[req.userId][dateKey] = list;
  saveData(store);
  res.json({ ok: true });
});

// 予定削除
app.delete("/api/events/:dateKey/:idx", requireUserAuth, (req, res) => {
  const { dateKey, idx } = req.params;
  const list = store.events[req.userId][dateKey] || [];
  const i = parseInt(idx, 10);
  list.splice(i, 1);
  store.events[req.userId][dateKey] = list;
  saveData(store);
  res.json({ ok: true });
});

// 全予定一括保存（IndexedDB同期用）
app.post("/api/events-bulk", requireUserAuth, (req, res) => {
  const { events } = req.body;
  if (!events || typeof events !== "object") {
    res.status(400).json({ error: "eventsが必要です" });
    return;
  }
  store.events[req.userId] = events;
  saveData(store);
  res.json({ ok: true });
});

// ユーザー設定保存（位置情報・地域など）
app.post("/api/user-settings", requireUserAuth, (req, res) => {
  Object.assign(store.users[req.userId], req.body);
  saveData(store);
  res.json({ ok: true });
});

// 自治体の公式情報だけを候補として返す。APIキーはブラウザへ渡さない。
app.post("/api/garbage-schedule", requireUserAuth, async (req, res) => {
  const pref = String(req.body?.pref || "").trim();
  const region = String(req.body?.region || "").trim();
  const area = String(req.body?.area || "").trim();
  if (!pref || !region || pref.length > 10 || region.length > 30 || area.length > 50) {
    return res.status(400).json({ error: "地域を正しく選択してください" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "ごみ情報検索APIが設定されていません" });
  }

  const prompt = `日本の自治体公式サイトだけを検索し、${pref}${region}${area ? area : ""}のごみ収集日を整理してください。
町名や地区によって日程が異なり特定できない場合、公式情報が見つからない場合、または推測が必要な場合は、garbageTypesを空配列、confidenceをlowにしてください。一般的な日程を作らないでください。
JSONのみを返してください。形式:
{"garbageTypes":[{"name":"種類","color":"#ef4444","icon":"🗑️","schedule":"説明","days":[{"dow":1,"week":null}]}],"note":"地区差や祝日の注意","sourceUrl":"https://自治体の公式URL","confidence":"highまたはmediumまたはlow"}
dowは0=日〜6=土、weekは毎週ならnull、第1・第3などの場合は数値です。`;

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 1400,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!apiRes.ok) throw new Error(`検索APIエラー (${apiRes.status})`);
    const apiData = await apiRes.json();
    const text = (apiData.content || []).filter(x => x.type === "text").map(x => x.text).join("\n");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("検索結果を読み取れませんでした");
    const schedule = JSON.parse(match[0]);
    const officialUrl = typeof schedule.sourceUrl === "string"
      && /^https:\/\//i.test(schedule.sourceUrl);
    const usable = officialUrl
      && ["high", "medium"].includes(schedule.confidence)
      && Array.isArray(schedule.garbageTypes)
      && schedule.garbageTypes.length > 0;
    if (!usable) {
      return res.status(422).json({ error: "自治体公式情報を十分に確認できませんでした" });
    }
    schedule._verifiedOfficial = true;
    schedule.checkedAt = new Date().toISOString();
    store.users[req.userId].garbageSchedule = schedule;
    store.users[req.userId].pref = pref;
    store.users[req.userId].region = region;
    store.users[req.userId].area = area;
    saveData(store);
    res.json(schedule);
  } catch (error) {
    console.error("ごみ情報取得エラー:", error.message);
    res.status(502).json({ error: "ごみ収集情報を安全に確認できませんでした" });
  }
});

// 品目の分別も自治体公式情報を確認できた場合だけ返す。
app.post("/api/garbage-sort", requireUserAuth, async (req, res) => {
  const pref = String(req.body?.pref || "").trim();
  const region = String(req.body?.region || "").trim();
  const area = String(req.body?.area || "").trim();
  const item = String(req.body?.item || "").trim();
  if (!pref || !region || !item || item.length > 80 || area.length > 50) {
    return res.status(400).json({ error:"地域と品目を正しく入力してください" });
  }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error:"分別検索APIが設定されていません" });
  const prompt = `日本の自治体公式サイトだけを検索してください。${pref}${region}${area}で「${item}」を何ごみとして、どのように出すか確認してください。見つからない場合や推測が必要な場合はconfidenceをlowにしてください。JSONのみを返してください: {"category":"分別区分","instructions":"出し方と注意","sourceUrl":"https://自治体公式URL","confidence":"highまたはmediumまたはlow"}`;
  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":process.env.ANTHROPIC_API_KEY, "anthropic-version":"2023-06-01" },
      body:JSON.stringify({
        model:process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6", max_tokens:900,
        tools:[{ type:"web_search_20260209", name:"web_search", max_uses:4 }],
        messages:[{ role:"user", content:prompt }]
      })
    });
    if (!apiRes.ok) throw new Error(`検索APIエラー (${apiRes.status})`);
    const apiData = await apiRes.json();
    const text = (apiData.content || []).filter(x => x.type === "text").map(x => x.text).join("\n");
    const match = text.match(/\{[\s\S]*\}/); if (!match) throw new Error("結果を読み取れませんでした");
    const answer = JSON.parse(match[0]);
    const valid = ["high","medium"].includes(answer.confidence)
      && typeof answer.category === "string" && typeof answer.instructions === "string"
      && typeof answer.sourceUrl === "string" && /^https:\/\//i.test(answer.sourceUrl);
    if (!valid) return res.status(422).json({ error:"自治体公式情報で分別方法を確認できませんでした" });
    res.json(answer);
  } catch(e) {
    console.error("分別検索エラー:", e.message);
    res.status(502).json({ error:"分別方法を安全に確認できませんでした" });
  }
});

// ── ユーザー別LINE通知 ──────────────────────────────────
cron.schedule("* * * * *", sendScheduledNotifications, { timezone: "Asia/Tokyo" });

function timeInJapan(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(date);
  const o = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { dateKey: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}` };
}

function isPaused(user, todayKey) {
  return user.notifyEnabled === false || (user.pauseUntil && todayKey <= user.pauseUntil);
}

async function pushOnce(userId, key, text) {
  const user = store.users[userId];
  if (!user.sentNotifications) user.sentNotifications = {};
  if (user.sentNotifications[key]) return;
  await lineClient.pushMessage({ to: userId, messages: [{ type: "text", text }] });
  user.sentNotifications[key] = new Date().toISOString();
  const cutoff = Date.now() - 14 * 86400000;
  for (const [k,v] of Object.entries(user.sentNotifications)) {
    if (new Date(v).getTime() < cutoff) delete user.sentNotifications[k];
  }
  saveData(store);
}

async function sendScheduledNotifications() {
  const now = timeInJapan();
  const userIds = Object.keys(store.users);
  for (const userId of userIds) {
    const user = store.users[userId];
    if (isPaused(user, now.dateKey)) continue;
    try {
      const todayTimes = user.todayNotifyTimes || [process.env.MORNING_NOTIFY_TIME || "07:00"];
      const previousTimes = user.previousNotifyTimes || [];
      if (todayTimes.includes(now.time)) {
        await pushOnce(userId, `today:${now.dateKey}:${now.time}`, await buildDailyMessage(userId, 0));
      }
      if (previousTimes.includes(now.time)) {
        await pushOnce(userId, `previous:${now.dateKey}:${now.time}`, await buildDailyMessage(userId, 1));
      }
      if (user.garbageReminder !== false && (user.garbageReminderTime || "20:00") === now.time) {
        const garbageText = buildGarbageReminder(user);
        if (garbageText) await pushOnce(userId, `garbage:${now.dateKey}:${now.time}`, garbageText);
      }
    } catch(e) {
      console.error(`通知送信失敗: ${userId}`, e.message);
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

async function buildDailyMessage(userId, dayOffset = 0) {
  const target = new Date(); target.setDate(target.getDate() + dayOffset);
  const targetKey = getDateKey(target);
  const events  = (store.events[userId] || {})[targetKey] || [];
  const user    = store.users[userId] || {};

  // 天気取得
  let weatherText = "";
  try {
    const lat = user.gpsLat || 35.69;
    const lon = user.gpsLon || 139.69;
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&hourly=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min,weathercode`
      + `&timezone=Asia%2FTokyo&forecast_days=${dayOffset + 1}`
    );
    const wData = await wRes.json();
    if (wData.daily) {
      const code   = wData.daily.weathercode[dayOffset];
      const max    = Math.round(wData.daily.temperature_2m_max[dayOffset]);
      const min    = Math.round(wData.daily.temperature_2m_min[dayOffset]);
      const icon   = wmoEmoji(code);
      weatherText  = `${icon} 天気: ${wmoText(code)}\n🌡️ ${min}℃ 〜 ${max}℃`;
    }
  } catch(e) { weatherText = "（天気の取得に失敗しました）"; }

  // 日付
  const wday  = ["日","月","火","水","木","金","土"][target.getDay()];
  const dateStr = `${target.getMonth()+1}月${target.getDate()}日（${wday}）`;

  // 予定
  let eventsText = "";
  if (events.length === 0) {
    eventsText = "📅 今日の予定はありません";
  } else {
    const sorted = [...events].sort((a,b) => a.time.localeCompare(b.time));
    eventsText = "📅 今日の予定:\n" + sorted.map(ev => `  ${ev.time} ${ev.title}`).join("\n");
  }

  return `━━━━━━━━━━━━━━━
📘 Ready2Go ${dayOffset ? "明日の" : "今日の"}お知らせ
${dateStr}
━━━━━━━━━━━━━━━

${weatherText}

${eventsText}

📌 ${process.env.APP_URL || "アプリで詳細を確認"}`;
}

function getTodayKey() {
  return getDateKey(new Date());
}
function getDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function garbageForDate(schedule, date) {
  if (!schedule?.garbageTypes) return [];
  const dow = date.getDay(), week = Math.ceil(date.getDate() / 7);
  return schedule.garbageTypes.filter(g => (g.days || []).some(r => r.dow === dow && (r.week == null || r.week === week)));
}

function buildGarbageReminder(user) {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const types = garbageForDate(user.garbageSchedule, tomorrow);
  if (!types.length) return "";
  const warning = user.garbageSchedule.note ? `\n⚠️ ${user.garbageSchedule.note}\n祝日などは自治体公式ページで再確認してください。` : "\n⚠️ 祝日は収集変更の可能性があります。自治体公式ページで確認してください。";
  return `🗑️ 明日は${types.map(x => `${x.icon || ""}${x.name}`).join("・")}の日です。${warning}\n${user.garbageSchedule.sourceUrl || ""}`;
}

app.post("/api/test-notification", requireUserAuth, async (req, res) => {
  try {
    await lineClient.pushMessage({ to: req.userId, messages: [{ type: "text", text: "✅ Ready2Goのテスト通知です。LINE連携は正常です。" }] });
    res.json({ ok: true });
  } catch(e) { res.status(502).json({ error: "LINEテスト通知を送れませんでした" }); }
});

function wmoEmoji(code) {
  if (code <= 1)  return "☀️";
  if (code <= 3)  return "⛅";
  if (code <= 49) return "🌫️";
  if (code <= 67) return "☔";
  if (code <= 77) return "☃️";
  if (code <= 82) return "🌧️";
  if (code <= 99) return "⛈️";
  return "☀️";
}

function wmoText(code) {
  if (code <= 1)  return "晴れ";
  if (code <= 3)  return "曇り";
  if (code <= 49) return "霧";
  if (code <= 67) return "雨";
  if (code <= 77) return "雪";
  if (code <= 82) return "強い雨";
  if (code <= 99) return "雷雨";
  return "晴れ";
}

// ── LINE LIFFのリダイレクト ──────────────────────────────
// LIFF経由でユーザーIDを取得してフロントエンドに渡す
app.post("/liff-init", requireUserAuth, (req, res) => {
  saveData(store);
  res.json({ ok: true, userId: req.userId });
});

// ── ヘルスチェック ────────────────────────────────────────
app.get("/health", (_, res) => res.json({ ok: true, users: Object.keys(store.users).length }));

// ── サーバー起動 ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ready2Go サーバー起動 — port ${PORT}`);
  console.log("ユーザー別通知スケジューラー起動 (Asia/Tokyo)");
});
