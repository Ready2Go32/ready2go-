// database.js — PostgreSQL優先・ファイル互換の保存層
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "data.json");
const EMPTY_STORE = { users: {}, events: {} };

let pool = null;
let storageMode = "file";
let saveQueue = Promise.resolve();

function normalizeStore(value) {
  const data = value && typeof value === "object" ? value : {};
  return {
    users: data.users && typeof data.users === "object" ? data.users : {},
    events: data.events && typeof data.events === "object" ? data.events : {},
  };
}

function loadFile() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return normalizeStore(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
    }
  } catch (error) {
    console.error("ファイルデータ読み込みエラー:", error.message);
  }
  return normalizeStore(EMPTY_STORE);
}

function databaseSsl() {
  if (process.env.DATABASE_SSL === "false") return false;
  if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "")) return false;
  return { rejectUnauthorized: false };
}

async function loadData() {
  if (!process.env.DATABASE_URL) {
    storageMode = "file";
    console.log(`保存先: ファイル (${DATA_FILE})`);
    return loadFile();
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: databaseSsl(),
    max: Number(process.env.DATABASE_POOL_SIZE || 5),
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ready2go_state (
      state_key TEXT PRIMARY KEY,
      state_data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pool.query(
    "SELECT state_data FROM ready2go_state WHERE state_key = $1",
    ["main"]
  );

  if (result.rows.length) {
    storageMode = "postgresql";
    console.log("保存先: PostgreSQL");
    return normalizeStore(result.rows[0].state_data);
  }

  // 初回接続時は従来のdata.jsonがあれば自動移行する。
  const initial = loadFile();
  await pool.query(
    `INSERT INTO ready2go_state (state_key, state_data)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (state_key) DO NOTHING`,
    ["main", JSON.stringify(initial)]
  );
  storageMode = "postgresql";
  console.log("保存先: PostgreSQL（初期データを登録）");
  return initial;
}

function saveFile(snapshot) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(snapshot, null, 2), "utf8");
  fs.renameSync(temporaryFile, DATA_FILE);
}

function saveData(data) {
  const snapshot = normalizeStore(JSON.parse(JSON.stringify(data)));

  if (!pool) {
    try {
      saveFile(snapshot);
    } catch (error) {
      console.error("ファイルデータ保存エラー:", error.message);
    }
    return Promise.resolve();
  }

  // 複数の保存が同時に来ても、登録順に書き込む。
  saveQueue = saveQueue
    .then(() => pool.query(
      `INSERT INTO ready2go_state (state_key, state_data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (state_key)
       DO UPDATE SET state_data = EXCLUDED.state_data, updated_at = NOW()`,
      ["main", JSON.stringify(snapshot)]
    ))
    .catch(error => {
      console.error("PostgreSQL保存エラー:", error.message);
    });

  return saveQueue;
}

function getStorageMode() {
  return storageMode;
}

module.exports = { loadData, saveData, getStorageMode };

