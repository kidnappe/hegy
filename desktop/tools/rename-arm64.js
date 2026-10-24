// dist:arm64 构建（输出到临时目录 dist-arm64）完成后，把产物移动到 dist/ 并改名为
// 「何解-x.y.z-便携版-arm64.exe」，避免覆盖 x64 的正式产物（artifactName 里不含架构）。
const fs = require("fs");
const path = require("path");

const pkg = require("../package.json");
const outDir = path.join(__dirname, "..", "dist-arm64");
const dist = path.join(__dirname, "..", "dist");
const artifact = String(pkg.build.win.artifactName)
  .replace("${version}", pkg.version)
  .replace("${ext}", "exe");

const src = path.join(outDir, artifact);
const dst = path.join(dist, artifact.replace(/\.exe$/i, "-arm64.exe"));

if (!fs.existsSync(src)) {
  console.error("[rename-arm64] 找不到构建产物: " + src);
  process.exit(1);
}
fs.mkdirSync(dist, { recursive: true });
fs.rmSync(dst, { force: true });
fs.renameSync(src, dst);
console.log("[rename-arm64] " + path.basename(src) + " -> dist\\" + path.basename(dst));

// 清掉临时输出目录（含 win-arm64-unpacked，约 220MB），正式产物已在 dist/
fs.rmSync(outDir, { recursive: true, force: true });
console.log("[rename-arm64] 已清理临时目录 " + path.basename(outDir));
