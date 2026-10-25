// 解题机器 · 桌面版外壳（Electron）
// 作用：启动内置小服务器（solver/serve.js）+ 打开应用窗口；便携版数据放在 exe 同目录。
// 应用内更新：关于页触发，主进程下载「安装版」到临时目录，再拉起安装器覆盖升级（见底部 IPC 区）。
const { app, BrowserWindow, Menu, shell, ipcMain, net } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");
const https = require("https");

const APP_ICON = path.join(__dirname, "build", "icon.png");

const PORT = 17321; // 独立端口，避免和开发时的 8099 冲突
let serverChild = null;
let win = null;

// userData（Electron 缓存/localStorage）：便携版放 exe 同目录 HegyData；安装版放 %APPDATA%\Hegy
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath("userData", path.join(process.env.PORTABLE_EXECUTABLE_DIR, "HegyData"));
} else if (app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "Hegy"));
}

// 开发态：solver 在上一级（E:\code\math\solver）；打包后：solver 在本目录下
function findSolverDir() {
  const a = path.join(__dirname, "solver");
  const b = path.join(__dirname, "..", "solver");
  if (fs.existsSync(path.join(a, "serve.js"))) return a;
  return b;
}

function startServer() {
  const servePath = path.join(findSolverDir(), "serve.js");
  serverChild = spawn(process.execPath, [servePath, String(PORT)], {
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  serverChild.stdout.on("data", (d) => process.stdout.write("[server] " + d));
  serverChild.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}

function waitServer(tries, cb) {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/status", timeout: 800 }, (res) => { res.resume(); cb(true); });
  req.on("error", () => { if (tries > 0) setTimeout(() => waitServer(tries - 1, cb), 300); else cb(false); });
  req.on("timeout", () => { req.destroy(); });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 940, minHeight: 620,
    title: "何解",
    icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
    autoHideMenuBar: true,
    backgroundColor: "#f7f8fa",
    webPreferences: {
      contextIsolation: false, nodeIntegration: false, spellcheck: false,
      preload: path.join(__dirname, "preload.js") // 挂 window.HEGY_DESKTOP（应用内更新接口）
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

// 页面带 ?appv=：「关于页」读它显示桌面端当前版本（来源 desktop/package.json）
const APP_URL = "http://127.0.0.1:" + PORT + "/solver/index.html?appv=" + encodeURIComponent(app.getVersion());

// 窗口立起来后、页面加载完成前的占位页（这几百毫秒~几秒也不想让用户看着空窗口）
const BOOT_HTML = '<!doctype html><meta charset="utf-8"><title>何解</title>' +
  '<body style="margin:0;font:15px/1.8 system-ui,Segoe UI,Microsoft YaHei;color:#5a6a7a;background:#f7f8fa;display:flex;align-items:center;justify-content:center;height:100vh">' +
  '<div style="text-align:center"><div style="font-size:22px;color:#2c3e50;letter-spacing:6px;margin-bottom:10px">何解</div>' +
  '<div>正在启动，请稍候…</div></div></body>';

// 服务没起来时的兜底提示（正常情况不会走到这里）
function showBootError() {
  const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px/1.7 system-ui,Segoe UI,Microsoft YaHei;color:#334;display:flex;align-items:center;justify-content:center;height:100vh;background:#f7f8fa">' +
    '<div style="text-align:center"><div style="font-size:18px;color:#223;margin-bottom:6px">何解 · 内部服务启动失败</div>' +
    '<div>请完全关闭本程序后重新打开；若反复出现，请把这一步的情况告诉维护者。</div></div>';
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

/* ============ 应用内更新（关于页「点击更新」：下载安装包 → 拉起安装器覆盖升级） ============
   只放行 GitHub 域名；安装包统一选「安装版」（NSIS 覆盖安装），便携版 exe 运行时被占用、
   无法自我替换，所以便携版用户也走安装版升级。 */
const UPDATE_HOST_OK = (h) => h === "github.com" || h === "api.github.com" || h.endsWith(".githubusercontent.com");
let updateDownloading = false;
let updateFile = null; // 最近一次下载完成的安装包 { path, name }

function sendUpdateEvent(event, payload) {
  try { if (event && event.sender && !event.sender.isDestroyed()) event.sender.send("hegy:update-event", payload); } catch (e) {}
}

ipcMain.handle("hegy:update-download", updateDownload);
ipcMain.handle("hegy:update-install", updateInstall);

/* ============ 关于页更新记录：主进程直连拉取 api.github.com ============
   渲染进程的 fetch 走系统代理——共享代理出口 IP 的 GitHub 未认证限额（60 次/小时/IP）常被打满，
   「更新记录」因此 403。Node 的 https 模块不读系统代理、天然直连；页面优先走这条路，
   失败再退回渲染进程 fetch。注意不能用 electron 的 net 模块（走 Chromium 网络栈 = 系统代理）。 */
function aboutFetch(_e, rawUrl, etag) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(String(rawUrl || "")); } catch (err) { resolve({ status: 0, error: "bad-url" }); return; }
    if (u.protocol !== "https:" || u.host !== "api.github.com") { resolve({ status: 0, error: "bad-url" }); return; }
    const headers = { "Accept": "application/vnd.github+json", "User-Agent": "Hegy-About" };
    if (etag) headers["If-None-Match"] = String(etag);
    const req = https.get({ host: u.host, path: u.pathname + u.search, headers, timeout: 15000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, etag: res.headers.etag || "", body: body }));
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", (err) => resolve({ status: 0, error: String((err && err.message) || err) }));
  });
}
ipcMain.handle("hegy:about-fetch", aboutFetch);

