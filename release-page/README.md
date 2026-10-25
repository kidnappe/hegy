# 发布页（release-page）

> 何解的对外发布页。2026-10-25 从 `demo/travelling-interface/` 拉出并改为发布口径。
> 约定：发布页**独立**，不使用任何一套皮肤（SKIN-SYSTEM.md §9 口径）；单文件自包含，无外部资源依赖。
> 部署目标：GitHub Pages → **https://kidnappe.github.io/hegy/**（`.github/workflows/pages.yml` 自动部署）。

## 文件

- `index.html` — 发布页本体（单文件：内联 CSS/JS/SVG sprite/data-URI 图标，离线可开）
- `preview.png` — 整页预览截图
- `manual.html` — 使用说明书（1.1.0 自包含单文件 6.2MB；08 屏「使用说明书 · 在线阅读」指向它）

## 已就位（2026-10-25，第三轮修订）

- **口径**：标题 / meta / 封面 / COLOPHON 均为发布口径（本地运行、AGPL-3.0 开源、离线导出）。
- **左侧介绍小字**：`.lede` 15.5px 深色（移动端 14px）。
- **右上角入口**：GitHub + 爱发电；**DOWNLOAD 按钮带下载图标**，点击直达末屏下载区（`#s8`）。
- **下载区在最后一屏**（08 COLOPHON）：GitHub Releases 主按钮 + 蓝奏云镜像位 + 「电脑模式」提示。
  带走屏（07）只讲导出，指引文案指向末屏。`.dl-btn .t` 加 `flex:1`、副文案允许换行——
  修复了旧版下载说明区字段重叠问题（已用 bounding box 程序化检测：块内元素零重叠、
  与应用浮层零冲突、整列收在视口内）。
- **蓝奏云已上线**（2026-10-25 晚）：地址 `https://zhouxuan.lanzoue.com/b0j1u8vej`、提取码 `4v61`。
  镜像按钮 href 直接写死在 HTML 里（不依赖 JS 才有链接），副文案带提取码、右侧 `前往 ↗`；
  按钮下方新增一行 `.dl-code`：`地址 zhouxuan.lanzoue.com/b0j1u8vej · 提取码 4v61 · [复制]`，
  复制按钮一次把「链接 + 提取码」放进剪贴板（`navigator.clipboard`，file:// 下退到
  `execCommand`，两者都不行就提示手动选）。地址/提取码的唯一来源仍是 JS 尾部的
  `MIRROR_URL` / `MIRROR_CODE`，换链接只改这两行。
- **末屏列顶**：`@media (min-width:901px){#s8 .copy{padding-top:11.5vh}}`——末屏比别屏多一块下载区，
  列顶抬 3.5vh，让 1440×900 下两个下载按钮 + 地址行都收在首屏内（说明书链接与页脚 pills
  需要再滚一点，末屏总高 961px）。窄屏不受影响，仍走 9vh。
- **按钮可读性**（第四轮小修）：DOWNLOAD 按钮图标 `fill:currentColor`（原黑底黑图标不可见，
  gap 12→7px）；下载区主按钮改**实心黑**（同 navcta 家族）、镜像按钮实心纸底 + 加深边框。
- **微调独立成页（05 REFINE，在追问之前）**：突出两件事——
  ① 微调后的提示（预览差异卡：原图形删除线 → 微调后，保留 / 撤销按钮）；
  ② 多微调版本切换（v1 原始 / v2 加粗线 / v3 滑块三个快照标签，点击有切换反馈）。
  新增 `#app[data-state="refine"]`。
- **追问页（06 ASK）**：对话气泡视图（紫=用户、灰=何解，带「微调/追问」标签），2D 图形在场。
- **可读性**：巨字上的小字全部垫纸底 chip（hero-line / scrollhint / pills / .edge halo）。
- **全页 9 屏**：00 封面 / 01 输入 / 02 图形 / 03 立体 / 04 解答 / 05 微调 / 06 追问 / 07 带走 / 08 末尾；
  页脚编号 /08。≤1280px 隐藏品牌副标题收紧导航（已验证不换行不重叠）。

## 链接状态（2026-10-25）

1. **蓝奏云**：已填。`index.html` 里 `MIRROR_URL = "https://zhouxuan.lanzoue.com/b0j1u8vej"`、
   `MIRROR_CODE = "4v61"`；按钮 href 与下方 `.dl-code` 那行的文案都跟这两个常量同源。
   换分享链接时改这两行 + 三处静态文案（`#dlMirror` 的 href、`#dlCodeUrl` 的 href/文字、`#dlCodePw`）。
2. **版本**：页面已同步到 `v1.2.1`（s0 hero-line、s8 下载区 `.cap`、s8 pill 三处）；再发版时同样改这三处。

## 上线步骤（需要仓库推送后执行）

1. 推送 `main`（含 `release-page/` 与 workflow）；
2. 仓库 Settings → Pages → Build and deployment → **Source 选「GitHub Actions」**；
3. 手动跑一次 `pages` workflow（或等下次 push 触发），站点即上线 `https://kidnappe.github.io/hegy/`。

## 验证

2026-10-25 第三轮实测（1440×900）：05 微调屏（预览差异卡 + 保留/撤销 + 三版本标签）、
06 追问屏（对话气泡、应用在左）、07 带走屏（下载块已移走、导出纸片在场）、
08 末屏（下载区 + 3D 应用浮层 + 纸底 chips）截图核对通过；
下载区做了 bounding box 程序化重叠检测——块内元素零重叠、与应用浮层零冲突、整列收在视口内；
1280px 导航不换行不重叠；JS 语法检查通过。
改版后再过一遍：≤900px 窄屏、`prefers-reduced-motion`。

2026-10-25 第五轮（蓝奏云上线）实测脚本 `.tmp/check_release_page.js`（headless Edge + CDP，全绿）：
镜像按钮 href/`_blank`/`前往 ↗`/副文案含提取码；地址行文字与 href；复制按钮点下去剪贴板真拿到
`https://zhouxuan.lanzoue.com/b0j1u8vej  提取码 4v61`（反馈变「已复制」）；
地址块与提示条/说明书链接/pills/3D 浮层零重叠；地址不被省略号截断、块不换行；
1440×900 下两个下载按钮 + 地址行收在首屏（`codeInScene=808 < 900`），末屏总高 961；
390×844 下地址行仍是一行、不横向溢出。无 JS 报错。
