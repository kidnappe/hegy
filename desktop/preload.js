// 何解 · 桌面壳预加载（主进程 contextIsolation 关闭，直接挂 window）
// 只暴露「应用内更新」需要的最小接口，供 solver/about.js 使用；页面里检测 window.HEGY_DESKTOP
// 判断是否运行在桌面壳内。下载进度通过 hegy:update-event 单通道推给页面。
const { ipcRenderer } = require("electron");

window.HEGY_DESKTOP = {
  // 下载安装包（主进程校验 URL 域名白名单），返回 Promise<{ok, error?|path?, name?, size?}>
  downloadUpdate: (url) => ipcRenderer.invoke("hegy:update-download", url),
  // 拉起已下载的安装器并退出本应用，返回 Promise<{ok, error?}>
  installUpdate: () => ipcRenderer.invoke("hegy:update-install"),
  // 订阅更新事件（目前只有 { type: "progress", pct, received, total }），返回取消订阅函数
  onUpdateEvent: (cb) => {
    const h = (_e, data) => { try { cb(data); } catch (err) {} };
    ipcRenderer.on("hegy:update-event", h);
    return () => ipcRenderer.removeListener("hegy:update-event", h);
  }
};
