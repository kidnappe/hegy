// 基础自检：不启动服务、不访问模型，确认这个副本可以开发 / 可以公开。
// 用法: node tools/verify.js  或  npm test
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let fail = 0;
let warn = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { console.log("  FAIL " + m); fail++; };
const wrn = (m) => { console.log("  warn " + m); warn++; };
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

console.log("== 1. Node 环境 ==");
const major = Number(process.versions.node.split(".")[0]);
if (major >= 18) ok("Node " + process.versions.node);
else bad("Node 版本过低（需 18+）：" + process.versions.node);

console.log("\n== 2. 关键文件 ==");
const need = [
  "package.json",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "docs/DEVELOPMENT.md",
  "docs/RELEASING.md",
  "docs/screenshots/2d-solve.png",
  "solver/index.html",
  "solver/ui.js",
  "solver/ui.css",
  "solver/solver.js",
  "solver/serve.js",
  "solver/geometry.js",
  "solver/shim.js",
  "solver/prompt.txt",
  "solver/chat-prompt.txt",
  "solver/prompt-rules.md",
  "solver/mock.js",
  "solver/config.example.json",
  "solver/example_main.js",
  "solver/vendor/jsxgraph.js",
  "solver/vendor/jsxgraph.css",
  "solver/vendor/icons.js",
  "solver/vendor/katex/katex.min.js",
  "solver/vendor/katex/katex.min.css",
  "solver/vendor3d/three.min.js",
  "solver/vendor3d/OrbitControls.js",
  "solver/vendor3d/render3d.js",
  "desktop/main.js",
  "desktop/package.json",
  "desktop/package-lock.json",
  "desktop/build/icon.ico",
  "tools/README.md",
  ".gitignore"
];
need.forEach((f) => (exists(f) ? ok(f) : bad("缺文件 " + f)));
[
  "solver/core.js",
  "solver/skins.css",
  "solver/skins.js",
  "mobile/package.json"
].forEach((f) => {
  if (exists(f)) ok("可选（未纳入公开集）" + f);
});

console.log("\n== 3. KaTeX 字体（导出 HTML 内联用） ==");
const fontsDir = path.join(ROOT, "solver/vendor/katex/fonts");
const woff2 = fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir).filter((f) => f.endsWith(".woff2")).length : 0;
if (woff2 >= 18) ok(woff2 + " 个 woff2");
else bad("woff2 只有 " + woff2 + " 个，导出公式会缺字");

console.log("\n== 4. JS 语法检查 ==");
const targets = [];
for (const f of fs.readdirSync(path.join(ROOT, "solver"))) {
  if (f.endsWith(".js")) targets.push("solver/" + f);
}
targets.push("desktop/main.js");
if (exists("mobile/tools/prepare.js")) targets.push("mobile/tools/prepare.js");
const mobileSrc = path.join(ROOT, "mobile/src");
if (fs.existsSync(mobileSrc)) {
  for (const f of fs.readdirSync(mobileSrc)) {
    if (f.endsWith(".js")) targets.push("mobile/src/" + f);
  }
}
for (const d of ["mobile/src/bridge", "mobile/src/overlay"]) {
  const p = path.join(ROOT, d);
  if (!fs.existsSync(p)) continue;
  for (const f of fs.readdirSync(p)) if (f.endsWith(".js")) targets.push(d + "/" + f);
}
targets.forEach((f) => {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) return bad("缺 " + f);
  try {
    execFileSync(process.execPath, ["--check", p], { stdio: "pipe" });
    ok(f);
  } catch (e) {
    const msg = String(e.stderr || e.message).split("\n").filter(Boolean).slice(0, 3).join(" ");
    bad(f + " 语法错误 → " + msg);
  }
});

console.log("\n== 5. 关键契约 ==");
function has(file, needle, label) {
  if (!exists(file)) return bad("缺 " + file);
  if (read(file).includes(needle)) ok(label);
  else bad(label + "（" + file + " 里找不到 " + JSON.stringify(needle) + "）");
}
has("solver/index.html", "ui.css", "index.html 引用 ui.css");
has("solver/index.html", "solver.js", "index.html 引用 solver.js");
has("solver/index.html", "shim.js", "index.html 引用 shim.js");
if (exists("solver/core.js")) has("solver/serve.js", "core.js", "serve.js 使用共享 core.js");
has("solver/shim.js", "GGBBoard", "shim.js 保留 GGBBoard 契约");
has("solver/shim.js", "GGBMath", "shim.js 保留 GGBMath 契约");
has("solver/shim.js", "HexMath", "shim.js 接到 HexMath");
has("solver/solver.js", "function exportCss", "solver.js 含导出模板 exportCss()");
has("solver/solver.js", "HJ_REC", "导出 HTML 内嵌 HJ_REC");
if (exists("mobile/src/localapi.js")) {
  has("mobile/src/localapi.js", "/api/solve", "localapi.js 实现 /api/solve");
  has("mobile/src/localapi.js", "/api/store/index", "localapi.js 实现 /api/store/index");
}

try {
  const pkg = JSON.parse(read("package.json"));
  if (pkg.scripts && pkg.scripts.test) ok("package.json 有 test 脚本");
  else bad("package.json 缺少 scripts.test");
  if (pkg.private === true) ok("package.json 标记 private（防误发布）");
  else wrn("package.json 没有 private: true");
  if (pkg.license === "UNLICENSED") wrn("许可证尚未选择（package.json: UNLICENSED）");
} catch (e) {
  bad("package.json 解析失败：" + e.message);
}

console.log("\n== 6. 本地配置 / 生成物（不应提交） ==");
[
  ["solver/config.json", "本地模型配置（含 Key）"],
  [".env", "本地环境变量"],
  ["mobile/www", "Android 生成的 www/"],
  ["desktop/dist", "桌面打包产物"],
  ["desktop/node_modules", "Electron 依赖"],
  ["mobile/node_modules", "Android / Capacitor 依赖"]
].forEach(([p, label]) => {
  if (!exists(p)) return;
  if (p === "solver/config.json" || p === ".env") wrn("存在 " + label + "：" + p + "（已被 .gitignore，勿提交）");
  else wrn("存在 " + label + "：" + p + "（已被 .gitignore，勿提交）");
});

const ignored = read(".gitignore");
["solver/config.json", "node_modules/", "desktop/dist/", "mobile/www/", "video-intro/"].forEach((p) => {
  if (ignored.includes(p)) ok(".gitignore 覆盖 " + p);
  else bad(".gitignore 未覆盖 " + p);
});

console.log("\n== 7. 旧文件 / 迁移残留 ==");
[
  "solver/vendor/txzmath.js",
  "solver/example_16391.js",
  "dynagraph-db"
].forEach((p) => {
  if (exists(p)) wrn("发现旧文件 / 目录：" + p + "（确认是否应删除）");
  else ok("没有 " + p);
});

console.log("\n----------------------------------------");
if (fail) {
  console.log("结果：有 " + fail + " 项失败，先修再开发。");
  process.exit(1);
}
console.log("结果：通过" + (warn ? "（" + warn + " 条提醒，均不阻塞）" : "") + "。");
console.log("起服务: node solver/serve.js 8099   与   node solver/mock.js");
console.log("打开:   http://127.0.0.1:8099/solver/index.html");
