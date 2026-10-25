#!/usr/bin/env node
// 组装 mobile/www：solver/（原样）+ src/（移动端专有）→ 单份可被 Capacitor 托管的静态站点。
// 规则：www/ 是生成物，任何人不要手改；改 solver/ 或 src/ 后重跑本脚本。
const fs = require("fs");
const path = require("path");

const MOBILE = path.join(__dirname, "..");
const ROOT = path.join(MOBILE, "..");
const SOLVER = path.join(ROOT, "solver");
const WWW = path.join(MOBILE, "www");
const STAMP = String(Date.now());

// 允许进包的 solver 文件（白名单：config.json / mock.js / shot_*.js / *.md 一律不进）
// skins.css / skins.js：皮肤 token 层（SKIN-SYSTEM.md）；手机端皮肤 UI 是 P4/P5，
// 但文件先进包（default 皮肤无任何视觉变化），否则 index.html 的 404 自检过不了。
const FILES = [
  "index.html", "ui.css", "ui.js", "solver.js", "geometry.js", "shim.js",
  "skins.css", "skins.js", "about.js",
  "prompt.txt", "chat-prompt.txt",
];
const DIRS = ["vendor", "vendor3d", "assets", "fonts"];

// 增量覆盖，不整目录删除：本机有「批量删除保护」，rmSync 整个 www 会被拦下来。
// 用 manifest 记录上一轮写了哪些文件，只清掉「这轮不再产出」的那几个（通常是 0~2 个）。
const MANIFEST = path.join(WWW, ".manifest.json");
const written = new Set();
function note(rel) { written.add(rel.replace(/\\/g, "/")); }
function cp(src, dst, relBase) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
  const st = fs.statSync(dst);
  if (st.isDirectory()) {
    (function walk(d, base) {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) walk(p, base + "/" + n);
        else note(base + "/" + n);
      }
    })(dst, relBase);
  } else note(relBase);
}
function cleanStale() {
  let old = [];
  try { old = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) || []; } catch (e) { old = []; }
  let n = 0;
  old.forEach((rel) => {
    if (written.has(rel)) return;
    const p = path.join(WWW, rel);
    try { if (fs.existsSync(p)) { fs.unlinkSync(p); n++; } } catch (e) {}
  });
  fs.writeFileSync(MANIFEST, JSON.stringify(Array.from(written).sort(), null, 0), "utf8");
  return n;
}

// ---------- 1. 复制 solver ----------
fs.mkdirSync(WWW, { recursive: true });
// 历史遗留：bridge 曾经被拍平到根目录，留着会被 index.html 之外的东西误加载
["cfg.js", "http.js", "store.js"].forEach((f) => {
  const p = path.join(WWW, f);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
});
for (const f of FILES) {
  const s = path.join(SOLVER, f);
  if (!fs.existsSync(s)) throw new Error("缺少 solver/" + f);
  fs.copyFileSync(s, path.join(WWW, f));
  note(f);
}
for (const d of DIRS) cp(path.join(SOLVER, d), path.join(WWW, d), d);
// few-shot 示例：排除 example_mock*（与桌面 serve.js 同口径）
fs.readdirSync(SOLVER)
  .filter((n) => /^example_.*\.js$/.test(n) && !/^example_mock/i.test(n))
  .forEach((n) => { fs.copyFileSync(path.join(SOLVER, n), path.join(WWW, n)); note(n); });

// ---------- 2. 复制移动端专有代码 ----------
// core.js 只有一份：solver/core.js（桌面 serve.js 与手机 localapi.js 共用）
const SRC = path.join(MOBILE, "src");
const CORE = path.join(SOLVER, "core.js");
if (fs.existsSync(CORE)) { fs.copyFileSync(CORE, path.join(WWW, "core.js")); note("core.js"); }
for (const f of ["localapi.js"]) {
  const s = path.join(SRC, f);
  if (fs.existsSync(s)) { fs.copyFileSync(s, path.join(WWW, f)); note(f); }
}
for (const d of ["bridge", "overlay"]) {
  const s = path.join(SRC, d);
  if (!fs.existsSync(s)) continue;
  // bridge 保持子目录（index.html 里引用 bridge/xxx.js），overlay 拍平到 www 根
  const out = d === "bridge" ? path.join(WWW, "bridge") : WWW;
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(s)) {
    if (!/\.(js|css)$/.test(f)) continue;
    fs.copyFileSync(path.join(s, f), path.join(out, f));
    note((d === "bridge" ? "bridge/" : "") + f);
  }
}

// ---------- 3. 改 index.html：只加两处，其余原样 ----------
const idxPath = path.join(WWW, "index.html");
let html = fs.readFileSync(idxPath, "utf8");

