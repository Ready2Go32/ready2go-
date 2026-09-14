const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ready2go-test-"));
process.env.DATA_DIR = tempDirectory;
process.env.DISABLE_SCHEDULER = "true";

const {
  startServer, timeInJapan, cleanEvent, cleanUserSettings, garbageForDate, parseLineEvent
} = require("../server");
const MunicipalGarbageData = require("../municipal-garbage-data");

test.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));

test("LINE文章から単発予定を読み取る", () => {
  const event = parseLineEvent("9月10日 18時30分 歯医者");
  assert.equal(event.time, "18:30");
  assert.equal(event.title, "歯医者");
  assert.match(event.dateKey, /^\d{4}-09-10$/);
});

test("予定入力を検査し内部フィールドを除く", () => {
  const event = cleanEvent({ title: "  部活  ", time: "16:00", _shared: true, items: ["水筒"] });
  assert.equal(event.title, "部活");
  assert.equal(event._shared, undefined);
  assert.deepEqual(event.items, [{ text: "水筒", done: false }]);
  assert.throws(() => cleanEvent({ title: "", time: "99:00" }));
});

test("ユーザー設定を許可範囲へ整形する", () => {
  const settings = cleanUserSettings({
    notifyEnabled: false,
    todayNotifyTimes: ["07:00", "07:00", "99:00"],
    gpsLat: "35.6",
    gpsLon: "999",
    pref: "東京都xxxxxxxxxxxxxxxx",
    unknown: "保存しない"
  });
  assert.equal(settings.notifyEnabled, false);
  assert.deepEqual(settings.todayNotifyTimes, ["07:00"]);
  assert.equal(settings.gpsLat, 35.6);
  assert.equal(settings.gpsLon, undefined);
  assert.equal(settings.pref.length, 10);
  assert.equal(settings.unknown, undefined);
});

test("町田市地区1を表記ゆれ込みで取得できる", () => {
  const schedule = MunicipalGarbageData.find("東京都", "町田市", "忠生一丁目");
  assert.equal(schedule.validUntil, "2027-09-30");
  const nonBurnable = schedule.garbageTypes.find(item => item.name === "燃やせないごみ");
  assert.ok(nonBurnable.dates.includes("2027-09-29"));
  const burnable = schedule.garbageTypes.find(item => item.name === "燃やせるごみ");
  assert.ok(!burnable.dates.includes("2026-12-31"));
  assert.equal(MunicipalGarbageData.find("東京都", "町田市", "金森2丁目").validFrom, "2026-10-01");
});

test("実日付のごみ収集を判定できる", () => {
  const schedule = MunicipalGarbageData.find("東京都", "町田市", "忠生1丁目");
  const types = garbageForDate(schedule, new Date("2027-09-29T12:00:00+09:00")).map(item => item.name);
  assert.ok(types.includes("燃やせないごみ"));
  assert.ok(!types.includes("ペットボトル"));
});

test("日本時間の日付と時刻を返す", () => {
  assert.deepEqual(timeInJapan(new Date("2026-09-07T15:05:00Z")), { dateKey: "2026-09-08", time: "00:05" });
});

test("サーバーが起動しヘルスチェックへ応答する", async () => {
  const server = await startServer({ port: 0, scheduler: false });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.ok, true);
    assert.equal(health.version, "1.1.0");
    assert.equal(health.ready, false);
    assert.equal((await fetch(`${baseUrl}/index.html`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/server.js`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/data.json`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
