// 解题机器 · 桌面版外壳（Electron）
// 作用：启动内置小服务器（solver/serve.js）+ 打开应用窗口；便携版数据放在 exe 同目录。
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");

const APP_ICON = path.join(__dirname, "build", "icon.png");

const PORT = 17321; // 独立端口，避免和开发时的 8099 冲突
let serverChild = null;
let win = null;

// 便携版：历史/配置等数据放在 exe 同目录下的“解题机器数据”文件夹，拷贝即迁移
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath("userData", path.join(process.env.PORTABLE_EXECUTABLE_DIR, "HegyData"));
}

// 开发态：solver 在仓库根目录；打包后：solver 在本目录下
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
    webPreferences: { contextIsolation: false, nodeIntegration: false, spellcheck: false }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

const APP_URL = "http://127.0.0.1:" + PORT + "/solver/index.html";

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

app.whenReady().then(() => {
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
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { if (serverChild) { try { serverChild.kill(); } catch (e) {} } });
