/* =========================================================
   何解 · B′ 外壳（mobile-sheet.js）
   ---------------------------------------------------------
   结构：
     第一层 #stage    画布铺满，尺寸恒定（JSXGraph 只初始化一次）
     第二层 #rightPanel 浮层，盖在画布上，连续拖拽 + 松手吸附 3 档
     首页 #mHome      收题（把原来的 #inputRow 搬进来）

   判定规则抄平台标准做法（见 mobile/UI-DIRECTIONS-2.md）：
     · 松手吸附：先看甩动速度，再看距离最近 —— iOS UISheetPresentationController.detents
     · 内容区也能拖：没展开时上滑先展开；展开后内容滚到顶再下拉才收 —— iOS
       prefersScrollingExpandsWhenScrolledToEdge / Android 嵌套滚动
     · 浮层只 translate 不 scale；画布只 translate 不 scale（保住 JSXGraph 坐标换算）

   只在 max-width:760px 生效；回桌面宽度自动还原（节点搬回原位）。
   ========================================================= */
(function () {
  "use strict";
  if (window.HJSheet) return;
  window.HJSheet = true;

  var MQ = window.matchMedia("(max-width: 760px)");
  var DET = [0, 0, 0];          // 0 全屏 / 1 半屏 / 2 答案条
  var offset = 0, maxOffset = 0;
  var panelH = 0, stageH = 0, peekPx = 156;   // 拖拽期间复用，避免每帧读布局
  var built = false, moved = [], resultShown = false;
  var snapTimer = null;
  var objPage = null, objMoved = null, objBar = null, barKey = null;
  var solveCard = null, solveTimer = null, solveStart = 0;
  var qCard = null, qCardMo = null;
  var P0 = { metaBtn: null, metaMo: null, tabs: null, tabsMo: null, tabsSync: null, more: null, moreMo: null };

  var ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9"/><path d="M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2"/><path d="M1 1l22 22"/></svg>';
  var ICON_FOCUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---------------- 首页层 ---------------- */
  function buildHome() {
    if ($("mHome")) return;
    var home = mk("div");
    home.id = "mHome";
    home.innerHTML =
      '<div class="mh-body">' +
        '<div class="mh-lead">拍一道题，或者把题目粘进来</div>' +
        '<div class="mh-sub">动态图形 · 可拖动 · 分步讲解</div>' +
        '<div class="mh-card"></div>' +
        '<div class="mh-acts">' +
          '<button type="button" id="mhGo" class="mh-go">解题</button>' +
          '<button type="button" id="mhPhoto">拍照</button>' +
          '<button type="button" id="mhAlbum">相册</button>' +
        '</div>' +
        '<div class="mh-steps">' +
          '<div><b>1</b><span>拍照 / 粘贴</span></div>' +
          '<div><b>2</b><span>生成动态图</span></div>' +
          '<div><b>3</b><span>上滑看解析</span></div>' +
        '</div>' +
        '<div class="mh-sec" id="mhRecentSec" hidden>' +
          '<div class="mh-sec-h"><span>最近解题</span><button type="button" id="mhAll">全部</button></div>' +
          '<div class="mh-recent-list" id="mhRecent"></div>' +
        '</div>' +
        '<div class="mh-sec">' +
          '<div class="mh-sec-h"><span>试试这些</span></div>' +
          '<div class="mh-examples" id="mhExamples"></div>' +
        '</div>' +
      '</div>';
    // 把真正的输入行搬进首页卡（节点不重建，solver.js 的事件都还在）
    var row = $("inputRow");
    if (row) {
      var rowParent = row.parentNode, rowNext = row.nextSibling;   // 先记，再搬
      home.querySelector(".mh-card").appendChild(row);
      moved.push({ el: row, parent: rowParent, next: rowNext });
    }
    document.getElementById("app").appendChild(home);

    // 对象面板入口也从画布左上搬到顶栏（画布上每多一个浮层，图就少一块）
    var objBtn = $("mObjBtn");
    var bar0 = document.querySelector(".topbar");
    if (objBtn && bar0) {
      moved.push({ el: objBtn, parent: objBtn.parentNode, next: objBtn.nextSibling });
      bar0.insertBefore(objBtn, bar0.firstChild);
    }

    // 顶栏放"页面级动作"：把原来塞在 ⋯ 里的历史/导出/设置搬到顶栏（图标态）
    ["btnHist", "btnHtml", "btnCfg"].forEach(function (id) {
      var b = $(id);
      if (!b) return;
      moved.push({ el: b, parent: b.parentNode, next: b.nextSibling });
      var menu = $("mMenuBtn");
      if (menu && menu.parentNode === document.querySelector(".topbar")) menu.parentNode.insertBefore(b, menu);
      else document.querySelector(".topbar").appendChild(b);
    });

    // 模型状态点放到最右（⋯ 之前），左边留给对象/历史这些动作
    var chip2 = $("cfg"), menu2 = $("mMenuBtn");
    if (chip2 && menu2 && menu2.parentNode === document.querySelector(".topbar")) {
      menu2.parentNode.insertBefore(chip2, menu2);
    }

    // 顶栏首页入口：紫色房子图标，固定左上角第一；有结果才出现
    var plus = mk("button", null,
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>');
    plus.id = "mHomeBtn";
    plus.type = "button";
    plus.title = "回到首页";
    plus.setAttribute("aria-label", "回到首页");
    var barHome = document.querySelector(".topbar");
    if (barHome) barHome.insertBefore(plus, barHome.firstChild);
    else document.querySelector(".topbar").appendChild(plus);
    plus.addEventListener("click", function () {
      var b = $("btnHome");
      if (b) b.click();
      resultShown = false;
      showHome(true);
    });

    // 结果页把“解题”改成“重解”；点之前先确认，避免误触重新扣费
    var reSolveGo = false;
    var goTop = $("go");
    if (goTop && !goTop.__mResolveBound) {
      goTop.__mResolveBound = true;
      goTop.addEventListener("click", function (e) {
        if (!MQ.matches || !document.body.classList.contains("m-has-result") || reSolveGo) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        var ask = (window.HJDialog && HJDialog.confirm)
          ? HJDialog.confirm({
              title: "重新解题？",
              message: "会重新调用模型生成解答和图形，可能再次产生费用。",
              okText: "重解",
              cancelText: "取消"
            })
          : Promise.resolve(true);
        ask.then(function (ok) {
          if (!ok) return;
          reSolveGo = true;
          try { goTop.click(); } finally { reSolveGo = false; }
        });
      }, true);
    }

    // 拍照/相册都交给系统选择器；选完先进 pending，再打开框选页
    function makePicker(capture) {
      var input = mk("input");
      input.type = "file";
      input.accept = "image/*";
      if (capture) input.setAttribute("capture", "environment");
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("change", function () {
        var f = input.files && input.files[0];
        function done() { input.value = ""; }
        if (!f) { done(); return; }
        if (window.SolverDebug && SolverDebug.stageImageFile) {
          SolverDebug.stageImageFile(f, true, capture ? "system" : "album").then(function (u) {
            done();
            if (!u) return;
            setTimeout(function () { if (window.HJ && HJ._cropPending) HJ._cropPending(); }, 60);
          }, done);
          return;
        }
        if (window.SolverDebug && SolverDebug.addImageFile) {
          var p = SolverDebug.addImageFile(f);
          if (p && p.then) p.then(done, done); else done();
          return;
        }
        done();
      });
      return input;
    }
    var sysPicker = makePicker(true);
    var albumPicker = makePicker(false);
    window.HJSystemCamera = {
      open: function () { sysPicker.value = ""; sysPicker.click(); },
      openAlbum: function () { albumPicker.value = ""; albumPicker.click(); }
    };
    $("mhGo").addEventListener("click", function () { var g = $("go"); if (g) g.click(); });
    $("mhPhoto").addEventListener("click", function () { window.HJSystemCamera.open(); });
    $("mhAlbum").addEventListener("click", function () { window.HJSystemCamera.openAlbum(); });
    buildExamples(home);
    buildHomeOptions();
    refreshRecent();
    // buildHomeOptions 会把年级/图形插到 topbar 最前；首页按钮再抢回第一位
    var hb = $("mHomeBtn"), tb0 = document.querySelector(".topbar");
    if (hb && tb0) tb0.insertBefore(hb, tb0.firstChild);
    var all = home.querySelector("#mhAll");
    if (all) all.addEventListener("click", function () { var h = $("btnHist"); if (h) h.click(); });

    // 点「解题」：有题或有图才离开首页；空输入原地不动，避免进空画布
    var go = $("go");
    if (go) go.addEventListener("click", function (e) {
      if (!MQ.matches) return;
      var home = $("mHome");
      var homeOn = !!(home && !home.classList.contains("off"));
      var qEl = $("q");
      var q = qEl ? qEl.value.trim() : "";
      var n = (window.SolverDebug && SolverDebug.images) ? SolverDebug.images().length : 0;
      if (homeOn && !q && !n) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      resultShown = true;
      showHome(false); body(true); setDetent(2);
    }, true);
  }

  function showHome(on) {
    var home = $("mHome");
    if (!home) return;
    home.classList.toggle("off", !on);
    document.body.classList.toggle("m-home", !!on);
    if (on) { body(false); hideBar(); setTimeout(function () { refreshRecent(); syncHomeOptions(); }, 0); }
  }

  /* ---------------- 首页：最近解题 + 示例题 ---------------- */
  var RECENT_PH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 18 9 8l4 6 2-3 5 7z"/><circle cx="7" cy="6" r="1.4" fill="currentColor" stroke="none"/></svg>';
  var EX_2D = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 4 21 20H3z"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></svg>';
  var EX_3D = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg>';
  var EX_LOCUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/></svg>';
  var EXAMPLES = [
    { title: "直角三角形", sub: "求斜边上的中线", dim: "2d", kind: "2d", q: "如图，在 Rt△ABC 中，∠C=90°，AC=3，BC=4，D 为 AB 的中点，求 CD 的长。" },
    { title: "正方体", sub: "异面直线所成角", dim: "3d", kind: "3d", q: "如图，在棱长为 2 的正方体 ABCD-A₁B₁C₁D₁ 中，求异面直线 AC 与 BD₁ 所成角的余弦值。" },
    { title: "动点轨迹", sub: "距离比为 1/2", dim: "2d", kind: "locus", q: "已知动点 M 与两个定点 O(0,0)、A(3,0) 的距离的比为 1/2，求动点 M 的轨迹方程。" }
  ];

  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

  function buildHomeOptions() {
    if (document.getElementById("mTopOpts")) return;
    var topbar = document.querySelector(".topbar");
    if (!topbar) return;
    var wrap = mk("div", "");
    wrap.id = "mTopOpts";
    topbar.insertBefore(wrap, topbar.firstChild);
    [
      { id: "grade", label: "年级", sub: "按该年级的知识范围作答" },
      { id: "dim", label: "图形", sub: "自动由 AI 判断，也可指定平面/立体" }
    ].forEach(function (def) {
      var src = $(def.id);
      if (!src) return;
      var lab = mk("div", "m-top-opt");
      lab.appendChild(mk("span", "k", def.label));
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "v";
      btn.dataset.src = def.id;
      btn.setAttribute("aria-haspopup", "dialog");
      function sync() {
        var o = src.options[src.selectedIndex];
        var text = o ? o.textContent : "";
        btn.textContent = text;
        btn.setAttribute("aria-label", def.label + "：" + text + "，点击选择");
      }
      sync();
      btn.addEventListener("click", function () {
        if (!window.HJChoice) return;
        var opts = Array.prototype.map.call(src.options, function (o) {
          var o2 = { value: o.value, label: o.textContent };
          if (def.id === "grade") {
            if (!o.value) o2.desc = "由题目自行判断";
            else if (o.value === "高三" || o.value === "高二" || o.value === "高一") o2.group = "高中";
            else o2.group = "初中";
          } else if (!o.value) {
            o2.desc = "由 AI 判断平面或立体";
          }
          return o2;
        });
        window.HJChoice.open({
          title: def.label,
          subtitle: def.sub,
          value: src.value,
          options: opts,
          onPick: function (v) {
            if (src.value !== v) {
              src.value = v;
              try { src.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
            }
            sync();
          }
        });
      });
      src.addEventListener("change", sync);
      lab.appendChild(btn);
      wrap.appendChild(lab);
    });
  }
  function syncHomeOptions() {
    var wrap = $("mTopOpts");
    if (!wrap) return;
    ["grade", "dim", "view"].forEach(function (id) {
      var src = $(id);
      var btn = wrap.querySelector('button[data-src="' + id + '"]');
      if (!src || !btn) return;
      var o = src.options[src.selectedIndex];
      var text = o ? o.textContent : "";
      if (btn.textContent !== text) btn.textContent = text;
    });
  }

  function buildExamples(home) {
    var wrap = home.querySelector("#mhExamples");
    if (!wrap) return;
    EXAMPLES.forEach(function (ex) {
      var b = mk("button", "mh-ex");
      b.type = "button";
      var ico = ex.kind === "3d" ? EX_3D : (ex.kind === "locus" ? EX_LOCUS : EX_2D);
      b.innerHTML =
        '<span class="ico">' + ico + '</span>' +
        '<span class="txt"><b>' + ex.title + '</b><span>' + ex.sub + '</span></span>' +
        '<span class="tag">' + (ex.dim === "3d" ? "3D" : "2D") + '</span>';
      b.addEventListener("click", function () {
        var q = $("q");
        if (!q) return;
        q.value = ex.q;
        try { q.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
        var dim = $("dim");
        if (dim && ex.dim) dim.value = ex.dim;
        try { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } catch (e) {}
        try { q.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
      });
      wrap.appendChild(b);
    });
  }

  function recentWhen(ts) {
    var d = new Date(ts), now = new Date();
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((day(now) - day(d)) / 86400000);
    var hm = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    if (diff === 0) return "今天 " + hm;
    if (diff === 1) return "昨天";
    if (diff > 1 && diff < 7) return "周" + "日一二三四五六"[d.getDay()];
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  function plainQ(s) {
    s = String(s || "");
    try { if (window.HJ && HJ._plain) s = HJ._plain(s); } catch (e) {}
    return String(s).replace(/\s+/g, " ").trim().slice(0, 80);
  }
  function refreshRecent() {
    var home = $("mHome");
    if (!home) return;
    var sec = home.querySelector("#mhRecentSec"), box = home.querySelector("#mhRecent");
    if (!sec || !box) return;
    var items = (window.HJ && HJ._recent) ? HJ._recent(3) : [];
    box.innerHTML = "";
    if (!items.length) { sec.hidden = true; return; }
    sec.hidden = false;
    items.forEach(function (rec) {
      var b = mk("button", "mh-recent-card");
      b.type = "button";
      var th = mk("span", "thumb");
      if (rec.thumb) {
        var im = document.createElement("img");
        im.src = rec.thumb;
        im.alt = "";
        th.appendChild(im);
      } else {
        th.classList.add("ph");
        th.innerHTML = RECENT_PH;
      }
      b.appendChild(th);
      var txt = mk("span", "txt");
      var q = mk("span", "q");
      q.textContent = plainQ(rec.questionText || rec.question || "（无题面）");
      var meta = mk("span", "meta");
      meta.textContent = [recentWhen(rec.ts), rec.model || ""].filter(Boolean).join(" · ");
      txt.appendChild(q); txt.appendChild(meta); b.appendChild(txt);
      b.appendChild(mk("span", "chev", "›"));
      b.addEventListener("click", function () { openRecent(rec.id); });
      box.appendChild(b);
    });
  }
  function openRecent(id) {
    if (!id) return;
    showHome(false);
    body(true);
    setDetent(1);
    setTimeout(function () { if (window.HJ && HJ._openRecord) HJ._openRecord(id); }, 30);
  }
  function body(hasResult) {
    document.body.classList.toggle("m-has-result", !!hasResult);
    var go = $("go");
    if (!go) return;
    var label = hasResult ? "重解" : "解题";
    var hit = false;
    for (var i = 0; i < go.childNodes.length; i++) {
      var n = go.childNodes[i];
      if (n.nodeType === 3 && String(n.nodeValue || "").trim()) { n.nodeValue = label; hit = true; break; }
    }
    if (!hit) go.appendChild(document.createTextNode(label));
    go.title = hasResult ? "重新解题（会重新请求模型）" : "解题";
    if (P0.metaBtn) {
      var meta = $("meta");
      if (meta) meta.classList.remove("m-open");
      P0.metaBtn.textContent = "详情";
    }
  }

  /* ---------------- 对象：sheet 内子页 + 画布点选属性条 ---------------- */
  function buildObjects() {
    if ($("mObjPage")) return;
    var panel = $("rightPanel");
    var left = $("leftPanel");
    if (!panel || !left) return;
    var page = mk("div", "m-objpage");
    page.id = "mObjPage";
    panel.appendChild(page);

    // 参数页（对象页）自己的拉杆：三档和解答浮层共用 setDetent，
    // 随时可以拉下来露出画布，不必先退回解答再拖。
    var handle = mk("div", "m-obj-handle");
    handle.id = "mObjHandle";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", "拖动调整参数页高度");
    handle.title = "拖动调整参数页高度";
    handle.innerHTML = "<span></span>";
    page.appendChild(handle);
    bindObjDrag(handle);

    objMoved = { el: left, parent: left.parentNode, next: left.nextSibling };
    left.classList.add("m-in-sheet");
    page.appendChild(left);
    var ph = left.querySelector(".ph");
    if (ph && !ph.querySelector(".m-obj-back")) {
      var back = mk("button", "m-back m-obj-back", ICON_BACK);
      back.type = "button";
      back.setAttribute("aria-label", "返回解答");
      back.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeObjects();
      });
      ph.insertBefore(back, ph.firstChild);
    }
    objPage = page;
  }

  function buildBar() {
    if ($("mObjBar")) return;
    var bar = mk("div", "m-objbar");
    bar.id = "mObjBar";
    bar.innerHTML =
      '<span class="dot"></span><span class="nm"></span><span class="grow"></span>' +
      '<button type="button" data-act="eye" title="显示/隐藏">' + ICON_EYE + '</button>' +
      '<button type="button" data-act="focus" title="定位">' + ICON_FOCUS + '</button>' +
      '<button type="button" data-act="all" class="txt">全部</button>' +
      '<button type="button" data-act="close" title="收起">' + ICON_X + '</button>';
    document.getElementById("app").appendChild(bar);
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]");
      if (!b || !barKey) return;
      var a = b.dataset.act;
      if (a === "eye") {
        if (window.HJ && HJ.toggleObjectByKey) HJ.toggleObjectByKey(barKey);
        renderBar();
      } else if (a === "focus") {
        if (window.HJ && HJ.focusObjectByKey) HJ.focusObjectByKey(barKey);
      } else if (a === "all") {
        openObjects();
      } else if (a === "close") {
        hideBar();
      }
    });
    objBar = bar;
  }

  function objInfo(key) {
    return (window.HJ && HJ.objectInfo) ? HJ.objectInfo(key) : null;
  }
  function renderBar() {
    if (!objBar || !barKey) return;
    var o = objInfo(barKey);
    if (!o) { hideBar(); return; }
    objBar.querySelector(".dot").style.background = o.color || "var(--accent)";
    objBar.querySelector(".nm").textContent = o.label || o.key;
    var eye = objBar.querySelector('[data-act="eye"]');
    if (eye) {
      eye.innerHTML = o.visible ? ICON_EYE : ICON_EYE_OFF;
      eye.title = o.visible ? "隐藏" : "显示";
    }
  }
  function hideBar() {
    barKey = null;
    document.body.classList.remove("m-objbar");
  }
  function showBar(key, collapse) {
    if (!MQ.matches) return;
    var o = objInfo(key);
    if (!o) return;
    barKey = String(key);
    if (!objBar) buildBar();
    if (collapse) setDetent(2);
    renderBar();
    document.body.classList.add("m-objbar");
    if (objPage) objPage.classList.remove("show");
    document.body.classList.remove("m-objpage-open");
  }
  function syncBar() {
    if (!barKey) {
      if (document.body.classList.contains("m-objbar")) document.body.classList.remove("m-objbar");
      return;
    }
    var on = MQ.matches && !document.body.classList.contains("m-home") &&
      offset >= maxOffset - 2 && !(objPage && objPage.classList.contains("show"));
    // 拖拽时每帧都会进这里：状态没变就别写 DOM（renderBar 里有 innerHTML）
    if (on === document.body.classList.contains("m-objbar")) return;
    document.body.classList.toggle("m-objbar", on);
    if (on) renderBar();
  }

  function openObjects() {
    if (!MQ.matches) return;
    buildObjects();
    buildBar();
    hideBar();
    if (objPage) {
      objPage.classList.add("show");
      document.body.classList.add("m-objpage-open");
    }
    setDetent(0);
    // 选中对象在长列表里可能很靠下：滚到中间，省得用户自己找
    setTimeout(function () {
      var sel = window.HJ && HJ.selectedObjectKey ? HJ.selectedObjectKey() : null;
      if (!sel) return;
      var rows = document.querySelectorAll("#objList .obj");
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].dataset.key === String(sel)) {
          try { rows[i].scrollIntoView({ block: "center" }); } catch (e) {}
          break;
        }
      }
    }, 80);
    try { window.dispatchEvent(new Event("resize")); } catch (e) {}
  }
  function closeObjects() {
    if (objPage) objPage.classList.remove("show");
    document.body.classList.remove("m-objpage-open");
    setDetent(1);
    try { window.dispatchEvent(new Event("resize")); } catch (e) {}
  }
  function isObjectOpen() {
    return !!(objPage && objPage.classList.contains("show"));
  }
  function onCanvasObject(key) {
    if (!MQ.matches) return;
    var o = objInfo(key);
    if (!o) return;
    if (isObjectOpen()) closeObjects();
    if (window.HJ && HJ.selectObjectByKey) HJ.selectObjectByKey(key, false);
    showBar(key, true);
  }
  function onObjSelected(e) {
    if (!MQ.matches) return;
    if (isObjectOpen()) return;
    var k = e.detail && e.detail.key;
    if (k && offset >= maxOffset - 2) showBar(k, false);
  }
  function onObjsChanged() {
    if (barKey) renderBar();
  }

  /* ---------------- 把画布上的步骤条搬进浮层 ---------------- */
  function moveStepbar() {
    var panel = $("rightPanel");
    if (!panel) return;
    var ph = panel.querySelector(".ph");
    var anchor = panel.querySelector(".anbody");
    var ana = $("anaCard");
    var bar = $("stepbar"), desc = document.querySelector(".stepdesc"), sui = $("scriptUi");
    if (!anchor) return;
    // 脚本按钮是低频辅助，放到解析之后，别挡住首屏解析
    if (sui && sui.parentNode !== anchor) {
      moved.push({ el: sui, parent: sui.parentNode, next: sui.nextSibling });
      if (ana && ana.parentNode === anchor) anchor.insertBefore(sui, ana.nextSibling);
      else anchor.appendChild(sui);
    }
    // 步骤条固定在浮层顶部，替换原来的“解答”标题
    if (bar && ph && bar.parentNode !== ph) {
      moved.push({ el: bar, parent: bar.parentNode, next: bar.nextSibling });
      ph.appendChild(bar);
    }
    // 步骤说明仍跟解析正文放在一起
    if (desc) {
      if (ana && desc.parentNode !== ana) {
        moved.push({ el: desc, parent: desc.parentNode, next: desc.nextSibling });
        ana.appendChild(desc);
      } else if (!ana && desc.parentNode !== anchor) {
        var ansCard = $("ansCard") || anchor.firstChild;
        moved.push({ el: desc, parent: desc.parentNode, next: desc.nextSibling });
        if (ansCard && ansCard.parentNode === anchor && ansCard.nextSibling) anchor.insertBefore(desc, ansCard.nextSibling);
        else if (ansCard && ansCard.parentNode === anchor) anchor.appendChild(desc);
        else anchor.insertBefore(desc, anchor.firstChild);
      }
    }
  }

  /* ---------------- P0-4：解答首屏收拢 ---------------- */
  function arrangeAnswerP0() {
    var card = $("ansCard"), ans = $("answer"), head = card && card.querySelector(".cardh");
    if (!card || !ans) return;

    // 耗时/token/资费：默认藏进「详情」
    var meta = $("meta");
    if (!P0.metaBtn) {
      P0.metaBtn = mk("button", "m-meta-btn", "详情");
      P0.metaBtn.type = "button";
      P0.metaBtn.title = "耗时 / token / 资费";
      P0.metaBtn.onclick = function () {
        if (!meta) return;
        var open = meta.classList.toggle("m-open");
        P0.metaBtn.textContent = open ? "收起" : "详情";
      };
      if (head) {
        var grow = head.querySelector(".grow");
        if (grow && grow.nextSibling) head.insertBefore(P0.metaBtn, grow.nextSibling);
        else head.appendChild(P0.metaBtn);
      }
    }
    if (meta && meta.parentNode !== card) {
      moved.push({ el: meta, parent: meta.parentNode, next: meta.nextSibling });
      var bar = $("mAnsActions");
      card.insertBefore(meta, bar || null);
    }
    function syncMeta() {
      if (!meta || !P0.metaBtn) return;
      var has = String(meta.textContent || "").trim().length > 0;
      P0.metaBtn.style.display = has ? "inline-flex" : "none";
      if (!has) { meta.classList.remove("m-open"); P0.metaBtn.textContent = "详情"; }
    }
    if (meta && !P0.metaMo) {
      P0.metaMo = new MutationObserver(syncMeta);
      P0.metaMo.observe(meta, { childList: true, subtree: true, characterData: true });
    }
    syncMeta();

    // 多小问：答案卡里也放一排 tabs，和画布的小题选择器共用同一组按钮
    if (!P0.tabs) {
      P0.tabs = mk("div", "m-ans-tabs");
      P0.tabs.id = "mAnsTabs";
      var host = $("subTabs");
      P0.tabsSync = function () {
        if (!host) return;
        var btns = host.querySelectorAll("button");
        var show = btns.length >= 2 && getComputedStyle(host).display !== "none";
        P0.tabs.style.display = show ? "flex" : "none";
        if (!show) { P0.tabs.innerHTML = ""; return; }
        P0.tabs.innerHTML = "";
        Array.prototype.forEach.call(btns, function (b, i) {
          var nb = mk("button", b.classList.contains("on") ? "on" : "", b.textContent);
          nb.type = "button";
          nb.onclick = function () { try { b.click(); } catch (e) {} };
          P0.tabs.appendChild(nb);
        });
      };
      if (host) {
        P0.tabsMo = new MutationObserver(P0.tabsSync);
        P0.tabsMo.observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
      }
      P0.tabsSync();
    }
    if (head && P0.tabs.parentNode !== card) card.insertBefore(P0.tabs, head.nextSibling);

    // 钉住：一键回半屏（「边看图边看解析」的标准姿态），不必对准把手拖
    if (!P0.pin) {
      P0.pin = mk("button", "m-pin-btn",
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 3h6l1 7 3 3H5l3-3z"/></svg>');
      P0.pin.type = "button";
      P0.pin.title = "钉在半屏（边看图边看解析）";
      P0.pin.setAttribute("aria-label", "钉在半屏");
      P0.pin.onclick = function () { setDetent(1); };
    }
    // 钉住按钮放进步骤条「下一步」右边：步骤条是常驻的操作区（半屏/全屏都在），
    // 比塞在答案卡标题栏里更顺手。
    // 不判断步骤条当前是否可见——arrangeAnswerP0 执行时步骤条往往还没加 .show
    // （要等 updateStepBar 算完分步），判断可见性会让它误判成「没有步骤条」而退回标题栏。
    var sbEl = document.getElementById("stepbar");
    var nextBtn = sbEl ? sbEl.querySelector(".nav button[data-act='next']") : null;
    if (nextBtn && nextBtn.parentNode) {
      if (P0.pin.parentNode !== nextBtn.parentNode) nextBtn.parentNode.insertBefore(P0.pin, nextBtn.nextSibling);
    } else if (head && P0.pin.parentNode !== head) {
      head.insertBefore(P0.pin, P0.metaBtn || null);
    }

    // peek 档横滑切小题（Photomath 式）：答案条上左滑 = 下一问、右滑 = 上一问。
    // 只在浮层收到答案条（body.m-peek）且确有 ≥2 问时接管横滑；确认手势前
    // 不 preventDefault，纵向滚动完全不受影响。切问走镜像按钮的既有链路，
    // 内容淡入（hjSwapIn）自动生效。
    if (!P0.swipeWired && card) {
      P0.swipeWired = true;
      var swX = 0, swY = 0, swT = 0, swLock = "";
      card.addEventListener("touchstart", function (e) {
        var btns = P0.tabs ? P0.tabs.querySelectorAll("button") : [];
        if (!document.body.classList.contains("m-peek") || btns.length < 2 || !e.touches.length) { swLock = ""; return; }
        swX = e.touches[0].clientX; swY = e.touches[0].clientY; swT = Date.now(); swLock = "";
      }, { passive: true });
      card.addEventListener("touchmove", function (e) {
        if (swLock === "" && !document.body.classList.contains("m-peek")) return;
        if (!e.touches.length) return;
        var dx = e.touches[0].clientX - swX, dy = e.touches[0].clientY - swY;
        if (!swLock) {
          if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            swLock = "h";
            var b2 = P0.tabs ? P0.tabs.querySelectorAll("button") : [];
            if (b2.length < 2) { swLock = ""; return; }
            e.preventDefault();
          } else if (Math.abs(dy) > 14) swLock = "v";
        } else if (swLock === "h") e.preventDefault();
      }, { passive: false });
      card.addEventListener("touchcancel", function () { swLock = ""; });
      card.addEventListener("touchend", function (e) {
        if (swLock !== "h") { swLock = ""; return; }
        swLock = "";
        if (!e.changedTouches.length) return;
        var dx = e.changedTouches[0].clientX - swX, dt = Date.now() - swT;
        if (Math.abs(dx) < 42 || dt > 900) return;   // 太短 / 太慢不算甩
        var btns = P0.tabs ? [].slice.call(P0.tabs.querySelectorAll("button")) : [];
        var cur = -1;
        for (var i = 0; i < btns.length; i++) if (btns[i].classList.contains("on")) { cur = i; break; }
        if (cur < 0) return;
        var next = cur + (dx < 0 ? 1 : -1);
        if (next < 0 || next >= btns.length) return; // 到头停在当前问
        try { btns[next].click(); } catch (er) {}
      });
    }

    // 答案默认只留一句；超长时给「展开全部答案」
    if (!P0.more) {
      P0.more = mk("button", "m-answer-more", "展开全部答案");
      P0.more.type = "button";
      var openAns = false;
      function measureAns() {
        ans.classList.remove("m-answer-clamped");
        openAns = false;
        P0.more.textContent = "展开全部答案";
        var long = ans.scrollHeight > 72;
        P0.more.style.display = long ? "block" : "none";
        if (long) ans.classList.add("m-answer-clamped");
      }
      P0.more.onclick = function () {
        openAns = !openAns;
        ans.classList.toggle("m-answer-clamped", !openAns);
        P0.more.textContent = openAns ? "收起答案" : "展开全部答案";
      };
      P0.moreMo = new MutationObserver(function () { requestAnimationFrame(measureAns); });
      P0.moreMo.observe(ans, { childList: true, subtree: true, characterData: true });
      setTimeout(measureAns, 120);
    }
    if (P0.more.parentNode !== card) card.insertBefore(P0.more, ans.nextSibling);
  }

  /* ---------------- 浮层：位置 / 吸附 / 画布让位 ----------------
     热路径原则：按下时量一次布局，拖拽过程中只写合成层（panel / 画布 transform）。
     不读 offsetHeight、不写 :root 变量、不切内容样式；答案区底部留白只在
     落位时更新一次。 */
  function readPeek() {
    var peek = 156;
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue("--m-peek");
      if (v) peek = parseInt(v, 10) || peek;
    } catch (e) {}
    return peek;
  }

  function measure() {
    var panel = $("rightPanel"), stage = $("stage");
    if (!panel || !stage) return false;
    peekPx = readPeek();
    panelH = panel.offsetHeight;
    stageH = stage.offsetHeight;
    maxOffset = Math.max(0, panelH - peekPx);
    DET = [0, Math.round(maxOffset * 0.55), maxOffset];
    return true;
  }

  // 被浮层盖住的高度 → 画布往上让一点，别让图正好被压在浮层下面
  function stageDy() {
    var covered = panelH - offset;
    return -Math.min(stageH * 0.3, Math.max(0, covered) * 0.42);
  }
  function setCanvasDy(dy) {
    var host = $("canvasHost"), g3d = $("g3d");
    var t = "translate3d(0," + dy.toFixed(1) + "px,0)";
    if (host) host.style.transform = t;
    if (g3d) g3d.style.transform = t;
  }
  function resetCanvasDy() {
    var host = $("canvasHost"), g3d = $("g3d");
    if (host) host.style.transform = "";
    if (g3d) g3d.style.transform = "";
  }

  function syncFlags() {
    var peek = offset >= maxOffset - 2;
    var high = offset < maxOffset * 0.6;
    if (document.body.classList.contains("m-peek") !== peek) document.body.classList.toggle("m-peek", peek);
    // 浮层盖过 40% 就把原题卡/读数条收起来，不然一定压到解析上
    if (document.body.classList.contains("m-sheet-high") !== high) document.body.classList.toggle("m-sheet-high", high);
    syncBar();
  }

  function paintSheet() {
    var panel = $("rightPanel");
    if (!panel) return;
    panel.style.transform = "translate3d(0," + offset + "px,0)";
    // 拖拽层级反馈（Apple Maps 手法）：半开时最「卡片」（圆角最大），
    // 全屏 / 答案条两端贴边、圆角收小；只写内联样式，落位后保持该档的值
    if (panelH && maxOffset) {
      var tt = Math.min(1, Math.max(0, offset / maxOffset));
      var rr = 22 - Math.abs(tt - 0.5) * 14;   // 半开 22px → 两端 15px
      panel.style.borderRadius = rr.toFixed(1) + "px " + rr.toFixed(1) + "px 0 0";
    }
    if (panelH) setCanvasDy(stageDy());
    syncFlags();
  }

  function applyPadding() {
    var body = document.querySelector("#rightPanel .anbody");
    if (body) body.style.paddingBottom = (12 + offset) + "px";
  }

  function layout() {
    if (!MQ.matches) return;
    if (!measure()) return;
    if (offset > maxOffset) offset = maxOffset;
    paintSheet();
    applyPadding();
    settleStage();
  }

  function setDetent(i) {
    var target = DET[Math.max(0, Math.min(2, i))];
    if (!MQ.matches) { offset = target; return; }
    springTo(target, 0);
  }

  /* 拖拽过程只 translate（不重排）；松手后等吸附动画走完，再把 #stage 高度
     改成"可见带子"并派一次 resize —— solver.js / render3d.js 会各自
     board.resize() + 取景。放在动画结束后做，避免 JSXGraph 重排卡在动画中间。 */
  var settleTimer = null;
  var lastStageBottom = null;
  var snapTimer = null;

  function scheduleSettle() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(finishSettle, 240);
  }
  function finishSettle() {
    clearTimeout(snapTimer);
    snapTimer = null;
    var panel = $("rightPanel");
    if (panel) panel.style.transition = "";
    document.body.classList.remove("m-sheet-dragging");
    if (!MQ.matches) return;
    applyPadding();
    settleStage();
    syncFlags();
  }

  function settleStage() {
    var panel = $("rightPanel");
    if (!panel) return;
    if (!panelH) measure();
    var covered = Math.max(0, panelH - offset);
    var changed = lastStageBottom === null ? covered > 0 : Math.abs(covered - lastStageBottom) > 0.5;
    lastStageBottom = covered;
    document.documentElement.style.setProperty("--m-stage-bottom", covered + "px");
    resetCanvasDy();
    clearTimeout(settleTimer);
    // layout() 本身挂在 window.resize 上：这里每次都派发 resize 会变成
    // resize → layout → settleStage → resize 的 60ms 死循环，
    // 把上层所有防抖取景永远顶掉。只有可见高度真的变了才需要通知一次。
    if (!changed) return;
    settleTimer = setTimeout(function () {
      settleTimer = null;
      window.dispatchEvent(new Event("resize"));
    }, 60);
  }
  /* 松手后的弹簧落档：spring(170/24/1.2)（与桌面 HJTabs 胶囊同一组参数），
     把手甩速度换算成初速度（px/ms → px/s，限幅 ±2.5px/ms），
     收敛阈值 ±0.4px / 30px·s⁻¹；1.2s 兜底强制落定，减动效直接落位 */
  var springRaf = 0;
  function springTo(target, velMs) {
    if (springRaf) { cancelAnimationFrame(springRaf); springRaf = 0; }
    var panel = $("rightPanel");
    if (!panel) { offset = target; finishSettle(); return; }
    var from = offset;
    var reduce = false;
    try { reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    if (reduce || Math.abs(target - from) < 0.5) {
      offset = target;
      panel.style.transform = "translate3d(0," + offset + "px,0)";
      finishSettle();
      return;
    }
    offset = target;
    document.body.classList.add("m-sheet-dragging");   // 弹簧期间继续暂停 3D 渲染和毛玻璃
    clearTimeout(snapTimer);
    snapTimer = setTimeout(finishSettle, 1200);
    var st = { p: from, v: Math.max(-2.5, Math.min(2.5, velMs || 0)) * 1000 };
    var last = performance.now();
    springRaf = requestAnimationFrame(function frame(now) {
      springRaf = 0;
      var dt = Math.min(Math.max((now - last) / 1000, 0), 0.05); last = now;
      var left = dt, h;
      while (left > 1e-6) {
        h = Math.min(0.008, left); left -= h;
        st.v += ((-170 * (st.p - target)) - 24 * st.v) / 1.2 * h;
        st.p += st.v * h;
      }
      if (st.p < -30) { st.p = -30; st.v = 0; }
      if (st.p > maxOffset + 30) { st.p = maxOffset + 30; st.v = 0; }
      var settled = Math.abs(st.p - target) < 0.4 && Math.abs(st.v) < 30;
      if (settled) st.p = target;
      offset = st.p;
      paintSheet();
      if (settled) { springRaf = 0; finishSettle(); return; }
      springRaf = requestAnimationFrame(frame);
    });
  }

  /* 松手吸附：|v| > 0.45 px/ms 视为甩动，按方向走一档；否则吸附最近档 */
  function snap(v) {
    var target;
    if (v != null && Math.abs(v) > 0.45) {
      if (v > 0) {                       // 往下甩 → 收一档
        target = DET[2];
        for (var i = 0; i < 3; i++) if (DET[i] > offset + 1) { target = DET[i]; break; }
      } else {                           // 往上甩 → 展开一档
        target = DET[0];
        for (var j = 2; j >= 0; j--) if (DET[j] < offset - 1) { target = DET[j]; break; }
      }
    } else {
      target = DET[0];
      for (var k = 0; k < 3; k++) if (Math.abs(DET[k] - offset) < Math.abs(target - offset)) target = DET[k];
    }
    springTo(target, v || 0);
  }

  /* ---------------- 拖拽绑定 ----------------
     所有拉杆（解答把手 / 对象页把手）共用一条热路径：
       pointerdown  量一次高度，冻结吸附中的过渡
       pointermove  只记坐标，rAF 合并
       rAF flush    只写 transform（合成层），不读布局、不切内容样式
       pointerup    按速度吸附，过渡结束后再收 stage
  */
  function bindHandleDrag(handle, opts) {
    opts = opts || {};
    var dragging = false, startY = 0, startOffset = 0, lastY = 0, lastT = 0, v = 0;
    var pendingY = 0, rafId = 0;

    function flush() {
      rafId = 0;
      if (!dragging || !MQ.matches) return;
      var next = Math.max(0, Math.min(maxOffset, startOffset + pendingY - startY));
      if (next === offset) return;
      offset = next;
      paintSheet();
    }

    // 上一档的 resize 还挂在 60ms 定时器里：趁按下时先跑掉，
    // 否则它会在拖拽中途重排一次画布。
    function flushPendingResize() {
      if (!settleTimer) return;
      clearTimeout(settleTimer);
      settleTimer = null;
      try { window.dispatchEvent(new Event("resize")); } catch (e) {}
    }

    function visualOffset(panel) {
      var y = offset;
      try {
        var cs = getComputedStyle(panel).transform;
        if (cs && cs !== "none" && window.DOMMatrixReadOnly) {
          var m = new DOMMatrixReadOnly(cs);
          if (isFinite(m.m42)) y = m.m42;
        }
      } catch (e) {}
      return y;
    }

    function begin(ev) {
      if (!MQ.matches) return;
      flushPendingResize();
      if (!measure()) return;
      clearTimeout(snapTimer);
      snapTimer = null;
      var panel = $("rightPanel");
      if (!panel) return;
      // 抓住正在吸附中的浮层：从当前视觉位置接着拖，不要跳回目标档
      var visual = visualOffset(panel);
      offset = Math.max(0, Math.min(maxOffset, visual));
      panel.style.transition = "";
      panel.style.transform = "translate3d(0," + offset + "px,0)";
      dragging = true;
      startY = lastY = pendingY = ev.clientY;
      startOffset = offset;
      lastT = Date.now(); v = 0;
      document.body.classList.add("m-sheet-dragging");
      if (opts.cls) handle.classList.add(opts.cls);
    }

    function moveTo(ev) {
      if (!dragging) return;
      var now = Date.now(), dt = now - lastT;
      if (dt > 0) v = (ev.clientY - lastY) / dt;
      lastY = ev.clientY; lastT = now;
      pendingY = ev.clientY;
      if (!rafId) rafId = requestAnimationFrame(flush);
    }

    function end(ev) {
      if (!dragging) return;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; flush(); }
      if (ev) pendingY = ev.clientY;
      if (MQ.matches) {
        var next = Math.max(0, Math.min(maxOffset, startOffset + pendingY - startY));
        if (next !== offset) { offset = next; paintSheet(); }
      }
      dragging = false;
      if (opts.cls) handle.classList.remove(opts.cls);
      if (!MQ.matches) {
        document.body.classList.remove("m-sheet-dragging");
        return;
      }
      // m-sheet-dragging 留到吸附动画结束：这 240ms 内继续暂停 3D 渲染和毛玻璃
      snap(v);
    }

    handle.addEventListener("pointerdown", function (ev) {
      if (opts.block && opts.block(ev)) return;
      begin(ev);
      if (!dragging) return;
      try { handle.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    });
    handle.addEventListener("pointermove", function (ev) {
      if (!dragging) return;
      moveTo(ev);
      ev.preventDefault();
    });
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    // 双击把手：全屏 ↔ 答案条
    handle.addEventListener("dblclick", function (ev) {
      if (opts.block && opts.block(ev)) return;
      setDetent(offset > DET[1] ? 0 : 2);
    });
  }

  function bindDrag() {
    var panel = $("rightPanel");
    if (!panel) return;
    var ph = panel.querySelector(".ph");
    if (!ph) return;
    function onStepbarControl(ev) {
      return !!(ev.target && ev.target.closest &&
        ev.target.closest("#stepbar button, #stepbar .m-step-menu"));
    }
    bindHandleDrag(ph, { block: onStepbarControl, cls: "m-dragging" });

    /* 解答内容区只保留原生滚动：不接管上滑/下滑，避免把浮层抬起、丢掉“边看图边看解析”。
       浮层高度只由顶部把手 .ph 调整。 */
  }

  /* 输入框跟随键盘：把目标滚进当前可见区（anbody 或微调底部面板的滚动体）。
     键盘弹出过程中 visualViewport 会连续变化（模拟器实测约 745ms 才落定）。这时滚一次
     只会和随后的布局重排打架：§82.6 实测先在键盘未弹时滚 13px，键盘落定后重排把位置
     拉回去，再滚 269px，用户看到的就是“闪两下”。所以这里要求 vvh 连续两次一致
     （键盘真正落定）才允许滚动；否则只排下一拍，返回 false 表示“这一拍没滚”。 */
  var nudgeVvhPrev = -1, nudgeDefer = 0;
  function nudgeInputIntoView(input) {
    if (!input || !input.closest) return true;
    var vv = window.visualViewport;
    if (vv) {
      var vvh = Math.round(vv.height);
      // 两个「还在动」的信号，任一成立就再等一拍：
      //   ① 视口高度变了（键盘还在弹/收）；
      //   ② --m-kb 刚更新过（layers.js 每帧写，浮层位置由它驱动）。
      // 只用 ① 不够：真机上视口一次跳变就稳定了，但浮层还会跟着 --m-kb 再挪一下，
      // 滚完被那次挪动覆盖 → 输入框又回到步骤条底下（实测 refine.top 48 而不是 145）。
      var kbFresh = Date.now() - (window.__kbSyncAt || 0) < 220;
      var moving = (vvh !== nudgeVvhPrev) || kbFresh;
      nudgeVvhPrev = vvh;
      // 最多等 24 拍（70ms × 24 ≈ 1.7s），覆盖键盘实测 745ms + 浮层跟随。
      // 真一直不稳也要按当前值滚一次，不能让输入框被键盘永久遮住。
      if (moving && nudgeDefer < 24) { nudgeDefer++; scheduleInputNudge(input, 70); return false; }
    }
    nudgeDefer = 0;
    var host = input.closest("#rightPanel .anbody") || input.closest(".m-refine-sheet-body");
    if (!host) return true;
    var r = input.getBoundingClientRect();
    var h = host.getBoundingClientRect();
    var kb = 0;
    try { kb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m-kb")) || 0; } catch (e) {}
    if (kb < 40 && vv) kb = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    if (kb < 40 && navigator.virtualKeyboard && navigator.virtualKeyboard.boundingRect) {
      kb = Math.max(0, navigator.virtualKeyboard.boundingRect.height || 0);
    }
    var inSheet = !!(input.closest && input.closest(".m-refine-sheet"));
    if (inSheet && kb < 40) document.body.classList.add("m-kb-fallback");
    else if (!inSheet) document.body.classList.remove("m-kb-fallback");
    var reserve = kb > 40 ? kb : 300;   // 键盘高度拿不到时，按 300px 保守留白
    var visTop = vv ? vv.offsetTop : 0;
    var visBottom = Math.min(h.bottom, window.innerHeight - reserve - 14);
    var top = Math.max(h.top, visTop) + 8;   // 与 .anbody 的 padding-top 对齐（见 mobile.css）
    var bottom = visBottom;
    // 位移用平滑滚动，不要瞬间跳。键盘弹起时浮层本身会先跟着视口缩一下，
    // 这里再瞬跳 269px，用户看到的就是「缩一下、又跳一下」两下。
    // 滑过去的话，第二段读起来是「内容让位」，不是闪。
    var delta = 0;
    // 顶部目标：微调以 #refine 卡片顶为准（卡片标题只有一行，带着一起露出来更完整）；
    // 改答案**不能**用 #ansEdit 当目标——它开头是 3~4 行说明文字，对齐到它就会停在说明上，
    // 输入框反被推到下面。改答案以 textarea 自身为准。追问没有卡片，也用自身。
    var cardEl = input.closest("#refine");
    var cardTop = cardEl ? cardEl.getBoundingClientRect().top : r.top;
    if (r.bottom > bottom) delta = Math.ceil(r.bottom - bottom);
    else if (cardTop < top) delta = -Math.ceil(top - cardTop);
    if (!delta) return true;
    var to = Math.max(0, host.scrollTop + delta);
    try { host.scrollTo({ top: to, behavior: "smooth" }); }
    catch (e) { host.scrollTop = to; }
    return true;
  }
  var kbNudgeT = null, kbNudgedAt = 0;
  function kbInsetPx() {
    var kb = 0;
    try { kb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m-kb")) || 0; } catch (e) {}
    var vv = window.visualViewport;
    if (kb < 40 && vv) kb = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    if (kb < 40 && navigator.virtualKeyboard && navigator.virtualKeyboard.boundingRect) {
      kb = Math.max(0, navigator.virtualKeyboard.boundingRect.height || 0);
    }
    return kb > 40 ? kb : 0;
  }
  // 键盘弹出时 visualViewport 会连续触发十几帧；每帧都滚一次就是用户看到的“闪两下”。
  // 统一走一个去抖队列：键盘落定后只校正一次，220ms 内的重复请求直接丢弃。
  function scheduleInputNudge(input, delay) {
    if (!input || !MQ.matches) return;
    if (kbNudgeT) clearTimeout(kbNudgeT);
    kbNudgeT = setTimeout(function () {
      kbNudgeT = null;
      if (document.activeElement !== input) return;
      var now = Date.now();
      if (now - kbNudgedAt < 220) return;
      // 只有真的滚了才记时间戳：被“键盘还在动”推迟的那一拍不算，
      // 否则 140ms 后的下一拍会被这 220ms 防抖直接拦掉，等于永远不校正。
      if (nudgeInputIntoView(input) !== false) kbNudgedAt = now;
    }, delay);
  }
  function keepInputVisible(input) {
    if (!input || !MQ.matches) return;
    // 键盘已经开着（切换输入框）：马上校正；键盘正在弹出：等它落定再校正。
    scheduleInputNudge(input, kbInsetPx() ? 40 : 360);
    // 独立的收尾校正，不挂在 nudge 末尾——nudge 的排程会被 resize 反复重置，
    // 实测在真机上常常一次都没跑到，导致收尾校正也跟着不执行。
    // 这里直接由 focusin 拉起，等键盘/浮层彻底静止后自己对齐一次。
    settleIntoView(input);
  }
  // 等 --m-kb 静默（键盘和浮层都不再动），若卡片顶被顶部步骤条压住就用
  // scrollIntoView 对齐。用定时轮询而不是「等一次就结束」：
  // 键盘弹出耗时在模拟器上能到 6~8 秒、真机 300ms 左右，固定次数的等待很容易在
  // 键盘还没落定时就用完（实测就是这样放弃的）。这里一直盯到位置正确或超时为止。
  function settleIntoView(input) {
    var n = 0, fixed = 0;
    var iv = setInterval(function () {
      if (!input || !input.isConnected || n++ > 60) { clearInterval(iv); return; }
      if (Date.now() - (window.__kbSyncAt || 0) < 300) return;   // 键盘/浮层还在动
      var host = input.closest("#rightPanel .anbody") || input.closest(".m-refine-sheet-body");
      if (!host) { clearInterval(iv); return; }
      // 同样：只有微调卡片用卡片顶，改答案/追问用输入框自身
      var el = input.closest("#refine") || input;
      var r = el.getBoundingClientRect(), h = host.getBoundingClientRect();
      if (r.top < h.top + 6) {
        try { el.scrollIntoView({ block: "start", behavior: "smooth" }); }
        catch (e) { try { el.scrollIntoView(true); } catch (e2) {} }
        if (++fixed >= 3) clearInterval(iv);   // 修 3 次还偏就放手，别一直拽
      } else if (fixed > 0) {
        clearInterval(iv);                     // 已经对齐，收工
      }
    }, 150);
  }
  function isChatLikeInput(el) {
    if (!el) return false;
    // 三个会唤起键盘的输入框走同一套避让逻辑：追问 / 微调 / 改答案。
    // 之前漏了 ansEditIn，导致改答案的输入框聚焦后不会主动置顶（被键盘挡住）。
    return el.id === "chatIn" || el.id === "rin" || el.id === "ansEditIn" ||
      (el.classList && el.classList.contains("msel-in"));
  }
  document.addEventListener("focusin", function (e) {
    if (!MQ.matches) return;
    if (isChatLikeInput(e.target)) keepInputVisible(e.target);
  }, true);
  if (window.visualViewport) {
    var onKbMove = function () {
      if (!MQ.matches) return;
      var a = document.activeElement;
      // 60ms 足够合并键盘动画的连续帧（16ms/帧），又不至于让校正拖到半秒后
      if (isChatLikeInput(a)) scheduleInputNudge(a, 60);
    };
    window.visualViewport.addEventListener("resize", onKbMove);
    // 不监听 scroll：键盘弹起主要走 resize。scroll 会被页面滚动反复触发，
    // 每次都 clearTimeout 重设 60ms，定时器永远等不到机会执行
    // （实测 nudge 被饿到 2762ms 才跑，比不修还慢）。
  }

  /* 参数页（对象页）的拉杆：和解答浮层共用 offset / DET / snap，
     所以拖到哪一档、画布让出多少、取景怎么重算都完全一致。 */
  function bindObjDrag(handle) {
    if (!handle) return;
    bindHandleDrag(handle, {});
  }

  /* ---------------- 等待时的进度胶囊 ----------------
     首页一收起，输入区里的 #imgProgress 就看不见了；这里把状态栏那句话
     浮到画布顶上，不然用户会以为点空了。 */
  function watchStatus() {
    var st = $("status");
    if (!st || $("mProg")) return;
    var pill = mk("div", "m-prog");
    pill.id = "mProg";
    document.getElementById("app").appendChild(pill);
    var lastErr = "";
    new MutationObserver(function () {
      var t = (st.textContent || "").trim();
      var busy = /…/.test(t) && !/完成|失败|就绪|已取消/.test(t);
      pill.textContent = busy ? t : "";
      pill.classList.toggle("on", busy);
      // 状态栏在手机端已隐藏：不能静默吞掉报错，失败一句话改成 toast
      var err = !busy && /失败|错误|无法|请先|不足|过长|不支持|未配置|已被删除/.test(t);
      if (err && t !== lastErr) {
        lastErr = t;
        try { if (window.HJ && HJ.toast) HJ.toast(t, "bad", 3800); } catch (e) {}
      } else if (!err && !busy) {
        lastErr = "";
      }
    }).observe(st, { childList: true, subtree: true, characterData: true });
  }

  /* P1-8：长解析默认收一段，避免半屏首屏全是字 */
  var anaFold = null;  function watchAnalysis() {
    var box = $("analysis"), card = $("anaCard");
    if (!box || !card || anaFold) return;
    var btn = mk("button", "m-ana-more", "展开全文");
    btn.type = "button";
    card.insertBefore(btn, box.nextSibling);
    var open = false;
    function measure() {
      box.classList.remove("m-folded");
      open = false;
      btn.textContent = "展开全文";
      var long = box.scrollHeight > 480;
      btn.style.display = long ? "block" : "none";
      if (long) box.classList.add("m-folded");
    }
    btn.onclick = function () {
      open = !open;
      box.classList.toggle("m-folded", !open);
      btn.textContent = open ? "收起" : "展开全文";
    };
    var mo = new MutationObserver(function () {
      open = false;
      requestAnimationFrame(measure);
    });
    mo.observe(box, { childList: true, subtree: true, characterData: true });
    setTimeout(measure, 120);
    anaFold = { btn: btn, mo: mo, box: box };
  }

  /* ---------------- 结果到达 ---------------- */
  /* 解题进度浮卡：手机没有状态栏，进度放在画布中央。
     信息分三层，任何一项都不重复：
       · 标题 + 百分比：在做什么、大概到哪；
       · 进度条；
       · 阶段文字：只写当前动作（模型思考中 / 输出中），不带秒数和字数；
       · 底部一行：左边已用时间，右边已接收/推理字数。 */
  function buildSolveProgress() {
    if (solveCard || !$("stage")) return;
    var el = mk("div", "m-solve-progress");
    el.id = "mSolveProgress";
    el.setAttribute("aria-live", "polite");
    el.innerHTML =
      '<div class="m-sp-head">' +
        '<span class="m-sp-pixels" aria-hidden="true">' + new Array(10).join("<i></i>") + '</span>' +
        '<b class="m-sp-title">正在解题</b><span class="m-sp-pct">0%</span>' +
      '</div>' +
      '<div class="m-sp-track"><i></i></div>' +
      '<div class="m-sp-stage">准备题目…</div>' +
      '<div class="m-sp-meta"><span class="m-sp-elapsed">已用 00:00</span><span class="m-sp-stat"></span></div>';
    el.setAttribute("role", "progressbar");
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "100");
    $("stage").appendChild(el);
    var pctEl = el.querySelector(".m-sp-pct"), fill = el.querySelector(".m-sp-track i");
    var stageEl = el.querySelector(".m-sp-stage"), elapsedEl = el.querySelector(".m-sp-elapsed");
    var statEl = el.querySelector(".m-sp-stat");
    var titleEl = el.querySelector(".m-sp-title");
    var trackEl = el.querySelector(".m-sp-track"), metaEl = el.querySelector(".m-sp-meta");
    var received = 0, reasoning = 0, lastInfo = null;
    var thinking = false, lastPct = 0;
    // 模型思考阶段进度真的不可知（单题实测 181.5s 都在 reasoning）：这时候
    // 进度条切成不确定态、右上角改显示已用时间，别拿一个卡死的 88% 骗人。
    var THINK_RE = /思考|推理/;
    function setThinking(on) {
      if (thinking === on) return;
      thinking = on;
      trackEl.classList.toggle("indet", on);
      titleEl.classList.toggle("is-think", on);
      pctEl.classList.toggle("is-clock", on);
      // 思考阶段右上角就是时间，底下再写一遍「已用」是重复信息
      elapsedEl.style.display = on ? "none" : "";
      if (!on) pctEl.textContent = Math.round(lastPct) + "%";
    }
    function clock(sec) {
      sec = Math.max(0, Math.floor(sec));
      var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      var mm = ("0" + m).slice(-2), ss = ("0" + s).slice(-2);
      return h ? (h + ":" + mm + ":" + ss) : (mm + ":" + ss);
    }
    function num(n) {
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    function statText() {
      var parts = [];
      if (received) parts.push("已接收 " + num(received) + " 字");
      if (reasoning && reasoning !== received) parts.push((received ? "推理 " : "已推理 ") + num(reasoning) + " 字");
      return parts.join(" · ");
    }
    function tick() {
      if (!el.classList.contains("show")) return;
      var s = Math.max(0, Math.floor((Date.now() - (solveStart || Date.now())) / 1000));
      elapsedEl.textContent = "已用 " + clock(s);
      if (thinking) pctEl.textContent = clock(s);
      var st = statText();
      statEl.textContent = st;
      // 字数拿不到就整行收起来（手机端非流式时 received/reasoning 恒为 0），别留一条空行
      metaEl.style.display = st ? "" : "none";
    }
    function update(running, info) {
      if (!running || !info) {
        el.classList.remove("show");
        document.body.classList.remove("m-solving");
        if (solveTimer) { clearInterval(solveTimer); solveTimer = null; }
        solveStart = 0; lastInfo = null; received = 0; reasoning = 0;
        thinking = false;
        trackEl.classList.remove("indet");
        titleEl.classList.remove("is-think");
        pctEl.classList.remove("is-clock");
        elapsedEl.style.display = "";
        return;
      }
      if (!el.classList.contains("show")) solveStart = info.ts || Date.now();
      else if (info.ts && solveStart && info.ts !== solveStart) solveStart = info.ts;
      var pct = Math.max(0, Math.min(100, Number(info.progress) || 0));
      lastPct = pct;
      titleEl.textContent = info.count > 1 ? ("正在处理 " + info.count + " 个任务")
        : (info.kind === "refine" ? "正在微调" : info.kind === "chat" ? "正在追问" : info.kind === "autofix" ? "正在修正图形" : "正在解题");
      var st = String(info.stage || "进行中").replace(/…+$/, "");
      setThinking(THINK_RE.test(st));
      var sec = solveStart ? Math.floor((Date.now() - solveStart) / 1000) : 0;
      // 30 秒后才给时长预期：简单题几秒就完，一上来就写「要 1–3 分钟」会吓人
      stageEl.textContent = (thinking && sec >= 30)
        ? "模型正在推理，这类题通常要 1–3 分钟"
        : (st || "进行中");
      received = Number(info.received) || 0;
      reasoning = Number(info.reasoning) || 0;
      if (!thinking) pctEl.textContent = Math.round(pct) + "%";
      fill.style.width = pct + "%";
      el.setAttribute("aria-valuenow", String(Math.round(pct)));
      el.setAttribute("aria-valuetext", (st || "进行中") + " " + Math.round(pct) + "%");
      el.classList.add("show");
      document.body.classList.add("m-solving");
      lastInfo = info;
      if (!solveTimer) solveTimer = setInterval(tick, 1000);
      tick();
    }
    solveCard = { el: el, update: update };
    window.HJMobileProgress = { update: update };
    // 页面刷新后恢复的任务：先按现有任务画一次
    try {
      var list = (window.SolverDebug && SolverDebug.tasks) ? SolverDebug.tasks() : [];
      var run = (list || []).filter(function (t) { return t.status === "running"; });
      if (run.length) {
        var l = run[0];
        update(run.length, { stage: l.stage, progress: l.progress, received: l.received, reasoning: l.reasoning || 0, ts: 0, kind: l.kind, count: run.length });
      }
    } catch (e) {}
  }

  /* ---------------- 标题行内的细进度条（微调 / 追问） ----------------
     桌面端有左下角任务条；手机端看不到，干脆把各自进度塞进对应卡片标题，
     微调看微调、追问看追问，不必在两处之间来回找。 */
  function buildInlineProgress() {
    var rh = document.querySelector("#refine .rh");
    if (rh && !$("mRefineProg")) {
      var p = mk("span", "m-inline-prog");
      p.id = "mRefineProg";
      p.hidden = true;
      p.innerHTML = '<span class="track"><i></i></span><span class="pct"></span>';
      var grow = rh.querySelector(".rh-grow");
      rh.insertBefore(p, grow || null);
    }
    var head = document.querySelector("#chatCard .cardh");
    if (head && !$("mChatProg")) {
      var p2 = mk("span", "m-inline-prog m-inline-prog-chat");
      p2.id = "mChatProg";
      p2.hidden = true;
      p2.innerHTML = '<span class="track"><i></i></span><span class="pct"></span>';
      var meta = $("chatMeta");
      // 放在“已问 N 轮”之后、“清空/收起”之前：标题和计数保持原顺序，按钮也留在右侧。
      head.insertBefore(p2, (meta && meta.nextSibling) || head.querySelector(".grow") || null);
    }
    window.HJMobileInlineProgress = { update: updateInlineProgress };
    try {
      updateInlineProgress((window.SolverDebug && SolverDebug.tasks) ? SolverDebug.tasks() : []);
    } catch (e) {}
  }
  function updateInlineOne(id, task) {
    var el = $(id);
    if (!el) return;
    if (!task) { el.hidden = true; return; }
    var pct = Math.max(0, Math.min(100, Math.round(Number(task.progress) || 0)));
    el.hidden = false;
    var fill = el.querySelector(".track i");
    var pctEl = el.querySelector(".pct");
    if (fill) fill.style.width = pct + "%";
    if (pctEl) pctEl.textContent = pct + "%";
    el.setAttribute("role", "progressbar");
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "100");
    el.setAttribute("aria-valuenow", String(pct));
    el.setAttribute("aria-valuetext", (task.stage || "进行中") + " " + pct + "%");
    el.title = (task.label || (task.kind === "chat" ? "追问" : "微调")) + " · " + (task.stage || "进行中") + " " + pct + "%";
  }
  function updateInlineProgress(tasks) {
    var refine = null, chat = null;
    (tasks || []).forEach(function (t) {
      if (!t || t.status !== "running") return;
      if (t.kind === "refine" || t.kind === "autofix") {
        if (!refine || (t.ts || 0) > (refine.ts || 0)) refine = t;
      } else if (t.kind === "chat") {
        if (!chat || (t.ts || 0) > (chat.ts || 0)) chat = t;
      }
    });
    updateInlineOne("mRefineProg", refine);
    updateInlineOne("mChatProg", chat);
  }

  /* ---------------- 手机端原题卡：题图 + 题文字 ----------------
     桌面端把原题做成画布浮卡（#qTextFloat/#qFigFloat），手机包按 HANDOVER §80
     全宽度隐藏。这里不再恢复浮卡，而是在解答浮层顶部做一张折叠卡：
     收起时给一行题干预览 + 原图缩略，展开后看全文和题图。
     题图交互（与桌面一致，但复用手机全屏框选）：
       · 右上角缩略图 = 整张原图，点开灯箱；
       · 下面的大图 = figureBox 框出来的题图；没有就显示原图；
       · 点大图打开框选，只保存 figureBox，原图永远保留。 */
  function buildQCard() {
    var anchor = document.querySelector("#rightPanel .anbody");
    if (!anchor) return;
    if ($("mQCard")) { qCard = $("mQCard"); return; }

    var card = mk("div", "m-qcard");
    card.id = "mQCard";
    card.hidden = true;
    card.__idx = 0;                       // 当前显示的题图序号

    // 标题行拆成「展开按钮 + 缩略图按钮」两个兄弟节点：
    // button 里不能再套 button，缩略图要独立响应「看原图」。
    var head = mk("div", "m-qcard-h");
    var toggle = mk("button", "m-qcard-tg");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML =
      '<span class="m-qcard-t">原题</span>' +
      '<span class="m-qcard-prev"></span>' +
      '<span class="m-qcard-fold">展开</span>' +
      '<span class="m-qcard-chev" aria-hidden="true">⌄</span>';
    var thumb = mk("button", "m-qcard-thumb");
    thumb.type = "button";
    thumb.title = "查看整张原图";
    thumb.hidden = true;
    head.appendChild(toggle);
    head.appendChild(thumb);

    var body = mk("div", "m-qcard-b");
    body.hidden = true;
    var textBox = mk("div", "m-qcard-txt");
    var note = mk("div", "m-qcard-note");
    note.hidden = true;
    var figs = mk("div", "m-qcard-figs");
    var figTip = mk("div", "m-qcard-figtip");
    figTip.hidden = true;
    var pick = mk("div", "m-qcard-pick");
    pick.hidden = true;
    body.appendChild(textBox);
    body.appendChild(note);
    body.appendChild(figs);
    body.appendChild(figTip);
    body.appendChild(pick);
    card.appendChild(head);
    card.appendChild(body);
    anchor.insertBefore(card, anchor.firstChild);

    var preview = toggle.querySelector(".m-qcard-prev");
    var fold = toggle.querySelector(".m-qcard-fold");
    var open = false;

    function setOpen(v) {
      open = !!v;
      body.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      fold.textContent = open ? "收起" : "展开";
      card.classList.toggle("open", open);
    }
    toggle.addEventListener("click", function () { setOpen(!open); });

    function showLightbox(src) {
      var lb = $("lightbox"), img = $("lightboxImg");
      if (!lb || !img || !src) return;
      img.src = src;
      lb.classList.add("show");
    }

    // 旧记录里可能还留着 OCR 乱码：渲染前再过一遍 core 的清洗。
    function cleanText(s) {
      try { if (window.HXApi && HXApi.cleanText) return HXApi.cleanText(s); } catch (e) {}
      return String(s == null ? "" : s);
    }
    // 只用于比较/预览：把换行和连续空白压平；判断要不要沿用已渲染的公式 HTML 时，
    // 必须两边都压平再比，否则带换行的干净题文会被误判成“清洗过”，丢掉 KaTeX 渲染。
    function flatText(s) {
      return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    }
    function boxOf(last) {
      var b = last && last.result && last.result.figureBox;
      if (!b) return null;
      var x = Number(b.x), y = Number(b.y), w = Number(b.w), h = Number(b.h);
      if (![x, y, w, h].every(function (v) { return isFinite(v); })) return null;
      x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
      w = Math.min(w, 1 - x); h = Math.min(h, 1 - y);
      if (w < 0.02 || h < 0.02) return null;
      var out = { x: x, y: y, w: w, h: h };
      if (typeof b.image === "number" && b.image >= 0) out.image = b.image;
      return out;
    }

    var qText = $("qText"), qFig = $("qFig");
    var state = { html: null, srcs: [], clean: null, boxKey: "", box: null };
    var figCache = {}, figToken = 0;
    function readSrcs() {
      var out = [];
      // 原题卡要放“整张原图”。#qFig 里第一张 qfig-main 是 figureBox 裁出来的
      // 题图局部，放在原题卡里会看着像图被截断，只能作为兜底。
      try {
        var imgs = (window.SolverDebug && SolverDebug.last) ? (SolverDebug.last().images || []) : [];
        imgs.forEach(function (s) {
          s = String(s || "");
          if (/^data:image\//.test(s) && out.indexOf(s) < 0) out.push(s);
        });
      } catch (e) {}
      if (out.length) return out;
      if (!qFig) return out;
      var list = qFig.querySelectorAll("img.qfig-main");
      for (var i = 0; i < list.length; i++) {
        var s = list[i].getAttribute("src") || list[i].src || "";
        if (s && out.indexOf(s) < 0) out.push(s);
      }
      return out;
    }
    function sameSrcs(a, b) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }
    function figKey(src, box) {
      return src.length + "|" + src.slice(0, 24) + "|" + src.slice(-24) + "|" +
        box.x + "," + box.y + "," + box.w + "," + box.h;
    }
    function updateThumb() {
      var src = state.srcs[card.__idx] || state.srcs[0] || "";
      thumb.innerHTML = "";
      thumb.hidden = !src;
      if (!src) return;
      var im = document.createElement("img");
      im.src = src;
      im.alt = "原图";
      thumb.appendChild(im);
      thumb.onclick = function (e) {
        e.stopPropagation();
        showLightbox(src);
      };
    }
    function openFigure(src, idx, box) {
      var D = window.SolverDebug;
      if (!D || !D.figureCrop || !D.figureCrop(src, idx, box)) showLightbox(src);
    }
    function renderFig() {
      figs.innerHTML = "";
      var srcs = state.srcs;
      if (!srcs.length) { figs.hidden = true; figTip.hidden = true; pick.hidden = true; return; }
      var idx = card.__idx;
      if (!srcs[idx]) idx = card.__idx = 0;
      var src = srcs[idx];
      var box = state.box && ((typeof state.box.image === "number" ? state.box.image : 0) === idx) ? state.box : null;
      var token = ++figToken;
      var b = mk("button", "m-qcard-fig");
      b.type = "button";
      b.title = box ? "点图重新框选题图" : "点图框选题图";
      b.setAttribute("aria-label", b.title);
      var im = document.createElement("img");
      im.alt = "题图";
      im.loading = "lazy";
      b.appendChild(im);
      b.addEventListener("click", function () { openFigure(src, idx, box); });
      figs.appendChild(b);
      figs.hidden = false;
      var key = box ? figKey(src, box) : "";
      if (box && figCache[key]) {
        im.src = figCache[key];
      } else {
        im.src = src;
        if (box) {
          var D = window.SolverDebug;
          if (D && D.cropFigure) D.cropFigure(src, box, function (u) {
            if (!u || token !== figToken) return;
            figCache[key] = u;
            im.src = u;
          });
        }
      }
      figTip.hidden = false;
      figTip.textContent = box
        ? "点上面的题图可重新框选；点右上角缩略图看整张原图。"
        : "点上面的题图，框出题目里的图形；点右上角缩略图看整张原图。";
      renderPick();
    }
    function renderPick() {
      pick.innerHTML = "";
      if (state.srcs.length < 2) { pick.hidden = true; return; }
      state.srcs.forEach(function (s, i) {
        var b = mk("button", "m-qcard-pick-i");
        b.type = "button";
        b.title = "第 " + (i + 1) + " 张图";
        if (i === card.__idx) b.className += " on";
        var im = document.createElement("img");
        im.src = s;
        im.alt = "";
        b.appendChild(im);
        b.addEventListener("click", function () {
          if (card.__idx === i) return;
          card.__idx = i;
          renderFig();
          updateThumb();
        });
        pick.appendChild(b);
      });
      pick.hidden = false;
    }
    function sync(force) {
      if (!qText || !qFig) return;
      var last = null;
      try { last = (window.SolverDebug && SolverDebug.last) ? SolverDebug.last() : null; } catch (e) {}
      var html = qText.innerHTML || "";
      var plain = (qText.textContent || "").replace(/\s+/g, " ").trim();
      var typed = String((last && last.question) || "").trim();
      var recTxt = String((last && last.result && last.result.questionText) || "").trim();
      var srcText = typed || recTxt;
      var rawText = srcText || plain;
      var cleanRaw = cleanText(rawText);
      var cleaned = flatText(cleanRaw);
      var srcs = readSrcs();
      var box = boxOf(last);
      var boxKey = box ? JSON.stringify(box) : "";
      var srcChanged = !sameSrcs(srcs, state.srcs);
      var textChanged = html !== state.html || cleaned !== state.clean;
      var boxChanged = boxKey !== state.boxKey;
      if (!force && !srcChanged && !textChanged && !boxChanged) return;

      if (srcChanged) {
        state.srcs = srcs.slice();
        card.__idx = (box && typeof box.image === "number" && srcs[box.image]) ? box.image : 0;
      }
      if (boxChanged && box && typeof box.image === "number" && state.srcs[box.image]) card.__idx = box.image;
      if (!state.srcs[card.__idx]) card.__idx = 0;
      state.html = html;
      state.clean = cleaned;
      state.boxKey = boxKey;
      state.box = box;

      var has = !!cleaned || state.srcs.length > 0;
      card.hidden = !has;
      if (!has) {
        setOpen(false);
        textBox.innerHTML = "";
        figs.innerHTML = "";
        pick.innerHTML = "";
        pick.hidden = true;
        figTip.hidden = true;
        note.hidden = true;
        note.textContent = "";
        thumb.hidden = true;
        thumb.innerHTML = "";
        preview.textContent = "";
        state.srcs = []; state.html = null; state.clean = null; state.boxKey = ""; state.box = null;
        return;
      }

      textBox.innerHTML = "";
      if (cleaned) {
        // 题文没被清洗改动过 → 保留 mathHTML 渲染好的公式；改过 → 用清洗后的纯文本。
        var useHTML = !!html && flatText(cleanRaw) === flatText(rawText);
        textBox.classList.toggle("m-plain", !useHTML);
        if (useHTML) textBox.innerHTML = html;
        else textBox.textContent = cleaned;
      } else {
        textBox.classList.remove("m-plain");
      }
      if (state.srcs.length) {
        note.textContent = cleaned
          ? (typed ? "" : "题文由 AI 识别，可能不完整；原图请点右上角缩略图查看。")
          : "图片题：未识别到题文，原图请点右上角缩略图查看。";
        note.hidden = !note.textContent;
      } else {
        note.hidden = true;
        note.textContent = "";
      }
      preview.textContent = cleaned
        ? cleaned.slice(0, 72)
        : ("原题图片" + (state.srcs.length > 1 ? " · " + state.srcs.length + " 张" : ""));

      updateThumb();
      renderFig();
    }

    qCard = card;
    qCardMo = new MutationObserver(function () { sync(false); });
    if (qText) qCardMo.observe(qText, { childList: true, subtree: true, characterData: true });
    if (qFig) qCardMo.observe(qFig, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["src", "class"] });
    card.__onFigure = function () { sync(true); };
    document.addEventListener("hj-figure-change", card.__onFigure);
    sync(true);
  }

  function watchAnswer() {
    var ans = $("answer");
    if (!ans) return;
    var done = false, lastRec = "";
    new MutationObserver(function () {
      var t = (ans.textContent || "").trim();
      var ok = t && t !== "—" && !ans.classList.contains("hint");
      var recId = (window.SolverDebug && SolverDebug.recId) ? String(SolverDebug.recId() || "") : "";
      // 从一条结果直接切到另一条时 answer 只是换了文本，done 仍为 true；
      // 按记录 id 判断是否换了记录，不然 m-has-result 会停留在上一条的状态。
      if (ok && (!done || recId !== lastRec)) {
        done = true;
        lastRec = recId;
        resultShown = true;
        body(true);
        showHome(false);
        setDetent(1);
        try { var bodyEl = document.querySelector("#rightPanel .anbody"); if (bodyEl) bodyEl.scrollTop = 0; } catch (e) {}
        try { document.dispatchEvent(new CustomEvent("hj-new-result")); } catch (e2) {}
        // 结果渲染完再校一次：图形尺寸可能变过
        setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 120);
      }
      if (!ok) { done = false; lastRec = ""; resultShown = false; }
    }).observe(ans, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  }

  /* ---------------- 启停 ---------------- */
  function on() {
    if (!MQ.matches) return;
    if (!document.getElementById("q") || !document.getElementById("inputRow")) {
      // 输入区不在了（历史 bug 的残留现场）：重载一次拿回原始 DOM，只重试一次防死循环
      if (!sessionStorage.getItem("hj_m_heal")) {
        sessionStorage.setItem("hj_m_heal", "1");
        location.reload();
      }
      return;
    }
    if (!built) {
      built = true;
      buildHome();
      buildObjects();
      buildBar();
      moveStepbar();
      arrangeAnswerP0();
      buildQCard();
      bindDrag();
      watchAnswer();
      watchStatus();
      watchAnalysis();
      buildSolveProgress();
      buildInlineProgress();
      window.addEventListener("resize", layout);
      window.addEventListener("orientationchange", function () { setTimeout(layout, 240); });
      try { sessionStorage.removeItem("hj_m_heal"); } catch (e) {}
      try { sessionStorage.removeItem("hj_m_heal"); } catch (e) {}
      // 有结果就直接进结果态（横竖屏来回切时不会把用户踢回首页）
      // 只看显式标志：以前用 #answer 的文本猜，初始化/解题中的占位符会被误判成"已有结果"
      showHome(!resultShown);
      if (resultShown) { body(true); setDetent(1); }
      setTimeout(layout, 60);
    } else {
      showHome(!document.body.classList.contains("m-has-result"));
      setTimeout(layout, 60);
    }
  }
  function off() {
    if (!built) return;
    if (solveCard) {
      if (solveTimer) { clearInterval(solveTimer); solveTimer = null; }
      if (solveCard.el && solveCard.el.parentNode) solveCard.el.parentNode.removeChild(solveCard.el);
      solveCard = null;
      window.HJMobileProgress = null;
      window.HJMobileInlineProgress = null;
      document.body.classList.remove("m-solving");
    }
    try { if (P0.metaMo) P0.metaMo.disconnect(); } catch (e) {}
    try { if (P0.tabsMo) P0.tabsMo.disconnect(); } catch (e) {}
    try { if (P0.moreMo) P0.moreMo.disconnect(); } catch (e) {}
    [P0.metaBtn, P0.tabs, P0.more].forEach(function (n) { try { if (n && n.parentNode) n.parentNode.removeChild(n); } catch (e2) {} });
    try { if ($("meta")) $("meta").classList.remove("m-open"); } catch (e3) {}
    try { if ($("answer")) $("answer").classList.remove("m-answer-clamped"); } catch (e4) {}
    P0 = { metaBtn: null, metaMo: null, tabs: null, tabsMo: null, tabsSync: null, more: null, moreMo: null };
    try { if (qCardMo) qCardMo.disconnect(); } catch (e5) {}
    if (qCard && qCard.__onFigure) {
      try { document.removeEventListener("hj-figure-change", qCard.__onFigure); } catch (e6) {}
    }
    if (qCard && qCard.parentNode) qCard.parentNode.removeChild(qCard);
    qCard = null; qCardMo = null;
    if (anaFold) {
      try { anaFold.mo.disconnect(); } catch (e) {}
      try { if (anaFold.btn.parentNode) anaFold.btn.parentNode.removeChild(anaFold.btn); } catch (e2) {}
      try { anaFold.box.classList.remove("m-folded"); } catch (e3) {}
      anaFold = null;
    }
    // 对象子页：先还原左栏，再删自建节点
    var obk = document.querySelector("#leftPanel .m-obj-back");
    if (obk && obk.parentNode) obk.parentNode.removeChild(obk);
    if (objMoved && objMoved.el) {
      objMoved.el.classList.remove("m-in-sheet");
      try {
        if (objMoved.parent && objMoved.parent.isConnected) objMoved.parent.insertBefore(objMoved.el, objMoved.next || null);
      } catch (e) {
        var mainEl = $("main");
        if (mainEl) mainEl.insertBefore(objMoved.el, $("splitL") || null);
      }
    }
    objMoved = null;
    if (objPage && objPage.parentNode) objPage.parentNode.removeChild(objPage);
    objPage = null;
    if (objBar && objBar.parentNode) objBar.parentNode.removeChild(objBar);
    objBar = null;
    barKey = null;
    document.body.classList.remove("m-objbar", "m-objpage-open");
    // 回到桌面宽度：把搬走的节点放回去，清掉内联状态
    var home = $("mHome");
    moved.slice().reverse().forEach(function (m) {
      try {
        if (m.parent && m.parent.isConnected && m.parent !== home) {
          if (m.next && m.next.parentNode === m.parent) m.parent.insertBefore(m.el, m.next);
          else m.parent.appendChild(m.el);
        } else {
          // 原位置已经不在文档里（或正好是 #mHome）→ 退回 #app，绝不能留在待删节点里
          var app = $("app");
          if (app) app.insertBefore(m.el, app.firstChild);
        }
      } catch (e) {}
    });
    moved.length = 0;
    // 还有子节点留在 #mHome 里就说明没搬干净，宁可留着也不删（删了就是整块 UI 消失）
    if (home && !home.querySelector("#inputRow")) home.remove();
    var plus = $("mHomeBtn"); if (plus) plus.remove();
    var topOpts = $("mTopOpts"); if (topOpts) topOpts.remove();
    clearTimeout(snapTimer); snapTimer = null;
    clearTimeout(settleTimer); settleTimer = null;
    var offPanel = $("rightPanel");
    if (offPanel) { offPanel.style.transform = ""; offPanel.style.transition = ""; }
    var offHost = $("canvasHost"), offG3d = $("g3d");
    if (offHost) offHost.style.transform = "";
    if (offG3d) offG3d.style.transform = "";
    var offBody = document.querySelector("#rightPanel .anbody");
    if (offBody) offBody.style.paddingBottom = "";
    document.documentElement.style.removeProperty("--m-stage-bottom");
    document.body.classList.remove("m-peek", "m-sheet-high", "m-sheet-dragging", "m-objbar", "m-has-result", "m-home");
    panelH = 0; stageH = 0; lastStageBottom = null;
    var prog = $("mProg"); if (prog) prog.remove();
    built = false;
  }

  // 调试口（模拟器上用 CDP 调用，方便验收各档位）
  window.HJSheetDebug = {
    set: setDetent,
    offset: function () { return offset; },
    detents: function () { return DET.slice(); },
    max: function () { return maxOffset; },
    home: function (v) { showHome(!!v); },
    layout: layout,
    off: function () { if (built) off(); }
  };

  window.HJMobile = window.HJMobile || {};
  window.HJMobile.openObjects = openObjects;
  window.HJMobile.closeObjects = closeObjects;
  window.HJMobile.isObjectOpen = isObjectOpen;
  window.HJMobile.onCanvasObject = onCanvasObject;
  window.HJMobile.keepInputVisible = keepInputVisible;
  document.addEventListener("hj-object-selected", onObjSelected);
  document.addEventListener("hj-objects-changed", onObjsChanged);
  document.addEventListener("hj-history-changed", function () { if (MQ.matches) refreshRecent(); });

  function sync() { MQ.matches ? on() : off(); }
  if (MQ.addEventListener) MQ.addEventListener("change", sync);
  else if (MQ.addListener) MQ.addListener(sync);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync);
  else sync();
})();
