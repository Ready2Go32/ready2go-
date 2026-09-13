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
const crypto     = require("crypto");
const path       = require("path");
const { loadData, saveData, getStorageMode } = require("./database");

const app = express();
const APP_VERSION = "1.1.0";
const REQUIRED_PRODUCTION_ENV = [
  "DATABASE_URL", "LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "LINE_LOGIN_CHANNEL_ID", "LIFF_ID", "APP_URL",
  "OPERATOR_NAME", "CONTACT_EMAIL"
];

app.set("trust proxy", 1);

// ── LINE SDK設定 ──────────────────────────────────────────
const lineConfig = {
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// DATABASE_URLがあればPostgreSQL、なければ従来のdata.jsonを使用する。
let store = { users: {}, events: {}, garbageSchedules: {}, notificationLogs: {}, feedback: [], groups: {} };

// ── ミドルウェア ─────────────────────────────────────────
// LINE WebhookはJSONミドルウェアより先に処理する。
// LINE SDKが署名検証のため本文を読み取るので、express.json()を重ねない。
const webhookMiddleware = lineConfig.channelSecret
  ? line.middleware(lineConfig)
  : (req, res) => res.status(503).json({ error: "LINE_CHANNEL_SECRET が設定されていません" });

app.post("/webhook", webhookMiddleware, async (req, res) => {
  res.sendStatus(200); // LINEには即座に200を返す

  const events = req.body.events || [];
  for (const event of events) {
    const userId = event.source?.userId;
    if (!userId) continue;

    try {
      if (event.type === "follow") {
        await handleFollow(userId);
      }

      if (event.type === "message" && event.message.type === "text") {
        await handleMessage(userId, event.message.text, event.replyToken);
      }
    } catch (error) {
      console.error(`Webhook処理失敗 (${event.type || "unknown"}):`, error.message);
    }
  }
});

app.use(express.json({ limit: "800kb" }));

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
  res.header("X-Frame-Options", "DENY");
  res.header("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  res.header("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://static.line-scdn.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://*.line.me https://*.line-scdn.net https://api.open-meteo.com https://air-quality-api.open-meteo.com https://geocoding-api.open-meteo.com https://nominatim.openstreetmap.org",
    "frame-src https://*.line.me",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; "));
  next();
});

function createRateLimit({ windowMs, max, message }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    current.count += 1;
    if (current.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
      res.status(429).json({ error: message || "短時間の操作が多すぎます。少し待ってから再度お試しください" });
      return;
    }
    next();
  };
}

const apiRateLimit = createRateLimit({ windowMs: 60_000, max: 180 });
const inviteRateLimit = createRateLimit({ windowMs: 10 * 60_000, max: 20, message: "招待コードの確認回数が多すぎます。10分ほど待ってください" });
app.use("/api", apiRateLimit);

