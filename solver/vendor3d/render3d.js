(function () {
  var THREE = window.THREE;
  if (!THREE) { console.warn("GGB3D: THREE not loaded"); return; }

  var st = { renderer: null, scene: null, camera: null, controls: null, raf: 0, ro: null, container: null, ui: null, scenes: null, idx: 0, base: null, tween: null, t: 0 };
  var G = null, R = 1, LS = 1;

  function V(a) { return new THREE.Vector3(Number(a[0]), Number(a[1]), Number(a[2])); }
  function isArr(a) { return Array.isArray(a) && a.length >= 3; }
  function num(x, d) { var n = Number(x); return isFinite(n) ? n : d; }
  function deg2rad(d) { return d * Math.PI / 180; }

  function styleOf(el, defColor, defOp) {
    var s = el.style, dashed = false, color = el.color || defColor, op = (el.opacity != null ? el.opacity : defOp);
    if (typeof s === "string") dashed = (s === "dashed");
    else if (s && typeof s === "object") { if (s.color) color = s.color; if (s.opacity != null) op = s.opacity; if (s.dashed) dashed = true; }
    if (el.dashed) dashed = true;
    return { color: color, opacity: op, dashed: dashed };
  }
  function lineWidthOf(el) {
    var w = el.lineWidth != null ? el.lineWidth : el.width;
    if (el.style && typeof el.style === "object" && el.style.lineWidth != null) w = el.style.lineWidth;
    return num(w, 1);
  }
  function isWireframe(el) {
    if (el.wireframe) return true;
    if (el.style === "wireframe") return true;
    if (el.style && typeof el.style === "object" && el.style.wireframe) return true;
    return false;
  }

  // ---- rich labels (canvas sprite, updatable text) ----
  // 迷你 LaTeX → 富文本 run（画布精灵标签专用：这里没有 DOM / 没有 KaTeX，只能手画）
  //
  // 支持的写法（递归解析，`\vec` 里面还能再套下标、希腊字母）：
  //   \vec{A_1B_1} \overrightarrow{AB}    → 上方箭头，箭头横跨整段（只画一个箭头）
  //   \overline{AB} \bar{x}               → 上方横线
  //   \hat{x} \dot{x} \tilde{x}           → 剥掉命令留内容
  //   \text{..} \mathrm{..} \mathbf{..}    → 剥掉命令留内容
  //   A_1 A_{12} P_min                     → 下标（裸参数：数字整串、小写字母整串）
  //   x^2 10^\circ                         → 上标
  //   \frac{a}{b} \dfrac \tfrac            → a/b
  //   \sqrt{3}                             → √3
  //   希腊字母 / 常用符号全套（见 TEX_SYM）
  //   $...$ 分隔符一律去掉
  //
  // run 形状：{ t: 文本, kind: 0 正常 / 2 下标 / 3 上标, ov: 0 无 / 1 箭头 / 2 横线 }
  var TEX_SYM = {
    "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ", "\\epsilon": "ϵ", "\\varepsilon": "ε",
    "\\zeta": "ζ", "\\eta": "η", "\\theta": "θ", "\\vartheta": "ϑ", "\\iota": "ι", "\\kappa": "κ",
    "\\lambda": "λ", "\\mu": "μ", "\\nu": "ν", "\\xi": "ξ", "\\omicron": "ο", "\\pi": "π", "\\varpi": "ϖ",
    "\\rho": "ρ", "\\varrho": "ϱ", "\\sigma": "σ", "\\varsigma": "ς", "\\tau": "τ", "\\upsilon": "υ",
    "\\phi": "ϕ", "\\varphi": "φ", "\\chi": "χ", "\\psi": "ψ", "\\omega": "ω",
    "\\Gamma": "Γ", "\\Delta": "Δ", "\\Theta": "Θ", "\\Lambda": "Λ", "\\Xi": "Ξ", "\\Pi": "Π",
    "\\Sigma": "Σ", "\\Upsilon": "Υ", "\\Phi": "Φ", "\\Psi": "Ψ", "\\Omega": "Ω",
    "\\circ": "°", "\\degree": "°", "\\angle": "∠", "\\measuredangle": "∡", "\\perp": "⊥", "\\parallel": "∥",
    "\\nparallel": "∦", "\\triangle": "△", "\\square": "□", "\\odot": "⊙", "\\cong": "≅", "\\sim": "∼",
    "\\simeq": "≃", "\\approx": "≈", "\\neq": "≠", "\\ne": "≠", "\\leq": "≤", "\\le": "≤", "\\geq": "≥",
    "\\ge": "≥", "\\ll": "≪", "\\gg": "≫", "\\equiv": "≡", "\\pm": "±", "\\mp": "∓", "\\times": "×",
    "\\div": "÷", "\\cdot": "·", "\\cdots": "⋯", "\\ldots": "…", "\\dots": "…", "\\vdots": "⋮", "\\infty": "∞",
    "\\in": "∈", "\\notin": "∉", "\\subset": "⊂", "\\subseteq": "⊆", "\\supset": "⊃", "\\supseteq": "⊇",
    "\\cup": "∪", "\\cap": "∩", "\\emptyset": "∅", "\\varnothing": "∅", "\\forall": "∀", "\\exists": "∃",
    "\\sum": "∑", "\\prod": "∏", "\\int": "∫", "\\to": "→", "\\rightarrow": "→", "\\leftarrow": "←",
    "\\leftrightarrow": "↔", "\\Rightarrow": "⇒", "\\Leftarrow": "⇐", "\\Leftrightarrow": "⇔",
    "\\uparrow": "↑", "\\downarrow": "↓", "\\prime": "′", "\\partial": "∂", "\\nabla": "∇", "\\propto": "∝",
    "\\therefore": "∴", "\\because": "∵", "\\ast": "∗", "\\star": "⋆", "\\bullet": "•", "\\oplus": "⊕",
    "\\otimes": "⊗", "\\left": "", "\\right": "", "\\,": " ", "\\;": " ", "\\:": " ", "\\!": "",
    "\\quad": " ", "\\qquad": " ", "\\enspace": " ", "\\%": "%", "\\&": "&", "\\#": "#", "\\_": "_",
    "\\{": "{", "\\}": "}", "\\$": "$", "\\|": "‖"
  };
  var TEX_OVER = { "\\vec": 1, "\\overrightarrow": 1, "\\overline": 2, "\\bar": 2 };
  var TEX_PASS = {  // 有参数、剥掉命令留内容的
    "\\text": 1, "\\mathrm": 1, "\\mathbf": 1, "\\mathit": 1, "\\mathsf": 1, "\\mathtt": 1,
    "\\operatorname": 1, "\\mbox": 1, "\\mathnormal": 1, "\\boldsymbol": 1,
    "\\hat": 1, "\\dot": 1, "\\ddot": 1, "\\tilde": 1, "\\check": 1, "\\breve": 1,
    "\\acute": 1, "\\grave": 1, "\\underline": 1, "\\widehat": 1, "\\widetilde": 1
  };
  var TEX_FRAC = { "\\frac": 1, "\\dfrac": 1, "\\tfrac": 1, "\\cfrac": 1 };

  function texRuns(text) {
    var s = String(text == null ? "" : text).replace(/\$/g, "");
    var out = [];
    // 从 '{' 起读到配对的 '}'（支持嵌套）
    function group(str, i) {
      if (str[i] !== "{") return { body: str[i] || "", next: i + 1 };
      var d = 0, j = i;
      for (; j < str.length; j++) {
        if (str[j] === "{") d++;
        else if (str[j] === "}") { d--; if (d === 0) break; }
      }
      return { body: str.slice(i + 1, j), next: j + 1 };
    }
    // 读一个参数：{...} / 一个命令 / 裸串（数字整串、小写字母整串，让 P_min → min）
    function arg(str, i) {
      while (i < str.length && /\s/.test(str[i])) i++;
      if (str[i] === "{") return group(str, i);
      if (str[i] === "\\") { var m = /^\\[A-Za-z]+/.exec(str.slice(i)); if (m) return { body: m[0], next: i + m[0].length }; }
      var m2 = /^(?:[0-9]+|[a-z]+)/.exec(str.slice(i));
      if (m2) return { body: m2[0], next: i + m2[0].length };
      return { body: str[i] || "", next: i + 1 };
    }
    function walk(str, kind, ov) {
      var i = 0, buf = "";
      function flush() { if (buf) { out.push({ t: buf, kind: kind, ov: ov || 0 }); buf = ""; } }
      while (i < str.length) {
        var ch = str[i];
        if (ch === "\\") {
          var m = /^\\[A-Za-z]+/.exec(str.slice(i));
          if (!m) {
            // 单字符命令：\\ \, \; \! \% \& \# \_ \{ \} \$ 等
            var c2 = str[i + 1] || "";
            if (c2 === "\\") { flush(); i += 2; continue; }               // \\ 换行 → 直接丢
            var lit = "\\,;:! %&#_{}$|".indexOf(c2) >= 0 ? TEX_SYM["\\" + c2] : undefined;
            if (lit !== undefined) { buf += lit; i += 2; continue; }
            i += 2; continue;
          }
          var cmd = m[0]; i += cmd.length;
          if (TEX_OVER[cmd]) { var a1 = arg(str, i); i = a1.next; flush(); walk(a1.body, kind, TEX_OVER[cmd]); continue; }
          if (TEX_FRAC[cmd]) {
            var f1 = arg(str, i); i = f1.next;
            var f2 = arg(str, i); i = f2.next;
            flush(); walk(f1.body, kind, ov); out.push({ t: "/", kind: kind, ov: ov || 0 }); walk(f2.body, kind, ov);
            continue;
          }
          if (cmd === "\\sqrt") {
            if (str[i] === "[") { var k = str.indexOf("]", i); if (k > 0) i = k + 1; }
            var q1 = arg(str, i); i = q1.next;
            flush(); buf += "√"; flush(); walk(q1.body, kind, ov);
            continue;
          }
          if (TEX_PASS[cmd]) { var a2 = arg(str, i); i = a2.next; flush(); walk(a2.body, kind, ov); continue; }
          if (TEX_SYM[cmd] != null) { buf += TEX_SYM[cmd]; continue; }
          // 未知命令：后面紧跟 {...} 就取参数内容，否则整个丢掉（不再原样留下反斜杠）
          var g = /^\s*\{/.exec(str.slice(i));
          if (g) { var a3 = group(str, i + g[0].length - 1); i = a3.next; flush(); walk(a3.body, kind, ov); }
          continue;
        }
        if (ch === "_" || ch === "^") {
          var a4 = arg(str, i + 1); i = a4.next;
          flush();
          walk(a4.body, ch === "_" ? 2 : 3, ov);
          continue;
        }
        buf += ch; i++;
      }
      flush();
    }
    walk(s, 0, 0);
    return out;
  }
  // 纯文本版：给面板 / 摘要用（去掉 LaTeX 结构，保留可读字符）
  function texPlain(text) {
    var runs = texRuns(text), s = "";
    for (var i = 0; i < runs.length; i++) s += runs[i].t;
    return s;
  }
  function drawLabel(sp, text, color) {
    var runs = texRuns(text);
    if (!runs.length) runs = [{ t: "", kind: 0, ov: 0 }];
    var fs = 64, pad = 18, cv = sp.userData.cv, ctx = cv.getContext("2d");
    var fontMain = "600 " + fs + 'px "Microsoft YaHei","Segoe UI",sans-serif';
    var fontSmall = "600 " + Math.round(fs * 0.62) + 'px "Microsoft YaHei","Segoe UI",sans-serif';
    // 有上方箭头/横线时整体下移一点，避免压到文字
    var hasOver = runs.some(function (r) { return r.ov; });
    var topPad = hasOver ? pad + Math.round(fs * 0.34) : pad;
    var total = 0;
    runs.forEach(function (r) { ctx.font = (r.kind === 2 || r.kind === 3) ? fontSmall : fontMain; total += ctx.measureText(r.t).width; });
    var w = Math.ceil(total) + pad * 2, h = fs + pad + topPad;
    cv.width = w; cv.height = h; ctx = cv.getContext("2d");
    ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillStyle = color || "#222";
    var midY = topPad + fs / 2, x = pad;
    var spans = [];   // 连续 ov 相同且非 0 的段，用来整段画一个箭头
    runs.forEach(function (r) {
      ctx.font = (r.kind === 2 || r.kind === 3) ? fontSmall : fontMain;
      var y = r.kind === 2 ? midY + fs * 0.22 : (r.kind === 3 ? midY - fs * 0.30 : midY);
      ctx.fillText(r.t, x, y);
      var rw = ctx.measureText(r.t).width;
      if (r.ov) {
        var last = spans[spans.length - 1];
        // 只有紧邻（中间没有普通文本隔开）的同类型覆盖段才合并成一根箭头
        if (last && last.ov === r.ov && last.open) { last.x2 = x + rw; }
        else spans.push({ ov: r.ov, x1: x, x2: x + rw, open: true });
      } else if (spans.length) {
        spans[spans.length - 1].open = false;
      }
      x += rw;
    });
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = Math.max(2, fs * 0.05);
    spans.forEach(function (sp2) {
      if (sp2.x2 - sp2.x1 < 1) return;
      var ay = midY - fs * (sp2.ov === 1 ? 0.62 : 0.52);
      var x1 = sp2.x1 + (sp2.ov === 1 ? (sp2.x2 - sp2.x1) * 0.02 : 0);
      ctx.beginPath(); ctx.moveTo(x1, ay); ctx.lineTo(sp2.x2, ay); ctx.stroke();
      if (sp2.ov === 1) {   // 只有 \vec/\overrightarrow 画箭头，\overline 只画横线
        var hl = fs * 0.15;
        ctx.beginPath();
        ctx.moveTo(sp2.x2 - hl, ay - hl * 0.6); ctx.lineTo(sp2.x2, ay); ctx.lineTo(sp2.x2 - hl, ay + hl * 0.6);
        ctx.stroke();
      }
    });
    if (sp.material.map) sp.material.map.dispose();
    sp.material.map = new THREE.CanvasTexture(cv); sp.material.needsUpdate = true;
    sp.userData.aspect = w / h;
  }
  function makeLabel(text, color) {
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    sp.userData.cv = document.createElement("canvas"); sp.userData.aspect = 1;
    drawLabel(sp, text, color); return sp;
  }
  function sizeLabel(sp, s) { sp.scale.set(s * sp.userData.aspect, s, 1); }

  // ---- rich HTML (KaTeX) for panels ----
  function setRich(el, text) {
    var s = (text == null ? "" : String(text)).replace(/\\n/g, "\n");
    if (window.mathHTML) { try { el.innerHTML = window.mathHTML(s); return; } catch (e) {} }
    el.textContent = s;
  }
  // 面板里的短文本（步骤标题 / 聚焦按钮 / 滑块名 / 多图标签）：有 $...$ 走 KaTeX，否则纯文本化
  function setPanelText(el, text) {
    var s = (text == null ? "" : String(text)).replace(/\\n/g, "\n");
    if (!s) { el.textContent = ""; return; }
    if (window.mathHTML && /[\\$]/.test(s)) {
      try { el.innerHTML = window.mathHTML(s); return; } catch (e) {}
    }
    el.textContent = texPlain(s);
  }

  // ---- geometry helpers ----
  function circlePts(r, n) { var a = []; for (var i = 0; i < n; i++) { var t = i / n * Math.PI * 2; a.push([Math.cos(t) * r, Math.sin(t) * r]); } return a; }
  function makeTubeGeo(pts, radius, closed) {
    var curve;
    if (pts.length === 2) curve = new THREE.LineCurve3(pts[0], pts[1]);
    else curve = new THREE.CatmullRomCurve3(pts, !!closed, "catmullrom", 0.2);
    var seg = Math.max(10, Math.min(400, pts.length * 2 + 10));
    return new THREE.TubeGeometry(curve, seg, Math.max(radius, 1e-4), 10, !!closed);
  }
  // stroke that can become a fat (tube) line when width>1.5
  // 记录 points / width，供「手动调整线宽」时原样重建
  function makeStroke(pts, color, width, dashed) {
    var sk = { obj: null, tube: false, width: 0, color: color, dashed: !!dashed, points: (pts || []).slice(), closed: false, set: null };
    function rebuild(p, closed, w) {
      sk.points = (p || []).slice(); sk.closed = !!closed; sk.width = w;
      var thick = w > 1.5 && !sk.dashed;
      sk.tube = thick;
      if (thick) {
        var mesh = new THREE.Mesh(makeTubeGeo(p, w * R * 0.35, closed), new THREE.MeshBasicMaterial({ color: color }));
        sk.obj = mesh;
        sk.set = function (np, nc) { sk.points = (np || []).slice(); sk.closed = !!nc; mesh.geometry.dispose(); mesh.geometry = makeTubeGeo(np, sk.width * R * 0.35, nc); };
      } else {
        var mat = sk.dashed ? new THREE.LineDashedMaterial({ color: color, dashSize: R * 3, gapSize: R * 2 }) : new THREE.LineBasicMaterial({ color: color });
        var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), mat);
        sk.obj = line;
        sk.set = function (np, nc) { sk.points = (np || []).slice(); sk.closed = !!nc; line.geometry.dispose(); line.geometry = new THREE.BufferGeometry().setFromPoints(nc ? np.concat([np[0]]) : np); if (sk.dashed) line.computeLineDistances(); };
      }
    }
    rebuild(pts, false, width);
    return sk;
  }

  function disposeObj(o) {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { var m = o.material; if (Array.isArray(m)) m.forEach(function (x) { if (x.map) x.map.dispose(); x.dispose(); }); else { if (m.map) m.map.dispose(); m.dispose(); } }
  }
  function clearView() {
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
    if (st.ro) { try { st.ro.disconnect(); } catch (e) {} st.ro = null; }
    if (st.controls) { try { st.controls.dispose(); } catch (e) {} st.controls = null; }
    if (G && G.timers) G.timers.forEach(function (t) { clearTimeout(t); });
    if (st.scene) st.scene.traverse(function (o) { disposeObj(o); });
    if (st.renderer) { try { st.renderer.dispose(); } catch (e) {} var c = st.renderer.domElement; if (c && c.parentNode) c.parentNode.removeChild(c); }
    if (st.ui && st.ui.parentNode) st.ui.parentNode.removeChild(st.ui);
    st.renderer = st.scene = st.camera = st.ui = null; st.tween = null; G = null;
    // 网格随场景一起销毁；不清掉的话切到 2D 后 hasGrid() 仍返回 true，按钮会误显示
    st.gridMesh = null;
  }
  function dispose() { clearView(); st.container = null; st.scenes = null; st.base = null; st.idx = 0; st.api = null; st.cam0 = null; }

  // =========================================================
  function build(scene, data) {
    var items = [], byId = {}, dynamic = [], timers = [];
    var specAll = {};
    ["points", "segments", "planes", "spheres", "cylinders", "cones", "circles", "paths", "labels", "arcs", "arrows", "dimensions", "surfaceUnfold"].forEach(function (k) {
      (data[k] || []).forEach(function (e) { if (e && e.id != null) specAll[String(e.id)] = e; });
    });

    var sliders = (data.sliders || []).map(function (s) {
      var min = s.min != null ? s.min : 0, max = s.max != null ? s.max : 1;
      // defaultValue 单独留一份：拖动后 value 会变，左栏的「复位」要用它还原（§72）
      var dv = s.defaultValue != null ? s.defaultValue : (min + max) / 2;
      return { id: s.id, min: min, max: max, step: s.step || 0.01, label: s.label || s.id, value: dv, defaultValue: dv };
    });
    var sliderById = {}; sliders.forEach(function (s) { sliderById[s.id] = s; });
    var stepEls = {}; (data.steps || []).forEach(function (sp) { (sp.elements || []).forEach(function (e) { if (e.targetId) stepEls[String(e.targetId)] = true; }); });

    function baseCoords() {
      var m = {};
      (data.points || []).forEach(function (p) { var c = p.coords || p.position || p.xyz; if (isArr(c)) m[String(p.id)] = [Number(c[0]), Number(c[1]), Number(c[2])]; });
      return m;
    }
    function resolveCoords() {
      var m = baseCoords();
      (data.bindings || []).forEach(function (b) {
        if (b.targetType !== "point" || (b.property && b.property !== "coords")) return;
        var s = sliderById[b.sliderId]; if (!s) return;
        var kf = (b.keyframes || []).slice().sort(function (x, y) { return x.at - y.at }); if (!kf.length) return;
        var t = s.value, v;
        if (t <= kf[0].at) v = kf[0].value;
        else if (t >= kf[kf.length - 1].at) v = kf[kf.length - 1].value;
        else for (var i = 1; i < kf.length; i++) { if (t <= kf[i].at) { var a = kf[i - 1].value, c = kf[i].value, f = (kf[i].at - kf[i - 1].at) ? (t - kf[i - 1].at) / (kf[i].at - kf[i - 1].at) : 0; v = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f]; break; } }
        if (Array.isArray(v)) m[String(b.targetId)] = [Number(v[0]), Number(v[1]), Number(v[2])];
      });
      return m;
    }
    function C(id) { return G.coords[id] ? V(G.coords[id]) : null; }
    function posOf(el, keys) { for (var i = 0; i < keys.length; i++) { var k = keys[i]; if (el[k] == null) continue; if (isArr(el[k])) return V(el[k]); if (typeof el[k] === "string" && G.coords[el[k]]) return V(G.coords[el[k]]); } return null; }
    // ---- 平面去重（窄口径）----
    // 只处理「一个平面的所有顶点都落在另一个同平面多边形内」这一种情况：后者的网格已经
    // 把前者完全盖住，重复建面只会 z-fighting。部分相交、仅共面不包含的平面一律不动。
    function polyNormal(pts) {
      var n = new THREE.Vector3(0, 0, 0);
      for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
      }
      var len = n.length();
      return len > 1e-12 ? n.multiplyScalar(1 / len) : null;
    }
    function dropAxisOf(n) { var ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z); return (ax >= ay && ax >= az) ? 0 : (ay >= az ? 1 : 2); }
    function uv2(p, d) { return d === 0 ? [p.y, p.z] : (d === 1 ? [p.x, p.z] : [p.x, p.y]); }
    function polyArea2(pts, n) {
      var d = dropAxisOf(n), s = 0, q = pts.map(function (p) { return uv2(p, d); });
      for (var i = 0; i < q.length; i++) { var a = q[i], b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; }
      return Math.abs(s) / 2;
    }
    function segDist2(q, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      var t = L ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      var x = a[0] + t * dx - q[0], y = a[1] + t * dy - q[1];
      return Math.sqrt(x * x + y * y);
    }
    function inPoly3(poly, n, p, tol) {
      if (Math.abs(n.dot(p.clone().sub(poly[0]))) > tol) return false;
      var d = dropAxisOf(n), q = uv2(p, d), qs = poly.map(function (v) { return uv2(v, d); }), inside = false;
      for (var i = 0, j = qs.length - 1; i < qs.length; j = i++) {
        var a = qs[i], b = qs[j];
        if (segDist2(q, a, b) <= tol) return true;
        if (((a[1] > q[1]) !== (b[1] > q[1])) && (q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
      }
      return inside;
    }
    var dynPt = {}; (data.bindings || []).forEach(function (b) { if (b && b.targetType === "point" && b.targetId != null) dynPt[String(b.targetId)] = true; });
    function planePts(f) {
      var raw = f.vertices || f.points || [], out = [], base = baseCoords();
      for (var i = 0; i < raw.length; i++) {
        var r = raw[i], p = null;
        if (isArr(r)) p = [Number(r[0]), Number(r[1]), Number(r[2])];
        else {
          if (dynPt[String(r)]) return null;  // 动点平面不做去重：包含关系会随滑块变化
          p = base[String(r)];
        }
        if (!p || !isFinite(Number(p[0])) || !isFinite(Number(p[1])) || !isFinite(Number(p[2]))) return null;
        out.push(V(p));
      }
      return out.length >= 3 ? out : null;
    }
    var planeArr = data.planes || data.faces || [];
    var planeInfo = planeArr.map(function (f, idx) {
      if (f.id == null) return null;
      var pts = planePts(f); if (!pts) return null;
      var n = polyNormal(pts); if (!n) return null;
      return { idx: idx, id: String(f.id), pts: pts, n: n, area: polyArea2(pts, n), parent: -1, root: idx, item: null };
    });
    var planeTol = Math.max(R * 0.6, 1e-9);
    planeInfo.forEach(function (a, i) {
      if (!a) return;
      var best = -1, bestArea = 0;
      planeInfo.forEach(function (b, j) {
        if (!b || j === i) return;
        var bigger = b.area > a.area * (1 + 1e-6) + 1e-12;
        var tie = Math.abs(b.area - a.area) <= a.area * 1e-6 + 1e-12 && j < i;
        if (!bigger && !tie) return;
        for (var k = 0; k < a.pts.length; k++) if (!inPoly3(b.pts, b.n, a.pts[k], planeTol)) return;
        if (best < 0 || b.area > bestArea) { best = j; bestArea = b.area; }
      });
      a.parent = best;
    });
    function planeRoot(i) { var guard = 0; while (i >= 0 && planeInfo[i] && planeInfo[i].parent >= 0 && guard++ < 64) i = planeInfo[i].parent; return i; }
    planeInfo.forEach(function (a, i) { if (a) a.root = planeRoot(i); });
    // spec：指向场景 JSON 里的原始定义（手动调样式时直接改它，随记录/导出保存）
    // stroke：粗线/细线的 makeStroke 结果（供手动改线宽时原样重建）
    function add(id, type, objs, update) { var it = { id: id, type: type, objs: objs || [], update: update || null, vis: true, spec: (id != null ? specAll[String(id)] || null : null), stroke: null }; items.push(it); if (id != null) byId[String(id)] = it; if (update) dynamic.push(it); return it; }

    G = { items: items, byId: byId, dynamic: dynamic, coords: {}, sliders: sliders, sliderById: sliderById, stepEls: stepEls, timers: timers, scene: scene, data: data };

    // points (+ inline labels)
    (data.points || []).forEach(function (p) {
      var mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), new THREE.MeshStandardMaterial({ color: p.color || "#d32f2f", roughness: 0.5 }));
      scene.add(mesh);
      var sp = null;
      if (p.label || (p.name && p.name !== p.id)) { sp = makeLabel(String(p.label || p.name), p.labelColor || "#1a1a1a"); scene.add(sp); }
      var objs = sp ? [mesh, sp] : [mesh];
      add(p.id, "point", objs, function () { var c = C(String(p.id)); if (!c) return; var s = p.size ? Number(p.size) : R; mesh.position.copy(c); mesh.scale.setScalar(s); if (sp) { sizeLabel(sp, LS); sp.position.copy(c.clone().add(new THREE.Vector3(LS * 0.9, LS * 0.9, 0))); } });
    });

    // standalone labels (targetId, or fixed coord: position / coords / at)
    (data.labels || []).forEach(function (lb) {
      var txt = lb.text != null ? lb.text : (lb.label != null ? lb.label : "");
      var fixed = (isArr(lb.position) || isArr(lb.coords) || isArr(lb.at)) ? posOf(lb, ["position", "coords", "at"]) : null;
      if (!lb.targetId && !fixed) return;
      var sp = makeLabel(String(txt), lb.color || "#1a1a1a"); scene.add(sp);
      add(lb.id, "label", [sp], function () {
        var c = lb.targetId ? C(lb.targetId) : fixed;
        if (!c) return; sizeLabel(sp, LS * 1.15); sp.position.copy(c.clone().add(new THREE.Vector3(LS * 1.0, LS * 1.0, 0)));
      });
    });

    // segments (from/to, optional lineWidth / dashed)
    (data.segments || data.edges || []).forEach(function (s) {
      var stl = styleOf(s, "#37474f");
      var sk = makeStroke([new THREE.Vector3(), new THREE.Vector3()], stl.color, lineWidthOf(s), stl.dashed);
      scene.add(sk.obj);
      var itSeg = add(s.id, "segment", [sk.obj], function () {
        var a = posOf(s, ["from", "a"]) || (isArr(s[0]) ? V(s[0]) : null), b = posOf(s, ["to", "b"]) || (isArr(s[1]) ? V(s[1]) : null);
        if (!a || !b) return; sk.set([a, b], false);
      });
      itSeg.stroke = sk;
    });

    // planes / faces
    planeArr.forEach(function (f, idx) {
      var info = planeInfo[idx];
      if (info && info.root !== idx) return;  // 完全被同平面的更大面覆盖：稍后挂别名，不再建网格
      var stl = styleOf(f, "#4caf50", 0.16);
      var wire = isWireframe(f);
      var mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: stl.color, transparent: true, opacity: stl.opacity != null ? stl.opacity : 0.16, side: THREE.DoubleSide, depthWrite: false, wireframe: wire }));
      var edge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: stl.color }));
      edge.visible = !wire;
      scene.add(mesh); scene.add(edge);
      var itPlane = add(f.id, "plane", [mesh, edge], function () {
        var vs = (f.vertices || f.points || []).map(function (r) { return isArr(r) ? V(r) : C(r); }).filter(Boolean); if (vs.length < 3) return;
        var tri = []; for (var i = 1; i < vs.length - 1; i++) tri.push(vs[0], vs[i], vs[i + 1]);
        mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry().setFromPoints(tri); mesh.geometry.computeVertexNormals();
        edge.geometry.dispose(); edge.geometry = new THREE.BufferGeometry().setFromPoints(vs.concat([vs[0]]));
      });
      if (info) info.item = itPlane;
    });
    // 重复平面只保留一个网格：别名 item 共享父平面的 Three 对象，显隐按整组取并集，
    // 高亮/聚焦/答案浮层仍然可以通过原 id 找到同一个面。
    planeInfo.forEach(function (info, idx) {
      if (!info || info.root === idx) return;
      var root = planeInfo[info.root], parent = root && root.item;
      if (!parent) return;
      var ai = add(info.id, "plane", parent.objs, null);
      ai.aliasOf = String(parent.id);
      var grp = parent.group || { items: [parent], objs: parent.objs };
      grp.items.push(ai); ai.group = grp; parent.group = grp;
    });

    // spheres
    (data.spheres || []).forEach(function (s) {
      var radius = Number(s.radius) || 1;
      var mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 28), new THREE.MeshStandardMaterial({ color: s.color || "#29b6f6", transparent: true, opacity: s.opacity != null ? s.opacity : 0.28, roughness: 0.4, wireframe: isWireframe(s) }));
      scene.add(mesh);
      add(s.id, "sphere", [mesh], function () { var c = s.centerPointId ? C(s.centerPointId) : (isArr(s.center) ? V(s.center) : null); if (c) mesh.position.copy(c); });
    });

    // cylinders
    (data.cylinders || []).forEach(function (cy) {
      var r = Number(cy.radiusTop != null ? cy.radiusTop : (cy.radius || 1));
      var mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 40, 1, false), new THREE.MeshStandardMaterial({ color: cy.color || "#90a4ae", transparent: true, opacity: cy.opacity != null ? cy.opacity : 0.25, roughness: 0.5, wireframe: isWireframe(cy) }));
      scene.add(mesh);
      add(cy.id, "cylinder", [mesh], function () {
        var a = posOf(cy, ["start", "from"]), b = posOf(cy, ["end", "to"]); if (!a || !b) return;
        var dir = new THREE.Vector3().subVectors(b, a), len = dir.length() || 1;
        mesh.scale.set(1, len, 1); mesh.position.copy(a.clone().add(b).multiplyScalar(0.5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      });
    });

    // cones
    (data.cones || []).forEach(function (cn) {
      var rb = Number(cn.baseRadius) || 1;
      var mesh = new THREE.Mesh(new THREE.ConeGeometry(rb, 1, 48, 1, true), new THREE.MeshStandardMaterial({ color: cn.color || "#cccccc", transparent: true, opacity: cn.opacity != null ? cn.opacity : 0.2, side: THREE.DoubleSide, roughness: 0.5, wireframe: isWireframe(cn) }));
      scene.add(mesh);
      add(cn.id, "cone", [mesh], function () {
        var apex = cn.apexPointId ? C(cn.apexPointId) : (isArr(cn.apex) ? cn.apex : null), base = cn.baseCenterPointId ? C(cn.baseCenterPointId) : (isArr(cn.baseCenter) ? cn.baseCenter : null);
        if (!apex || !base) return; var dir = new THREE.Vector3().subVectors(V(apex), V(base)), len = dir.length() || 1;
        mesh.scale.set(1, len, 1); mesh.position.copy(V(base).add(V(apex)).multiplyScalar(0.5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      });
    });

    // circles
    (data.circles || []).forEach(function (ci) {
      var radius = Number(ci.radius) || 1, pts = [];
      var N = 96; for (var i = 0; i < N; i++) { var t = i / N * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * radius, Math.sin(t) * radius, 0)); }
      var stl = styleOf(ci, "#8e24aa");
      var sk = makeStroke(pts, stl.color, lineWidthOf(ci), stl.dashed);
      scene.add(sk.obj);
      var itCi = add(ci.id, "circle", [sk.obj], function () {
        var c = ci.centerPointId ? C(ci.centerPointId) : (isArr(ci.center) ? V(ci.center) : null); if (!c) return;
        sk.obj.position.copy(c); if (isArr(ci.normal)) sk.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), V(ci.normal).normalize());
      });
      itCi.stroke = sk;
    });

    // arcs (center + radius + startAngle/endAngle [deg], or from/to point ids)
    (data.arcs || []).forEach(function (ar) {
      var stl = styleOf(ar, "#d81b60");
      var normal = isArr(ar.normal) ? V(ar.normal).normalize() : new THREE.Vector3(0, 0, 1);
      var sk = makeStroke([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)], stl.color, lineWidthOf(ar), stl.dashed);
      scene.add(sk.obj);
      var itArc = add(ar.id, "arc", [sk.obj], function () {
        var c = ar.centerPointId ? C(ar.centerPointId) : (isArr(ar.center) ? V(ar.center) : null); if (!c) return;
        var a1, a2, rad;
        if (ar.startAngle != null && ar.endAngle != null) {
          a1 = num(ar.startAngle, 0); a2 = num(ar.endAngle, 0);
          if (ar.unit === "deg" || Math.abs(a1) > 6.2832 || Math.abs(a2) > 6.2832) { a1 = deg2rad(a1); a2 = deg2rad(a2); }
          rad = num(ar.radius, 1);
        } else {
          var fp = posOf(ar, ["from", "start"]), tp = posOf(ar, ["to", "end"]); if (!fp || !tp) return;
          a1 = Math.atan2(fp.y - c.y, fp.x - c.x); a2 = Math.atan2(tp.y - c.y, tp.x - c.x); rad = fp.distanceTo(c);
          var d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; a2 = a1 + d;
        }
        var pts = [], Nn = 72, d2 = a2 - a1;
        for (var i = 0; i <= Nn; i++) { var t = a1 + d2 * i / Nn; pts.push(new THREE.Vector3(Math.cos(t) * rad, Math.sin(t) * rad, 0)); }
        sk.set(pts, false);
        sk.obj.position.copy(c); sk.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      });
      itArc.stroke = sk;
    });

    // arrows / vectors (from -> to)
    (data.arrows || data.vectors || []).forEach(function (ar) {
      var color = ar.color || "#e53935";
      var helper = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, color);
      scene.add(helper);
      var sp = ar.label ? makeLabel(String(ar.label), color) : null; if (sp) scene.add(sp);
      add(ar.id, "arrow", sp ? [helper, sp] : [helper], function () {
        var a = posOf(ar, ["from", "start"]) || (isArr(ar[0]) ? V(ar[0]) : null), b = posOf(ar, ["to", "end"]) || (isArr(ar[1]) ? V(ar[1]) : null);
        if (!a || !b) return; var dir = new THREE.Vector3().subVectors(b, a); var len = dir.length() || 1e-6; dir.normalize();
        helper.position.copy(a); helper.setDirection(dir);
        helper.setLength(len, num(ar.headLength, R * 4.2), num(ar.headWidth, R * 2.6));
        var w = lineWidthOf(ar); if (w > 1.5) helper.line.material.linewidth = w;
        if (sp) { sizeLabel(sp, LS); sp.position.copy(b.clone().add(new THREE.Vector3(LS * 0.6, LS * 0.6, 0))); }
      });
    });

    // dimensions (double-arrow between two points, auto length label)
    (data.dimensions || data.dims || []).forEach(function (dm) {
      var color = dm.color || "#546e7a";
      var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: color }));
      var coneGeo = new THREE.ConeGeometry(R * 2.0, R * 4.2, 12);
      var h1 = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: color }));
      var h2 = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: color }));
      var sp = makeLabel("", color);
      scene.add(line); scene.add(h1); scene.add(h2); scene.add(sp);
      add(dm.id, "dimension", [line, h1, h2, sp], function () {
        var a = posOf(dm, ["from", "a"]) || (isArr(dm[0]) ? V(dm[0]) : null), b = posOf(dm, ["to", "b"]) || (isArr(dm[1]) ? V(dm[1]) : null);
        if (!a || !b) return;
        var off = isArr(dm.offset) ? V(dm.offset) : new THREE.Vector3();
        var A = a.clone().add(off), B = b.clone().add(off);
        line.geometry.dispose(); line.geometry = new THREE.BufferGeometry().setFromPoints([A, B]);
        var u = new THREE.Vector3().subVectors(B, A).normalize();
        h1.position.copy(A); h1.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
        h2.position.copy(B); h2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), u.clone().negate());
        drawLabel(sp, dm.text != null ? dm.text : (Math.round(a.distanceTo(b) * 100) / 100), color);
        sizeLabel(sp, LS * 0.95); sp.position.copy(A.clone().add(B).multiplyScalar(0.5).add(isArr(dm.labelOffset) ? V(dm.labelOffset) : new THREE.Vector3(LS * 0.6, LS * 0.6, 0)));
      });
    });

    // paths (polyline / trajectory)
    (data.paths || []).forEach(function (pa) {
      var stl = styleOf(pa, "#ff00ff");
      var pts = (pa.points || []).map(V); if (pts.length < 2) return;
      var sk = makeStroke(pts, stl.color, lineWidthOf(pa), stl.dashed);
      scene.add(sk.obj);
      var itPath = add(pa.id, "path", [sk.obj], null);
      itPath.stroke = sk;
    });

    // surface unfold (flat net of cylinder / cone / prism)
    (data.surfaceUnfold || data.unfolds || []).forEach(function (u) {
      var color = u.color || "#f9a825", op = u.opacity != null ? u.opacity : 0.14;
      var pos = isArr(u.position) ? V(u.position) : new THREE.Vector3();
      var polys = unfoldPolys(u);
      var grp = new THREE.Group(); grp.position.copy(pos);
      polys.forEach(function (poly) {
        var vs = poly.map(function (p) { return new THREE.Vector3(p[0], p[1], 0); });
        var tri = []; for (var i = 1; i < vs.length - 1; i++) tri.push(vs[0], vs[i], vs[i + 1]);
        var face = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(tri), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }));
        var edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vs.concat([vs[0]])), new THREE.LineBasicMaterial({ color: color }));
        grp.add(face); grp.add(edge);
      });
      if (u.label) { var sp = makeLabel(String(u.label), color); sp.position.set(0, 0, 0); sizeLabel(sp, LS); sp.userData.unfoldLabel = true; grp.add(sp); }
      if (isArr(u.rotation)) grp.rotation.set(num(u.rotation[0], 0), num(u.rotation[1], 0), num(u.rotation[2], 0));
      scene.add(grp);
      add(u.id, "unfold", [grp], null);
    });

    function unfoldPolys(u) {
      var polys = [];
      var r = num(u.radius, 1), h = num(u.height, 2);
      if (u.type === "cylinder") {
        var w = 2 * Math.PI * r;
        polys.push([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]);
        polys.push(circlePts(r, 48).map(function (p) { return [p[0], p[1] + h / 2 + r]; }));
        polys.push(circlePts(r, 48).map(function (p) { return [p[0], p[1] - h / 2 - r]; }));
      } else if (u.type === "cone") {
        var L = num(u.slant, num(u.height, 2) || Math.sqrt(r * r + h * h)) || 2;
        var half = Math.PI * r / L, N = 60, poly = [[0, 0]];
        var a0 = -Math.PI / 2 - half;
        for (var i = 0; i <= N; i++) { var a = a0 + 2 * half * i / N; poly.push([Math.cos(a) * L, Math.sin(a) * L]); }
        polys.push(poly);
      } else if (u.type === "box") {
        var bx = num(u.width, 2) / 2, bz = num(u.depth, 2) / 2, by = num(u.height, 2) / 2;
        polys.push([[-bx, -by], [bx, -by], [bx, by], [-bx, by]]);
        polys.push([[bx, -by], [bx + 2 * bz, -by], [bx + 2 * bz, by], [bx, by]]);
        polys.push([[-bx, by], [bx, by], [bx, by + bz], [-bx, by + bz]]);
        polys.push([[-bx, -by], [bx, -by], [bx, -by - bz], [-bx, -by - bz]]);
        polys.push([[-bx, by], [-bx, by + bz], [-bx - bx, by + bz], [-bx - bx, by]]);
      } else {
        var n = u.sides || 3, s = num(u.sideLength, num(u.radius, 1)), total = n * s;
        for (var k = 0; k < n; k++) polys.push([[-total / 2 + k * s, -h / 2], [-total / 2 + (k + 1) * s, -h / 2], [-total / 2 + (k + 1) * s, h / 2], [-total / 2 + k * s, h / 2]]);
      }
      return polys;
    }

    // initial visibility (spec.visible === false -> hidden)
    items.forEach(function (it) { if (it.id != null && specAll[String(it.id)] && specAll[String(it.id)].visible === false) it.vis = false; });

    // 同一平面的网格由父面 + 别名共享：任一项可见就可见，避免别名 id 的显隐把父面误关。
    function groupVis(g) { for (var i = 0; i < g.items.length; i++) if (g.items[i].vis !== false) return true; return false; }
    function applyVis(it) {
      if (it.group) { var v = groupVis(it.group); it.group.objs.forEach(function (o) { o.visible = v; }); }
      else it.objs.forEach(function (o) { o.visible = it.vis; });
    }
    function setVisible(it, v) { it.vis = v; applyVis(it); }
    function refresh() {
      G.coords = resolveCoords();
      dynamic.forEach(function (it) { try { it.update(); } catch (e) {} });
      items.forEach(applyVis);
    }
    // ---- 分步 / 答案高亮：线段和平面没有 emissive，必须改 color；半透明面同时提 opacity ----
    // 2026-10-20：原实现只设 material.emissive，LineBasicMaterial / MeshBasicMaterial 没有该属性，
    // 所以 3D 分步里线段和平面从来不会变色。这里按材质类型做通用高亮，并在 clear 时还原。
    var HL_COLOR = 0xff00ff;   // 3D 高亮用亮品红：题目里常用的玫红 #e91e63 已有 P/M/Q/DP，避免撞色
    function matsOf(o) {
      var out = [];
      (function add(x) {
        if (!x) return;
        if (x.material) {
          (Array.isArray(x.material) ? x.material : [x.material]).forEach(function (m) { out.push(m); });
        }
        if (x.children && x.children.length) x.children.forEach(add);
      })(o);
      return out;
    }
    function highlight(it) {
      it.objs.forEach(function (o) {
        matsOf(o).forEach(function (m) {
          if (m.isSpriteMaterial) return;                 // 文字标签不染色，避免影响可读性
          if (!m.userData) m.userData = {};
          if (!m.userData.__hl) {
            m.userData.__hl = {
              color: m.color ? m.color.getHex() : null,
              emissive: m.emissive ? m.emissive.getHex() : null,
              emissiveIntensity: (m.emissiveIntensity != null ? m.emissiveIntensity : null),
              opacity: (m.transparent ? m.opacity : null)
            };
          }
          if (m.emissive) {
            m.emissive.setHex(HL_COLOR);
            if (m.emissiveIntensity != null) m.emissiveIntensity = 0.9;
          } else if (m.color) {
            m.color.setHex(HL_COLOR);
          }
          if (m.transparent && m.userData.__hl.opacity != null) {
            m.opacity = Math.max(m.userData.__hl.opacity, 0.34);
          }
        });
      });
    }
    function clearHighlight() {
      items.forEach(function (it) {
        it.objs.forEach(function (o) {
          matsOf(o).forEach(function (m) {
            var h = m.userData && m.userData.__hl;
            if (!h) return;
            if (h.color != null && m.color) m.color.setHex(h.color);
            if (h.emissive != null && m.emissive) m.emissive.setHex(h.emissive);
            if (h.emissiveIntensity != null && m.emissiveIntensity != null) m.emissiveIntensity = h.emissiveIntensity;
            if (h.opacity != null) m.opacity = h.opacity;
            delete m.userData.__hl;
          });
        });
      });
    }

    // ---- 手动样式调整（对象面板滑杆调用；直接改 spec，随记录/导出保存）----
    function setPointSize(id, radius) {
      var it = byId[String(id)]; if (!it || it.type !== "point") return false;
      var r = Number(radius); if (!isFinite(r) || r <= 0) return false;
      var mesh = it.objs[0]; if (!mesh || !mesh.scale) return false;
      if (it.spec) it.spec.size = r;
      mesh.scale.setScalar(r);
      return true;
    }
    function setSphereRadius(id, radius) {
      var it = byId[String(id)]; if (!it || it.type !== "sphere") return false;
      var r = Number(radius); if (!isFinite(r) || r <= 0) return false;
      var mesh = it.objs[0]; if (!mesh || !mesh.geometry) return false;
      if (it.spec) it.spec.radius = r;
      mesh.geometry.dispose();
      mesh.geometry = new THREE.SphereGeometry(r, 40, 28);
      return true;
    }
    function setLineWidth(id, width) {
      var it = byId[String(id)]; if (!it || !it.stroke) return false;
      var w = Number(width); if (!isFinite(w) || w <= 0) return false;
      w = Math.max(0.5, Math.min(6, w));
      var old = it.stroke, oldObj = old.obj;
      var next = makeStroke(old.points, old.color, w, old.dashed);
      try {
        next.obj.position.copy(oldObj.position);
        next.obj.quaternion.copy(oldObj.quaternion);
        next.obj.visible = oldObj.visible;
      } catch (e) {}
      var parent = oldObj.parent || scene;
      try { parent.add(next.obj); parent.remove(oldObj); } catch (e2) {}
      disposeObj(oldObj);
      it.objs = it.objs.map(function (o) { return o === oldObj ? next.obj : o; });
      // 原对象就地换壳，让已有的 update 闭包继续生效；
      // set 包一层，把 next 每次重建后的 points/width 同步回 old，避免下次调线宽用到旧几何。
      old.set = function (np, nc) { next.set(np, nc); old.points = next.points; old.closed = next.closed; old.width = next.width; };
      old.obj = next.obj; old.tube = next.tube; old.width = next.width; old.points = next.points; old.closed = next.closed;
      if (it.spec) it.spec.lineWidth = w;
      return true;
    }

    return { refresh: refresh, items: items, byId: byId, setVisible: setVisible, highlight: highlight, clearHighlight: clearHighlight, sliders: sliders, stepEls: stepEls, pointRadius: R, setPointSize: setPointSize, setSphereRadius: setSphereRadius, setLineWidth: setLineWidth };
  }

  // =========================================================
  function buildUI(container, api, data) {
    var wrap = document.createElement("div");
    wrap.className = "g3d-wrap";
    wrap.style.cssText = "position:absolute;inset:0;pointer-events:none;font-family:'Microsoft YaHei',sans-serif;";
    container.appendChild(wrap); st.ui = wrap;
    function panel(cls, css) { var d = document.createElement("div"); d.className = "g3d-panel " + cls; d.style.cssText = "pointer-events:auto;background:rgba(255,255,255,.95);border:1px solid #e2e2e2;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.10);" + css; wrap.appendChild(d); return d; }

    // multi-scene tabs
    if (st.scenes && st.scenes.length > 1) {
      var tb = panel("g3d-tabs", "position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:5px 6px;display:flex;gap:5px;max-width:70%;overflow:auto;");
      st.scenes.forEach(function (sc, i) {
        var b = document.createElement("button");
        b.textContent = (sc && (sc.title || sc.name)) ? (sc.title || sc.name) : ("图" + (i + 1));
        b.style.cssText = "font-size:12.5px;padding:3px 11px;border-radius:7px;cursor:pointer;white-space:nowrap;border:1px solid " + (i === st.idx ? "#1890ff" : "#d0d0d0") + ";background:" + (i === st.idx ? "#1890ff" : "#fff") + ";color:" + (i === st.idx ? "#fff" : "#333") + ";";
        setPanelText(b, (sc && (sc.title || sc.name)) ? (sc.title || sc.name) : ("图" + (i + 1)));
        b.style.cssText = "font-size:12.5px;padding:3px 11px;border-radius:7px;cursor:pointer;white-space:nowrap;border:1px solid " + (i === st.idx ? "#1890ff" : "#d0d0d0") + ";background:" + (i === st.idx ? "#1890ff" : "#fff") + ";color:" + (i === st.idx ? "#fff" : "#333") + ";";
        b.onclick = function () { if (i === st.idx) return; st.idx = i; renderScene(); };
        tb.appendChild(b);
      });
    }

    if (api.sliders.length) {
      var sp = panel("g3d-sliders", "position:absolute;left:12px;bottom:12px;padding:9px 12px;max-width:300px;box-sizing:border-box;");
      // 标题行 + 复位：导出页没有 ui.js，滑块面板由这里负责（应用内由左栏负责，见 ui.js）
      var srows = [];
      var shd = document.createElement("div");
      shd.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:2px;";
      var sht = document.createElement("span"); sht.textContent = "参数";
      sht.style.cssText = "font-size:11px;color:#8a9099;letter-spacing:.5px;flex:1;";
      var srb = document.createElement("button"); srb.type = "button";
      // 导出页没有 icons.js，这里直接内联 svg，别用 <use href="#i-...">
      srb.innerHTML = '<svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-2px"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';
      srb.title = "把所有参数恢复到初始值";
      srb.style.cssText = "font-size:11px;line-height:1.6;padding:0 8px;border:1px solid #d0d0d0;border-radius:5px;background:#fff;color:#5b5bd6;cursor:pointer;font-family:inherit;";
      srb.onclick = function () {
        srows.forEach(function (r) {
          var dv = (r.s.defaultValue != null) ? r.s.defaultValue : r.s.value;
          r.s.value = dv; r.inp.value = dv; r.val.textContent = Number(dv).toFixed(2);
        });
        api.refresh();
      };
      shd.appendChild(sht); shd.appendChild(srb); sp.appendChild(shd);
      api.sliders.forEach(function (s) {
        // 这层浮层只在「没有 ui.js 接管」时才出现（见文件末尾 buildUI 的调用条件）；
        // 应用内与导出页都由 ui.js / exportUi 负责，改那边的布局才生效。
        // 这里仍按窄屏可用的形式排版：标签和数值一行，整条滑杆独占下一行。
        var row = document.createElement("div"); row.className = "g3d-slider-row";
        row.style.cssText = "display:flex;align-items:center;gap:8px;margin:4px 0;flex-wrap:wrap;min-width:0;";
        var lb = document.createElement("span"); setPanelText(lb, s.label);
        lb.className = "g3d-slider-lb";
        lb.style.cssText = "font-size:12.5px;color:#444;min-width:0;flex:1 1 auto;overflow-wrap:anywhere;line-height:1.45;";
        var inp = document.createElement("input"); inp.type = "range"; inp.min = s.min; inp.max = s.max; inp.step = s.step; inp.value = s.value;
        inp.className = "g3d-slider-inp";
        inp.style.cssText = "flex:1 1 100%;min-width:0;width:100%;margin:2px 0 0;order:3;";
        var val = document.createElement("span"); val.textContent = Number(s.value).toFixed(2);
        val.className = "g3d-slider-val";
        val.style.cssText = "font-size:12px;color:#888;min-width:36px;text-align:right;flex:0 0 auto;order:2;";
        inp.oninput = function () { s.value = Number(inp.value); val.textContent = s.value.toFixed(2); api.refresh(); };
        row.appendChild(lb); row.appendChild(val); row.appendChild(inp); sp.appendChild(row);
        srows.push({ s: s, inp: inp, val: val });
      });
    }

    var steps = data.steps || [];
    if (steps.length) {
      var stp = panel("g3d-steps", "position:absolute;left:12px;top:12px;padding:9px 12px;max-width:340px;max-height:62%;overflow:auto;");
      var bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;";
      var cur = -1, playing = false;
      var title = document.createElement("div"); title.style.cssText = "font-size:13px;font-weight:600;color:#111;margin-bottom:4px;";
      var desc = document.createElement("div"); desc.style.cssText = "font-size:12.5px;color:#333;line-height:1.65;white-space:pre-wrap;";
      function mkBtn(t, fn) { var b = document.createElement("button"); b.textContent = t; b.style.cssText = "font-size:12px;padding:3px 9px;border:1px solid #d0d0d0;border-radius:6px;background:#fff;cursor:pointer;"; b.onclick = fn; return b; }
      function applySteps(k) {
        var shown = {}; for (var i = 0; i <= k; i++) (steps[i].elements || []).forEach(function (e) { if (e.targetId) shown[String(e.targetId)] = true; });
        // 导出页的小问标签：元素还要满足当前小问的 targets（与 App 的 applyView3D 同口径）
        var sc = window.HJ_EXPORT_SCOPE || null;
        var scope = sc && sc.scope, union = sc && sc.union;
        api.items.forEach(function (it) {
          if (it.id != null && api.stepEls[String(it.id)]) {
            var id = String(it.id);
            var vis = k < 0 ? true : !!shown[id];
            if (scope && union && union[id] && !scope[id]) vis = false;
            api.setVisible(it, vis);
          }
        });
        api.clearHighlight();
        if (k >= 0) (steps[k].elements || []).forEach(function (e) { var it = api.byId[String(e.targetId)]; if (it) api.highlight(it); });
      }
      function setStep(k) { cur = k; var s = steps[k] || {}; setPanelText(title, (k + 1) + "/" + steps.length + "  " + (s.title || "")); setRich(desc, s.description || ""); applySteps(k); }
      function showAllSteps() { stopPlay(); cur = -1; applySteps(-1); setPanelText(title, "全部元素"); desc.textContent = ""; }
      api.showAllSteps = showAllSteps;
      api.applySteps = applySteps;
      api.getStep = function () { return cur; };
      function stopPlay() { (G && G.timers || []).forEach(function (t) { clearTimeout(t); }); if (G) G.timers = []; playing = false; playB.textContent = "播放"; }
      function play() {
        if (playing) { stopPlay(); return; }
        stopPlay(); playing = true; playB.textContent = "暂停";
        var tl = data.timeline || [], acc = 0;
        for (var i = 0; i < steps.length; i++) { (function (i) { var d = (tl[i] && tl[i].durationMs) || 1300; G.timers.push(setTimeout(function () { setStep(i); if (i === steps.length - 1) playing = false, playB.textContent = "播放"; }, acc)); acc += d; })(i); }
      }
      var prevB = mkBtn("◀", function () { stopPlay(); setStep(Math.max(0, (cur < 0 ? steps.length : cur) - 1)); });
      var nextB = mkBtn("▶", function () { stopPlay(); setStep(Math.min(steps.length - 1, cur + 1)); });
      var playB = mkBtn("播放", play);
      var allB = mkBtn("全部", showAllSteps);
      bar.appendChild(prevB); bar.appendChild(nextB); bar.appendChild(playB); bar.appendChild(allB);
      stp.appendChild(bar); stp.appendChild(title); stp.appendChild(desc);
      setStep(steps.length - 1);
    }

    var ov = data.answerOverlays || [];
    if (ov.length) {
      var op = panel("g3d-answers", "position:absolute;right:12px;bottom:12px;padding:9px 12px;max-width:320px;max-height:52%;overflow:auto;");
      var oh = document.createElement("div"); oh.style.cssText = "font-size:12.5px;font-weight:600;color:#111;margin-bottom:5px;"; oh.textContent = "答案 / 解析"; op.appendChild(oh);
      ov.forEach(function (o) {
        var b = document.createElement("button"); setPanelText(b, o.title || "查看"); b.style.cssText = "display:block;width:100%;text-align:left;font-size:12.5px;padding:4px 8px;margin:3px 0;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;cursor:pointer;";
        var body = document.createElement("div"); body.style.cssText = "font-size:12.5px;color:#333;line-height:1.65;white-space:pre-wrap;display:none;margin-top:4px;";
        setRich(body, o.description || "");
        b.onclick = function () { var show = body.style.display === "none"; body.style.display = show ? "block" : "none"; if (show) { api.clearHighlight(); (o.elements || []).forEach(function (e) { var it = api.byId[String(e.targetId)]; if (it) api.highlight(it); }); } else api.clearHighlight(); };
        op.appendChild(b); op.appendChild(body);
      });
    }

    // focus targets (camera fly-to)
    var fts = data.focusTargets || [];
    if (fts.length) {
      var fp = panel("g3d-focus", "position:absolute;right:12px;top:12px;padding:8px 10px;max-width:200px;");
      var fh = document.createElement("div"); fh.textContent = "聚焦"; fh.style.cssText = "font-size:12px;font-weight:600;color:#111;margin-bottom:5px;";
      fp.appendChild(fh);
      fts.forEach(function (ft) {
        var b = document.createElement("button");
        setPanelText(b, ft.label || ft.title || ft.id || "聚焦");
        b.style.cssText = "display:block;width:100%;text-align:left;font-size:12.5px;padding:4px 8px;margin:3px 0;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;cursor:pointer;";
        b.onclick = function () { focusOn(api, ft); };
        fp.appendChild(b);
      });
    }
  }

  // =========================================================
  function focusOn(api, ft) {
    if (!st.camera || !st.controls) return;
    var center = null, radius = null;
    var t = ft.target;
    var it = (typeof t === "string") ? api.byId[String(t)] : (t && t.id ? api.byId[String(t.id)] : null);
    if (it) {
      var box = new THREE.Box3();
      it.objs.forEach(function (o) { try { box.expandByObject(o); } catch (e) {} });
      if (isFinite(box.min.x)) { center = box.getCenter(new THREE.Vector3()); radius = box.getSize(new THREE.Vector3()).length() / 2; }
    }
    if (!center && isArr(ft.position)) center = V(ft.position);
    if (!center && isArr(ft.target)) center = V(ft.target);
    if (!center) return;
    var dist = num(ft.distance, radius ? Math.max(radius * 4, 3) : st.camera.position.distanceTo(st.controls.target));
    var dir = new THREE.Vector3().subVectors(st.camera.position, st.controls.target).normalize();
    var toPos = center.clone().add(dir.multiplyScalar(dist));
    st.tween = { t0: performance.now(), dur: 650, fromPos: st.camera.position.clone(), toPos: toPos, fromTgt: st.controls.target.clone(), toTgt: center.clone() };
    api.clearHighlight(); if (it) api.highlight(it);
  }

  // =========================================================
  function renderScene() {
    clearView();
    var container = st.container, data = st.base;
    var scene = st.scenes ? st.scenes[st.idx] : data;
    var coord = (scene && scene.coordinateSystem) || data.coordinateSystem || {};
    var up = (coord.upAxis === "z") ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);

    var all = [];
    (scene.points || []).forEach(function (p) { if (isArr(p.coords)) all.push(V(p.coords)); });
    (scene.paths || []).forEach(function (p) { (p.points || []).forEach(function (c) { if (isArr(c)) all.push(V(c)); }); });
    (scene.cylinders || []).forEach(function (c) { if (isArr(c.start)) all.push(V(c.start)); if (isArr(c.end)) all.push(V(c.end)); });
    (scene.spheres || []).forEach(function (s) { var c = s.centerPointId && scene.points ? scene.points.filter(function (p) { return p.id === s.centerPointId; })[0] : null; if (c && isArr(c.coords)) all.push(V(c.coords)); });
    (scene.surfaceUnfold || scene.unfolds || []).forEach(function (u) {
      if (!isArr(u.position)) return;
      var rr = num(u.radius, 1), hh = num(u.height, 2);
      var e = Math.max(Math.PI * rr, hh / 2 + rr, num(u.width, 0) / 2, num(u.sideLength, 0) * (u.sides || 1) / 2, 1);
      var p = V(u.position);
      all.push(p.clone().add(new THREE.Vector3(e, e, 0)), p.clone().add(new THREE.Vector3(-e, -e, 0)));
    });
    if (!all.length) all.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
    var box = new THREE.Box3().setFromPoints(all);
    if (!isFinite(box.min.x)) box.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)]);
    var center = box.getCenter(new THREE.Vector3()), sizeV = box.getSize(new THREE.Vector3());
    var size = Math.max(sizeV.x, sizeV.y, sizeV.z) || 1;
    // R：3D 点位小球半径 / 粗线管半径的基准（按场景最大尺寸取比例）
    R = Math.max(size * 0.010, 1e-6);
    LS = Math.max(size * 0.05, 1e-6);

    var W = container.clientWidth || 800, H = container.clientHeight || 600;
    st.gridMesh = null;
    var renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1); renderer.setSize(W, H); renderer.setClearColor(0xffffff, 1);
    container.innerHTML = ""; container.appendChild(renderer.domElement);
    st.renderer = renderer;

    var threescene = new THREE.Scene(); st.scene = threescene;
    threescene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 1.0));
    var dl = new THREE.DirectionalLight(0xffffff, 0.55); dl.position.set(2, 3, 2); threescene.add(dl);

    var cam = new THREE.PerspectiveCamera(45, W / H, 0.01, size * 200); cam.up.copy(up);
    var dist = (scene.camera && scene.camera.distance) ? scene.camera.distance : Math.max(size * 2.3, 3);
    // 默认观察方向：-y 侧、仰角 25°（≈ 方位 -75°）。
    // 为什么不是原来的 (1, 0.7, 1.3)：那个方向在 +y 一侧，会把"后角"画到最前面——
    // 教材图里画在最低处（最靠前）的顶点会跑到画面深处，整张图左右镜像、前后颠倒（§72）。
    // 这条只是默认值；模型给了 camera.position 就照模型的来。
    var DEF_DIR = new THREE.Vector3(0.2346, -0.8754, 0.4226);
    var camPos = (scene.camera && isArr(scene.camera.position)) ? V(scene.camera.position) : center.clone().add(DEF_DIR.clone().multiplyScalar(dist));
    cam.position.copy(camPos); cam.lookAt(center); st.camera = cam;

    // ---- 坐标轴（2026-10-20 新增 scene.axes）----
    // 三种写法：
    //   省略                      → 保持老行为：一条 THREE.AxesHelper（三色细线、无字母）
    //   false 或 {show:false}     → 不画坐标轴
    //   {labels:true, length:3}   → 画三条带箭头的三色轴，轴端标 x / y / z（建系题用这个）
    // 为什么要自己画而不是直接用 AxesHelper：AxesHelper 只有三条线、没有箭头、也没有字母，
    // 而教辅书里的建系图是「带箭头的三色轴 + x/y/z 字母」。
    // 轴长必须**超出几何体**（见下方 1.35 倍）：若只画到顶点，轴会和棱完全重合、看起来就是三条棱。
    var axCfg = scene.axes;
    var axShow = !(axCfg === false || (axCfg && typeof axCfg === "object" && axCfg.show === false));
    if (axShow) {
      if (axCfg && typeof axCfg === "object") {
        // 轴长：默认「伸到该方向最远的顶点之外一点点」，三条轴各自算。
        // 原来三条轴统一用 size*1.1（最大跨度），对「底面很宽、高很小」的棱柱，
        // y/z 轴会白伸三倍长——取景时把包围盒撑大、相机被顶远，图形只剩画布 1/5（§72）。
        var axFixed = (Number(axCfg.length) > 0) ? Number(axCfg.length) : 0;
        var axWithLb = (axCfg.labels !== false);
        var axReach = [0, 0, 0];
        (scene.points || []).forEach(function (p) {
          var c = p.coords || p.position || p.xyz;
          if (!isArr(c)) return;
          for (var i = 0; i < 3; i++) { var v = Math.abs(Number(c[i]) || 0); if (v > axReach[i]) axReach[i] = v; }
        });
        [[1, 0, 0, "x", 0xc62828], [0, 1, 0, "y", 0x2e7d32], [0, 0, 1, "z", 0x1565c0]].forEach(function (a, ai) {
          var axLen = axFixed || Math.max(axReach[ai] * 1.12, size * 0.4);
          var axHead = axLen * 0.075;
          var axDir = new THREE.Vector3(a[0], a[1], a[2]);
          threescene.add(new THREE.ArrowHelper(axDir, new THREE.Vector3(0, 0, 0), axLen, a[4], axHead, axHead * 0.5));
          if (axWithLb) {
            var axSp = makeLabel(a[3], "#" + ("000000" + a[4].toString(16)).slice(-6));
            sizeLabel(axSp, Math.max(axLen * 0.085, 1e-6));
            // 字母放在箭头尖端之外一点，避免盖住箭头，也避免和顶点标签重叠
            axSp.position.copy(axDir.clone().multiplyScalar(axLen + axHead * 1.6));
            threescene.add(axSp);
          }
        });
      } else {
        threescene.add(new THREE.AxesHelper(size * 0.9));
      }
    }

    var api = build(threescene, scene);
    api.refresh();
    st.api = api;

    // 取景：坐标轴长 1.1×跨度、字母还要再外移，必须都装得下。
    // 但原来的写法有两个毛病：① 用「包围球 / sin(半视角)」，球的半径是盒子的 √3 倍，白白把相机推远；
    // ② 只「装不下才后退」，模型随手写个大 distance 就一直是小图（§72：图形只占画布 1/5）。
    // 现在改成：把包围盒 8 个角点投到相机平面，按横/纵半视角分别算距离取最大值；太远也拉近。
    try {
      var fitBox = new THREE.Box3().setFromObject(threescene);
      if (isFinite(fitBox.min.x)) {
        var dirC = cam.position.clone().sub(center).normalize();
        var vHalf = (cam.fov / 2) * Math.PI / 180;
        var hHalf = Math.atan(Math.tan(vHalf) * (cam.aspect || 1));
        var rightV = new THREE.Vector3().crossVectors(cam.up, dirC).normalize();
        var upV = new THREE.Vector3().crossVectors(dirC, rightV).normalize();
        var needDist = 0;
        for (var ci = 0; ci < 8; ci++) {
          var corner = new THREE.Vector3((ci & 1) ? fitBox.max.x : fitBox.min.x, (ci & 2) ? fitBox.max.y : fitBox.min.y, (ci & 4) ? fitBox.max.z : fitBox.min.z);
          var rel = corner.sub(center);
          var zf = rel.dot(dirC);                                  // 朝相机为正
          var dNeed = Math.max(Math.abs(rel.dot(rightV)) / Math.tan(hHalf), Math.abs(rel.dot(upV)) / Math.tan(vHalf)) + zf;
          if (dNeed > needDist) needDist = dNeed;
        }
        needDist = needDist * 1.12;
        var curDist = cam.position.distanceTo(center);
        if (isFinite(needDist) && needDist > 0 && Math.abs(needDist - curDist) > curDist * 0.02) {
          cam.position.copy(center).add(dirC.multiplyScalar(needDist));
          cam.lookAt(center);
          cam.updateProjectionMatrix();
        }
      }
    } catch (e) {}

    // 建系题自动铺坐标纸：只在 xOy 底面画一层、每 1 单位一格、不标数字。
    // 默认开，模型可写 "axes":{"grid":false} 关掉。放在取景之后，避免网格把相机推远、图形变小。
    if (axShow && axCfg && typeof axCfg === "object" && axCfg.grid !== false) {
      try {
        var gSpan = Math.max(2, Math.ceil(Math.max(sizeV.x, sizeV.y, 1) + 2));
        if (gSpan % 2) gSpan += 1;                       // 偶数格，保证线落在整数坐标上
        var gridMesh = new THREE.GridHelper(gSpan, gSpan, 0xd0d0d0, 0xe8e8e8);
        gridMesh.rotation.x = Math.PI / 2;              // 默认在 XZ 平面，转到 xOy
        // 居中点取「整数 + 半跨度」，这样每条网格线都恰好落在整数坐标上（否则会误导读坐标）
        var gx = Math.round(center.x - gSpan / 2) + gSpan / 2;
        var gy = Math.round(center.y - gSpan / 2) + gSpan / 2;
        gridMesh.position.set(gx, gy, box.min.z - Math.max(size * 0.002, 0.002));
        gridMesh.material.transparent = true;
        gridMesh.material.opacity = 0.9;
        gridMesh.visible = st.gridOn !== false;
        st.gridMesh = gridMesh;
        threescene.add(gridMesh);
      } catch (eGrid) {}
    }

    var controls = new THREE.OrbitControls(cam, renderer.domElement);
    controls.target.copy(center); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.update(); st.controls = controls;

    // 记录初始相机，供「复位视图」使用
    st.cam0 = { pos: cam.position.clone(), tgt: controls.target.clone() };

    // 悬停拾取：画布上的三维元素 → 左侧对象列表高亮
    var pickables = [], hoverId = null;
    api.items.forEach(function (it) {
      if (it.id == null) return;
      it.objs.forEach(function (o) {
        if (!o) return;
        o.traverse(function (n) { n.userData.__hjItemId = it.id; });
        pickables.push(o);
      });
    });
    var raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = Math.max(R * 0.45, 0.01);
    var pickPtr = new THREE.Vector2();
    function setHoverId(id) {
      if (id === hoverId) return;
      hoverId = id;
      if (window.HJ && window.HJ.hoverObject) window.HJ.hoverObject(id == null ? null : String(id));
    }
    renderer.domElement.addEventListener("pointermove", function (ev) {
      var rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pickPtr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pickPtr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pickPtr, cam);
      var hits = raycaster.intersectObjects(pickables, true);
      var id = null;
      for (var i = 0; i < hits.length; i++) {
        var p = hits[i].object;
        while (p && p.userData.__hjItemId == null) p = p.parent;
        if (!p) continue;
        var it = api.byId[String(p.userData.__hjItemId)];
        if (!it || it.vis === false) continue;
        id = it.id;
        break;
      }
      setHoverId(id);
    });
    renderer.domElement.addEventListener("pointerleave", function () { setHoverId(null); });

    // 3D 的步骤/滑块/多图切换改由 ui.js 统一渲染（不再自建浮层）
    if (!window.HJ || !window.HJ.afterRender3D) buildUI(container, api, scene);

    st.ro = new ResizeObserver(function () { var w = container.clientWidth, h = container.clientHeight; if (!w || !h || !st.renderer) return; st.camera.aspect = w / h; st.camera.updateProjectionMatrix(); st.renderer.setSize(w, h); });
    st.ro.observe(container);

    st.t = 0;
    (function loop(now) {
      st.raf = requestAnimationFrame(loop);
      if (st.tween) {
        var k = Math.min(1, (performance.now() - st.tween.t0) / st.tween.dur);
        var e = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;
        st.camera.position.lerpVectors(st.tween.fromPos, st.tween.toPos, e);
        st.controls.target.lerpVectors(st.tween.fromTgt, st.tween.toTgt, e);
        if (k >= 1) st.tween = null;
      }
      if (st.controls) st.controls.update();
      if (st.renderer) st.renderer.render(st.scene, st.camera);
    })();
  }

  // 顶层场景与图集第一张是否同一张图（按点集判断）：相同就不重复插入，避免出现两个一样的标签
  function sameScenePayload(a, b) {
    if (!a || !b) return false;
    var key = function (o) {
      return (o.points || []).map(function (p) { return p.id + "@" + (p.coords || []).join(","); }).join("|");
    };
    var ka = key(a), kb = key(b);
    return !!ka && ka === kb;
  }
  function render(container, data) {
    dispose();
    st.container = container;
    st.base = data || {};
    // 保留 payload 的原始引用：手动改样式（小球/线宽）直接写回 render3d，随记录/导出保存
    var qs = (st.base.questionScenes && st.base.questionScenes.length) ? st.base.questionScenes.map(function (s) {
      if (!s || !s.payload) return s;
      if (s.title && s.payload.title == null) s.payload.title = s.title;
      return s.payload;
    }) : null;
    // 兜底：模型常把主图放顶层、附加图放 questionScenes，
    // 而这里原来「有图集就只认图集」会把顶层整张丢掉。顶层有图且与图集首张不同，就并成第一张。
    if (qs) {
      var baseHasFig = (st.base.points && st.base.points.length) || (st.base.paths && st.base.paths.length);
      if (baseHasFig && !sameScenePayload(st.base, qs[0])) {
        var head = {};
        for (var k in st.base) if (Object.prototype.hasOwnProperty.call(st.base, k) && k !== "questionScenes") head[k] = st.base[k];
        if (!head.title) head.title = "主图";
        qs = [head].concat(qs);
      }
    }
    st.scenes = qs;
    st.idx = 0;
    renderScene();
  }

  function snapshot() {
    if (!st.renderer || !st.scene || !st.camera) return "";
    try { st.renderer.render(st.scene, st.camera); return st.renderer.domElement.toDataURL("image/png"); } catch (e) { return ""; }
  }

  function focus(ft) { if (st.api) focusOn(st.api, ft); }

  // ---- v2 UI 接口（对象面板 / 复位视图 / 尺寸自适应） ----
  function getApi() { return st.api; }
  function getScene() { return st.scenes ? st.scenes[st.idx] : st.base; }
  function resetView() {
    if (!st.camera || !st.controls) return;
    st.tween = null;
    // 用首次渲染时记录的相机与目标复位
    if (st.cam0) {
      st.camera.position.copy(st.cam0.pos);
      st.controls.target.copy(st.cam0.tgt);
      st.camera.updateProjectionMatrix();
      st.controls.update();
    }
  }
  function resize() {
    if (!st.renderer || !st.camera || !st.container) return;
    var w = st.container.clientWidth, h = st.container.clientHeight;
    if (!w || !h) return;
    st.camera.aspect = w / h;
    st.camera.updateProjectionMatrix();
    st.renderer.setSize(w, h);
  }

  window.GGB3D = {
    render: render, dispose: dispose, focus: focus, snapshot: snapshot, focusOn: focusOn,
    getApi: getApi, getScene: getScene, resetView: resetView, resize: resize,
    setGrid: function (v) { st.gridOn = !!v; if (st.gridMesh) st.gridMesh.visible = !!v; },
    hasGrid: function () { return !!st.gridMesh; },
    gridVisible: function () { return !!(st.gridMesh && st.gridMesh.visible); },
    texPlain: texPlain, texRuns: texRuns
  };
})();
