# 发布检查清单

本文给维护者用，说明如何从当前源码生成一个可发布的版本。

---

## 1. 发布前确认

- [ ] 所有编辑会话已结束，工作区没有半成品改动；
- [ ] `npm test` 通过；
- [ ] 桌面版至少跑过一次基本解题；
- [ ] README 的截图、版本号和仓库地址是最新的；
- [ ] 根目录 `LICENSE` 存在，且与 `package.json` 的 `license` 字段一致（AGPL-3.0-only）；
- [ ] `solver/vendor/LICENSES.md` 覆盖了所有第三方组件，并包含版权行与许可全文；
- [ ] 桌面安装包内包含 `resources/app/LICENSE` 与 `solver/vendor/LICENSES.md`；
- [ ] 没有密钥、用户记录、构建产物和大体积素材。

---

## 2. 公开边界

以下内容不应提交到公开仓库：

```text
node_modules/
desktop/dist/
desktop/dist-arm64/
mobile/node_modules/
mobile/www/
mobile/android/.gradle/
mobile/android/build/
mobile/android/app/build/
solver/config.json
.env
.env.*
*.local.json
video-intro/
video-kit/
demo/
poster/
_backup/
_check/
.tmp/
```

另外：

- `docs/manual/` 是生成的使用说明书，不进入公开仓库；
- 内部交接 / 排障记录不进入公开仓库；
- 设计归档（历史候选图标、启动图草稿）不进入公开仓库，当前生效资源只保留在 `desktop/build/` 与 `solver/assets/`；
- `desktop/build/` 里的图标和启动图是构建输入，可以公开；打包产物不要提交。

---

## 3. 扫描密钥与个人信息

```bash
# 常见 API Key
git grep -n -I -E "sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}"

# 本机绝对路径 / 用户名
git grep -n -I -E "[A-Za-z]:\\\\|C:/Users/|/Users/"

# 内部文档 / 临时工具痕迹
git grep -n -I -E "HANDOVER|opencode|D:\\\\software|C:\\\\Users\\\\Admin"

# 真实配置 / 记录
git ls-files | grep -E "config\\.json$|\\.env|settings\\.json$|records/"
```

> 允许保留的路径：Edge 安装路径、`C:\Users\你的用户名` 占位符、文档里的命令示例。其余本机路径必须清掉。

如果发现密钥：

1. 立即在服务商后台**吊销 / 轮换**；
2. 从工作区中移除；
3. 如果已经提交过，连同历史一起清理，不要只删最新提交。

---

## 4. 版本与标签

需要保持一致的位置：

- 根目录 `package.json`；
- `desktop/package.json`；
- `solver/index.html` 里的静态资源 `?v=`（用于破缓存，不必与版本号完全一致）。

发布时打 tag：

```bash
git tag -a v1.1.0 -m "v1.1.0"
git push origin main --tags
```

---

## 5. 构建桌面版

```bash
cd desktop
npm install
npm run dist        # x64 便携版
npm run dist:arm64  # ARM64 便携版
```

产物在 `desktop/dist/` 和 `desktop/dist-arm64/`。建议把安装包作为 GitHub Release 附件上传，并附上 SHA-256：

```powershell
Get-FileHash .\dist\*.exe -Algorithm SHA256
```

---

## 6. 发布后

- [ ] GitHub Actions 的 CI 通过；
- [ ] Issues、Discussions、Security Advisories 按需开启；
- [ ] README 里的仓库地址和 Release 链接可访问；
- [ ] Release 附件不包含密钥、用户记录或内部文档；
- [ ] 公开仓库的历史里没有内部交接文档、旧实验或真实密钥。

---

## 7. 从私有开发仓同步

如果公开仓库是从一个私有工作区整理出来的：

1. 只复制公开文件集，不要直接推送私有仓库的完整历史；
2. 优先使用干净快照或 orphan 分支生成首个公开提交；
3. 推送前再跑一次 `npm test`、密钥扫描和 `git log` 检查；
4. 后续同步时，保持公开提交的信息可读，不要把内部流水账带进来。
