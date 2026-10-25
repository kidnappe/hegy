/* =========================================================
   何解 · 皮肤运行时（HJSkin）
   ---------------------------------------------------------
   职责（SKIN-SYSTEM.md §3.4/§5.3/§6.3）：
   - 皮肤注册表与元数据（设置页预览用）；
   - 切换：只改 <html data-skin>，不刷新、不重载记录；
     03/04 v1 只有日间——选中时若在夜间则临时切到日间，
     solver_theme_v1（用户偏好）不覆写，切回 default 自动恢复；
   - 持久化：solver_skin_v1（UI 偏好，不写记录）；
   - 画布 palette：2D JSXGraph / 3D three.js 的网格、坐标轴、底色。
     default 的取值 = 现有代码的字面值（保证逐像素一致）；
     画布内部的图形颜色是模型给的内容色，不随皮肤。
   - 切换后派发 document 事件 "hj:skin"（detail.skin），应用层监听并
     给画布重上 palette（只改样式，不重算几何）。

   本文件必须在 ui.js / solver.js 之前加载（导出离线 HTML 不含本文件，
   所以 render3d.js / solver.js 引用 palette 时都要带存在性回退）。
   ========================================================= */
(function () {
  "use strict";

  var KEY = "solver_skin_v1";
  var ALLOWED = ["default", "warm", "swiss"];

  // 设置页预览卡的色板（与 skins.css 的 token 保持一致；改色两边同步）
  var SWATCH = {
    "default": { bg: "#f4f5f7", panel: "#ffffff", line: "#e4e7ec", txt: "#1c2024" },
    "warm":    { bg: "#ece5d9", panel: "#f6f0e5", line: "#a89f91", txt: "#1b1a17" },
    "swiss":   { bg: "#ffffff", panel: "#f7f7f4", line: "#111111", txt: "#0d0d0d" }
  };

  var SKINS = [
    { key: "default", name: "原色", desc: "现有界面 · 日间/夜间", swatch: SWATCH["default"] },
    { key: "warm",    name: "暖工业", desc: "暖灰材质 · 日间/夜间", swatch: SWATCH["warm"] },
    { key: "swiss",   name: "瑞士网格", desc: "黑白栅格 · 日间/夜间", swatch: SWATCH["swiss"] }
  ];

  function readKey() {
    try {
      var s = localStorage.getItem(KEY);
      return ALLOWED.indexOf(s) >= 0 ? s : "default";
    } catch (e) { return "default"; }
  }

  function readTheme() {
    try {
      var t = localStorage.getItem("solver_theme_v1");
      return t === "dark" ? "dark" : "light";
    } catch (e) { return "light"; }
  }

  // P6 起 03/04 也有夜间（单独设计，见 skins.css 暗色块）：主题只跟用户偏好走
  function effectiveTheme() { return readTheme(); }

  // 画布 palette。default = 现有代码字面值：
  //  - 2D 网格 #e2e2e2（solver.js ensureGrid2D）；axis2d:null = 不动轴色（模型/JSXGraph 自己的）
  //  - 3D 背景 #ffffff、GridHelper 中心线 #d0d0d0 / 网格 #e8e8e8（render3d.js）
  //  - objectDot：对象列表色点覆盖。null = 沿用图元自身颜色（内容色）；
  //    swiss 按 §9 拍板压成黑白（类型文字保留，靠文字区分对象）。
  var CANVAS = {
    "default": { grid2d: "#e2e2e2", axis2d: null, paper3d: 0xffffff, gridMajor3d: 0xd0d0d0, gridMinor3d: 0xe8e8e8, objectDot: null },
    "warm":    { grid2d: "#e4ddd0", axis2d: "#a99f90", paper3d: 0xfbf7ef, gridMajor3d: 0xa99f90, gridMinor3d: 0xd8d0c3, objectDot: null },
    "swiss":   { grid2d: "#e8e8e3", axis2d: "#b4b4ae", paper3d: 0xffffff, gridMajor3d: 0xb4b4ae, gridMinor3d: 0xe8e8e3, objectDot: "var(--object-point)" }
  };

  function current() { return readKey(); }
  function palette() { return CANVAS[readKey()] || CANVAS["default"]; }

  function dispatch(skin) {
    try {
      document.dispatchEvent(new CustomEvent("hj:skin", { detail: { skin: skin } }));
    } catch (e) {}
  }

  // 应用到 <html>：皮肤 + 应生效的主题。首帧脚本（index.html）与运行时切换共用这套口径。
  function apply(skin) {
    skin = ALLOWED.indexOf(skin) >= 0 ? skin : "default";
    try { localStorage.setItem(KEY, skin); } catch (e) {}
    var html = document.documentElement;
    html.setAttribute("data-skin", skin);
    html.setAttribute("data-theme", effectiveTheme(skin));
    dispatch(skin);
    return skin;
  }

  function set(skin) { return apply(skin); }

  window.HJSkin = {
    KEY: KEY,
    SKINS: SKINS,
    canvas: CANVAS,
    current: current,
    palette: palette,
    effectiveTheme: effectiveTheme,
    apply: apply,
    set: set
  };
})();
