// 背景：electron-builder 24.13.3 的 portable.nsi 模板有两个问题，导致
// 「arm64 单架构 + portable.useZip=true」无法打包：
//   1) 顶层只判断 APP_DIR_64；arm64-only 构建只定义 APP_DIR_ARM64，
//      会掉进「7z 归档」分支，而 useZip 时该分支需要的 APP_ARM64 又没有定义
//      → makensis 报错（Variable "packageArch" not referenced or never set）。
//   2) 双架构分支里有一处 `{endIf}` 拼写错误（少了 `$`）。
// 本脚本对 node_modules 里的模板做最小修补（幂等），供 dist / dist:arm64 使用。
// 注意：升级 electron-builder 后需重新确认这两个问题是否已被上游修复。
const fs = require("fs");
const path = require("path");

const tpl = path.join(
  __dirname,
  "..",
  "node_modules",
  "app-builder-lib",
  "templates",
  "nsis",
  "portable.nsi"
);

if (!fs.existsSync(tpl)) {
  console.error("[patch-portable-nsis] 找不到模板: " + tpl);
  process.exit(1);
}

const before = fs.readFileSync(tpl, "utf8");
let s = before;

// 问题 2：修 typo（幂等：先还原历史上被误改成 $$ 的情况，再只修不带 $ 前缀的裸 {endIf}）
s = s.replace(/\$\$\{endIf\}/g, "${endIf}");
s = s.replace(/(^|[^$])(\{endIf\})/g, (m, p1) => p1 + "${endIf}");

// 问题 1：arm64-only 时把 APP_DIR_ARM64 兜底为 APP_DIR_64，走 File /r 分支
const MARK = "本地补丁 patch-portable-nsis";
const shim = [
  "",
  "# --- " + MARK + " ---",
  "# arm64 单架构 + useZip 时，builder 只定义 APP_DIR_ARM64；这里兜底成 APP_DIR_64，",
  "# 让它走下面的 File /r 分支（运行时按 ${IsNativeARM64} 选择，单架构下两者相同）。",
  "!ifndef APP_DIR_64",
  "  !ifdef APP_DIR_ARM64",
  '    !define APP_DIR_64 "${APP_DIR_ARM64}"',
  "  !endif",
  "!endif",
  "",
].join("\r\n");

if (!s.includes(MARK)) {
  s = s.replace(
    /(!include "extractAppPackage\.nsh"\r?\n)/,
    "$1" + shim
  );
}

// 问题 3：启动图（splashImage）在高 DPI 下被系统位图放大 → 发糊。
// 根因：electron-builder 的 portable.nsi 模板没有声明 DPI 感知，Windows 会把整个
// NSIS 窗口按缩放比例做位图拉伸再显示（150% 时 560×340 被拉成 840×510）。
// 修法：在 exe 的 manifest 里加 dpiAware=true，让系统按 100% 绘制、不再拉伸位图。
// 用 NSIS 3.x 原生指令（makensis /V3 编译已实测通过，manifest 里确有 <dpiAware>true</dpiAware>）。
const MARK_DPI = "本地补丁 dpi-aware";
if (!s.includes(MARK_DPI)) {
  s = s.replace(
    /(RequestExecutionLevel \$\{REQUEST_EXECUTION_LEVEL\}[^\r\n]*)/,
    "$1\r\n" +
      "# --- " + MARK_DPI + " ---\r\n" +
      "# 声明 DPI 感知，避免启动图被系统按缩放比例位图拉伸（见 tools/patch-portable-nsis.js 问题 3）\r\n" +
      "ManifestDPIAware true\r\n" +
      "ManifestSupportedOS all"
  );
}

if (s !== before) {
  fs.writeFileSync(tpl, s);
  console.log("[patch-portable-nsis] 已修补 portable.nsi");
} else {
  console.log("[patch-portable-nsis] 无需修改（已是最新）");
}
