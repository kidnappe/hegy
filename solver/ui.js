/* =========================================================
   何解 · UI 层
   职责：布局（可拖拽/可收起）、对象面板、步骤条、测量卡、工具栏、
        脚本自带浮层的兜底收纳。
   约定：本文件只碰 DOM 与"场景对象索引"，不参与解题/任务逻辑。
   ========================================================= */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var LS = "solver_layout_v1";

  /* ---------------- 小工具 ---------------- */
  function el(tag, cls, txt) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (txt != null) d.textContent = txt;
    return d;
  }
  function num(v, n) {
    if (v == null || !isFinite(v)) return "—";
    var x = Number(v);
    if (Math.abs(x) < 1e-9) x = 0; // 消除 -0
    var s = x.toFixed(n == null ? 2 : n);
    if (s.indexOf(".") >= 0) s = s.replace(/\.?0+$/, "");
    return s === "-0" ? "0" : (s || "0");
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  // LaTeX → 纯文本（交给 render3d.js 的 texPlain；没加载时退化成去掉 $ 和常见命令）
  function texPlain(t) {
    var s = String(t == null ? "" : t);
    if (!/[\\$]/.test(s)) return s;
    if (window.GGB3D && typeof window.GGB3D.texPlain === "function") {
      try { return window.GGB3D.texPlain(s); } catch (e) {}
    }
    return s.replace(/\$/g, "").replace(/\\[A-Za-z]+\s*/g, "");
  }
  // 内联 SVG 图标（Lucide sprite，见 vendor/icons.js）

  /* ---- 坐标纸开关（§72）：偏好存 localStorage，2D/3D 共用一个按钮 ---- */
  var GRID_KEY = "solver_grid_v1";
  function gridPrefOn() { try { return localStorage.getItem(GRID_KEY) !== "0"; } catch (e) { return true; } }
  // 网格可能是 ensureGrid2D 补的，也可能是模型自己用 board 选项/脚本建的，
  // 所以每次都以画板里的对象为准，不能只认一个句柄。
  function gridEls2D() {
    var b = window.board, out = [];
    if (!b || !b.objectsList) return out;
    for (var i = 0; i < b.objectsList.length; i++) {
      var o = b.objectsList[i];
      if (o && o.elType === "grid") out.push(o);
    }
    return out;
  }
  function gridAvailable() {
    if (gridEls2D().length) return true;
    if (window.GGB3D && window.GGB3D.hasGrid && window.GGB3D.hasGrid()) return true;
    return false;
  }
  function applyGridPref() {
    var on = gridPrefOn();
    var gs = gridEls2D();
    if (gs.length) {
      // JSXGraph 的显隐在 visProp 里，直接给元素赋 .visible 不参与渲染；
      // 网格分主/次两条 curve，两条都要改（次网格默认 visible:"inherit"）。
      for (var i = 0; i < gs.length; i++) {
        try { gs[i].setAttribute({ visible: on }); } catch (e) {}
      }
      try { window.board.update(); } catch (e) {}
    }
    if (window.GGB3D && window.GGB3D.setGrid) { try { window.GGB3D.setGrid(on); } catch (e) {} }
    var btn = document.querySelector('#toolbar button[data-act="grid"]');
    if (btn) {
      var avail = gridAvailable();
      btn.style.display = avail ? "" : "none";
      btn.classList.toggle("on", avail && on);
      btn.title = on ? "隐藏网格" : "显示网格";
    }
  }
  function toggleGrid() {
    var on = !gridPrefOn();
    try { localStorage.setItem(GRID_KEY, on ? "1" : "0"); } catch (e) {}
    applyGridPref();
  }
  window.HJGrid = { apply: applyGridPref, toggle: toggleGrid };

  function icon(name, cls) {
    return '<svg class="' + (cls || "ico") + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  /* ---- 友好名：把模型内部 id 转成人话 ---- */
  // 常见内部命名：seg_AB / segAB / vec_AM / plane_x / pl1 / aux_GH / point_A / A1
  // 注意：每一组正则只捕获"前缀"和"剩余部分"，剩余部分才是名字本体
  var NAME_RULES = [
    [/^(?:segment|seg|edge|line|ln)[_\-]?(.+)$/i, "棱 "],
    [/^(?:vector|vec|arrow)[_\-]?(.+)$/i, "向量 "],
    [/^(?:plane|pl|face|section|sec)[_\-]?(.+)$/i, "面 "],
    [/^(?:aux|helper|hidden)[_\-]?(.+)$/i, "辅助 "],
    [/^(?:circle|circ|k)[_\-]?(.+)$/i, "圆 "],
    [/^(?:dim|dimension)[_\-]?(.+)$/i, "尺寸 "],
    [/^(?:path|traj|track)[_\-]?(.+)$/i, "轨迹 "],
    [/^(?:arc)[_\-]?(.+)$/i, "弧 "],
    [/^(?:sphere|sph)[_\-]?(.+)$/i, "球 "],
    [/^(?:cylinder|cyl)[_\-]?(.+)$/i, "圆柱 "],
    [/^(?:cone)[_\-]?(.+)$/i, "圆锥 "],
    // 点：point_A / pt_A / p_A → A（不加前缀，点就直接用名字）
    [/^(?:point|pt)[_\-]?([A-Za-z][A-Za-z0-9_\-]*)$/i, ""],
  ];
  var SUB_DIGITS = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
  // A1 → A₁；AB1 → AB₁；seg_AB 里剩下的 A_B → AB
  function sub(s) {
    s = String(s || "").replace(/[_\-]/g, "");
    return s.replace(/([A-Za-z])(\d+)/g, function (m, a, d) {
      return a + d.split("").map(function (c) { return SUB_DIGITS[c] || c; }).join("");
    });
  }
  function friendlyName(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "对象";
    // 名字里带 LaTeX（如 \vec{AB}）先转成可读文本，否则对象列表会原样显示反斜杠
    if (/[\\$]/.test(s)) { var tp = texPlain(s); if (tp) s = tp; }
    // 已经是中文就不动
    if (/[\u4e00-\u9fff]/.test(s)) return s;
    for (var i = 0; i < NAME_RULES.length; i++) {
      var m = s.match(NAME_RULES[i][0]);
      if (m) {
        var body = sub(m[1]);
        if (body) return NAME_RULES[i][1] + body;
      }
    }
    // 兜底：至少把 A1 转成 A₁
    return sub(s);
  }

  /* =========================================================
     一、布局：左右两栏可拖拽 + 可收起
     ========================================================= */
  var LAYOUT = { left: 236, right: 404, leftCollapsed: false, rightCollapsed: false, refine: 158 };
  var MIN_CANVAS = 360;  // 画布最小宽度（低于这个值图就看不清了）
  var MIN_SIDE = 150;    // 侧栏最小宽度
  var MAX_LEFT = 420;    // 对象面板没必要太宽
  var MAX_RIGHT = 640;   // 解答栏上限
  var REFINE_MIN = 34;   // 微调区最小高度（折叠态）
  var REFINE_MAX = 420;  // 微调区最大高度

  // 把两栏夹进"窗口够用"的范围；返回是否改动过
  function fitLayout() {
    var main = $("main");
    var total = main ? main.getBoundingClientRect().width : window.innerWidth;
    if (!total) return false;
    var before = LAYOUT.left + "/" + LAYOUT.right;
    LAYOUT.left = clamp(LAYOUT.left, MIN_SIDE, MAX_LEFT);
    LAYOUT.right = clamp(LAYOUT.right, MIN_SIDE, MAX_RIGHT);
    if (!LAYOUT.leftCollapsed && !LAYOUT.rightCollapsed) {
      var avail = total - MIN_CANVAS;
      if (LAYOUT.left + LAYOUT.right > avail) {
        // 按比例压缩，保证画布最小宽度
        var sum = LAYOUT.left + LAYOUT.right;
        var k = avail / sum;
        LAYOUT.left = Math.max(MIN_SIDE, Math.round(LAYOUT.left * k));
        LAYOUT.right = Math.max(MIN_SIDE, Math.round(avail - LAYOUT.left));
        if (LAYOUT.left + LAYOUT.right > avail) LAYOUT.left = Math.max(MIN_SIDE, avail - LAYOUT.right);
      }
    }
    return before !== (LAYOUT.left + "/" + LAYOUT.right);
  }

  function loadLayout() {
    try {
      var o = JSON.parse(localStorage.getItem(LS) || "null");
      if (o && typeof o === "object") {
        if (typeof o.left === "number") LAYOUT.left = o.left;
        if (typeof o.right === "number") LAYOUT.right = o.right;
        if (typeof o.refine === "number") LAYOUT.refine = o.refine;
        LAYOUT.leftCollapsed = !!o.leftCollapsed;
        LAYOUT.rightCollapsed = !!o.rightCollapsed;
        // 旧版本存过 96px 的默认值，向上抬到能放下输入框+选项行+chips
        if (LAYOUT.refine > 0 && LAYOUT.refine < 146) LAYOUT.refine = 158;
      }
    } catch (e) {}
  }
  function saveLayout() {
    try { localStorage.setItem(LS, JSON.stringify(LAYOUT)); } catch (e) {}
  }
  function applyLayout() {
    fitLayout(); // 窗口变小/历史值过大时自动夹紧
    var root = document.documentElement.style;
    root.setProperty("--left-w", LAYOUT.left + "px");
    root.setProperty("--right-w", LAYOUT.right + "px");
    var L = $("leftPanel"), R = $("rightPanel");
    if (L) L.classList.toggle("collapsed", LAYOUT.leftCollapsed);
    if (R) R.classList.toggle("collapsed", LAYOUT.rightCollapsed);
    var sL = $("splitL"), sR = $("splitR");
    if (sL) sL.style.display = LAYOUT.leftCollapsed ? "none" : "";
    if (sR) sR.style.display = LAYOUT.rightCollapsed ? "none" : "";
    // 收起后显示边缘展开把手
    var rL = $("reopenL"), rR = $("reopenR");
    if (rL) {
      rL.classList.toggle("show", LAYOUT.leftCollapsed);
      rL.setAttribute("title", "展开对象面板");
    }
    if (rR) {
      rR.classList.toggle("show", LAYOUT.rightCollapsed);
      rR.setAttribute("title", "展开解答栏");
    }
    // 状态栏也放一个恢复入口，两条都收起时更好找
    updateSbRestore();
    // 右栏内部的微调区高度
    root.setProperty("--refine-h", clamp(LAYOUT.refine, REFINE_MIN, REFINE_MAX) + "px");
    if (window.JXG && JXG.JSXGraph) { try { window.board && window.board.update(); } catch (e) {} }
    // 3D 画布跟随尺寸
    if (window.HJ && HJ._onResize) HJ._onResize();
  }

  // 右栏内：解答区 / 微调区 的水平分隔拖拽
  function startDragV(ev) {
    ev.preventDefault();
    var panel = $("rightPanel"), refine = $("refine"), split = $("splitV");
    if (!panel || !refine || !split) return;
    var startY = ev.clientY;
    var startH = refine.getBoundingClientRect().height;
    split.classList.add("dragging");
    document.body.classList.add("resizing-v");
    function move(e) {
      // 往上拖 → 微调区变高
      var dy = startY - e.clientY;
      var maxH = panel.getBoundingClientRect().height - 120; // 给解答区至少留 120px
      LAYOUT.refine = clamp(startH + dy, REFINE_MIN, Math.max(REFINE_MIN, Math.min(REFINE_MAX, maxH)));
      document.documentElement.style.setProperty("--refine-h", LAYOUT.refine + "px");
      refine.classList.remove("collapsed");
    }
    function up() {
      split.classList.remove("dragging");
      document.body.classList.remove("resizing-v");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      saveLayout();
      applyLayout();
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  function toggleRefine() {
    var refine = $("refine");
    if (!refine) return;
    refine.classList.toggle("collapsed");
    if (!refine.classList.contains("collapsed")) {
      document.documentElement.style.setProperty("--refine-h", clamp(LAYOUT.refine, REFINE_MIN, REFINE_MAX) + "px");
    }
  }

  function startDrag(which, ev) {
    ev.preventDefault();
    var main = $("main");
    var total = main.getBoundingClientRect().width;
    var startX = ev.clientX;
    var startL = LAYOUT.left, startR = LAYOUT.right;
    var split = which === "left" ? $("splitL") : $("splitR");
    split.classList.add("dragging");
    document.body.classList.add("resizing");

    function move(e) {
      var dx = e.clientX - startX;
      if (which === "left") {
        // 左栏：向左拖变宽
        var max = Math.min(MAX_LEFT, total - LAYOUT.right - MIN_CANVAS);
        LAYOUT.left = clamp(startL + dx, MIN_SIDE, Math.max(MIN_SIDE, max));
        document.documentElement.style.setProperty("--left-w", LAYOUT.left + "px");
      } else {
        // 右栏：向左拖变宽
        var max2 = Math.min(MAX_RIGHT, total - LAYOUT.left - MIN_CANVAS);
        LAYOUT.right = clamp(startR - dx, MIN_SIDE, Math.max(MIN_SIDE, max2));
        document.documentElement.style.setProperty("--right-w", LAYOUT.right + "px");
      }
      if (HJ._onResize) HJ._onResize();
    }
    function up() {
      split.classList.remove("dragging");
      document.body.classList.remove("resizing");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      saveLayout();
      applyLayout();
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  /* =========================================================
     二、对象面板
     ========================================================= */
  var OBJ = { items: [], filter: "all", sel: null, source: null, styleOff: false };

  // JSXGraph 元素 → { key, type, label, value, color, visible }
  function read2D() {
    var out = [];
    var board = window.board;
    if (!board || !board.objects) return out;
    var byName = {};
    for (var k in board.objects) {
      var e = board.objects[k];
      if (!e) continue;
      var t = String(e.elType || "");
      if (t === "text" || t === "image" || t === "label") continue; // 文字/图片不当作几何对象
      if (t === "arc" || t === "curve") continue;                   // 脚本内部的构造残留，用户看不懂
      if (t === "grid") continue;                                   // 自动铺的坐标纸不是几何对象（§72）
      if (t === "slider") continue;                                 // 滑块由「显示控制」区管理
      var name = (e.name == null ? "" : String(e.name)).trim();
      if (!name) continue;
      // JSXGraph 自动命名的对象（a/b/c、P_{a}）不是题目里的对象，跳过
      if (/^[a-z]$/.test(name) || /^P_\{/.test(name)) continue;
      (byName[name] = byName[name] || []).push(e);
    }
    Object.keys(byName).forEach(function (name) {
      var arr = byName[name], e = arr[0];
      var t = String(e.elType || "");
      var vis = true;
      try { vis = !(e.visProp && e.visProp.visible === false); } catch (er) {}
      out.push({
        key: name,
        type: mapType2D(t),
        label: friendlyName(name),
        value: value2D(e, t),
        color: color2D(e),
        visible: vis,
        raw: arr
      });
    });
    return out;
  }
  function mapType2D(t) {
    if (t === "point" || t === "glider" || t === "intersection") return "point";
    if (t === "segment" || t === "line" || t === "arrow" || t === "arc" || t === "curve" || t === "circle" || t === "conic") return "line";
    if (t === "polygon" || t === "angle" || t === "sector" || t === "inequality") return "area";
    return "other";
  }
  function value2D(e, t) {
    try {
      if (t === "point" || t === "glider" || t === "intersection") return "(" + num(e.X()) + ", " + num(e.Y()) + ")";
      if (t === "slider") return num(e.Value()) + " / " + num(e._max || (e.visProp && e.visProp.max));
      if (t === "polygon") { try { return "面积 " + num(e.Area()); } catch (er) { return "多边形"; } }
      if (t === "circle") { try { return "r = " + num(e.Radius()); } catch (er) { return "圆"; } }
      if (t === "angle") { try { return num(e.Value() * 180 / Math.PI, 1) + "°"; } catch (er) { return "角"; } }
      if (t === "segment") return "线段";
      if (t === "line") return "直线";
      if (t === "arrow") return "向量";
      if (t === "midpoint") return "中点";
      return t;
    } catch (er) { return t; }
  }
  function color2D(e) {
    try {
      var c = e.visProp && (e.visProp.strokecolor || e.visProp.fillcolor);
      return c && c !== "none" ? c : "#8b95a1";
    } catch (er) { return "#8b95a1"; }
  }

  function read3D() {
    var out = [];
    var api = window.GGB3D && window.GGB3D.getApi ? window.GGB3D.getApi() : null;
    if (!api || !api.items) return out;
    var byId = api.byId || {};
    // 场景里的 id → 原始定义（用于显示"棱 AB""面 ABCD"这类说明）
    var scene = (window.GGB3D.getScene && window.GGB3D.getScene()) || {};
    var segMap = {}, planeMap = {};
    (scene.segments || []).forEach(function (s) { if (s && s.id) segMap[String(s.id)] = s; });
    (scene.planes || []).forEach(function (p) { if (p && p.id) planeMap[String(p.id)] = p; });

    // id → 图上标签：模型偶尔用英文 id（Obase / sphere_circum），面板要显示成图上的样子
    var ptLabel = {};
    (scene.points || []).forEach(function (q) { if (q && q.id != null) ptLabel[String(q.id)] = String(q.label || q.name || q.id); });
    function nm(id) { var k = String(id == null ? "" : id); return friendlyName(ptLabel[k] || k); }
    function plainTex(x) { try { return texPlain(String(x)); } catch (e) { return String(x); } }

    api.items.forEach(function (it) {
      if (it.id == null) return;
      var key = String(it.id);
      var type = mapType3D(it.type);
      var tt = String(it.type || "");
      var spec = it.spec || {};
      var val = "";
      var label = "";
      if (tt === "sphere") {
        // 球不显示球心坐标（看着像个点），显示半径
        label = "球";
        val = isFinite(spec.radius) ? ("R = " + num(spec.radius)) : "";
      } else if (tt === "circle") {
        label = "圆";
        val = isFinite(spec.radius) ? ("r = " + num(spec.radius)) : "";
      } else if (tt === "dimension") {
        label = "尺寸";
        var dtx = spec.text != null ? plainTex(spec.text) : "";
        var dnm = (spec.from && spec.to) ? (nm(spec.from) + nm(spec.to)) : "";
        val = dnm ? (dnm + (dtx ? " = " + dtx : "")) : dtx;
      } else if (type === "point" && it.objs && it.objs[0] && it.objs[0].position) {
        var p = it.objs[0].position;
        val = "(" + num(p.x) + ", " + num(p.y) + ", " + num(p.z) + ")";
        label = nm(key);                     // 优先用图上的 label，而不是模型起的 id
      } else if (segMap[key]) {
        val = nm(segMap[key].from) + " → " + nm(segMap[key].to);
        label = "棱 " + nm(segMap[key].from) + nm(segMap[key].to);
      } else if (planeMap[key]) {
        var vs = (planeMap[key].vertices || []).map(nm).join("");
        val = vs;
        label = "面 " + vs;
      } else {
        // 没有对应声明：内部 id 一定不直接露给用户
        label = friendlyName(key);
        val = tt === "cylinder" ? "圆柱" : tt === "cone" ? "圆锥"
          : tt === "arc" ? "弧" : tt === "label" ? "标注"
          : tt === "path" ? "轨迹" : tt === "arrow" ? "向量" : "";
      }
      out.push({
        key: key,
        type: type,
        label: label,
        value: val,
        color: type === "point" ? "#5b5bd6" : (type === "area" ? "#12a150" : "#8b95a1"),
        visible: it.vis !== false,
        raw: it
      });
    });
    return out;
  }
  function mapType3D(t) {
    t = String(t || "");
    if (t.indexOf("point") === 0 || t === "sphere") return "point";
    if (t.indexOf("plane") === 0) return "area";
    return "line";
  }

  function renderObjects() {
    var box = $("objList");
    if (!box) return;
    var items = OBJ.items.filter(function (o) { return OBJ.filter === "all" || o.type === OBJ.filter; });
    $("objCount").textContent = String(OBJ.items.length);
    box.innerHTML = "";
    // 选中项若已不在当前对象列表里，清空选中（样式面板随之收起）
    var selOk = false;
    for (var si = 0; si < OBJ.items.length; si++) if (OBJ.items[si].key === OBJ.sel) { selOk = true; break; }
    if (!selOk) OBJ.sel = null;
    if (!items.length) {
      var d = el("div", "empty", OBJ.items.length ? "此分类下没有对象" : "解题后，这里会列出图中的每个几何对象");
      box.appendChild(d);
      renderObjStyle();
      return;
    }
    items.forEach(function (o) {
      var row = el("div", "obj" + (o.visible ? "" : " off") + (OBJ.sel === o.key ? " on" : ""));
      row.dataset.key = o.key;

      var dot = el("span", "cdot" + (o.type === "area" ? " sq" : "") + (o.type === "point" ? "" : ""));
      dot.style.background = o.color;
      row.appendChild(dot);

      row.appendChild(el("span", "nm", o.label));
      row.appendChild(el("span", "df", o.value));

      var eye = el("button", "act");
      eye.innerHTML = icon(o.visible ? "eye" : "eye-off");
      eye.title = o.visible ? "隐藏" : "显示";
      eye.dataset.act = "eye";
      row.appendChild(eye);

      var foc = el("button", "act");
      foc.innerHTML = icon("crosshair");
      foc.title = "定位";
      foc.dataset.act = "focus";
      row.appendChild(foc);

      row.addEventListener("click", function (e) {
        var a = e.target && e.target.dataset && e.target.dataset.act;
        if (a === "eye") { e.stopPropagation(); toggleObject(o); return; }
        if (a === "focus") { e.stopPropagation(); focusObject(o); return; }
        selectObject(o);
      });
      box.appendChild(row);
    });
    renderObjStyle();
  }

  // 选中对象 → 左栏底部「对象样式」滑杆
  // 2D：点大小 / 线宽；3D：小球大小 / 球半径 / 线宽。
  // 改动最终交给 solver.js 落盘（2D 存 style2d，3D 直接改 render3d）。
  function styleSlider(host, label, min, max, step, value, fmt, oninput) {
    var row = el("div", "sld");
    var top = el("div", "sld-top");
    top.appendChild(el("span", "sld-name", label));
    var val = el("span", "sld-val", fmt(value));
    top.appendChild(val); row.appendChild(top);
    var inp = document.createElement("input");
    inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
    inp.oninput = function () { var v = Number(inp.value); val.textContent = fmt(v); try { oninput(v); } catch (e) {} };
    row.appendChild(inp); host.appendChild(row);
    return inp;
  }
  function renderObjStyle() {
    var box = $("objStyle"); if (!box) return;
    box.innerHTML = "";
    if (OBJ.styleOff) return;                                        // 用户点了「−」收起面板
    // 版本预览中不提供改样式（改动会写进不该写的版本）。
    // 但必须给出可见提示，否则用户会以为「滑杆坏了 / 要刷新才恢复」。
    if (window.HJ._styleLocked && window.HJ._styleLocked()) {
      var tip = el("div", "os-head");
      tip.appendChild(el("span", "lbl", "样式"));
      box.appendChild(tip);
      box.appendChild(el("div", "os-note", "正在预览历史版本 — 先「设为当前」或「回到当前」才能调样式"));
      return;
    }
    var o = null;
    for (var i = 0; i < OBJ.items.length; i++) if (OBJ.items[i].key === OBJ.sel) { o = OBJ.items[i]; break; }
    if (!o) return;
    var head = el("div", "os-head");
    head.appendChild(el("span", "lbl", "样式 · " + o.label));
    var hb = el("button", "os-hide", "−");
    hb.type = "button";
    hb.title = "收起样式面板";
    hb.onclick = function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      OBJ.styleOff = true;
      renderObjStyle();
    };
    head.appendChild(hb);
    box.appendChild(head);

    if (OBJ.source === "2d") {
      var e = (o.raw && o.raw[0]) || null; if (!e) return;
      if (o.type === "point") {
        var cur = 2; try { cur = Number(e.visProp && e.visProp.size); } catch (er) {}
        if (!isFinite(cur) || cur <= 0) cur = 2;
        styleSlider(box, "点大小", 1, 12, 0.5, cur, function (v) { return v + " px"; },
          function (v) { window.HJ._style2D(o.key, { size: v }); });
      } else {
        var cw = 1; try { cw = Number(e.visProp && e.visProp.strokewidth); } catch (er2) {}
        if (!isFinite(cw) || cw <= 0) cw = 1;
        styleSlider(box, "线宽", 0.5, 6, 0.5, cw, function (v) { return String(v); },
          function (v) { window.HJ._style2D(o.key, { strokeWidth: v }); });
      }
      return;
    }

    // 3D：样式直接改场景 JSON（spec），所以滑杆读 it.spec 的当前值
    var it = o.raw; if (!it) return;
    var api = (window.GGB3D && window.GGB3D.getApi) ? window.GGB3D.getApi() : null;
    if (!api) return;
    var spec = it.spec || {};
    if (it.type === "sphere") {
      var r0 = Number(spec.radius); if (!isFinite(r0) || r0 <= 0) r0 = 1;
      var rmax = Math.max(2, Math.ceil(r0 * 4) / 2);
      styleSlider(box, "球半径", 0.2, rmax, 0.1, Math.round(r0 * 10) / 10, function (v) { return v.toFixed(1); },
        function (v) { api.setSphereRadius(o.key, v); window.HJ._style3D(); });
    } else if (it.type === "point") {
      var R = Number(api.pointRadius) || 1;
      var curR = Number(spec.size); if (!isFinite(curR) || curR <= 0) curR = R;
      var mult = Math.max(0.1, curR / R), mmax = Math.max(3, Math.ceil(mult * 2 * 10) / 10);
      styleSlider(box, "小球大小", 0.2, mmax, 0.1, Math.round(mult * 10) / 10, function (v) { return v.toFixed(1) + "×"; },
        function (v) { api.setPointSize(o.key, R * v); window.HJ._style3D(); });
    } else if (it.stroke) {
      var w = Number(spec.lineWidth); if (!isFinite(w) || w <= 0) w = 1;
      var wmax = Math.max(4, Math.ceil(w * 2 * 4) / 4);
      styleSlider(box, "线宽", 0.5, wmax, 0.25, w, function (v) { return String(v); },
        function (v) { api.setLineWidth(o.key, v); window.HJ._style3D(); });
    }
  }

  function selectObject(o) {
    OBJ.sel = o.key;
    OBJ.styleOff = false;   // 重新点选元素时，样式面板再次出现
    renderObjects();
    if (OBJ.source === "2d") highlight2D(o.key);
    else focusObject(o);
  }
  // 画布元素悬停 → 左侧对象行高亮 + 自动滚动到该行；同时在画布上高亮元素本身（2D/3D 共用）
  var HOVER = { key: null, source: null };
  function scrollRowIntoView(box, row) {
    try {
      var br = box.getBoundingClientRect(), rr = row.getBoundingClientRect();
      if (rr.top < br.top) box.scrollTop -= (br.top - rr.top) + 6;
      else if (rr.bottom > br.bottom) box.scrollTop += (rr.bottom - br.bottom) + 6;
    } catch (e) {}
  }
  function restoreHover2D() {
    var board = window.board; if (!board || !board.objects) return;
    var any = false;
    for (var k in board.objects) {
      var e = board.objects[k]; if (!e || !e.__hjHover) continue;
      var s = e.__hjHover; e.__hjHover = null; any = true;
      (s.dom || []).forEach(function (d) {
        try { if (d.stroke != null) d.n.setAttribute("stroke", d.stroke); if (d.fill != null) d.n.setAttribute("fill", d.fill); } catch (er) {}
      });
      try { if (s.w != null) e.setAttribute({ strokeWidth: s.w }); } catch (er2) {}
    }
    if (any) { try { board.update(); } catch (er3) {} }
  }
  // 说明：这个改版 JSXGraph 的 setAttribute 换色后不会重绘（宽度/大小会重绘），
  // 所以悬停颜色直接改 SVG 节点的 stroke / fill 属性，移出时按保存值还原。
  function applyHover2D(key) {
    var board = window.board; if (!board || !board.objects) return;
    (o2arr(key) || []).forEach(function (e) {
      try {
        if (!e || !e.setAttribute || e.__hjHover) return;
        if (e.visProp && e.visProp.visible === false) return;
        var t = String(e.elType || "");
        var isPt = (t === "point" || t === "glider" || t === "intersection");
        var saved = [];
        [e.rendNode, e.rendNode2].forEach(function (n) {
          if (!n || !n.getAttribute) return;
          var d = { n: n };
          if (n.getAttribute("stroke") != null) d.stroke = n.getAttribute("stroke");
          if (n.getAttribute("fill") != null) d.fill = n.getAttribute("fill");
          saved.push(d);
          if (d.stroke != null) n.setAttribute("stroke", "#1890ff");
          if (isPt && d.fill != null) n.setAttribute("fill", "#40a9ff");
        });
        e.__hjHover = { dom: saved, w: (e.visProp && e.visProp.strokewidth) };
        if (!isPt) e.setAttribute({ strokeWidth: Math.max(Number(e.visProp && e.visProp.strokewidth) || 1, 3) });
      } catch (er) {}
    });
    try { board.update(); } catch (er) {}
  }
  function restoreHover3D() {
    var api = (window.GGB3D && window.GGB3D.getApi) ? window.GGB3D.getApi() : null; if (!api) return;
    (api.items || []).forEach(function (it) {
      (it.objs || []).forEach(function (o) {
        if (!o || o.__hjHov == null) return;
        try { if (o.material && o.material.color) o.material.color.setHex(o.__hjHov); } catch (er) {}
        o.__hjHov = null;
      });
    });
  }
  function applyHover3D(key) {
    var api = (window.GGB3D && window.GGB3D.getApi) ? window.GGB3D.getApi() : null; if (!api) return;
    var it = api.byId[String(key)]; if (!it) return;
    (it.objs || []).forEach(function (o) {
      if (!o || o.isSprite || !o.material || !o.material.color) return;
      try {
        if (o.__hjHov == null) o.__hjHov = o.material.color.getHex();
        o.material.color.setHex(0x40a9ff);
      } catch (er) {}
    });
  }
  function clearHoverHL() {
    if (HOVER.source === "2d") restoreHover2D();
    else if (HOVER.source === "3d") restoreHover3D();
    HOVER.key = null; HOVER.source = null;
  }
  function setHoverHL(k) {
    if (HOVER.key === k && HOVER.source === OBJ.source) return;
    clearHoverHL();
    HOVER.key = k; HOVER.source = OBJ.source;
    if (!k) return;
    if (OBJ.source === "2d") applyHover2D(k);
    else if (OBJ.source === "3d") applyHover3D(k);
  }
  function hoverObject(key) {
    var box = $("objList"); if (!box) return;
    var k = key == null ? "" : String(key);
    var rows = box.querySelectorAll(".obj"), row = null;
    for (var i = 0; i < rows.length; i++) {
      var on = !!k && rows[i].dataset.key === k;
      rows[i].classList.toggle("hover", on);
      if (on) row = rows[i];
    }
    if (row) scrollRowIntoView(box, row);
    setHoverHL(k || null);
  }
  // 给 JSXGraph 的 SVG 节点挂 hover；refresh2D 每次重建对象时补挂一次
  function bindHover2D() {
    var board = window.board;
    if (!board || !board.objects) return;
    var keys = {};
    (OBJ.items || []).forEach(function (o) { keys[o.key] = true; });
    for (var k in board.objects) {
      var e = board.objects[k];
      if (!e || !e.rendNode) continue;
      var name = String(e.name == null ? "" : e.name).trim();
      if (!name || !keys[name]) continue;
      [e.rendNode, e.rendNode2].forEach(function (node) {
        if (!node || node.__hjHoverName) return;
        node.__hjHoverName = name;
        node.addEventListener("pointerenter", function () { hoverObject(this.__hjHoverName); });
        node.addEventListener("pointerleave", function () { hoverObject(null); });
      });
    }
  }
  function highlight2D(name) {
    var board = window.board;
    if (!board || !board.objects) return;
    for (var k in board.objects) {
      var e = board.objects[k];
      if (!e || !e.setAttribute) continue;
      try {
        if (e.__hjhl) { e.setAttribute({ strokeColor: e.__hjhl.s, strokeWidth: e.__hjhl.w }); e.__hjhl = null; }
      } catch (er) {}
    }
    (o2arr(name) || []).forEach(function (e) {
      try {
        if (e.__hjHover) {
          // 选中接管前，先把悬停改的 DOM 颜色还原（避免移出鼠标后一直是悬停蓝）
          (e.__hjHover.dom || []).forEach(function (d) {
            try { if (d.stroke != null) d.n.setAttribute("stroke", d.stroke); if (d.fill != null) d.n.setAttribute("fill", d.fill); } catch (er2) {}
          });
          e.__hjHover = null;
        }
        if (!e.__hjhl) e.__hjhl = { s: e.visProp && e.visProp.strokecolor, w: e.visProp && e.visProp.strokewidth };
        e.setAttribute({ strokeColor: "#e91e63", strokeWidth: 4 });
      } catch (er) {}
    });
    try { board.update(); } catch (er) {}
  }
  function o2arr(name) {
    var board = window.board;
    if (!board || !board.objects) return [];
    var out = [];
    for (var k in board.objects) {
      var e = board.objects[k];
      if (e && String(e.name || "").trim() === name) out.push(e);
    }
    return out;
  }
  function toggleObject(o) {
    var v = !o.visible;
    if (OBJ.source === "2d") {
      (o.raw || []).forEach(function (e) { try { e.setAttribute({ visible: v }); } catch (er) {} });
      try { window.board.update(); } catch (er) {}
    } else {
      var api = window.GGB3D && window.GGB3D.getApi ? window.GGB3D.getApi() : null;
      if (api && o.raw) api.setVisible(o.raw, v);
    }
    o.visible = v;
    renderObjects();
  }
  // 「显示全部元素」：把三个维度（显示控制开关 / 小题范围 / 步骤进度）和逐对象显隐一起归位。
  // 不硬把模型自己设成 visible:false 的元素翻出来——视图层有账本（VIEW.hid2d/hid3d），
  // applyView 恢复时按"隐藏前的原始可见性"来，这里只负责清掉用户造成的隐藏。
  function resetAllVisible() {
    window.HJ._ctlHidden = {};
    var host = $("ctlHost");
    if (host) Array.prototype.forEach.call(host.querySelectorAll(".sw"), function (r) { r.classList.add("on"); });
    (OBJ.items || []).forEach(function (o) {
      if (o.visible) return;
      o.visible = true;
      if (OBJ.source === "2d") {
        (o.raw || []).forEach(function (e) { try { e.setAttribute({ visible: true }); } catch (er) {} });
      } else {
        var api = window.GGB3D && window.GGB3D.getApi ? window.GGB3D.getApi() : null;
        if (api && o.raw) api.setVisible(o.raw, true);
      }
    });
    if (OBJ.source === "2d") { try { window.board.update(); } catch (e) {} }
    setSubScope([], []);   // 小题范围 + 步骤进度归位；内部会 applyView()
    try { renderObjects(); } catch (e) {}
    try { toast("已显示全部元素"); } catch (e) {}
  }
  function focusObject(o) {    if (OBJ.source === "2d") {
      var els = o.raw || [];
      var board = window.board;
      if (!board || !els.length) return;
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, any = false;
      els.forEach(function (e) {
        try {
          var b = e.bounds();
          if (b && isFinite(b[0])) { any = true; minX = Math.min(minX, b[0], b[2]); maxX = Math.max(maxX, b[0], b[2]); minY = Math.min(minY, b[1], b[3]); maxY = Math.max(maxY, b[1], b[3]); }
        } catch (er) {}
      });
      if (!any) return;
      var padX = Math.max((maxX - minX) * 0.6, 0.8), padY = Math.max((maxY - minY) * 0.6, 0.8);
      try { board.setBoundingBox([minX - padX, maxY + padY, maxX + padX, minY - padY]); board.update(); } catch (er) {}
      highlight2D(o.key);
    } else if (window.GGB3D && window.GGB3D.focus) {
      try { window.GGB3D.focus({ target: o.key }); } catch (er) {}
    }
  }

  /* =========================================================
     三、步骤条（2D/3D 共用）
     ========================================================= */
  var STEPS = { items: [], cur: -1, playing: false, timers: [], onApply: null, onHighlight: null };

  function buildSteps(items, opts) {
    STEPS.items = items || [];
    STEPS.cur = -1;
    stopPlay();
    var bar = $("stepbar");
    if (!STEPS.items.length) { if (bar) bar.classList.remove("show"); return; }
    if (!bar) return;
    bar.classList.add("show");
    updateStepBar();
  }
  function updateStepBar() {
    var bar = $("stepbar");
    if (!bar) return;
    var n = STEPS.items.length, c = STEPS.cur;
    var idxEl = bar.querySelector(".idx");
    if (idxEl) idxEl.textContent = (c < 0 ? "全部" : (c + 1) + " / " + n);
    var s = c >= 0 ? STEPS.items[c] : null;
    var ttl = bar.querySelector(".ttl");
    if (ttl) {
      var tt = s ? (s.title || "") : "";
      // 标题里可能带 $...$（如「两个夹角 $\alpha,\beta$」）：有 LaTeX 就走 KaTeX，否则纯文本
      if (tt && /[\\$]/.test(tt) && window.mathHTML) ttl.innerHTML = window.mathHTML(tt);
      else ttl.textContent = texPlain(tt);
    }
    var pv = bar.querySelector("[data-act=prev]"), nx = bar.querySelector("[data-act=next]");
    if (pv) pv.disabled = (c <= -1);
    if (nx) nx.disabled = (c >= n - 1);
    var desc = $("stepdesc");
    if (desc) {
      var html = s ? (window.mathHTML ? window.mathHTML(s.description || "") : (s.description || "")) : "";
      desc.innerHTML = html;
      if (!html) desc.classList.remove("show");
    }
  }
  function setStep(k) {
    stopPlay();
    STEPS.cur = k;
    if (STEPS.onApply) STEPS.onApply(k);
    if (STEPS.onHighlight) STEPS.onHighlight(k);
    updateStepBar();
  }
  function stopPlay() {
    STEPS.timers.forEach(clearTimeout); STEPS.timers = []; STEPS.playing = false;
    var b = $("stepbar");
    if (b) { var p = b.querySelector(".play"); if (p) p.innerHTML = icon("play") + "播放"; }
  }
  function playSteps() {
    if (STEPS.playing) { stopPlay(); return; }
    stopPlay();
    STEPS.playing = true;
    var b = $("stepbar"); if (b) b.querySelector(".play").innerHTML = icon("pause") + "暂停";
    var acc = 0, tl = STEPS.items;
    tl.forEach(function (s, i) {
      var d = (s && s.durationMs) || 1500;
      STEPS.timers.push(setTimeout(function () {
        STEPS.cur = i;
        if (STEPS.onApply) STEPS.onApply(i);
        if (STEPS.onHighlight) STEPS.onHighlight(i);
        updateStepBar();
        if (i === tl.length - 1) { STEPS.playing = false; var p = $("stepbar").querySelector(".play"); if (p) p.innerHTML = icon("play") + "播放"; }
      }, acc));
      acc += d;
    });
  }

  /* =========================================================
     四、测量卡
     ========================================================= */
  function setMeasure(list) {
    var box = $("measure");
    if (!box) return;
    box.innerHTML = "";
    MEASURE_ALL = (list || []).slice();
    var show = measureVisible(MEASURE_ALL);
    if (!show.length) { box.style.display = "none"; return; }
    show.forEach(function (m) {
      var row = el("div", "m");
      if (m.color) { var d = el("span", "dot"); d.style.background = m.color; row.appendChild(d); }
      var lab = el("span", null, (m.label || "") + " ");
      row.appendChild(lab);
      var b = el("b", null, m.text || "");
      row.appendChild(b);
      box.appendChild(row);
    });
    box.style.display = "block";
  }
  // 读数跟着元素走：元素被本小问隐藏了，它的测量行也一起收起来，
  // 否则会出现"图上没有 H，右上角还写着 H = (2.00, 2.00)"。
  function measureVisible(list) {
    if (!VIEW.scope) return list;
    return (list || []).filter(function (m) {
      var n = m && m.scopeName ? String(m.scopeName) : "";
      return !n || !!VIEW.scope[n];
    });
  }
  function refreshMeasure() { if (MEASURE_ALL && MEASURE_ALL.length) setMeasure(MEASURE_ALL); }
  // 测量对象 → 它归属的图元名（首轮算好后一直复用，轮询不重算）
  var MEAS_SCOPE = [];
  function MEAS_SCOPE_OF(e) {
    for (var i = 0; i < MEAS_SCOPE.length; i++) if (MEAS_SCOPE[i].raw === e) return MEAS_SCOPE[i].n;
    return "";
  }

  /* =========================================================
     五、脚本自带 DOM 浮层收纳（B 方案兼容层）
     老 renderCode 会往画布塞按钮；统一收进底部一条，避免与新 UI 打架。
     ========================================================= */
  function extractScriptUI(host) {
    if (!host) return;
    var wrap = $("scriptUi");
    if (!wrap) return;
    wrap.innerHTML = "";
    var found = [];
    // 脚本常把按钮容器 append 到 #ggb-canvas 里，也可能是 #canvasHost 的直接子元素
    var scope = host.querySelector("#ggb-canvas") || host;
    Array.prototype.slice.call(scope.querySelectorAll("div")).forEach(function (c) {
      if (!c || c.id === "ggb-canvas" || c.tagName === "svg") return;
      if (!c.querySelector || !c.querySelector("button")) return;
      if (c.closest("#scriptUi")) return;
      if (c.__hjTaken) return;
      found.push(c);
    });
    if (!found.length) return;
    var bar = wrap.querySelector(".legacybar");
    if (!bar) { bar = el("div", "legacybar"); wrap.appendChild(bar); }
    found.forEach(function (n) {
      n.__hjTaken = true;
      Array.prototype.slice.call(n.querySelectorAll("button")).forEach(function (b) {
        var nb = el("button", null, b.textContent);
        nb.onclick = function () { try { b.click(); } catch (e) {} };
        bar.appendChild(nb);
      });
      n.style.display = "none"; // 原浮层隐藏
    });
  }

  /* =========================================================
     六、工具栏 / 欢迎页 / 状态栏
     ========================================================= */
  var _bbox0 = null;   // 2D 初始视图
  var _3dInit = null;  // 3D 初始相机

  function resetView() {
    if (OBJ.source === "2d" && window.board && _bbox0) {
      try { window.board.setBoundingBox(_bbox0.slice()); window.board.update(); } catch (e) {}
    } else if (window.GGB3D && window.GGB3D.resetView) {
      try { window.GGB3D.resetView(); } catch (e) {}
    }
  }
  function focusAnswer() {
    var ft = (HJ._focusTargets || [])[0];
    if (!ft) return;
    if (window.HJ && HJ._locate) HJ._locate(ft);
  }
  function toggleFull() {
    if (!document.fullscreenElement) {
      var s = $("stage");
      (s.requestFullscreen || function () {}).call(s);
    } else { document.exitFullscreen(); }
  }

  function showWelcome(on) {
    var w = $("welcome");
    if (w) w.classList.toggle("hidden", !on);
  }

  function notify(text) {
    var s = $("status");
    if (s) s.textContent = text;
  }

  /* ---- 轻提示（toast）：用于导入/导出等需要明确回执又不想被状态栏覆盖的场景 ---- */
  var _toastTimer = null;
  function toast(text, kind, ms) {
    var host = $("toastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "toastHost";
      document.body.appendChild(host);
    }
    host.innerHTML = "";
    var t = el("div", "toast" + (kind ? " " + kind : ""));
    t.innerHTML = icon(kind === "bad" ? "x" : "check", "ico-sm") + "<span>" + text + "</span>";
    host.appendChild(t);
    // 触发进入动画
    requestAnimationFrame(function () { t.classList.add("in"); });
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      t.classList.remove("in");
      setTimeout(function () { if (host) host.innerHTML = ""; }, 220);
    }, ms || 3200);
    return t;
  }

  // 状态栏里的「面板已收起」恢复入口
  function updateSbRestore() {
    var host = $("sbRestore");
    if (!host) return;
    host.innerHTML = "";
    var any = LAYOUT.leftCollapsed || LAYOUT.rightCollapsed;
    host.classList.toggle("show", any);
    if (!any) return;
    var mk = function (label, iconName, fn) {
      var b = el("button", "sb-restore");
      b.innerHTML = icon(iconName, "ico-sm") + label;
      b.onclick = fn;
      host.appendChild(b);
    };
    if (LAYOUT.leftCollapsed) mk("对象面板", "panel-left-open", function () { LAYOUT.leftCollapsed = false; saveLayout(); applyLayout(); });
    if (LAYOUT.rightCollapsed) mk("解答栏", "panel-right-open", function () { LAYOUT.rightCollapsed = false; saveLayout(); applyLayout(); });
  }

  /* =========================================================
     七、对外接口
     ========================================================= */
  var HJ = window.HJ = {
    layout: LAYOUT,
    applyLayout: applyLayout,

    /* --- 2D --- */
    afterRender2D: function (result) {
      OBJ.source = "2d";
      _bbox0 = null;
      try { if (window.board) _bbox0 = window.board.getBoundingBox().slice(); } catch (e) {}
      VIEW.hid2d = {};            // 新一次渲染：上一张图记下的「隐藏前状态」全部作废
      refresh2D();
      HJ._focusTargets = (result && result.focusTargets) || [];
      // 步骤
      var steps = (result && result.steps) || [];
      // targets/elements 要留着：视图层按步骤算「此刻该出现哪些元素」
      buildSteps(steps.map(function (s) { return { title: s.title, description: s.description, durationMs: s.durationMs, targets: s.targets, elements: s.elements }; }), null);
      STEPS.onApply = function (k) { applyStep2D(k, steps); };
      STEPS.onHighlight = null;
      // 测量（搬到 UI 卡，并隐藏画布上的重复文字）
      var ms = readMeasure2D(result);
      MEASURED = ms.map(function (m) { return m.raw; }).filter(Boolean);
      setMeasure(ms);
      hideMeasuredTexts();
      // 快捷开关（含脚本自带的滑块）
      renderControls(buildControls(result));
      // 脚本自带浮层
      extractScriptUI($("canvasHost"));
      showWelcome(false);
      startMeasureLoop();
    },
    refresh2D: refresh2D,

    /* --- 3D --- */
    afterRender3D: function (scene) {
      OBJ.source = "3d";
      _bbox0 = null;
      VIEW.hid3d = {};
      var api = window.GGB3D && window.GGB3D.getApi ? window.GGB3D.getApi() : null;
      refresh3D();
      HJ._focusTargets = (scene && scene.focusTargets) || [];
      buildSteps3D(scene, api);
      setMeasure([]);
      // 3D 的滑块同样搬进左栏
      renderControls(buildControls3D(scene));
      showWelcome(false);
    },
    refresh3D: refresh3D,

    clearScene: function () {
      clearHoverHL();
      OBJ.items = []; OBJ.sel = null; renderObjects();
      buildSteps([], null);
      setMeasure([]);
      MEASURED = [];
      stopMeasureLoop();
      renderControls([]);
      var b = $("stepbar"); if (b) b.classList.remove("show");
      var d = $("stepdesc"); if (d) { d.classList.remove("show"); d.innerHTML = ""; }
      var w = $("scriptUi"); if (w) w.innerHTML = "";
      VIEW.scope = null; VIEW.union = null; VIEW.hid2d = {}; VIEW.hid3d = {};
      showWelcome(true);
    },

    // 小题切换：cur = 本问需要的元素（空/缺省则不限，退回全显）
    // all = 所有小问 target 的并集，只有并集里的元素才允许被本维度隐藏
    setSubScope: function (cur, all) { setSubScope(cur, all); },
    setView: function () { applyView(); },
    _measureAll: function () {
      return MEASURE_ALL.map(function (m) { return { label: m.label, text: m.text, scopeName: m.scopeName || "" }; });
    },

    showWelcome: showWelcome,
    notify: notify,
    toast: toast,
    setMeasure: setMeasure,
    setSteps: buildSteps,
    hoverObject: hoverObject,
    _friendly: friendlyName,
    _icon: icon,
    _locate: function (ft) {
      // 交给 solver.js 的 locate（它知道 2D/3D 差异）
      if (window.HJ._locateImpl) return HJ._locateImpl(ft);
    },
    _locateImpl: null,
    _onResize: null
  };

  /* =========================================================
     视图层：小题范围 ∩ 步骤进度 ∩ 显示开关
     三个维度都想控制同一个元素的显隐，所以统一在这里算一次，
     避免各自 set 一遍互相覆盖。只还原「本层隐藏过」的元素：
     脚本自己设成 visible:false 的对象不碰，测量文字也不碰。
     ========================================================= */
  var VIEW = { scope: null, union: null, hid2d: {}, hid3d: {} };
  var MEASURED = [];
  var MEASURE_ALL = [];

  // 当前步骤下：哪些元素被步骤引用过（ref）、哪些已经该出现（shown）
  function stepState() {
    var ref = {}, shown = {}, k = STEPS.cur, items = STEPS.items || [];
    for (var i = 0; i < items.length; i++) {
      var ts = stepTargets(items[i]);
      for (var j = 0; j < ts.length; j++) {
        ref[ts[j]] = true;
        if (k >= 0 && i <= k) shown[ts[j]] = true;
      }
    }
    return { ref: ref, shown: shown, k: k };
  }
  // 本元素的原始可见性（在第一次隐藏前记录，恢复时用它而不是硬写 true）
  function origVisible2D(name) {
    var v = false;
    o2arr(name).forEach(function (e) {
      try { if (!(e.visProp && e.visProp.visible === false)) v = true; } catch (er) {}
    });
    return v;
  }
  function ctlHiddenOf() { return (window.HJ && window.HJ._ctlHidden) || {}; }

  function want2D() {
    var st = stepState(), want = {}, n;
    var ctl = ctlHiddenOf();
    for (n in ctl) want[n] = true;                                  // 开关手动隐藏
    if (VIEW.scope) for (n in (VIEW.union || {})) { if (!VIEW.scope[n]) want[n] = true; }  // 不属于本小问
    if (st.k >= 0) for (n in st.ref) { if (!st.shown[n]) want[n] = true; }                 // 步骤还没走到
    // 测量文字由测量卡统一管，视图层不碰
    (MEASURED || []).forEach(function (e) {
      var nm = e && e.name ? String(e.name).trim() : "";
      if (nm) delete want[nm];
    });
    return want;
  }

  function applyView2D() {
    var board = window.board;
    if (!board || !board.objects) return;
    var want = want2D();
    Object.keys(want).forEach(function (n) {
      if (!(n in VIEW.hid2d)) VIEW.hid2d[n] = origVisible2D(n);
      setVisible2D(n, false);
      // 隐藏只是不画，几何约束还在：动点会变成"看不见但能拖"的幽灵手柄。
      // 顺手把它固定住，恢复可见时再放开。
      o2arr(n).forEach(function (e) {
        if (!e || !e.setAttribute) return;
        try {
          var t = String(e.elType || "");
          if (t !== "glider" && t !== "point" && t !== "intersection") return;
          if (e.__hjFix === undefined) e.__hjFix = (e.visProp && e.visProp.fixed) ? 1 : 0;
          if (!e.__hjFix) e.setAttribute({ fixed: true });
        } catch (er) {}
      });
    });
    Object.keys(VIEW.hid2d).forEach(function (n) {
      if (want[n]) return;
      var back = VIEW.hid2d[n];
      delete VIEW.hid2d[n];
      if (back) setVisible2D(n, true);
      o2arr(n).forEach(function (e) {
        try { if (e && e.__hjFix === 0) e.setAttribute({ fixed: false }); } catch (er) {}
      });
    });
    try { board.update(); } catch (e) {}
  }

  function applyView3D() {
    var api = window.GGB3D && window.GGB3D.getApi ? window.GGB3D.getApi() : null;
    if (!api || !api.byId) return;
    var st = stepState(), want = {}, n, sref = api.stepEls || {};
    var ctl = ctlHiddenOf();
    for (n in ctl) want[n] = true;                                                          // 开关手动隐藏
    if (VIEW.scope) for (n in (VIEW.union || {})) { if (!VIEW.scope[n]) want[n] = true; }    // 不属于本小问
    if (st.k >= 0) for (n in sref) { if (!st.shown[n]) want[n] = true; }                     // 步骤还没走到
    Object.keys(want).forEach(function (id) {
      var it = api.byId[id]; if (!it) return;
      if (!(id in VIEW.hid3d)) VIEW.hid3d[id] = it.vis !== false;
      api.setVisible(it, false);
    });
    Object.keys(VIEW.hid3d).forEach(function (id) {
      if (want[id]) return;
      var it = api.byId[id], back = VIEW.hid3d[id];
      delete VIEW.hid3d[id];
      if (it) api.setVisible(it, back);
    });
  }

  function applyView() {
    if (OBJ.source === "3d") applyView3D(); else applyView2D();
    // 显隐变了，左侧对象面板和右上测量卡都要跟着走，否则会留下列表里/卡片上"看不见的数据"
    try { refreshMeasure(); } catch (e) {}
    try { OBJ.items = (OBJ.source === "3d") ? read3D() : read2D(); renderObjects(); } catch (e2) {}
  }

  // 切小题时调用：cur 是本问白名单（空 = 不限，退回全显），all 是所有小问的并集
  function setSubScope(cur, all) {
    // 步骤是小问内部的进度，跨问不该沿用：切小题一律归位到「全部」
    if (STEPS.cur !== -1) {
      STEPS.cur = -1;
      stopPlay();
      updateStepBar();
      // 步骤的高亮是加在图元上的颜色，归位时也要一起撤掉
      try {
        var bd = window.board;
        for (var kk in bd.objects) {
          var el2 = bd.objects[kk];
          if (el2 && el2.__hjhl && el2.setAttribute) {
            el2.setAttribute({ strokeColor: el2.__hjhl.s, strokeWidth: el2.__hjhl.w });
            el2.__hjhl = null;
          }
        }
      } catch (e3) {}
      if (OBJ.source === "3d" && window.GGB3D && window.GGB3D.getApi) {
        try { window.GGB3D.getApi().clearHighlight(); } catch (e4) {}
      }
    }
    VIEW.union = null;
    if (all && all.length) {
      VIEW.union = {};
      all.forEach(function (t) { VIEW.union[String(t)] = true; });
    }
    VIEW.scope = null;
    if (cur && cur.length) {
      VIEW.scope = {};
      cur.forEach(function (t) { VIEW.scope[String(t)] = true; });
    }
    // 注意：不能清 VIEW.hid2d/hid3d——那是「被我隐藏过、原始状态是什么」的账本，
    // 清掉就再也还原不回来了。新渲染时才作废。
    applyView();
  }

  /* ---- 2D 步骤应用 ---- */
  function applyStep2D(k, steps) {
    var board = window.board;
    if (!board || !board.objects) return;
    STEPS.cur = k;
    applyView2D();
    // 高亮
    for (var kk in board.objects) {
      var e = board.objects[kk];
      if (!e || !e.setAttribute) continue;
      try {
        if (e.__hjhl) { e.setAttribute({ strokeColor: e.__hjhl.s, strokeWidth: e.__hjhl.w }); e.__hjhl = null; }
      } catch (er) {}
    }
    if (k >= 0) (stepTargets(steps[k]) || []).forEach(function (n) {
      o2arr(n).forEach(function (e) {
        try {
          if (!e.__hjhl) e.__hjhl = { s: e.visProp && e.visProp.strokecolor, w: e.visProp && e.visProp.strokewidth };
          e.setAttribute({ strokeColor: "#e91e63", strokeWidth: 4 });
        } catch (er) {}
      });
    });
    try { board.update(); } catch (er) {}
    refresh2D();
  }
  function stepTargets(s) {
    if (!s) return [];
    if (Array.isArray(s.targets)) return s.targets.filter(Boolean).map(String);
    if (Array.isArray(s.elements)) return s.elements.map(function (e) { return e && (e.targetId || e.target); }).filter(Boolean).map(String);
    return [];
  }
  function setVisible2D(name, v) {
    o2arr(name).forEach(function (e) { try { e.setAttribute({ visible: v }); } catch (er) {} });
  }

  /* ---- 2D 实时测量 ---- */
  // 脚本里的测量文字对象（board.create('text', ...)）有两种处理：
  //  1) 内容能被解析成"名称 + 数值"的 → 搬到 UI 层的测量卡，画布上隐藏；
  //  2) 解析不了的 → 原样保留在画布上（不破坏老脚本的表现）。
  function readMeasure2D() {
    var out = [];
    var board = window.board;
    if (!board || !board.objects) return out;
    // 滑块自带的标签（"F位置% = 45"）不是测量读数，排除掉
    var sliderLabels = {};
    try {
      for (var sk in board.objects) {
        var se = board.objects[sk];
        if (se && String(se.elType) === "slider" && se.label) sliderLabels[se.label.id] = true;
      }
    } catch (er) {}
    for (var k in board.objects) {
      var e = board.objects[k];
      if (!e || String(e.elType) !== "text") continue;
      if (sliderLabels[e.id]) continue;
      var txt = "";
      try { txt = String(e.plaintext || ""); } catch (er) {}
      if (!txt) { try { txt = String((e.visProp && e.visProp.text) || ""); } catch (er) {} }
      txt = txt.trim();
      if (!txt || txt.length > 40) continue;
      // 只认"含等号 + 数字 + 角度/长度符号"的读数；答案文字（含 LaTeX 的 $）一律不收
      // 也要排除已被 applyTex2D 转成 KaTeX HTML 的文本，否则整段标记会被当成读数
      if (txt.indexOf("$") >= 0) continue;
      if (/[<>]/.test(txt) || /katex/.test(txt)) continue;
      if (!/[=:：]/.test(txt)) continue;
      if (!/[\d]/.test(txt)) continue;
      if (!/[°∠π]|^\s*\S+\s*[=:：]\s*[\d.]+\s*$/.test(txt)) continue;
      var col = "#5b5bd6";
      try { col = (e.visProp && e.visProp.color) || col; } catch (er) {}
      var m = txt.match(/^(.*?)[=:：]\s*(.+)$/);
      // 读数归属：文字里提到的图元名（M、AH、∠AHC 里的 AHC…）决定它属于哪个小问。
      // 没提到任何已知名字就不归属（任何小问都显示）。
      var nm = "";
      try {
        var names = [];
        for (var nk in board.objects) {
          var ne = board.objects[nk];
          var nn = (ne && ne.name == null ? "" : String(ne.name || "")).trim();
          if (nn && nn.length >= 1 && nn.length <= 6) names.push(nn);
        }
        names.sort(function (a, b) { return b.length - a.length; });
        var head = (m ? m[1] : txt) + " " + (m ? m[2] : "");
        for (var q = 0; q < names.length; q++) {
          if (head.indexOf(names[q]) >= 0) { nm = names[q]; break; }
        }
      } catch (er2) {}
      MEAS_SCOPE.push({ raw: e, n: nm });
      out.push({ label: m ? m[1].trim() : "", text: m ? m[2].trim() : txt, color: col, raw: e, scopeName: nm });
      if (out.length >= 4) break;
    }
    return out;
  }
  // 把已搬到测量卡的脚本文字对象隐藏掉（画布上不再重复显示）
  function hideMeasuredTexts() {
    (MEASURED || []).forEach(function (e) {
      try { if (e.setAttribute) e.setAttribute({ visible: false }); } catch (er) {}
    });
    try { if (window.board) window.board.update(); } catch (er) {}
  }

  /* ---- 测量实时刷新（每 500ms 重读脚本里的动态文字） ---- */
  var _measTimer = null;
  function startMeasureLoop() {
    stopMeasureLoop();
    if (!MEASURED.length) return;
    _measTimer = setInterval(function () {
      if (!MEASURED.length) { stopMeasureLoop(); return; }
      var out = [];
      MEASURED.forEach(function (e) {
        var txt = "";
        try { txt = String(e.plaintext || ""); } catch (er) {}
        txt = txt.trim();
        if (!txt) return;
        var m = txt.match(/^(.*?)[=:：]\s*(.+)$/);
        var col = "#5b5bd6";
        try { col = (e.visProp && e.visProp.color) || col; } catch (er) {}
        // 归属要沿用首轮算好的：轮询只更新数值，不能把 scopeName 冲掉，
        // 否则每次刷新后测量卡都会重新显示本小问已经隐藏的元素读数。
        out.push({ label: m ? m[1].trim() : "", text: m ? m[2].trim() : txt, color: col, raw: e, scopeName: MEAS_SCOPE_OF(e) });
        try { e.setAttribute({ visible: false }); } catch (er) {}
      });      setMeasure(out);
    }, 500);
  }
  function stopMeasureLoop() { if (_measTimer) { clearInterval(_measTimer); _measTimer = null; } }

  /* ---- 快捷开关（controls + 脚本自带的滑块） ---- */
  // 老脚本把滑块画在画布坐标里；B 方案下改为 UI 层的滑块控件。
  var SLIDERS = [];
  function buildControls(result) {
    var list = ((result && result.controls) || []).slice();
    SLIDERS = [];
    var board = window.board;
    if (board && board.objects) {
      for (var k in board.objects) {
        var e = board.objects[k];
        if (!e || String(e.elType) !== "slider") continue;
        var nm = (e.name == null ? "" : String(e.name)).trim();
        if (!nm) continue;
        SLIDERS.push(e);
        try { e.setAttribute({ visible: false }); } catch (er) {}
      }
      if (SLIDERS.length) {
        list.push({ label: "", type: "sliders", sliders: SLIDERS });
      }
      try { board.update(); } catch (er) {}
    }
    return list;
  }

  // 3D 的滑块来自场景 JSON（sliders 字段）
  function buildControls3D(scene) {
    var list = [];
    var api = window.GGB3D && window.GGB3D.getApi ? window.GGB3D.getApi() : null;
    var sl = (api && api.sliders) || [];
    if (sl.length) list.push({ label: "", type: "sliders3d", sliders: sl });
    return list;
  }

  function renderControls(controls) {
    var host = $("ctlHost");
    if (!host) return;
    host.innerHTML = "";
    window.HJ._ctlHidden = window.HJ._ctlHidden || {};
    if (!controls || !controls.length) return;
    host.appendChild(el("div", "lbl", "显示控制"));

    // 应用某个开关（初始状态与点击共用同一套逻辑）
    // 只改状态，真正的显隐交给视图层算：开关 ∩ 小题范围 ∩ 步骤进度
    function applyCtl(ctl, v) {
      (ctl.targets || []).forEach(function (n) {
        n = String(n);
        if (v) delete window.HJ._ctlHidden[n]; else window.HJ._ctlHidden[n] = true;
      });
      applyView();
    }

    controls.forEach(function (ctl) {
      if (ctl.type === "sliders") { renderSliders(host, ctl.sliders || []); return; }
      if (ctl.type === "sliders3d") { renderSliders3D(host, ctl.sliders || []); return; }
      var on = ctl.default !== false;
      var row = el("div", "sw" + (on ? " on" : ""));
      row.appendChild(el("span", "track"));
      row.appendChild(el("span", null, texPlain(ctl.label || "显示")));
      applyCtl(ctl, on); // ← 初始状态立即生效（default:false 的辅助线一开始就隐藏）
      row.addEventListener("click", function () {
        var v = !row.classList.contains("on");
        row.classList.toggle("on", v);
        applyCtl(ctl, v);
        if (OBJ.source === "2d") refresh2D(); else refresh3D();
      });
      host.appendChild(row);
    });
  }

  function renderSliders(host, sliders) {    if (!sliders.length) return;
    // 「复位」要记住每个滑块渲染时的初始值（JSXGraph 的滑块没有 defaultValue 字段）
    var items = [];
    var head = el("div", "lbl sld-head");
    head.appendChild(el("span", null, "参数"));
    var resetBtn = document.createElement("button");
    resetBtn.type = "button"; resetBtn.className = "sld-reset";
    resetBtn.innerHTML = '<svg class="ico-sm"><use href="#i-refresh-cw"/></svg>';
    resetBtn.title = "把所有参数恢复到初始值";
    head.appendChild(resetBtn);
    host.appendChild(head);
    sliders.forEach(function (s) {
      var nm = String(s.name || "").trim();
      var row = el("div", "sld");
      var top = el("div", "sld-top");
      top.appendChild(el("span", "sld-name", texPlain(nm)));
      var val = el("span", "sld-val", "");
      top.appendChild(val);
      row.appendChild(top);
      var inp = document.createElement("input");
      inp.type = "range";
      var mn = 0, mx = 100, st = 0.1, cur = 0;
      try {
        var bb = s.getBoundingBox ? s.getBoundingBox() : null;
        cur = Number(s.Value());
        // JSXGraph 滑块的取值范围在 _min/_max 上
        mn = (s._min != null) ? Number(s._min) : 0;
        mx = (s._max != null) ? Number(s._max) : 100;
        st = (s._snapWidth != null && s._snapWidth > 0) ? Number(s._snapWidth) : ((mx - mn) / 100);
      } catch (er) {}
      if (!isFinite(mn)) mn = 0;
      if (!isFinite(mx) || mx <= mn) mx = mn + 100;
      if (!isFinite(st) || st <= 0) st = (mx - mn) / 100;
      inp.min = mn; inp.max = mx; inp.step = st; inp.value = cur;
      val.textContent = fmtNum(cur);
      inp.oninput = function () {
        var v = Number(inp.value);
        try { s.setValue(v); } catch (er) {}
        try { window.board.update(); } catch (er) {}
        val.textContent = fmtNum(v);
      };
      row.appendChild(inp);
      host.appendChild(row);
      items.push({ s: s, inp: inp, val: val, init: cur });
    });
    resetBtn.addEventListener("click", function () {
      items.forEach(function (it) {
        try { it.s.setValue(it.init); } catch (er) {}
        it.inp.value = it.init;
        it.val.textContent = fmtNum(it.init);
      });
      try { window.board.update(); } catch (er) {}
      try { if (window.HJ && window.HJ._afterSliderReset) window.HJ._afterSliderReset(); } catch (er) {}
    });
  }
  function fmtNum(v) {
    if (!isFinite(v)) return "—";
    var n = Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return n;
  }

  // 3D 滑块（render3d.js 的 slider 对象：{id,min,max,step,value,defaultValue,label}）
  function renderSliders3D(host, sliders) {
    if (!sliders.length) return;
    var items = [];
    var head = el("div", "lbl sld-head");
    head.appendChild(el("span", null, "参数"));
    var resetBtn = document.createElement("button");
    resetBtn.type = "button"; resetBtn.className = "sld-reset";
    resetBtn.innerHTML = '<svg class="ico-sm"><use href="#i-refresh-cw"/></svg>';
    resetBtn.title = "把所有参数恢复到初始值";
    head.appendChild(resetBtn);
    host.appendChild(head);
    sliders.forEach(function (s) {
      var row = el("div", "sld");
      var top = el("div", "sld-top");
      top.appendChild(el("span", "sld-name", texPlain(s.label || s.id || "参数")));
      var val = el("span", "sld-val", fmtNum(Number(s.value)));
      top.appendChild(val);
      row.appendChild(top);
      var inp = document.createElement("input");
      inp.type = "range";
      inp.min = Number(s.min) || 0; inp.max = Number(s.max) || 1;
      inp.step = Number(s.step) || 0.01; inp.value = Number(s.value) || 0;
      inp.oninput = function () {
        s.value = Number(inp.value);
        val.textContent = fmtNum(s.value);
        var api = window.GGB3D && window.GGB3D.getApi ? window.GGB3D.getApi() : null;
        if (api && api.refresh) api.refresh();
        refresh3D();
      };
      row.appendChild(inp);
      host.appendChild(row);
      var dv = (s.defaultValue != null) ? Number(s.defaultValue) : Number(s.value);
      items.push({ s: s, inp: inp, val: val, init: dv });
    });
    resetBtn.addEventListener("click", function () {
      items.forEach(function (it) {
        it.s.value = it.init;
        it.inp.value = it.init;
        it.val.textContent = fmtNum(it.init);
      });
      var api = window.GGB3D && window.GGB3D.getApi ? window.GGB3D.getApi() : null;
      if (api && api.refresh) api.refresh();
      refresh3D();
    });
  }

  /* ---- 3D 步骤/滑块/多图 ---- */
  function buildSteps3D(scene, api) {
    var steps = (scene && scene.steps) || [];
    if (!steps.length) { buildSteps([], null); return; }
    buildSteps(steps.map(function (s) { return { title: s.title, description: s.description, durationMs: (scene.timeline || []).filter(function (t) { return t.stepId === s.id; })[0] && (scene.timeline || []).filter(function (t) { return t.stepId === s.id; })[0].durationMs, elements: s.elements }; }), null);
    STEPS.onApply = function (k) {
      if (!api) return;
      STEPS.cur = k;
      applyView3D();          // 显隐统一交给视图层（小题范围 ∩ 步骤进度）
      api.clearHighlight();
      if (k >= 0) (steps[k].elements || []).forEach(function (e) { var it = api.byId[String(e.targetId)]; if (it) api.highlight(it); });
      refresh3D();
    };
  }

  function refresh2D() {
    clearHoverHL();
    OBJ.source = "2d";
    OBJ.items = read2D();
    renderObjects();
    bindHover2D();
  }
  function refresh3D() {
    clearHoverHL();
    OBJ.source = "3d";
    OBJ.items = read3D();
    renderObjects();
  }

  /* =========================================================
     七、2D 画布操作：滚轮缩放 / 长按拖拽平移 / 方向键微调
     说明：JSXGraph 自带 pan/zoom 需要 Shift 才生效，这里直接接管，
          并且不删除原有任何控件（工具栏按钮、自带导航条都在）。
     ========================================================= */
  var NAV = { wheelStep: 0.12, dragPx: 1.0, keyStep: 0.06, bound: false };

  function boardBB() {
    try { return window.board ? window.board.getBoundingBox() : null; } catch (e) { return null; }
  }
  function setBB(bb) {
    if (!window.board || !bb) return;
    try { window.board.setBoundingBox(bb); window.board.update(); } catch (e) {}
  }
  // 以屏幕上的点为中心缩放：k>1 缩小，k<1 放大
  function zoomAt(clientX, clientY, k) {
    var bb = boardBB();
    if (!bb) return;
    var host = $("ggb-canvas") || $("canvasHost");
    if (!host) return;
    var r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var fx = (clientX - r.left) / r.width;   // 0..1
    var fy = (clientY - r.top) / r.height;
    fx = clamp(fx, 0, 1); fy = clamp(fy, 0, 1);
    // boundingBox = [xmin, ymax, xmax, ymin]
    var x0 = bb[0], y1 = bb[1], x1 = bb[2], y0 = bb[3];
    var px = x0 + (x1 - x0) * fx;
    var py = y1 + (y0 - y1) * fy;
    var nx0 = px + (x0 - px) * k;
    var nx1 = px + (x1 - px) * k;
    var ny1 = py + (y1 - py) * k;
    var ny0 = py + (y0 - py) * k;
    // 限制缩放范围，防止缩成一点
    var w = nx1 - nx0, h = ny1 - ny0;
    if (w < 1e-4 || h < 1e-4) return;
    if (w > 1e5 || h > 1e5) return;
    setBB([nx0, ny1, nx1, ny0]);
    afterNav();
  }
  function panBy(dxPx, dyPx) {
    var bb = boardBB();
    if (!bb) return;
    var host = $("ggb-canvas") || $("canvasHost");
    if (!host) return;
    var r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var x0 = bb[0], y1 = bb[1], x1 = bb[2], y0 = bb[3];
    var perX = (x1 - x0) / r.width;
    var perY = (y0 - y1) / r.height;
    var ox = dxPx * perX, oy = dyPx * perY;
    setBB([x0 - ox, y1 - oy, x1 - ox, y0 - oy]);
    afterNav();
  }
  function afterNav() {
    // 记录中若开启了「网格/坐标轴」，缩放后 JSXGraph 会自己重绘，无需处理
  }

  function init2DNav() {
    if (NAV.bound) return;
    var stage = $("stage");
    if (!stage) return;
    NAV.bound = true;

    // ---- 滚轮缩放（不需要按 Shift）----
    stage.addEventListener("wheel", function (e) {
      if (OBJ.source !== "2d" || !window.board) return;
      // 侧栏 / 悬浮原题卡片里的滚动不要被劫持
      if (e.target.closest && e.target.closest("#leftPanel,#rightPanel,#taskPanel,.stepbar,.stepdesc,.qfloat")) return;
      e.preventDefault();
      var dir = e.deltaY > 0 ? 1 : -1;
      var k = 1 + dir * NAV.wheelStep;
      zoomAt(e.clientX, e.clientY, k);
    }, { passive: false });

    // ---- 长按拖拽平移 ----
    var drag = null;
    stage.addEventListener("mousedown", function (e) {
      if (OBJ.source !== "2d" || !window.board) return;
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest("button,.toolbar,.measure,.stepbar,.stepdesc,.welcome,#taskPanel,.qfloat")) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
      stage.style.cursor = "grabbing";
    });
    document.addEventListener("mousemove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      panBy(dx, dy);
    });
    document.addEventListener("mouseup", function () {
      if (!drag) return;
      drag = null;
      stage.style.cursor = "";
    });

    // ---- 方向键微调（画布聚焦时）----
    stage.setAttribute("tabindex", "0");
    stage.addEventListener("keydown", function (e) {
      if (OBJ.source !== "2d" || !window.board) return;
      var bb = boardBB(); if (!bb) return;
      var stepX = Math.abs(bb[2] - bb[0]) * NAV.keyStep;
      var stepY = Math.abs(bb[3] - bb[1]) * NAV.keyStep;
      var handled = true;
      if (e.key === "ArrowLeft") panBy(stepX * 4, 0);
      else if (e.key === "ArrowRight") panBy(-stepX * 4, 0);
      else if (e.key === "ArrowUp") panBy(0, stepY * 4);
      else if (e.key === "ArrowDown") panBy(0, -stepY * 4);
      else if (e.key === "+" || e.key === "=") zoomAtByCenter(1 - NAV.keyStep);
      else if (e.key === "-" || e.key === "_") zoomAtByCenter(1 + NAV.keyStep);
      else handled = false;
      if (handled) e.preventDefault();
    });
    // 点画布就让它拿到焦点，方向键才有用（悬浮卡片内不抢焦点）
    stage.addEventListener("mousedown", function (e) {
      if (e.target && e.target.closest && e.target.closest(".qfloat")) return;
      try { stage.focus({ preventScroll: true }); } catch (e2) {}
    });
  }
  function zoomAtByCenter(k) {
    var host = $("ggb-canvas") || $("canvasHost");
    if (!host) return;
    var r = host.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, k);
  }

  /* =========================================================
     八、初始化
     ========================================================= */
  function init() {
    loadLayout();
    applyLayout();

    var sL = $("splitL"), sR = $("splitR");
    if (sL) sL.addEventListener("mousedown", function (e) { startDrag("left", e); });
    if (sR) sR.addEventListener("mousedown", function (e) { startDrag("right", e); });
    // 右栏内：解答 / 微调 的水平分隔
    var sV = $("splitV");
    if (sV) sV.addEventListener("mousedown", function (e) { startDragV(e); });
    var rt = $("refineToggle");
    if (rt) rt.onclick = toggleRefine;

    var bcl = $("btnCollapseL"), bcr = $("btnCollapseR");
    if (bcl) bcl.onclick = function () { LAYOUT.leftCollapsed = true; saveLayout(); applyLayout(); };
    if (bcr) bcr.onclick = function () { LAYOUT.rightCollapsed = true; saveLayout(); applyLayout(); };
    var bsa = $("btnShowAll");
    if (bsa) bsa.onclick = resetAllVisible;
    var rl = $("reopenL"), rr2 = $("reopenR");
    if (rl) rl.onclick = function () { LAYOUT.leftCollapsed = false; saveLayout(); applyLayout(); };
    if (rr2) rr2.onclick = function () { LAYOUT.rightCollapsed = false; saveLayout(); applyLayout(); };

    // 收起后从边缘点击恢复：双击分隔条区域或点状态栏
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && (LAYOUT.leftCollapsed || LAYOUT.rightCollapsed)) {
        LAYOUT.leftCollapsed = false; LAYOUT.rightCollapsed = false; saveLayout(); applyLayout();
      }
    });

    // 对象分类过滤
    var seg = $("objSeg");
    if (seg) seg.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-k]");
      if (!b) return;
      OBJ.filter = b.dataset.k;
      Array.prototype.forEach.call(seg.children, function (x) { x.classList.toggle("on", x === b); });
      renderObjects();
    });

    // 步骤条
    var bar = $("stepbar");
    if (bar) {
      bar.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-act]");
        if (!b) return;
        var a = b.dataset.act;
        if (a === "prev") setStep(Math.max(-1, STEPS.cur - 1));
        else if (a === "next") setStep(Math.min(STEPS.items.length - 1, STEPS.cur + 1));
        else if (a === "all") setStep(-1);
        else if (a === "play") playSteps();
        else if (a === "exp") {
          var d = $("stepdesc");
          if (d && d.innerHTML) d.classList.toggle("show");
        }
      });
    }

    // 工具栏
    var tb = $("toolbar");
    if (tb) tb.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]");
      if (!b) return;
      var a = b.dataset.act;
      if (a === "fit") resetView();
      else if (a === "focus") focusAnswer();
      else if (a === "png") { var p = $("btnPng"); if (p) p.click(); }
      else if (a === "full") toggleFull();
      else if (a === "grid") toggleGrid();
    });

    init2DNav();

    // 欢迎页按钮（「粘贴图片」主按钮已移除，这里直接读剪贴板）
    var wp = $("wPaste"), wf = $("wFocus");
    if (wp) wp.onclick = function () {
      if (navigator.clipboard && navigator.clipboard.read) {
        navigator.clipboard.read().then(function (its) {
          var got = 0;
          its.forEach(function (it) {
            var t = (it.types || []).filter(function (x) { return /^image\//.test(x); })[0];
            if (!t) return;
            it.getType(t).then(function (blob) {
              if (window.SolverDebug && SolverDebug.addImageFile) {
                SolverDebug.addImageFile(new File([blob], "paste.png", { type: t }));
                got++;
              }
            }).catch(function () {});
          });
          setTimeout(function () { if (!got) notify("剪贴板里没有图片，可在题目框里直接 Ctrl+V"); }, 600);
        }).catch(function () { notify("无法读取剪贴板，请在题目框里 Ctrl+V 粘贴"); });
      } else { notify("浏览器不支持读取剪贴板，请在题目框里 Ctrl+V"); }
    };
    if (wf) wf.onclick = function () { var q = $("q"); if (q) q.focus(); };

    // 3D 画布尺寸自适应
    HJ._onResize = function () {
      try {
        if (window.GGB3D && window.GGB3D.resize) window.GGB3D.resize();
      } catch (e) {}
      try { if (window.board && window.board.update) window.board.update(); } catch (e) {}
    };
    window.addEventListener("resize", function () { applyLayout(); if (HJ._onResize) HJ._onResize(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
