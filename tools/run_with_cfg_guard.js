// 包装器：把任意测试脚本包在「跑前备份、退出恢复」的保护里（U-17）。
// 用法：node tools\run_with_cfg_guard.js tools\versions_test.js [脚本自己的参数...]
const path = require("path");
const { spawn } = require("child_process");
const guard = require("./_cfg_guard");

const target = process.argv[2];
if (!target) {
  console.error("用法：node tools\\run_with_cfg_guard.js tools\\versions_test.js [args...]");
  process.exit(2);
}
const script = path.isAbsolute(target) ? target : path.join(__dirname, "..", target);
const had = guard.backup();
console.log("[cfg-guard] " + (had ? "已备份 settings.json → settings.json.bak_agent" : "没有 settings.json，跳过备份"));

const child = spawn(process.execPath, [script].concat(process.argv.slice(3)), {
  stdio: "inherit",
  cwd: path.join(__dirname, "..")
});

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  const ok = guard.restore();
  console.log("[cfg-guard] " + (ok ? "已恢复真实配置" : "无需恢复（没有备份）"));
  process.exit(code);
}
child.on("exit", (code) => finish(code == null ? 0 : code));
["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => { try { child.kill(); } catch (e) {} finish(1); }));
