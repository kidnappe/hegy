# tools/ 使用说明

这里放的是开发期的**测试、截图、回归脚本**，不是应用运行时的一部分。应用本身不依赖 `tools/`。

## 先跑这个

```bash
node tools/verify.js
# 或
npm test
```

`verify.js` 是跨平台的基础自检：检查文件完整性、核心 JS 语法、KaTeX 字体、渲染 / 导出契约。它不会启动浏览器，也不会访问模型。

## 浏览器回归脚本

其余脚本大多通过 **CDP 驱动无头 Edge**，有这些前提：

1. Windows；
2. Edge 安装在 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`；
3. 先启动：

   ```bash
   node solver/serve.js 8099
   node solver/mock.js
   ```

4. 脚本使用 `9400+` 端口，**不要并发跑**；
5. 部分脚本把临时目录写死为本机路径（如 `%TEMP%\opencode\...`），换机器需要改路径。

常用脚本：

| 脚本 | 用途 |
|---|---|
| `analysis_test.js` | 解析 / 答案 / 小问 |
| `regression_check.js` | 综合回归 |
| `export_snapshot.js` | 导出 2D / 3D 离线 HTML 快照 |
| `test_export_*.js` | 导出页 / 版本 / 对象显隐 |
| `new_features_test.js` | 新功能回归 |
| `shot_2d_harness.js` | 独立 2D 渲染 harness |
| `golden*.js` | 固定题目的黄金结果对比 |

## 配置保护

有些脚本会把 mock 配置写进真实的 `~/.hegy/settings.json`。跑这类脚本时用包装器：

```bash
node tools/run_with_cfg_guard.js tools/versions_test.js
```

它会在启动前备份 `settings.json`，退出 / 异常时恢复。

## 输出目录

以下目录是生成物，已被 `.gitignore` 忽略：

```text
tools/exports/
tools/shots_new/
```

## 已知情况

- 这些脚本是项目迭代过程中积累的，**不是每个都仍然可用**；
- 部分脚本引用了已经删除的旧模块或旧文件名；
- 端口、Edge 路径、临时目录可能需要在你的机器上调整；
- 欢迎把它们改成跨平台、参数化的版本，但请保持一个脚本只做一件事。

如果你只是使用应用，不需要运行 `tools/` 里的任何东西。