// ブラウザへ公開してよい設定だけを環境変数から配信する。
app.get("/app-config.js", (req, res) => {
  res.type("application/javascript");
  res.header("Cache-Control", "no-store");
  res.send(`window.APP_CONFIG=${JSON.stringify({
    serverUrl: process.env.APP_URL || `${req.protocol}://${req.get("host")}`,
    liffId: process.env.LIFF_ID || "",
    version: APP_VERSION,
    operatorName: process.env.OPERATOR_NAME || "Ready2Go運営者",
    contactEmail: process.env.CONTACT_EMAIL || "",
  })};`);
});

// 必要な画面ファイルだけを公開する。data.json・server.js・設定資料などは配信しない。
const PUBLIC_FILES = new Set([
  "index.html", "garbage-calendar.html", "liff-init.html", "privacy.html", "terms.html",
  "style.css", "storage.js", "weather.js", "garbage.js", "municipal-garbage-data.js",
  "settings.js", "calendar.js", "dashboard.js", "features.js", "script.js",
  "service-worker.js", "manifest.json", "app-icon.svg", "icon-192.png", "icon-512.png"
]);
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const fileName = req.path.startsWith("/") ? req.path.slice(1) : req.path;
  if (!PUBLIC_FILES.has(fileName)) return next();
  res.set("Cache-Control", fileName === "service-worker.js" || fileName.endsWith(".html")
    ? "no-cache"
    : "public, max-age=3600");
  return res.sendFile(path.join(__dirname, fileName));
});

// 友だち追加時の処理
async function handleFollow(userId) {
  if (!store.users[userId]) {
    store.users[userId] = {
      userId,
      registeredAt: new Date().toISOString(),
      notifyEnabled: true,
    };
    await saveData(store);
    console.log(`新規ユーザー登録: ${userId}`);
  }

  // プッシュメッセージで歓迎
  await lineClient.pushMessage({
    to: userId,
    messages: [{
      type: "text",
      text: `📘 Ready2Goへようこそ！\n\nあなたのLINEアカウントと連携しました。\n設定した時刻に予定・天気・ごみ情報をお知らせします。\n\n「通知オフ」と送ると通知を停止できます。`
    }]
  });
}

// メッセージ受信時の処理
async function handleMessage(userId, text, replyToken) {
  const trimmed = text.trim();
  ensureUser(userId);

  if (process.env.TEST_MODE === "true" && !store.users[userId].testAccess) {
    await lineClient.replyMessage({ replyToken, messages: [{ type: "text", text: "Ready2Goは現在テスト中です。先にアプリを開き、グループから受け取った招待コードを入力してください。" }] });
    return;
  }

  if (trimmed === "登録する" && store.users[userId].pendingLineEvent) {
    const pending = store.users[userId].pendingLineEvent;
    const end = pending.repeat === "weekly" ? new Date(Date.now() + 366 * 86400000) : new Date(`${pending.dateKey}T00:00:00`);
    for (let day = new Date(`${pending.dateKey}T00:00:00`), count = 0; day <= end && count < 53; count++) {
      const dateKey = getDateKey(day);
      store.events[userId][dateKey] ||= [];
      store.events[userId][dateKey].push(cleanEvent({
        title: pending.title, time: pending.time, repeat: pending.repeat || "none",
        repeatUntil: getDateKey(end), recurrenceStart: pending.dateKey, items: []
      }));
      if (pending.repeat !== "weekly") break;
      day.setDate(day.getDate() + 7);
    }
    delete store.users[userId].pendingLineEvent;
    await saveData(store);
    await lineClient.replyMessage({ replyToken, messages: [{ type: "text", text: `✅ 「${pending.title}」を予定に登録しました。` }] });
    return;
  }

  if (trimmed === "キャンセル" && store.users[userId].pendingLineEvent) {
    delete store.users[userId].pendingLineEvent;
    await saveData(store);
    await lineClient.replyMessage({ replyToken, messages: [{ type: "text", text: "予定登録をキャンセルしました。" }] });
    return;
  }

  const parsedEvent = parseLineEvent(trimmed);
  if (parsedEvent) {
    store.users[userId].pendingLineEvent = parsedEvent;
    await saveData(store);
    const repeatText = parsedEvent.repeat === "weekly" ? "（毎週・1年間）" : "";
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: `この内容で登録しますか？\n📅 ${parsedEvent.dateKey} ${parsedEvent.time}\n${parsedEvent.title}${repeatText}\n\n「登録する」または「キャンセル」と送ってください。` }]
    });
    return;
  }

  if (trimmed === "通知オフ" || trimmed === "通知OFF") {
    if (store.users[userId]) {
      store.users[userId].notifyEnabled = false;
      await saveData(store);
    }
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: "Ready2Goの通知をオフにしました。「通知オン」で再度有効にできます。" }]
    });
    return;
  }

  if (trimmed === "通知オン" || trimmed === "通知ON") {
    if (store.users[userId]) {
      store.users[userId].notifyEnabled = true;
      await saveData(store);
    }
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: "Ready2Goの通知をオンにしました。アプリで設定した時刻にお知らせします。" }]
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
      text: "コマンド一覧:\n・「今日の予定」— 今日のスケジュール確認\n・「8月30日 10時 歯医者」— 予定登録\n・「毎週月曜日 16時 部活」— 繰り返し登録\n・「通知オフ」— 通知を停止\n・「通知オン」— 通知を再開"
    }]
  });
}

function parseLineEvent(value) {
  const weekly = value.match(/^毎週\s*([日月火水木金土])曜日?\s*(\d{1,2})時(?:\s*(\d{1,2})分)?\s+(.+)$/);
  if (weekly) {
    const dows = "日月火水木金土";
    const targetDow = dows.indexOf(weekly[1]);
    const date = new Date();
    let diff = (targetDow - date.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    date.setDate(date.getDate() + diff);
    return parsedLineEventResult(date, weekly[2], weekly[3], weekly[4], "weekly");
  }
  const dated = value.match(/^(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日\s*(\d{1,2})時(?:\s*(\d{1,2})分)?\s+(.+)$/);
  if (!dated) return null;
  const now = new Date();
  let year = Number(dated[1] || now.getFullYear());
  let date = new Date(year, Number(dated[2]) - 1, Number(dated[3]));
  if (!dated[1] && date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    date = new Date(year + 1, Number(dated[2]) - 1, Number(dated[3]));
  }
  if (date.getMonth() !== Number(dated[2]) - 1 || date.getDate() !== Number(dated[3])) return null;
  return parsedLineEventResult(date, dated[4], dated[5], dated[6], "none");
}

function parsedLineEventResult(date, hourValue, minuteValue, titleValue, repeat) {
  const hour = Number(hourValue), minute = Number(minuteValue || 0);
  const title = String(titleValue || "").trim();
  if (hour > 23 || minute > 59 || !title || title.length > 120) return null;
  return { dateKey: getDateKey(date), time: `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`, title, repeat };
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

const USER_SETTING_KEYS = [
  "notifyEnabled", "todayNotifyTimes", "previousNotifyTimes", "pauseUntil",
  "garbageReminder", "garbageReminderTime", "eventReminderEnabled", "pref", "region", "area",
  "locationMode", "gpsLat", "gpsLon", "garbageSchedule"
];

function publicUserSettings(user = {}) {
  return Object.fromEntries(USER_SETTING_KEYS
    .filter(key => user[key] !== undefined)
    .map(key => [key, JSON.parse(JSON.stringify(user[key]))]));
}

function cleanGarbageSchedule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ごみ収集設定の形式が正しくありません");
  }
  const types = Array.isArray(value.garbageTypes) ? value.garbageTypes : [];
  if (types.length > 40) throw new Error("ごみ収集区分が多すぎます");
  const safe = {
    garbageTypes: types.map(item => {
      const name = String(item?.name || "").trim().slice(0, 60);
      if (!name) throw new Error("ごみ収集区分の名前が必要です");
      const days = Array.isArray(item.days) ? item.days.slice(0, 20).map(rule => ({
        dow: Math.min(6, Math.max(0, Number(rule?.dow) || 0)),
        week: rule?.week == null ? null : Math.min(5, Math.max(1, Number(rule.week) || 1))
      })) : [];
      const dates = Array.isArray(item.dates)
        ? [...new Set(item.dates.map(String).filter(validDateKey))].slice(0, 1000)
        : [];
      return {
        name,
        color: /^#[0-9a-f]{6}$/i.test(String(item.color || "")) ? String(item.color) : "#64748b",
        icon: String(item.icon || "🗑️").slice(0, 12),
        schedule: String(item.schedule || "").slice(0, 160),
        days,
        dates
      };
    }),
    note: String(value.note || "").slice(0, 500),
    sourceUrl: /^https:\/\//i.test(String(value.sourceUrl || "")) ? String(value.sourceUrl).slice(0, 500) : "",
    checkedAt: String(value.checkedAt || "").slice(0, 40),
    validFrom: validDateKey(String(value.validFrom || "")) ? String(value.validFrom) : "",
    validUntil: validDateKey(String(value.validUntil || "")) ? String(value.validUntil) : ""
  };
  for (const key of ["_verifiedOfficial", "_manual", "_municipalRegistered"]) {
    if (value[key] !== undefined) safe[key] = value[key] === true;
  }
  return safe;
}

function cleanUserSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const safe = {};
  const boolKeys = ["notifyEnabled", "garbageReminder", "eventReminderEnabled"];
  for (const key of boolKeys) if (input[key] !== undefined) safe[key] = input[key] !== false;
  const timeList = value => Array.isArray(value)
    ? [...new Set(value.map(String).filter(time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)))].slice(0, 8).sort()
    : [];
  if (input.todayNotifyTimes !== undefined) safe.todayNotifyTimes = timeList(input.todayNotifyTimes);
  if (input.previousNotifyTimes !== undefined) safe.previousNotifyTimes = timeList(input.previousNotifyTimes);
  if (input.pauseUntil !== undefined) {
    const value = String(input.pauseUntil || "");
    safe.pauseUntil = value === "" || validDateKey(value) ? value : "";
  }
  if (input.garbageReminderTime !== undefined) {
    const value = String(input.garbageReminderTime || "");
    safe.garbageReminderTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "20:00";
  }
  if (input.pref !== undefined) safe.pref = String(input.pref || "").trim().slice(0, 10);
  if (input.region !== undefined) safe.region = String(input.region || "").trim().slice(0, 30);
  if (input.area !== undefined) safe.area = String(input.area || "").trim().slice(0, 50);
  if (input.locationMode !== undefined) safe.locationMode = input.locationMode === "gps" ? "gps" : "address";
  for (const [key, min, max] of [["gpsLat", -90, 90], ["gpsLon", -180, 180]]) {
    if (input[key] === undefined || input[key] === "" || input[key] == null) continue;
    const value = Number(input[key]);
    if (Number.isFinite(value) && value >= min && value <= max) safe[key] = value;
  }
  if (input.garbageSchedule !== undefined) safe.garbageSchedule = cleanGarbageSchedule(input.garbageSchedule);
  return safe;
}

function cleanEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("予定の形式が正しくありません");
  }
  const title = String(event.title || "").trim();
  if (!title || title.length > 120) throw new Error("予定名を1〜120文字で入力してください");
  const time = event.time == null ? "" : String(event.time);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("時刻の形式が正しくありません");
  }
  const safe = JSON.parse(JSON.stringify(event));
  safe.title = title;
  safe.time = time;
  safe.repeat = ["none", "daily", "weekly", "monthly"].includes(safe.repeat) ? safe.repeat : "none";
  safe.items = Array.isArray(safe.items) ? safe.items.slice(0, 30).map(item => ({
    text: String(typeof item === "string" ? item : item?.text || "").trim().slice(0, 100),
    done: typeof item === "object" && item?.done === true
  })).filter(item => item.text) : [];
  for (const key of Object.keys(safe)) if (key.startsWith("_")) delete safe[key];
  return safe;
}

function cleanEventList(value) {
  if (!Array.isArray(value) || value.length > 200) {
    throw new Error("1日に保存できる予定は200件までです");
  }
  return value.map(cleanEvent);
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getBearerToken(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

const verifiedLineTokens = new Map();

async function verifyLineIdToken(idToken) {
  if (!process.env.LINE_LOGIN_CHANNEL_ID) {
    throw new Error("LINE_LOGIN_CHANNEL_ID が設定されていません");
  }
  const cacheKey = crypto.createHash("sha256").update(idToken).digest("hex");
  const cached = verifiedLineTokens.get(cacheKey);
  if (cached?.validUntil > Date.now()) return cached.payload;

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
  const tokenExpiresAt = Number(payload.exp || 0) * 1000;
  const validUntil = Math.min(tokenExpiresAt || Date.now() + 300_000, Date.now() + 300_000);
  verifiedLineTokens.set(cacheKey, { payload, validUntil });
  if (verifiedLineTokens.size > 500) {
    for (const [key, value] of verifiedLineTokens) {
      if (value.validUntil <= Date.now() || verifiedLineTokens.size > 400) verifiedLineTokens.delete(key);
    }
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
    const testGatePath = req.path === "/api/test/access" || req.path === "/api/test/join";
    if (process.env.TEST_MODE === "true" && !store.users[req.userId].testAccess && !testGatePath) {
      return res.status(403).json({ error: "このテスト版は招待された人だけ利用できます", code: "TEST_ACCESS_REQUIRED" });
    }
    next();
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
}

// 予定一覧取得
app.get("/api/events-range", requireUserAuth, (req, res) => {
  const start = String(req.query.start || "");
  const end = String(req.query.end || "");
  if (!validDateKey(start) || !validDateKey(end)) {
    return res.status(400).json({ error: "期間が正しくありません" });
  }
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const days = Math.floor((endDate - startDate) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 62) {
    return res.status(400).json({ error: "取得期間は62日以内にしてください" });
  }
  const all = store.events[req.userId] || {};
  const result = {};
  for (const [dateKey, list] of Object.entries(all)) {
    if (dateKey >= start && dateKey <= end) result[dateKey] = list;
  }
  res.json(result);
});

// ── 公開前テスト・改善報告・グループ共有 ──────────────────
app.get("/api/test/access", requireUserAuth, (req, res) => {
  res.json({ required: process.env.TEST_MODE === "true", allowed: process.env.TEST_MODE !== "true" || store.users[req.userId].testAccess === true });
});

app.post("/api/test/join", inviteRateLimit, requireUserAuth, async (req, res) => {
  const expected = String(process.env.TEST_INVITE_CODE || "").trim();
  const actual = String(req.body?.inviteCode || "").trim();
  if (!expected || actual !== expected) return res.status(400).json({ error: "招待コードが正しくありません" });
  store.users[req.userId].testAccess = true;
  await saveData(store);
  res.json({ ok: true });
});

function safeFeedback(item, userId) {
  return {
    id: item.id, type: item.type, message: item.message, createdAt: item.createdAt,
    hasScreenshot: !!item.screenshot, votes: item.votes?.length || 0,
    voted: item.votes?.includes(userId) || false
  };
}

app.get("/api/feedback", requireUserAuth, (req, res) => {
  res.json((store.feedback || []).slice(-40).reverse().map(item => safeFeedback(item, req.userId)));
});

app.post("/api/feedback", requireUserAuth, async (req, res) => {
  const type = ["bug", "idea"].includes(req.body?.type) ? req.body.type : "idea";
  const message = String(req.body?.message || "").trim();
  const screenshot = String(req.body?.screenshot || "");
  if (!message || message.length > 500) return res.status(400).json({ error: "内容を1〜500文字で入力してください" });
  if (screenshot && (!/^data:image\/(png|jpeg|webp);base64,/i.test(screenshot) || screenshot.length > 700000)) {
    return res.status(400).json({ error: "画像は500KB程度までにしてください" });
  }
  const item = { id: crypto.randomUUID(), type, message, screenshot, createdAt: new Date().toISOString(), authorId: req.userId, votes: [] };
  store.feedback ||= [];
  store.feedback.push(item);
  if (store.feedback.length > 300) store.feedback = store.feedback.slice(-300);
  await saveData(store);
  res.json(safeFeedback(item, req.userId));
});

app.post("/api/feedback/:id/vote", requireUserAuth, async (req, res) => {
  const item = (store.feedback || []).find(entry => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: "報告が見つかりません" });
  item.votes ||= [];
  const index = item.votes.indexOf(req.userId);
  if (index >= 0) item.votes.splice(index, 1); else item.votes.push(req.userId);
  await saveData(store);
  res.json(safeFeedback(item, req.userId));
});

function groupForUser(groupId, userId) {
  const group = (store.groups || {})[groupId];
  return group?.members?.includes(userId) ? group : null;
}

function publicGroup(group, userId) {
  return { id: group.id, name: group.name, memberCount: group.members.length,
    inviteCode: group.ownerId === userId ? group.inviteCode : "", isOwner: group.ownerId === userId };
}

app.get("/api/groups", requireUserAuth, (req, res) => {
  res.json(Object.values(store.groups || {}).filter(group => group.members?.includes(req.userId)).map(group => publicGroup(group, req.userId)));
});

app.post("/api/groups", requireUserAuth, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 40) return res.status(400).json({ error: "グループ名を1〜40文字で入力してください" });
  const id = crypto.randomUUID();
  const group = { id, name, inviteCode: crypto.randomBytes(4).toString("hex").toUpperCase(), ownerId: req.userId, members: [req.userId], events: {}, createdAt: new Date().toISOString() };
  store.groups ||= {};
  store.groups[id] = group;
  await saveData(store);
  res.json(publicGroup(group, req.userId));
});

app.post("/api/groups/join", inviteRateLimit, requireUserAuth, async (req, res) => {
  const code = String(req.body?.inviteCode || "").trim().toUpperCase();
  const group = Object.values(store.groups || {}).find(entry => entry.inviteCode === code);
  if (!group) return res.status(404).json({ error: "招待コードが見つかりません" });
  if (!group.members.includes(req.userId)) group.members.push(req.userId);
  await saveData(store);
  res.json(publicGroup(group, req.userId));
});

app.get("/api/group-events-range", requireUserAuth, (req, res) => {
  const start = String(req.query.start || ""), end = String(req.query.end || "");
  if (!validDateKey(start) || !validDateKey(end)) return res.status(400).json({ error: "期間が正しくありません" });
  const startDate = new Date(`${start}T00:00:00Z`), endDate = new Date(`${end}T00:00:00Z`);
  const days = Math.floor((endDate - startDate) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 62) {
    return res.status(400).json({ error: "取得期間は62日以内にしてください" });
  }
  const result = {};
  for (const group of Object.values(store.groups || {})) {
    if (!group.members?.includes(req.userId)) continue;
    for (const [dateKey, events] of Object.entries(group.events || {})) {
      if (dateKey < start || dateKey > end) continue;
      result[dateKey] ||= [];
      result[dateKey].push(...events.map(event => ({ ...event, _shared: true, _groupId: group.id, _groupName: group.name, _canDelete: event.createdBy === req.userId || group.ownerId === req.userId })));
    }
  }
  res.json(result);
});

app.delete("/api/groups/:groupId/membership", requireUserAuth, async (req, res) => {
  const group = groupForUser(req.params.groupId, req.userId);
  if (!group) return res.status(404).json({ error: "グループが見つかりません" });
  if (group.ownerId === req.userId) {
    return res.status(400).json({ error: "管理者は退出できません。グループを削除してください" });
  }
  group.members = group.members.filter(userId => userId !== req.userId);
  await saveData(store);
  res.json({ ok: true });
});

app.delete("/api/groups/:groupId", requireUserAuth, async (req, res) => {
  const group = groupForUser(req.params.groupId, req.userId);
  if (!group) return res.status(404).json({ error: "グループが見つかりません" });
  if (group.ownerId !== req.userId) return res.status(403).json({ error: "管理者だけが削除できます" });
  delete store.groups[req.params.groupId];
  await saveData(store);
  res.json({ ok: true });
});

app.post("/api/groups/:groupId/events/:dateKey", requireUserAuth, async (req, res) => {
  const group = groupForUser(req.params.groupId, req.userId);
  if (!group) return res.status(404).json({ error: "グループが見つかりません" });
  if (!validDateKey(req.params.dateKey)) return res.status(400).json({ error: "日付が正しくありません" });
  try {
    const event = cleanEvent(req.body);
    event.id = crypto.randomUUID(); event.createdBy = req.userId;
    group.events ||= {}; group.events[req.params.dateKey] ||= [];
    if (group.events[req.params.dateKey].length >= 200) {
      return res.status(400).json({ error: "1日に保存できる共有予定は200件までです" });
    }
    group.events[req.params.dateKey].push(event);
    await saveData(store);
    res.json({ ok: true, id: event.id });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.delete("/api/groups/:groupId/events/:dateKey/:eventId", requireUserAuth, async (req, res) => {
  const group = groupForUser(req.params.groupId, req.userId);
  if (!group) return res.status(404).json({ error: "グループが見つかりません" });
  const list = group.events?.[req.params.dateKey] || [];
  const event = list.find(entry => entry.id === req.params.eventId);
  if (!event) return res.status(404).json({ error: "予定が見つかりません" });
  if (event.createdBy !== req.userId && group.ownerId !== req.userId) return res.status(403).json({ error: "この予定は削除できません" });
  group.events[req.params.dateKey] = list.filter(entry => entry.id !== req.params.eventId);
  await saveData(store);
  res.json({ ok: true });
});

app.get("/api/events/:dateKey", requireUserAuth, (req, res) => {
  const { dateKey } = req.params;
  if (!validDateKey(dateKey)) return res.status(400).json({ error: "日付が正しくありません" });
  const list = store.events[req.userId][dateKey] || [];
  res.json(list);
});

// その日全体を置き換える。オフライン再同期は変更した日だけを送る。
app.put("/api/events/:dateKey", requireUserAuth, async (req, res) => {
  try {
    const { dateKey } = req.params;
    if (!validDateKey(dateKey)) return res.status(400).json({ error: "日付が正しくありません" });
    store.events[req.userId][dateKey] = cleanEventList(req.body?.events);
    await saveData(store);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || "予定を保存できませんでした" });
  }
});

// 予定追加
app.post("/api/events/:dateKey", requireUserAuth, async (req, res) => {
  const { dateKey } = req.params;
  try {
    if (!validDateKey(dateKey)) return res.status(400).json({ error: "日付が正しくありません" });
    const event = cleanEvent(req.body);
    if (!store.events[req.userId][dateKey]) store.events[req.userId][dateKey] = [];
    if (store.events[req.userId][dateKey].length >= 200) {
      return res.status(400).json({ error: "1日に保存できる予定は200件までです" });
    }
    store.events[req.userId][dateKey].push(event);
    await saveData(store);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || "予定を保存できませんでした" });
  }
});

// 予定更新
app.put("/api/events/:dateKey/:idx", requireUserAuth, async (req, res) => {
  const { dateKey, idx } = req.params;
  const list = store.events[req.userId][dateKey] || [];
  const i = parseInt(idx, 10);
  if (!Number.isInteger(i) || i < 0 || i >= list.length) {
    res.status(404).json({ error: "見つかりません" });
    return;
  }
  try { list[i] = cleanEvent(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  store.events[req.userId][dateKey] = list;
  try {
    await saveData(store);
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ error: "データベースへ保存できませんでした" });
  }
});

// 予定削除
app.delete("/api/events/:dateKey/:idx", requireUserAuth, async (req, res) => {
  const { dateKey, idx } = req.params;
  const list = store.events[req.userId][dateKey] || [];
  const i = parseInt(idx, 10);
  if (!Number.isInteger(i) || i < 0 || i >= list.length) {
    return res.status(404).json({ error: "見つかりません" });
  }
  list.splice(i, 1);
  store.events[req.userId][dateKey] = list;
  try {
    await saveData(store);
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ error: "データベースへ保存できませんでした" });
  }
});

// 全予定一括保存（IndexedDB同期用）
app.post("/api/events-bulk", requireUserAuth, async (req, res) => {
  const { events } = req.body;
  if (!events || typeof events !== "object") {
    res.status(400).json({ error: "eventsが必要です" });
    return;
  }
  try { store.events[req.userId] = sanitizeBackupEvents(events); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    await saveData(store);
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ error: "データベースへ保存できませんでした" });
  }
});

// ユーザー設定保存（位置情報・地域など）
app.get("/api/user-settings", requireUserAuth, (req, res) => {
  res.json(publicUserSettings(store.users[req.userId]));
});

app.post("/api/user-settings", requireUserAuth, async (req, res) => {
  try {
    Object.assign(store.users[req.userId], cleanUserSettings(req.body));
    await saveData(store);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || "設定を保存できませんでした" });
  }
});

// ── ユーザー本人のバックアップ・復元 ─────────────────────
const BACKUP_SETTING_KEYS = [
  "notifyEnabled", "todayNotifyTimes", "previousNotifyTimes", "pauseUntil",
  "garbageReminder", "garbageReminderTime", "eventReminderEnabled", "pref", "region", "area",
  "locationMode", "gpsLat", "gpsLon", "garbageSchedule"
];

function backupSettings(user = {}) {
  return Object.fromEntries(BACKUP_SETTING_KEYS
    .filter(key => user[key] !== undefined)
    .map(key => [key, user[key]]));
}

function sanitizeBackupEvents(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("予定データの形式が正しくありません");
  }
  const result = Object.create(null);
  const entries = Object.entries(value);
  if (entries.length > 1500) throw new Error("予定の日付数が多すぎます");
  for (const [dateKey, list] of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Array.isArray(list) || list.length > 200) {
      throw new Error("予定データの内容が正しくありません");
    }
    result[dateKey] = cleanEventList(list);
  }
  return result;
}

app.get("/api/backup", requireUserAuth, (req, res) => {
  res.json({
    app: "Ready2Go",
    version: 1,
    exportedAt: new Date().toISOString(),
    events: store.events[req.userId] || {},
    settings: backupSettings(store.users[req.userId]),
  });
});

app.post("/api/restore", requireUserAuth, async (req, res) => {
  try {
    const backup = req.body;
    if (!backup || backup.app !== "Ready2Go" || Number(backup.version) !== 1) {
      return res.status(400).json({ error: "Ready2Goのバックアップファイルではありません" });
    }
    const restoredEvents = sanitizeBackupEvents(backup.events);
    const restoredSettings = cleanUserSettings(backup.settings);

    store.events[req.userId] = restoredEvents;
    Object.assign(store.users[req.userId], restoredSettings);
    await saveData(store);
    res.json({ ok: true, restoredDates: Object.keys(restoredEvents).length });
  } catch (error) {
    res.status(400).json({ error: error.message || "復元できませんでした" });
  }
});

app.get("/api/account", requireUserAuth, (req, res) => {
  const eventDays = Object.keys(store.events[req.userId] || {}).length;
  const groups = Object.values(store.groups || {}).filter(group => group.members?.includes(req.userId)).length;
  res.json({ registeredAt: store.users[req.userId]?.registeredAt || "", eventDays, groups });
});

app.delete("/api/account", requireUserAuth, async (req, res) => {
  if (req.body?.confirm !== "DELETE") return res.status(400).json({ error: "削除確認が一致しません" });
  delete store.users[req.userId];
  delete store.events[req.userId];
  delete store.notificationLogs?.[req.userId];
  store.feedback = (store.feedback || []).filter(item => item.authorId !== req.userId);
  for (const [groupId, group] of Object.entries(store.groups || {})) {
    if (group.ownerId === req.userId) delete store.groups[groupId];
    else group.members = (group.members || []).filter(userId => userId !== req.userId);
  }
  await saveData(store);
  res.json({ ok: true });
});

function garbageScheduleKey(pref, region, area = "") {
  return [pref, region, area].map(value => String(value || "").trim()).join("::");
}

function cachedGarbageSchedule(pref, region, area) {
  const schedules = store.garbageSchedules || (store.garbageSchedules = {});
  // 町名まで一致するものを優先し、自治体全域データにもフォールバックする。
  return schedules[garbageScheduleKey(pref, region, area)]
    || schedules[garbageScheduleKey(pref, region, "")]
    || null;
}

// 住所選択時の自動検索用。共有DBに確認済み情報があればAIを使わず返す。
app.get("/api/garbage-schedule", requireUserAuth, (req, res) => {
  const pref = String(req.query.pref || "").trim();
  const region = String(req.query.region || "").trim();
  const area = String(req.query.area || "").trim();
  if (!pref || !region || pref.length > 10 || region.length > 30 || area.length > 50) {
    return res.status(400).json({ error: "地域を正しく選択してください" });
  }
  const schedule = cachedGarbageSchedule(pref, region, area);
  if (!schedule) return res.status(404).json({ error: "この地域はまだ自動登録されていません" });
  res.json({ ...schedule, _fromSharedDatabase: true });
});

// 自治体の公式情報だけを候補として返す。APIキーはブラウザへ渡さない。
app.post("/api/garbage-schedule", requireUserAuth, async (req, res) => {
  const pref = String(req.body?.pref || "").trim();
  const region = String(req.body?.region || "").trim();
  const area = String(req.body?.area || "").trim();
  const forceRefresh = req.body?.forceRefresh === true;
  if (!pref || !region || pref.length > 10 || region.length > 30 || area.length > 50) {
    return res.status(400).json({ error: "地域を正しく選択してください" });
  }
  const alreadyRegistered = forceRefresh ? null : cachedGarbageSchedule(pref, region, area);
  if (alreadyRegistered) {
    store.users[req.userId].garbageSchedule = alreadyRegistered;
    store.users[req.userId].pref = pref;
    store.users[req.userId].region = region;
    store.users[req.userId].area = area;
    await saveData(store);
    return res.json({ ...alreadyRegistered, _fromSharedDatabase: true });
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
    schedule.pref = pref;
    schedule.region = region;
    schedule.area = area;
    store.garbageSchedules ||= {};
    store.garbageSchedules[garbageScheduleKey(pref, region, area)] = schedule;
    store.users[req.userId].garbageSchedule = schedule;
    store.users[req.userId].pref = pref;
    store.users[req.userId].region = region;
    store.users[req.userId].area = area;
    await saveData(store);
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
  const type = String(key).split(":")[0] || "notification";
  try {
    await lineClient.pushMessage({ to: userId, messages: [{ type: "text", text }] });
    user.sentNotifications[key] = new Date().toISOString();
    const cutoff = Date.now() - 14 * 86400000;
    for (const [k,v] of Object.entries(user.sentNotifications)) {
      if (new Date(v).getTime() < cutoff) delete user.sentNotifications[k];
    }
    recordNotification(userId, { type, status: "sent", text });
    await saveData(store);
  } catch (error) {
    recordNotification(userId, { type, status: "failed", text, error: error.message });
    await saveData(store).catch(() => {});
    throw error;
  }
}

function recordNotification(userId, entry) {
  store.notificationLogs ||= {};
  store.notificationLogs[userId] ||= [];
  store.notificationLogs[userId].push({
    id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    type: entry.type || "notification", status: entry.status || "sent",
    text: String(entry.text || "").slice(0, 1500), error: String(entry.error || "").slice(0, 300)
  });
  store.notificationLogs[userId] = store.notificationLogs[userId].slice(-100);
}

async function sendScheduledNotifications() {
  const now = timeInJapan();
  const userIds = Object.keys(store.users);
  for (const userId of userIds) {
    const user = store.users[userId];
    if (process.env.TEST_MODE === "true" && user.testAccess !== true) continue;
    if (isPaused(user, now.dateKey)) continue;
    try {
      await retryFailedNotification(userId);
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
      const reminderTime = user.eventReminderEnabled === false ? "" : addMinutesToTime(now.time, 30);
      const personalUpcoming = reminderTime
        ? (store.events[userId]?.[now.dateKey] || []).filter(event => event.time === reminderTime) : [];
      const groupUpcoming = Object.values(store.groups || {})
        .filter(group => group.members?.includes(userId))
        .flatMap(group => reminderTime ? (group.events?.[now.dateKey] || []).filter(event => event.time === reminderTime)
          .map(event => ({ ...event, sharedGroupName: group.name, reminderGroupId: group.id })) : []);
      const upcoming = [...personalUpcoming, ...groupUpcoming];
      for (const event of upcoming) {
        await pushOnce(userId, `event:${now.dateKey}:${event.time}:${event.title}:${event.reminderGroupId || "personal"}`, await buildEventReminder(userId, event));
      }
    } catch(e) {
      console.error(`通知送信失敗: ${userId}`, e.message);
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

function addMinutesToTime(time, minutes) {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  if (total >= 1440) return "";
  return `${String(Math.floor(total / 60)).padStart(2,"0")}:${String(total % 60).padStart(2,"0")}`;
}

async function buildEventReminder(userId, event) {
  const user = store.users[userId] || {};
  let weather = "";
  try {
    const lat = user.gpsLat || 35.69, lon = user.gpsLon || 139.69;
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,precipitation&timezone=Asia%2FTokyo`);
    const data = await response.json();
    const code = Number(data.current?.weather_code || 0), temperature = Math.round(data.current?.temperature_2m || 0);
    weather = `\n${wmoEmoji(code)} 現在は${wmoText(code)}・${temperature}℃${code >= 51 ? "。傘や雨具も確認しましょう" : ""}`;
  } catch (_) {}
  const items = (event.items || []).filter(item => !(typeof item === "object" && item.done)).map(item => typeof item === "string" ? item : item.text).filter(Boolean);
  return `⏰ 30分後の予定\n${event.time} ${event.title}${event.sharedGroupName ? `（👥${event.sharedGroupName}）` : ""}${weather}${items.length ? `\n🎒 ${items.join("・")}` : ""}`;
}