const CSS_ANCHOR = /(<link rel="stylesheet" href="ui\.css[^"]*"\s*\/>)/;
if (!CSS_ANCHOR.test(html)) throw new Error("index.html 里找不到 ui.css 引用");
html = html.replace(CSS_ANCHOR, '$1\n<link rel="stylesheet" href="mobile.css?v=' + STAMP + '" />');
// pages.css 是第二层样式（设置 / 历史 / 关于），靠"加载在 mobile.css 之后 + 同特异性"覆盖前者。
// 顺序一旦被改坏不会报错，只会静默退回旧外观 —— 所以这里直接断言，构建失败比线上难看强。
const SKIN_ANCHOR = /(<link rel="stylesheet" href="skins\.css[^"]*"\s*\/>)/;
if (SKIN_ANCHOR.test(html)) {
  html = html.replace(SKIN_ANCHOR, '$1\n<link rel="stylesheet" href="pages.css?v=' + STAMP + '" />');
} else {
  html = html.replace('<link rel="stylesheet" href="mobile.css?v=' + STAMP + '" />',
    '<link rel="stylesheet" href="mobile.css?v=' + STAMP + '" />\n<link rel="stylesheet" href="pages.css?v=' + STAMP + '" />');
}
(function assertCssOrder() {
  const at = (name) => html.indexOf('href="' + name + '.css');
  const order = ["ui", "mobile", "skins", "pages"].map((n) => ({ n, i: at(n) }));
  const missing = order.filter((o) => o.i < 0).map((o) => o.n);
  if (missing.length) throw new Error("[prepare] 样式表没全部挂上：" + missing.join(", "));
  const pagesI = at("pages");
  ["ui", "mobile", "skins"].forEach((n) => {
    if (at(n) > pagesI) {
      throw new Error("[prepare] pages.css 必须排在 " + n + ".css 之后（当前顺序会让覆盖失效）");
    }
  });
})();

const JS_ANCHOR = '<script src="ui.js';
if (html.indexOf(JS_ANCHOR) < 0) throw new Error("index.html 里找不到 ui.js 引用");
// 手机端版本号：从 mobile/package.json 读出注入，「关于页」用它显示当前版本
const mobileVer = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
const verTag = '<script>window.HEGY_MOBILE_VERSION=' + JSON.stringify(mobileVer) + '</script>';
const pre = [
  "core.js",
  "bridge/cfg.js",
  "bridge/store.js",
  "bridge/http.js",
  "localapi.js",
  "boot.js",
].map((f) => '<script src="' + f + "?v=" + STAMP + '"></script>').join("\n");
html = html.replace(JS_ANCHOR, verTag + "\n" + pre + "\n" + JS_ANCHOR);

// mobile-ui.js 必须在 solver.js 之后（它要读 window.HJ / DOM 已就绪）
const TAIL_ANCHOR = '<script src="solver.js';
const tailIdx = html.indexOf(TAIL_ANCHOR);
if (tailIdx >= 0) {
  const lineEnd = html.indexOf("\n", tailIdx);
  const insertAt = lineEnd < 0 ? html.length : lineEnd + 1;
  html = html.slice(0, insertAt)
    + '<script src="layers.js?v=' + STAMP + '"></script>\n'
    + '<script src="mobile-ui.js?v=' + STAMP + '"></script>\n'
    + '<script src="mobile-sheet.js?v=' + STAMP + '"></script>\n'
    + '<script src="pages.js?v=' + STAMP + '"></script>\n'
    + html.slice(insertAt);
}
fs.writeFileSync(idxPath, html, "utf8");
note("index.html");

// ---------- 4. 清掉上一轮遗留、这轮不再产出的文件 ----------
const stale = cleanStale();
if (stale) console.log("[prepare] 清掉 " + stale + " 个过期文件");

// ---------- 5. 自检 ----------
// 必须真的出现在 www 里，而不是"应该出现了"：之前 bridge/ 拍平到根目录，
// index.html 引 bridge/cfg.js 直接 404，App 里所有 /api 全挂，只有断言能拦住。
const must = ["index.html", "ui.css", "ui.js", "solver.js", "core.js", "localapi.js", "boot.js", "mobile.css", "bridge/cfg.js", "bridge/store.js", "bridge/http.js"];
const missing = must.filter((f) => !fs.existsSync(path.join(WWW, f)));
if (missing.length) {
  console.error("[prepare] ❌ 缺文件：missing.join() => " + missing.join(", "));
  process.exit(1);
}
// index.html 里引用的每个本地脚本/样式都必须存在（防止再出现 404 静默失败）
const refs = Array.from(html.matchAll(/(?:src|href)="([^":]+?)(?:\?[^"]*)?"/g))
  .map((m) => m[1])
  .filter((r) => r.charAt(0) !== "#");   // #i-xxx 是 SVG sprite 引用，不是文件
const broken = refs.filter((r) => !/^https?:/.test(r) && !fs.existsSync(path.join(WWW, r)));
if (broken.length) {
  console.error("[prepare] ❌ index.html 引用了不存在的文件：" + broken.join(", "));
  process.exit(1);
}
let bytes = 0;
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p); else bytes += st.size;
  }
})(WWW);
console.log("[prepare] www 就绪：" + (bytes / 1048576).toFixed(2) + " MB, stamp=" + STAMP);
