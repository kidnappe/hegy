// 真实配置保护（HANDOVER §71 / U-17）：跑前备份 ~/.hegy/settings.json，退出或异常一律恢复。
// 用法一（推荐）：node tools\run_with_cfg_guard.js tools\versions_test.js
// 用法二（脚本内）：const guard = require("./_cfg_guard"); guard.install();
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = path.join(process.env.USERPROFILE || os.homedir(), ".hegy");
const SRC = path.join(HOME, "settings.json");
const BAK = path.join(HOME, "settings.json.bak_agent");

function backup() {
  try {
    if (!fs.existsSync(SRC)) return false;
    fs.copyFileSync(SRC, BAK);
    return true;
  } catch (e) {
    console.error("[cfg-guard] 备份失败：" + e.message);
    return false;
  }
}

function restore() {
  try {
    if (!fs.existsSync(BAK)) return false;
    fs.copyFileSync(BAK, SRC);
    return true;
  } catch (e) {
    console.error("[cfg-guard] 恢复失败：" + e.message);
    return false;
  }
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  const had = backup();
  if (!had) console.warn("[cfg-guard] 没有找到 " + SRC + "，跳过备份（脚本可能自己创建配置）");
  let done = false;
  const once = () => { if (done) return; done = true; restore(); };
  process.on("exit", once);
  process.on("SIGINT", () => { once(); process.exit(130); });
  process.on("SIGTERM", () => { once(); process.exit(143); });
  process.on("uncaughtException", (e) => { console.error(e); once(); process.exit(1); });
  process.on("unhandledRejection", (e) => { console.error(e); once(); process.exit(1); });
}

module.exports = { backup, restore, install, SRC, BAK };