async function retryFailedNotification(userId) {
  const logs = store.notificationLogs?.[userId] || [];
  const failed = [...logs].reverse().find(log => log.status === "failed" && (log.retryCount || 0) < 2
    && Date.now() - new Date(log.createdAt).getTime() >= 2 * 60000
    && Date.now() - new Date(log.createdAt).getTime() < 24 * 3600000);
  if (!failed) return;
  failed.retryCount = (failed.retryCount || 0) + 1;
  try {
    await lineClient.pushMessage({ to: userId, messages: [{ type: "text", text: failed.text }] });
    failed.status = "retried";
    recordNotification(userId, { type:`auto-retry-${failed.type}`, status:"sent", text:failed.text });
  } catch (error) {
    failed.error = error.message;
  }
  await saveData(store);
}

async function buildDailyMessage(userId, dayOffset = 0) {
  const target = new Date(); target.setDate(target.getDate() + dayOffset);
  const targetKey = getDateKey(target);
  const personalEvents = (store.events[userId] || {})[targetKey] || [];
  const sharedEvents = Object.values(store.groups || {})
    .filter(group => group.members?.includes(userId))
    .flatMap(group => (group.events?.[targetKey] || []).map(event => ({ ...event, sharedGroupName: group.name })));
  const events = [...personalEvents, ...sharedEvents];
  const user    = store.users[userId] || {};

  // 天気取得
  let weatherText = "", weatherAdvice = "";
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
      const advice = [];
      if (code >= 51) advice.push("傘を忘れずに");
      if (max >= 30) advice.push("暑さに気をつけて、水分を用意");
      if (min <= 5) advice.push("冷え込みに備えて上着を確認");
      weatherAdvice = advice.length ? `\n💡 ${advice.join("・")}` : "";
    }
  } catch(e) { weatherText = "（天気の取得に失敗しました）"; }

  // 日付
  const wday  = ["日","月","火","水","木","金","土"][target.getDay()];
  const dateStr = `${target.getMonth()+1}月${target.getDate()}日（${wday}）`;

  // 予定
  let eventsText = "";
  if (events.length === 0) {
    eventsText = `📅 ${dayOffset ? "明日" : "今日"}の予定はありません`;
  } else {
    const sorted = [...events].sort((a,b) => a.time.localeCompare(b.time));
    eventsText = `📅 ${dayOffset ? "明日" : "今日"}の予定:\n` + sorted.map(ev => {
      const items = Array.isArray(ev.items) ? ev.items.filter(item => !item.done).map(item => item.text).filter(Boolean) : [];
      return `  ${ev.time} ${ev.title}${ev.sharedGroupName ? `（👥${ev.sharedGroupName}）` : ""}${items.length ? `\n    🎒 ${items.join("・")}` : ""}`;
    }).join("\n");
  }

  return `━━━━━━━━━━━━━━━
📘 Ready2Go ${dayOffset ? "明日の" : "今日の"}お知らせ
${dateStr}
━━━━━━━━━━━━━━━

${weatherText}${weatherAdvice}

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
  const dateKey = timeInJapan(date).dateKey;
  const dow = date.getDay(), week = Math.ceil(date.getDate() / 7);
  return schedule.garbageTypes.filter(g => (g.dates || []).includes(dateKey)
    || (g.days || []).some(r => r.dow === dow && (r.week == null || r.week === week)));
}

function buildGarbageReminder(user) {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const types = garbageForDate(user.garbageSchedule, tomorrow);
  if (!types.length) return "";
  const warning = user.garbageSchedule.note ? `\n⚠️ ${user.garbageSchedule.note}\n祝日などは自治体公式ページで再確認してください。` : "\n⚠️ 祝日は収集変更の可能性があります。自治体公式ページで確認してください。";
  return `🗑️ 明日は${types.map(x => `${x.icon || ""}${x.name}`).join("・")}の日です。${warning}\n${user.garbageSchedule.sourceUrl || ""}`;
}

app.post("/api/test-notification", requireUserAuth, async (req, res) => {
  const text = "✅ Ready2Goのテスト通知です。LINE連携は正常です。";
  try {
    await lineClient.pushMessage({ to: req.userId, messages: [{ type: "text", text }] });
    recordNotification(req.userId, { type: "test", status: "sent", text });
    await saveData(store);
    res.json({ ok: true });
  } catch(e) {
    recordNotification(req.userId, { type: "test", status: "failed", text, error: e.message });
    await saveData(store).catch(() => {});
    res.status(502).json({ error: "LINEテスト通知を送れませんでした" });
  }
});

app.get("/api/notification-logs", requireUserAuth, (req, res) => {
  res.json((store.notificationLogs?.[req.userId] || []).slice().reverse());
});

app.post("/api/notification-logs/:id/resend", requireUserAuth, async (req, res) => {
  const original = (store.notificationLogs?.[req.userId] || []).find(entry => entry.id === req.params.id);
  if (!original) return res.status(404).json({ error: "通知履歴が見つかりません" });
  try {
    await lineClient.pushMessage({ to: req.userId, messages: [{ type: "text", text: original.text }] });
    recordNotification(req.userId, { type: `resend-${original.type}`, status: "sent", text: original.text });
    await saveData(store);
    res.json({ ok: true });
  } catch (error) {
    recordNotification(req.userId, { type: `resend-${original.type}`, status: "failed", text: original.text, error: error.message });
    await saveData(store).catch(() => {});
    res.status(502).json({ error: "通知を再送できませんでした" });
  }
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
app.post("/liff-init", requireUserAuth, async (req, res) => {
  await saveData(store);
  res.json({ ok: true, userId: req.userId });
});

// ── ヘルスチェック ────────────────────────────────────────
app.get("/health", (_, res) => {
  const missingEnvironment = REQUIRED_PRODUCTION_ENV.filter(key => !process.env[key]);
  if (process.env.TEST_MODE === "true" && !process.env.TEST_INVITE_CODE) {
    missingEnvironment.push("TEST_INVITE_CODE");
  }
  res.json({
    ok: true,
    ready: missingEnvironment.length === 0,
    version: APP_VERSION,
    storage: getStorageMode(),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    missingEnvironment,
    scheduler: process.env.DISABLE_SCHEDULER === "true" ? "disabled" : "enabled",
    startedAt: SERVER_STARTED_AT,
    checkedAt: new Date().toISOString(),
  });
});

app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "送信データが大きすぎます" });
  }
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "JSONの形式が正しくありません" });
  }
  next(error);
});

// ── サーバー起動 ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const SERVER_STARTED_AT = new Date().toISOString();
let schedulerTask = null;

async function startServer(options = {}) {
  store = await loadData();
  if (!schedulerTask && process.env.DISABLE_SCHEDULER !== "true" && options.scheduler !== false) {
    schedulerTask = cron.schedule("* * * * *", sendScheduledNotifications, { timezone: "Asia/Tokyo" });
  }
  const port = options.port ?? PORT;
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Ready2Go サーバー起動 — port ${server.address().port}`);
      if (schedulerTask) console.log("ユーザー別通知スケジューラー起動 (Asia/Tokyo)");
      resolve(server);
    });
    server.once("error", reject);
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error("サーバー起動エラー:", error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  timeInJapan,
  cleanEvent,
  cleanEventList,
  cleanUserSettings,
  garbageForDate,
  parseLineEvent,
};