function updateDownload(event, rawUrl) {
  return new Promise((resolve) => {
    const url = String(rawUrl || "");
    let host = "", fileName = "";
    try {
      const u = new URL(url);
      if (u.protocol === "https:") host = u.hostname.toLowerCase();
      fileName = decodeURIComponent(u.pathname.split("/").pop() || "");
    } catch (e) {}
    fileName = fileName.replace(/[^\w.\u4e00-\u9fa5-]/g, "_");
    if (!UPDATE_HOST_OK(host) || !/\.exe$/i.test(fileName)) return resolve({ ok: false, error: "invalid-url" });
    if (updateDownloading) return resolve({ ok: false, error: "busy" });
    updateDownloading = true;

    const dir = path.join(app.getPath("temp"), "hegy-update");
    const partPath = path.join(dir, fileName + ".part");
    const finalPath = path.join(dir, fileName);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.rmSync(partPath, { force: true });
      fs.rmSync(finalPath, { force: true });
    } catch (e) {}

    let settled = false;
    const settle = (payload) => { if (settled) return; settled = true; updateDownloading = false; resolve(payload); };
    const fail = (error) => settle({ ok: false, error: error });

    const req = net.request({ url: url });
    req.setHeader("User-Agent", "hegy-desktop/" + app.getVersion());
    let total = 0, received = 0, lastPct = -1, lastTick = 0;

    req.on("response", (res) => {
      if (res.statusCode !== 200) { fail("http-" + res.statusCode); res.resume(); return; }
      const cl = parseInt(res.headers["content-length"], 10);
      total = isFinite(cl) && cl > 0 ? cl : 0;
      const out = fs.createWriteStream(partPath);
      out.on("error", () => { try { req.abort(); } catch (e) {} fail("write"); });
      res.on("data", (chunk) => {
        received += chunk.length;
        if (!out.write(chunk)) res.pause();
        const now = Date.now();
        const pct = total ? (received / total) * 100 : 0;
        if (now - lastTick > 300 || Math.floor(pct) > lastPct) {
          lastTick = now; lastPct = Math.floor(pct);
          sendUpdateEvent(event, { type: "progress", pct: pct, received: received, total: total });
        }
      });
      out.on("drain", () => { try { res.resume(); } catch (e) {} });
      res.on("end", () => {
        out.end(() => {
          try { fs.renameSync(partPath, finalPath); } catch (e) { return fail("write"); }
          updateFile = { path: finalPath, name: fileName };
          sendUpdateEvent(event, { type: "progress", pct: 100, received: received, total: total || received });
          settle({ ok: true, path: finalPath, name: fileName, size: received });
        });
      });
      res.on("error", () => { try { out.close(); } catch (e) {} fail("network"); });
    });
    req.on("error", () => fail("network"));
    req.end();
  });
}

function updateInstall() {
  if (!updateFile || !fs.existsSync(updateFile.path)) return { ok: false, error: "no-file" };
  // 先把安装器拉起来（独立进程，不随本应用退出），600ms 后退出本应用：
  // 覆盖安装要求旧版先退出；NSIS 那边还有「检测到程序正在运行」的兜底。
  spawn(updateFile.path, [], { detached: true, stdio: "ignore" }).unref();
  setTimeout(() => app.quit(), 600);
  return { ok: true };
}

// 更新链路自测：--update-selftest=<url> 跳过窗口，直接走一遍下载逻辑并把结果打到 stdout
const SELFTEST_URL = (() => {
  const a = process.argv.find((x) => x.indexOf("--update-selftest=") === 0);
  return a ? a.split("=").slice(1).join("=") : "";
})();

app.whenReady().then(() => {
  if (SELFTEST_URL) {
    const fakeEvent = { sender: { isDestroyed: () => false, send: (_c, p) => console.log("[selftest] event " + JSON.stringify(p)) } };
    updateDownload(fakeEvent, SELFTEST_URL).then((r) => {
      console.log("[selftest] result " + JSON.stringify(r));
      app.quit();
    });
    return;
  }
  Menu.setApplicationMenu(null);
  // 先立窗口（浅色底 + 标题「何解」+「正在启动」占位页），服务就绪后再加载真实页面：把等待时间用起来
  createWindow();
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(BOOT_HTML));
  startServer();
  waitServer(50, (ok) => {
    if (!win || win.isDestroyed()) return;
    if (ok) win.loadURL(APP_URL);
    else showBootError();
  });
  if (process.argv.indexOf("--autoclose") >= 0) setTimeout(() => app.quit(), 15000);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { if (serverChild) { try { serverChild.kill(); } catch (e) {} } });
