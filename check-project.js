const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const required = [
  "server.js", "database.js", "package.json", "package-lock.json", "render.yaml", ".env.example", ".gitignore", "START-HERE.md",
  "index.html", "style.css", "storage.js", "weather.js", "garbage.js", "garbage-calendar.html",
  "municipal-garbage-data.js", "settings.js", "calendar.js", "dashboard.js", "features.js", "script.js",
  "manifest.json", "service-worker.js", "privacy.html", "terms.html", "DEPLOY-RENDER-LINE.md"
];

const fail = message => { throw new Error(message); };
const read = file => fs.readFileSync(path.join(root, file), "utf8");

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) fail(`必須ファイルがありません: ${file}`);
}

JSON.parse(read("package.json"));
JSON.parse(read("manifest.json"));

for (const file of ["storage.js", "weather.js", "garbage.js", "municipal-garbage-data.js", "settings.js", "calendar.js", "dashboard.js", "features.js", "script.js", "service-worker.js"]) {
  new vm.Script(read(file), { filename: file });
}

for (const htmlFile of ["index.html", "garbage-calendar.html", "liff-init.html", "privacy.html", "terms.html"]) {
  const html = read(htmlFile);
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) fail(`${htmlFile} に重複IDがあります: ${duplicate}`);
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new vm.Script(match[1], { filename: `${htmlFile}:inline-script` });
  }
  for (const match of html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const source = match[1];
    if (/^https?:/.test(source)) continue;
    if (source.split("?")[0] === "app-config.js") continue;
    if (!fs.existsSync(path.join(root, source.split("?")[0]))) fail(`${htmlFile} が存在しないスクリプトを参照しています: ${source}`);
  }
}

const secretPatterns = [
  /LINE_CHANNEL_ACCESS_TOKEN\s*=\s*[^\s#][^\n]*/,
  /LINE_CHANNEL_SECRET\s*=\s*[^\s#][^\n]*/,
  /ANTHROPIC_API_KEY\s*=\s*[^\s#][^\n]*/
];
for (const file of fs.readdirSync(root).filter(name => fs.statSync(path.join(root, name)).isFile())) {
  if (file === ".env.example") continue;
  const content = read(file);
  if (secretPatterns.some(pattern => pattern.test(content))) fail(`秘密情報らしき値が含まれています: ${file}`);
}

const serviceWorker = read("service-worker.js");
if (!serviceWorker.includes('url.pathname.startsWith("/api/")')) fail("Service WorkerがAPIをキャッシュ対象外にしていません");
const indexHtml = read("index.html");
if ((indexHtml.match(/class="bottom-nav-item/g) || []).length !== 5) fail("下部メニューが5項目に統一されていません");
if (!indexHtml.includes('id="settingsScrim"') || !indexHtml.includes('aria-labelledby="settingsTitle"')) fail("設定画面の操作補助が不足しています");
if (!indexHtml.includes("暑さへの注意目安（推定）")) fail("暑さの参考表示が明確になっていません");
if (read("script.js").includes("Notification.requestPermission")) fail("利用開始時に通知許可を自動要求しないでください");
if (!read("settings.js").includes("ready2go:settingschange")) fail("設定画面と下部メニューの状態が連携していません");
const packageVersion = JSON.parse(read("package.json")).version;
if (!read("server.js").includes(`APP_VERSION = "${packageVersion}"`)) fail("package.jsonとサーバーのバージョンが一致していません");
if (!read("render.yaml").includes("DATABASE_URL")) fail("render.yamlにDATABASE_URLがありません");
if (fs.existsSync(path.join(root, ".env"))) fail("配布フォルダに.envを含めないでください");
for (const value of ["node_modules/", ".env", "data.json"]) {
  if (!read(".gitignore").split(/\r?\n/).includes(value)) fail(`.gitignoreに${value}がありません`);
}

console.log(`Ready2Go project check: OK (${required.length} required files)`);
