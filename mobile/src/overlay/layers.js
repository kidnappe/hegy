/* =========================================================
   何解 · 移动端底座（layers.js）
   ---------------------------------------------------------
   1. 单一层栈：对话框 / 全屏页 / sheet 子页 都往里 push，
      Android 返回键从最上层往下关；栈空时才交给页面自己处理。
   2. Material 风格确认对话框：替代 WebView 的 confirm()。
   3. 键盘 inset：visualViewport + env(keyboard-inset-height)，
      不单靠 adjustResize（Capacitor 8 + Android 15 edge-to-edge 有已知坑）。

   只在 max-width:760px 生效；桌面端由 solver.js 回退到原生 confirm()。
   ========================================================= */
(function () {
  "use strict";
  if (window.HJLayers) return;

  var MQ = window.matchMedia("(max-width: 760px)");
  var stack = [];

  function run(fn) { try { fn(); } catch (e) { console.error("[layers]", e); } }

  // solver.js 的旧弹层没有 z-index 管理：从设置里再开日志/历史时会被设置盖住。
  // 谁后显示谁拿更高的 z（上限留 100 给对话框）。
  (function raiseLegacyOverlays() {
    var ids = ["cfgModal", "histModal", "logModal", "cropModal", "lightbox", "aboutModal"];
    var z = 85;
    function arm(id) {
      var n = $(id);
      if (!n || n.__hjRaise) return;
      n.__hjRaise = true;
      new MutationObserver(function () {
        if (n.classList.contains("show")) n.style.zIndex = String(++z);
      }).observe(n, { attributes: true, attributeFilter: ["class"] });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { ids.forEach(arm); });
    } else {
      ids.forEach(arm);
    }
  })();

  var layers = {
    push: function (layer) {
      if (!layer) return null;
      stack.push(layer);
      return layer;
    },
    remove: function (layer) {
      var i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
    },
    closeTop: function () {
      var l = stack[stack.length - 1];
      if (!l) return false;
      stack.pop();
      run(l.close);
      return true;
    },
    size: function () { return stack.length; }
  };
  window.HJLayers = layers;

  function $(id) { return document.getElementById(id); }
  function shown(id) {
    var n = $(id);
    return !!(n && n.classList && n.classList.contains("show"));
  }
  function click(id) {
    var n = $(id);
    if (!n) return false;
    n.click();
    return true;
  }

  /* ---------------- 返回键：栈 → 旧弹层 → sheet → 首页 ---------------- */
  function onBack() {
    if (layers.closeTop()) return true;

    // solver.js 里还没迁到层栈的弹层：按视觉层级从上往下找
    if (shown("cropModal")) return click("cropCancel");
    if (shown("lightbox")) return click("lbClose");
    if (shown("logModal")) return click("logClose");
    if (shown("histModal")) {
      var sweep = new CustomEvent("hj-swipe-back", { cancelable: true });
      document.dispatchEvent(sweep);
      if (sweep.defaultPrevented) return true;
      return click("btnHistX");
    }
    if (window.HJPages && HJPages.back && HJPages.back()) return true;
    if (shown("aboutModal")) { if (window.HJAbout) { window.HJAbout.close(); return true; } return click("btnAboutX"); }
    if (shown("cfgModal")) return click("btnCfgClose");

    if (window.HJMobile && window.HJMobile.closeAll) {
      if (document.getElementById("mSheet") && $("mSheet").classList.contains("show")) {
        window.HJMobile.closeAll();
        return true;
      }
    }
    if (window.HJMobile && window.HJMobile.isObjectOpen && window.HJMobile.isObjectOpen()) {
      window.HJMobile.closeObjects();
      return true;
    }
    // 属性条开着：先收起属性条，再按一次才回首页
    if (document.body.classList.contains("m-objbar")) {
      var ob = document.querySelector('#mObjBar [data-act="close"]');
      if (ob) { ob.click(); return true; }
    }

    // sheet 没收到最底 → 先收到答案条
    if (window.HJSheetDebug) {
      try {
        var off = HJSheetDebug.offset(), det = HJSheetDebug.detents();
        if (off < det[2] - 2) { HJSheetDebug.set(2); return true; }
      } catch (e) {}
    }

    // 有结果 → 回首页；已经在首页 → 退到后台（Android 根页面惯例）
    if (document.body.classList.contains("m-has-result")) {
      click("btnHome");                              // 清空当前题
      if (window.HJSheetDebug) HJSheetDebug.home(true);  // 再切回首页层
      return true;
    }
    if (!document.body.classList.contains("m-home")) {
      if (window.HJSheetDebug) { HJSheetDebug.home(true); return true; }
    }

    var App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && App.minimizeApp) { App.minimizeApp(); return true; }
    return false;
  }
  window.HJBack = onBack;

  var AppPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (AppPlugin && AppPlugin.addListener) {
    AppPlugin.addListener("backButton", function () { onBack(); });
  } else {
    console.warn("[layers] @capacitor/app 不可用，Android 返回键未接管");
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !MQ.matches) return;
    if (layers.size()) { onBack(); }
  });

  /* ---------------- 对话框 ---------------- */
  function mk(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  var dlgSeq = 0;

  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      var scrim = mk("div", "m-dlg-scrim");
      var box = mk("div", "m-dlg");
      box.setAttribute("role", "alertdialog");
      box.setAttribute("aria-modal", "true");
      var titleId = "mDlgTitle" + (++dlgSeq);
      box.setAttribute("aria-labelledby", titleId);

      var h = mk("h3", "m-dlg-t");
      h.id = titleId;
      h.textContent = opts.title || "确认操作";
      box.appendChild(h);

      if (opts.message) {
        var p = mk("p", "m-dlg-m");
        p.textContent = opts.message;
        box.appendChild(p);
      }

      var acts = mk("div", "m-dlg-acts");
      var cancel = mk("button", "m-dlg-btn");
      cancel.type = "button";
      cancel.textContent = opts.cancelText || "取消";
      var ok = mk("button", "m-dlg-btn m-dlg-ok" + (opts.danger ? " danger" : ""));
      ok.type = "button";
      ok.textContent = opts.okText || "确定";
      acts.appendChild(cancel);
      acts.appendChild(ok);
      box.appendChild(acts);
      scrim.appendChild(box);
      document.body.appendChild(scrim);

      var layer = { id: "dialog", close: function () { finish(false); } };
      layers.push(layer);

      function finish(v) {
        if (done) return;
        done = true;
        layers.remove(layer);
        try { scrim.classList.remove("show"); } catch (e) {}
        setTimeout(function () { if (scrim.parentNode) scrim.parentNode.removeChild(scrim); }, 160);
        resolve(!!v);
      }
      cancel.onclick = function () { finish(false); };
      ok.onclick = function () { finish(true); };
      scrim.addEventListener("click", function (e) { if (e.target === scrim) finish(false); });

      requestAnimationFrame(function () { scrim.classList.add("show"); });
      setTimeout(function () { try { cancel.focus(); } catch (e) {} }, 30);
    });
  }

  function toast(msg, opts) {
    if (window.HJ && window.HJ.toast) {
      try { window.HJ.toast(msg, (opts && opts.kind) || "ok"); return; } catch (e) {}
    }
    console.log("[toast] " + msg);
  }

  window.HJDialog = { confirm: confirm, toast: toast };

  /* ---------------- 选择面板 ----------------
     beUI Bottom Sheet 的手机移植：只让把手接管纵向拖拽，选项区保持可点可滚；
     松手按距离和速度决定关闭，遮罩/返回键/取消按钮都能退。 */
  var choiceSeq = 0;
  var activeChoice = null;
  function openChoice(opts) {
    opts = opts || {};
    if (!MQ.matches) return null;
    if (activeChoice) return activeChoice;
    var options = opts.options || [];
    var current = opts.value == null ? "" : String(opts.value);
    var opener = document.activeElement;
    var root = mk("div", "m-choice");
    var scrim = mk("div", "m-choice-scrim");
    var panel = mk("div", "m-choice-panel");
    panel.tabIndex = -1;
    var grab = mk("div", "m-choice-grab");
    var titleId = "mChoiceTitle" + (++choiceSeq);
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", titleId);
    grab.appendChild(mk("i"));
    panel.appendChild(grab);

    var hd = mk("div", "m-choice-hd");
    var h = mk("h3", "m-choice-t");
    h.id = titleId;
    h.textContent = opts.title || "请选择";
    hd.appendChild(h);
    if (opts.subtitle) {
      var p = mk("p", "m-choice-sub");
      p.textContent = opts.subtitle;
      hd.appendChild(p);
    }
    panel.appendChild(hd);

    var list = mk("div", "m-choice-list");
    list.setAttribute("role", "listbox");
    var lastGroup = "";
    options.forEach(function (o) {
      if (o.group && o.group !== lastGroup) {
        lastGroup = o.group;
        var gh = mk("div", "m-choice-group");
        gh.textContent = o.group;
        list.appendChild(gh);
      }
      var b = mk("button", "m-choice-row" + (String(o.value) === current ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(o.value) === current ? "true" : "false");
      var t = mk("span", "t");
      var n = mk("span", "n");
      n.textContent = o.label == null ? String(o.value) : String(o.label);
      t.appendChild(n);
      if (o.desc) {
        var d = mk("span", "d");
        d.textContent = o.desc;
        t.appendChild(d);
      }
      b.appendChild(t);
      var chk = mk("span", "chk");
      chk.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5 9.2 16.7 19 7"/></svg>';
      b.appendChild(chk);
      b.addEventListener("click", function () {
        if (typeof opts.onPick === "function") opts.onPick(o.value, o);
        close(true);
      });
      list.appendChild(b);
    });
    panel.appendChild(list);

    var cancel = mk("button", "m-choice-cancel");
    cancel.type = "button";
    cancel.textContent = opts.cancelText || "取消";
    cancel.addEventListener("click", function () { close(false); });
    panel.appendChild(cancel);

    scrim.addEventListener("click", function () { close(false); });
    root.appendChild(scrim);
    root.appendChild(panel);

    var layer = layers.push({ id: "choice", close: function () { close(false); } });
    var done = false;
    function close(picked) {
      if (done) return;
      done = true;
      layers.remove(layer);
      root.classList.remove("show");
      document.documentElement.classList.remove("m-choice-lock");
      document.body.classList.remove("m-choice-lock");
      if (panel.style.transform) {
        requestAnimationFrame(function () { panel.style.transform = ""; });
      }
      setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 280);
      activeChoice = null;
      if (!picked && opener && opener.focus) {
        try { opener.focus({ preventScroll: true }); } catch (e) {}
      }
    }

    // 只手柄拖拽：选项列表继续吃自己的滚动和点击
    var drag = null;
    function endDrag() {
      if (!drag) return;
      var dy = drag.dy, v = drag.v;
      drag = null;
      panel.classList.remove("dragging");
      if (dy > 96 || (v > 0.55 && dy > 14)) {
        panel.style.transform = "translate3d(0," + dy + "px,0)";
        close(false);
        return;
      }
      panel.style.transform = "";
    }
    grab.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      drag = { y: e.clientY, dy: 0, lastY: e.clientY, lastT: performance.now(), v: 0 };
      try { grab.setPointerCapture(e.pointerId); } catch (err) {}
      panel.classList.add("dragging");
    });
    grab.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dy = Math.max(0, e.clientY - drag.y);
      var now = performance.now();
      var dt = now - drag.lastT;
      if (dt > 0) {
        drag.v = (e.clientY - drag.lastY) / dt;
        drag.lastY = e.clientY;
        drag.lastT = now;
      }
      drag.dy = dy;
      panel.style.transform = "translate3d(0," + dy + "px,0)";
    });
    grab.addEventListener("pointerup", endDrag);
    grab.addEventListener("pointercancel", endDrag);

    document.documentElement.classList.add("m-choice-lock");
    document.body.classList.add("m-choice-lock");
    document.body.appendChild(root);
    requestAnimationFrame(function () { root.classList.add("show"); });
    setTimeout(function () {
      try { panel.focus({ preventScroll: true }); } catch (e) {}
    }, 40);
    activeChoice = { close: function () { close(false); } };
    return activeChoice;
  }
  window.HJChoice = { open: openChoice };

  /* ---------------- 键盘 inset ---------------- */
  var kbT = null;
  function syncKeyboard() {
    var vv = window.visualViewport;
    var kb = 0;
    if (vv) {
      kb = window.innerHeight - (vv.height + vv.offsetTop);
      if (!isFinite(kb) || kb < 0) kb = 0;
      // 浏览器已经缩过布局视口时，两者差值≈0，交给原生 resize 就好
      if (kb < 40) kb = 0;
    }
    document.documentElement.style.setProperty("--m-kb", Math.round(kb) + "px");
    document.body.classList.toggle("m-kb-open", kb > 0);
    // 浮层位置直接由 --m-kb 驱动。留个时间戳，让键盘避让的滚动校正能等到
    // 「布局真的不再变」再滚——否则滚完会被随后的一次布局变化/原生滚动覆盖。
    window.__kbSyncAt = Date.now();
  }
  function queueKeyboard() {
    if (kbT) cancelAnimationFrame(kbT);
    kbT = requestAnimationFrame(function () { kbT = null; syncKeyboard(); });
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", queueKeyboard);
    window.visualViewport.addEventListener("scroll", queueKeyboard);
  }
  if (navigator.virtualKeyboard && "overlaysContent" in navigator.virtualKeyboard) {
    try {
      navigator.virtualKeyboard.overlaysContent = true;
      navigator.virtualKeyboard.addEventListener("geometrychange", queueKeyboard);
    } catch (e) {}
  }
  document.addEventListener("focusin", queueKeyboard, true);
  document.addEventListener("focusout", function () { setTimeout(queueKeyboard, 60); }, true);
  syncKeyboard();

  window.HJKeyboard = { sync: syncKeyboard };
})();
