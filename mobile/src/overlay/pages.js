/* =========================================================
   何解 · 手机端全屏页（pages.js）
   ---------------------------------------------------------
   设置：把桌面手风琴重排成「列表 → 子页」，复用原有字段与校验；
        改完即存，不再有保存/取消底栏。
   历史：全屏 + 日期分组 + 左滑删除。
   日志 / 裁剪：全屏页，左上角返回。
   首启：没配置模型时三步向导（服务商 → Key → 模型/测试）。
   ========================================================= */
(function () {
  "use strict";
  if (window.HJPages) return;
  var MQ = window.matchMedia("(max-width: 760px)");
  var SET = { built: false, sub: "", openModel: false, showSub: null };
  var WIZ = null;

  function $(id) { return document.getElementById(id); }
  function onMobile() { return MQ.matches; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function checkNode() {
    var s = el("span", "chk");
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5 9.2 16.7 19 7"/></svg>';
    return s;
  }
  function markPick(btn, on) {
    btn.classList.toggle("on", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  // 设置/向导里的原生 <select> 同样换成自绘面板；select 保留原事件与取值，
  // 只是不再让 Android 接管弹层。
  function bindMobileSelects(root) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll("select"), function (sel) {
      if (sel.__hjPickBound) return;
      sel.__hjPickBound = true;
      var title = sel.id === "fPreset" ? "服务商预设"
        : sel.classList.contains("w-preset") ? "服务商"
        : sel.classList.contains("w-models") ? "模型" : "请选择";
      var host = sel.parentNode;
      if (!host) return;
      var dedicated = host.classList && (host.classList.contains("field") || host.classList.contains("m-wiz-f"));
      if (!dedicated) {
        var wrap = el("div", "m-select-host");
        host.insertBefore(wrap, sel);
        wrap.appendChild(sel);
        host = wrap;
      }
      sel.classList.add("m-select-proxy");
      host.classList.add("m-select-hosted");
      host.addEventListener("click", function (e) {
        if (!onMobile() || sel.disabled || !sel.options.length) return;
        if (sel.style.display === "none" || !sel.offsetParent) return;
        e.preventDefault();
        e.stopPropagation();
        var opts = Array.prototype.map.call(sel.options, function (o) {
          return { value: o.value, label: o.textContent };
        });
        if (!window.HJChoice) return;
        window.HJChoice.open({
          title: title,
          value: sel.value,
          options: opts,
          onPick: function (v) {
            sel.value = v;
            try { sel.dispatchEvent(new Event("change", { bubbles: true })); } catch (err) {}
          }
        });
      });
    });
  }
  var BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

  function backButton(label) {
    var b = el("button", "m-back");
    b.type = "button";
    b.innerHTML = BACK_SVG;
    b.setAttribute("aria-label", label || "返回");
    return b;
  }

  /* =========================================================
     一、设置：列表 → 子页
     ========================================================= */
  function buildSettings() {
    if (SET.built) return;
    var overlay = $("cfgModal");
    if (!overlay) return;
    var modal = overlay.querySelector(".modal");
    if (!modal) return;
    SET.built = true;

    overlay.classList.add("m-cfg");
    modal.classList.add("m-set");

    var desktopHead = modal.querySelector(".mhead");
    if (desktopHead) desktopHead.style.display = "none";
    var wrap = modal.querySelector(".acc-wrap");
    if (wrap) wrap.style.display = "none";
    var foot = modal.querySelector(".mfoot");
    if (foot) foot.style.display = "none";
    var detail = $("cfgDetail");
    if (detail) detail.style.display = "none";

    var hd = el("div", "m-set-hd");
    var back = backButton("关闭设置");
    var title = el("span", "m-set-title", "设置");
    hd.appendChild(back);
    hd.appendChild(title);
    modal.insertBefore(hd, modal.firstChild);

    var root = el("div", "m-set-root");
    var CHEV_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.5 15.5 12 9 18.5"/></svg>';
    function icoSvg(id) {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#' + id + '"/></svg>';
    }
    function row(go, name, desc, icon) {
      var b = el("button", "m-set-row");
      b.type = "button";
      b.dataset.go = go;
      var ic = el("span", "m-set-ico");
      ic.innerHTML = icoSvg(icon || "i-settings");
      b.appendChild(ic);
      var main = el("span", "m-set-row-main");
      main.appendChild(el("span", "n", name));
      if (desc) main.appendChild(el("span", "d", desc));
      b.appendChild(main);
      var v = el("span", "v", "");
      b.appendChild(v);
      var chev = el("span", "chev");
      chev.innerHTML = CHEV_SVG;
      b.appendChild(chev);
      return b;
    }
    // 分组卡片：视觉上把条目收成一块，比一长串通栏行好扫
    function group(title, rows) {
      var g = el("div", "m-set-group");
      if (title) g.appendChild(el("div", "m-set-group-h", title));
      var card = el("div", "m-set-card");
      rows.forEach(function (r) { card.appendChild(r); });
      g.appendChild(card);
      return g;
    }

    var hero = el("div", "m-set-hero");
    hero.appendChild(el("h1", null, "设置"));
    hero.appendChild(el("p", null, "模型、外观与本地记录"));
    root.appendChild(hero);

    root.appendChild(group("解题", [
      row("model", "模型配置", "服务商、Key、模型", "i-sparkles"),
      row("view", "画法", "真实尺寸 / 像题图", "i-ruler")
    ]));
    root.appendChild(group("界面", [
      row("appearance", "外观", "皮肤 · 主题", "i-palette")
    ]));
    root.appendChild(group("数据与支持", [
      row("records", "解题记录", "查看与删除", "i-history"),
      row("diag", "诊断", "错误日志", "i-file-json"),
      row("about", "关于何解", "版本 · 更新记录 · 版权", "i-info")
    ]));
    modal.insertBefore(root, hd.nextSibling);

    var sub = el("div", "m-set-subbody");
    modal.insertBefore(sub, root.nextSibling);

    // 模型子页：沿用桌面字段（节点搬过来，事件与 id 都不变）
    var modelPage = el("div", "m-set-page");
    modelPage.dataset.page = "model";
    var modelAcc = modal.querySelector('.acc[data-acc="model"]');
    if (modelAcc) {
      modelAcc.classList.add("m-set-acc");
      var accH = modelAcc.querySelector(".acc-h");
      if (accH) accH.style.display = "none";
      modelPage.appendChild(modelAcc);
      var accB = modelAcc.querySelector(".acc-b");
      var fields = accB ? Array.prototype.slice.call(accB.querySelectorAll(".field")) : [];
      // 温度 + 单价：收进「高级设置」，大多数人不用
      var advFields = fields.slice(4);
      if (advFields.length) {
        var adv = el("div", "m-set-adv");
        var advBtn = el("button", "m-set-adv-t");
        advBtn.type = "button";
        advBtn.textContent = "高级设置";
        var advBody = el("div", "m-set-adv-b");
        advFields.forEach(function (f) { advBody.appendChild(f); });
        adv.appendChild(advBtn);
        adv.appendChild(advBody);
        accB.appendChild(adv);
        advBtn.onclick = function () {
          var open = adv.classList.toggle("open");
          advBtn.textContent = open ? "收起高级设置" : "高级设置";
        };
      }
      var testRow = el("div", "m-set-test");
      var test = $("btnTest"), msg = $("cfgMsg");
      if (msg) testRow.appendChild(msg);
      if (test) testRow.appendChild(test);
      modelPage.appendChild(testRow);
    }
    sub.appendChild(modelPage);
    bindMobileSelects(modelPage);

    // 外观：皮肤三选一 + 主题（日间/夜间）；数据来自 HJSkin（与桌面同源，key 同为 solver_skin_v1）
    var appearPage = el("div", "m-set-page");
    appearPage.dataset.page = "appearance";
    appearPage.appendChild(el("div", "m-set-note", "皮肤：整个界面的配色与质感。公式、画布图形和导出页不随皮肤变化。"));
    var skinHost = el("div", "m-set-pick");
    appearPage.appendChild(skinHost);
    appearPage.appendChild(el("div", "m-set-note", "主题：日间 / 夜间。画布始终保持白纸，图形颜色不受影响。"));
    var themeHost = el("div", "m-set-pick");
    appearPage.appendChild(themeHost);

    function renderSkinPick() {
      if (!window.HJSkin || !HJSkin.SKINS) return;
      var cur = HJSkin.current();
      skinHost.innerHTML = "";
      HJSkin.SKINS.forEach(function (s) {
        var b = el("button", "m-set-pick-row col");
        b.type = "button";
        markPick(b, s.key === cur);
        var t = el("span", "t");
        var sw = el("span", "sw");
        var swc = s.swatch || {};
        ["bg", "panel", "line", "accent"].forEach(function (k) {
          var i = document.createElement("i");
          i.style.background = k === "accent" ? "#5b5bd6" : (swc[k] || "#fff");
          sw.appendChild(i);
        });
        t.appendChild(sw);
        var tx = el("span", "tx");
        tx.appendChild(el("span", "n", s.name));
        tx.appendChild(el("span", "d", s.desc));
        t.appendChild(tx);
        b.appendChild(t);
        b.appendChild(checkNode());
        b.addEventListener("click", function () {
          if (window.HJSkin) HJSkin.set(s.key);
          renderSkinPick();
          refresh();
        });
        skinHost.appendChild(b);
      });
    }
    function renderThemePick() {
      var dark = document.documentElement.getAttribute("data-theme") === "dark";
      var cur = dark ? "dark" : "light";
      themeHost.innerHTML = "";
      [["light", "日间"], ["dark", "夜间"]].forEach(function (p) {
        var b = el("button", "m-set-pick-row");
        b.type = "button";
        markPick(b, p[0] === cur);
        b.appendChild(el("span", "t", p[1]));
        b.appendChild(checkNode());
        b.addEventListener("click", function () {
          if (p[0] !== cur) { var t = $("btnTheme"); if (t) t.click(); }
          renderThemePick();
          refresh();
        });
        themeHost.appendChild(b);
      });
    }
    renderSkinPick();
    renderThemePick();
    // 主题切换经 solver.js 的 View Transition 是下一帧生效，点完立刻读 data-theme
    // 会读到旧值（切向因此反转）——改听 hj-themechange 再刷新选中态
    if (!window.__hjThemePickWired) {
      window.__hjThemePickWired = true;
      document.addEventListener("hj-themechange", function () { renderThemePick(); refresh(); });
    }
    sub.appendChild(appearPage);

    // 画法（真实尺寸 / 像题图）
    var viewPage = el("div", "m-set-page");
    viewPage.dataset.page = "view";
    viewPage.appendChild(el("div", "m-set-note", "立体图怎么画：真实尺寸严格按题目长度；像题图按教材的视觉习惯，比例是估的。"));
    var pickHost = el("div", "m-set-pick");
    function renderViewPick() {
      var vs = $("view");
      if (!vs) return;
      pickHost.innerHTML = "";
      Array.prototype.forEach.call(vs.options, function (o) {
        var b = el("button", "m-set-pick-row");
        b.type = "button";
        markPick(b, o.value === vs.value);
        b.appendChild(el("span", "t", o.textContent));
        b.appendChild(checkNode());
        b.addEventListener("click", function () {
          vs.value = o.value;
          try { vs.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
          renderViewPick();
          refresh();
        });
        pickHost.appendChild(b);
      });
    }
    renderViewPick();
    viewPage.appendChild(pickHost);
    sub.appendChild(viewPage);

    // 记录
    var recPage = el("div", "m-set-page");
    recPage.dataset.page = "records";
    var recGo = row("hist", "查看全部记录", "点一条即可回看", "i-history");
    var recClear = row("clear", "清空全部记录", "删除后无法恢复", "i-trash-2");
    recClear.classList.add("danger");
    recPage.appendChild(group(null, [recGo, recClear]));
    sub.appendChild(recPage);

    // 诊断
    var diagPage = el("div", "m-set-page");
    diagPage.dataset.page = "diag";
    var logRow = row("log", "错误日志", "解题失败时的完整信息", "i-file-json");
    diagPage.appendChild(group(null, [logRow]));
    sub.appendChild(diagPage);

    function refresh() {
      var mv = $("accModelSum");
      var mrow = root.querySelector('[data-go="model"] .v');
      if (mrow) mrow.textContent = (mv && mv.textContent) || "未配置";
      var rrow = root.querySelector('[data-go="records"] .v');
      var cnt = (window.HJ && HJ._histCount) ? HJ._histCount() : 0;
      if (rrow) rrow.textContent = cnt + " 条";
      var rsub = recPage.querySelector('[data-go="hist"] .v');
      if (rsub) rsub.textContent = cnt + " 条";
      var dark = document.documentElement.getAttribute("data-theme") === "dark";
      var skinName = "";
      if (window.HJSkin && HJSkin.current) {
        var cur = HJSkin.current();
        HJSkin.SKINS.forEach(function (s2) { if (s2.key === cur) skinName = s2.name; });
      }
      var arow = root.querySelector('[data-go="appearance"] .v');
      if (arow) arow.textContent = (skinName || "原色") + " · " + (dark ? "夜间" : "日间");
      if (typeof renderSkinPick === "function") { renderSkinPick(); renderThemePick(); }
      var vs = $("view");
      var vrow = root.querySelector('[data-go="view"] .v');
      if (vs && vrow) vrow.textContent = vs.options[vs.selectedIndex] ? vs.options[vs.selectedIndex].textContent : "";
      var brow = root.querySelector('[data-go="about"] .v');
      if (brow) brow.textContent = window.HEGY_MOBILE_VERSION ? "v" + window.HEGY_MOBILE_VERSION : "";
    }

    function saveQuiet() {
      if (!window.HJ || !HJ._cfgSaveQuiet) return null;
      var c = HJ._cfgSaveQuiet();
      if (c) refresh();
      return c;
    }

    function showSub(name) {
      SET.sub = name || "";
      root.classList.toggle("hide", !!name);
      // 列表页正文里已有大标题，头部标题只在子页显示
      modal.classList.toggle("m-set-sub", !!name);
      Array.prototype.forEach.call(sub.querySelectorAll(".m-set-page"), function (p) {
        p.classList.toggle("show", p.dataset.page === name);
      });
      title.textContent = name === "model" ? "模型配置"
        : name === "appearance" ? "外观"
        : name === "view" ? "画法"
        : name === "records" ? "解题记录"
        : name === "diag" ? "诊断" : "设置";
      back.setAttribute("aria-label", name ? "返回设置" : "关闭设置");
      if (!name) refresh();
      try { modal.scrollTop = 0; } catch (e) {}
    }
    SET.showSub = showSub;

    back.onclick = function () {
      if (SET.sub) { showSub(""); return; }
      saveQuiet();
      var x = $("btnCfgClose");
      if (x) x.click();
    };

    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-go]");
      if (!b) return;
      var go = b.dataset.go;
      if (go === "about") { if (window.HJAbout) window.HJAbout.open(); return; }
      if (go === "records") { showSub("records"); return; }
      if (go === "appearance") { showSub("appearance"); return; }
      if (go === "diag") { showSub("diag"); return; }
      showSub(go);
    });

    sub.addEventListener("click", function (e) {
      var b = e.target.closest("[data-go]");
      if (!b) return;
      var go = b.dataset.go;
      if (go === "hist") {
        var x = $("btnCfgClose"); if (x) x.click();
        setTimeout(function () { var h = $("btnHist"); if (h) h.click(); }, 120);
        return;
      }
      if (go === "clear") {
        var c = $("btnHistClear"); if (c) c.click();
        return;
      }
      if (go === "log") { var l = $("sbLog"); if (l) l.click(); }
    });

    // 改完即存（只存合法配置；不弹保存按钮）
    var saveT = null;
    function queueSave(ms) {
      clearTimeout(saveT);
      saveT = setTimeout(saveQuiet, ms);
    }
    modelPage.addEventListener("input", function () { queueSave(500); });
    modelPage.addEventListener("change", function () { queueSave(220); });

    // 打开时决定落到哪一页：点模型 chip 直接进模型子页，点齿轮进列表
    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("#cfg");
      if (t) SET.openModel = true;
    }, true);
    new MutationObserver(function () {
      if (!overlay.classList.contains("show")) return;
      refresh();
      showSub(SET.openModel ? "model" : "");
      SET.openModel = false;
    }).observe(overlay, { attributes: true, attributeFilter: ["class"] });

    window.HJPages._refreshSettings = refresh;
    window.HJPages._saveSettings = saveQuiet;
  }

  /* =========================================================
     二、历史：全屏 + 日期分组 + 左滑删除
     ========================================================= */
  function buildHistory() {
    var ov = $("histModal");
    if (!ov) return;
    var modal = ov.querySelector(".modal");
    if (!modal || modal.__mHist) return;
    modal.__mHist = true;
    ov.classList.add("m-hist");

    var head = modal.querySelector(".mhead");
    if (head) {
      var back = backButton("关闭解题记录");
      back.onclick = function () { var x = $("btnHistX"); if (x) x.click(); };
      head.insertBefore(back, head.firstChild);
      var x = $("btnHistX");
      if (x) x.style.display = "none";
      var clear = $("btnHistClear");
      if (clear) {
        clear.classList.remove("ghost");
        clear.classList.add("m-hist-clear");
        head.appendChild(clear);
      }
    }
    var acts = modal.querySelector(".actions");
    if (acts) acts.style.display = "none";

    // 大标题搬进正文（头部只留返回 + 清空），标题文案仍由 pages 自己维护
    var body = modal.querySelector(".mbody");
    var subEl = $("histSub");
    if (body && subEl && !body.querySelector(".m-hist-h1")) {
      body.insertBefore(el("h1", "m-hist-h1", "解题记录"), subEl);
    }

    // 每次重渲染后补三件事：分组条数、纯文字题的占位砖、把「2026/10/25 10:30:02」
    // 收成「10:30」（日期已经由分组条表达了，整串日期把摘要挤成两行）。
    function decorateHistory() {
      var list0 = $("histList");
      if (!list0) return;
      Array.prototype.forEach.call(list0.querySelectorAll(".hist-group"), function (g) {
        var n = 0, p = g.nextElementSibling;
        while (p && !p.classList.contains("hist-group")) {
          if (p.classList.contains("hist-row")) n++;
          p = p.nextElementSibling;
        }
        var tag = g.querySelector(".gn");
        if (!tag) { tag = el("span", "gn"); g.appendChild(tag); }
        tag.textContent = n + " 条";
      });
      Array.prototype.forEach.call(list0.querySelectorAll(".hist-row"), function (row, i) {
        row.style.setProperty("--i", String(Math.min(i, 10)));
        var it = row.querySelector(".hist-item");
        if (!it) return;
        if (!it.querySelector(".thumb-sm")) {
          var ph = el("div", "thumb-sm pg-ph");
          ph.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-list"/></svg>';
          it.insertBefore(ph, it.firstChild);
        }
        var s = it.querySelector(".meta .sub");
        if (!s) return;
        var parts = String(s.textContent || "").split(" · ");
        var head = parts.shift() || "";
        var hm = head.match(/(\d{1,2}):(\d{2})/);
        s.innerHTML = "";
        if (hm) {
          // 补零：卡片里时间是等宽数字，「5:18 / 05:18」混排会左右跳
          var hh = hm[1].length === 1 ? "0" + hm[1] : hm[1];
          s.appendChild(el("b", null, hh + ":" + hm[2]));
          if (parts.length) s.appendChild(document.createTextNode(" · " + parts.join(" · ")));
        } else {
          s.textContent = parts.join(" · ");
        }
      });
    }

    var list = $("histList");
    if (list && !list.__mSwipe) {
      list.__mSwipe = true;
      var RAIL = 80;
      var openRow = null, sw = null;

      function rowOf(it) { return it.closest ? it.closest(".hist-row") : null; }
      function railOf(row) { return row ? row.querySelector(".hist-rail") : null; }
      function setX(it, x, animate) {
        it.style.transition = animate ? "transform .24s cubic-bezier(.2,.86,.24,1)" : "none";
        it.style.transform = x ? "translate3d(" + x + "px,0,0)" : "";
      }
      function setRail(row, on) {
        var rail = railOf(row);
        if (!rail) return;
        rail.setAttribute("aria-hidden", on ? "false" : "true");
        var b = rail.querySelector("button");
        if (b) b.tabIndex = on ? 0 : -1;
      }
      function closeOpen(animate) {
        if (!openRow) return;
        var o = openRow;
        openRow = null;
        setX(o.it, 0, animate !== false);
        o.it.__hjSwipeOpen = false;
        setRail(o.row, false);
      }
      function openThis(it, animate) {
        var row = rowOf(it);
        if (!row) return;
        if (openRow && openRow.it !== it) closeOpen(animate !== false);
        openRow = { it: it, row: row };
        it.__hjSwipeOpen = true;
        setX(it, -RAIL, animate !== false);
        setRail(row, true);
      }
      function resetOpen() { openRow = null; sw = null; }

      document.addEventListener("hj-history-changed", function () { resetOpen(); decorateHistory(); });
      document.addEventListener("hj-swipe-close", function () { closeOpen(true); });
      document.addEventListener("hj-swipe-back", function (e) {
        if (!openRow) return;
        e.preventDefault();
        closeOpen(true);
      });

      list.addEventListener("pointerdown", function (e) {
        var it = e.target.closest(".hist-item");
        if (!it || e.target.closest(".hist-del") || e.target.closest(".thumb-sm")) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (openRow && openRow.it !== it) closeOpen(true);
        sw = {
          it: it,
          x: e.clientX,
          y: e.clientY,
          base: it.__hjSwipeOpen ? -RAIL : 0,
          dx: 0,
          move: false,
          lastX: e.clientX,
          lastT: performance.now(),
          v: 0
        };
      });

      list.addEventListener("pointermove", function (e) {
        if (!sw) return;
        var dx = e.clientX - sw.x, dy = e.clientY - sw.y;
        if (!sw.move) {
          if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
          // 右滑手势整体禁用：条目原地不动。之前会按 0.18 给一段回弹位移，
          // 松手再弹回去，看着像"滑坏了"。操作栏只认左滑。
          if (dx > 0) { sw = null; return; }
          sw.move = true;
          sw.it.style.transition = "none";
          try { sw.it.setPointerCapture(e.pointerId); } catch (err) {}
        }
        var x = sw.base + dx;
        if (x < -RAIL) x = -RAIL + (x + RAIL) * 0.18;
        if (x > 0) x = 0;
        sw.dx = x;
        var now = performance.now(), dt = now - sw.lastT;
        if (dt > 0) {
          sw.v = (e.clientX - sw.lastX) / dt;
          sw.lastX = e.clientX;
          sw.lastT = now;
        }
        sw.it.style.transform = "translate3d(" + x + "px,0,0)";
      });

      function endSwipe() {
        if (!sw) return;
        var s = sw;
        sw = null;
        if (!s.move) return;
        s.it.__hjSwiped = true;          // solver.js 的 click 会消费这个标记
        setTimeout(function () { s.it.__hjSwiped = false; }, 420);
        var shouldOpen;
        if (s.it.__hjSwipeOpen) {
          shouldOpen = !(s.dx > -RAIL * 0.28 || s.v > 0.45);
        } else {
          shouldOpen = s.dx < -Math.max(30, RAIL * 0.46) || (s.v < -0.55 && s.dx < -8);
        }
        if (shouldOpen) openThis(s.it, true);
        else closeOpen(true);
      }
      list.addEventListener("pointerup", endSwipe);
      list.addEventListener("pointercancel", endSwipe);

      // 操作栏开着时点别处先关栏；刚滑完的那次 click 留给 solver.js 吞掉
      list.addEventListener("click", function (e) {
        if (e.target.closest(".hist-del")) return;
        var it = e.target.closest(".hist-item");
        if (!it) return;
        if (it.__hjSwiped) return;
        if (openRow) {
          e.preventDefault();
          e.stopPropagation();
          closeOpen(true);
        }
      }, true);
      document.addEventListener("click", function (e) {
        if (!openRow) return;
        if (e.target.closest("#histList") || e.target.closest("#histModal .mhead")) return;
        closeOpen(true);
      }, true);
    }

    new MutationObserver(function () {
      if (!ov.classList.contains("show")) return;
      var n = (window.HJ && HJ._histCount) ? HJ._histCount() : 0;
      var sub = $("histSub");
      if (sub) sub.textContent = "共 " + n + " 条 · 点任意一条回看";
      if (window.HJ && HJ._renderHistory) HJ._renderHistory();
      decorateHistory();
    }).observe(ov, { attributes: true, attributeFilter: ["class"] });
  }

  /* =========================================================
     三、日志 / 裁剪：全屏 + 返回
     ========================================================= */
  function buildLog() {
    var ov = $("logModal");
    if (!ov) return;
    var modal = ov.querySelector(".modal");
    if (!modal || modal.__mLog) return;
    modal.__mLog = true;
    ov.classList.add("m-log");
    var head = modal.querySelector(".mhead");
    if (!head) return;
    var back = backButton("关闭错误日志");
    back.onclick = function () { var x = $("logClose"); if (x) x.click(); };
    head.insertBefore(back, head.firstChild);
    var x = $("logClose");
    if (x) x.style.display = "none";
  }

  /* 关于：桌面端是个居中弹窗，手机上整页化（顶部返回 + 正文滚动） */
  function buildAbout() {
    var ov = $("aboutModal");
    if (!ov) return;
    var modal = ov.querySelector(".modal");
    if (!modal || modal.__mAbout) return;
    modal.__mAbout = true;
    ov.classList.add("m-about");
    var head = modal.querySelector(".mhead");
    if (!head) return;
    var back = backButton("关闭关于");
    back.onclick = function () { var x = $("btnAboutX"); if (x) x.click(); };
    head.insertBefore(back, head.firstChild);
    var x = $("btnAboutX");
    if (x) x.style.display = "none";
    // 桌面用的是 64px 图标，手机 hero 要放大到 68px —— 换 256 的源，别让位图糊
    var logo = modal.querySelector(".about-logo");
    if (logo && /icon-64\.png$/.test(logo.getAttribute("src") || "")) {
      logo.addEventListener("error", function () { logo.src = "assets/icon-64.png"; }, { once: true });
      logo.src = "assets/icon-256.png";
    }
  }

  function buildCrop() {
    var ov = $("cropModal");
    if (!ov) return;
    var modal = ov.querySelector(".modal");
    if (!modal || modal.__mCrop) return;
    modal.__mCrop = true;
    ov.classList.add("m-crop");
    var head = modal.querySelector(".mhead");
    if (!head) return;
    var h2 = head.querySelector("h2");
    if (h2) h2.textContent = "框选题目区域";
    var back = backButton("取消裁剪");
    back.onclick = function () { var x = $("cropClose"); if (x) x.click(); };
    head.insertBefore(back, head.firstChild);
    var x = $("cropClose");
    if (x) x.style.display = "none";
  }

  /* =========================================================
     四、首启向导
     ========================================================= */
  function wizard() {
    if (WIZ) return;
    var page = el("div", "m-page m-wiz show");
    page.innerHTML =
      '<div class="m-wiz-hd"><span class="m-wiz-t">配置模型</span><button type="button" class="m-wiz-skip">稍后</button></div>' +
      '<div class="m-wiz-dots"><i class="on"></i><i></i><i></i></div>' +
      '<div class="m-wiz-bd">' +
        '<div class="m-wiz-step" data-step="1">' +
          '<h3>先选一个服务商</h3>' +
          '<p>国内模型直连；换服务商只改这一处。</p>' +
          '<label class="m-wiz-f">服务商<select class="w-preset"></select></label>' +
          '<label class="m-wiz-f">接口地址<input class="w-base" spellcheck="false" placeholder="https://api.deepseek.com/v1" /></label>' +
        '</div>' +
        '<div class="m-wiz-step" data-step="2">' +
          '<h3>填入 API Key</h3>' +
          '<p>只保存在本机，用于直接调用模型。</p>' +
          '<label class="m-wiz-f">API Key<input class="w-key" type="password" spellcheck="false" autocomplete="off" placeholder="sk-..." /></label>' +
        '</div>' +
        '<div class="m-wiz-step" data-step="3">' +
          '<h3>选模型</h3>' +
          '<p>可以先拉取列表，也可以直接输入模型名。</p>' +
          '<div class="m-wiz-model"><input class="w-model" spellcheck="false" placeholder="例如 deepseek-chat" /><button type="button" class="w-fetch">获取列表</button></div>' +
          '<select class="w-models" style="display:none"></select>' +
          '<div class="m-wiz-msg"></div>' +
        '</div>' +
      '</div>' +
      '<div class="m-wiz-ft"><button type="button" class="m-wiz-prev">上一步</button><button type="button" class="m-wiz-next">下一步</button></div>';
    document.body.appendChild(page);
    WIZ = page;
    bindMobileSelects(page);

    var step = 1;
    var preset = page.querySelector(".w-preset");
    var base = page.querySelector(".w-base");
    var key = page.querySelector(".w-key");
    var model = page.querySelector(".w-model");
    var models = page.querySelector(".w-models");
    var msg = page.querySelector(".m-wiz-msg");
    var prev = page.querySelector(".m-wiz-prev");
    var next = page.querySelector(".m-wiz-next");

    // 复用设置里的服务商列表与默认地址
    var src = $("fPreset");
    if (src) {
      Array.prototype.forEach.call(src.options, function (o) {
        var op = document.createElement("option");
        op.value = o.value; op.textContent = o.textContent;
        preset.appendChild(op);
      });
    }
    preset.onchange = function () {
      if (!src) return;
      src.value = preset.value;
      src.dispatchEvent(new Event("change"));
      var fb = $("fBase");
      if (fb) base.value = fb.value || "";
      model.value = ""; models.style.display = "none";
    };
    if (src) {
      preset.value = src.value || "0";
      var fb0 = $("fBase");
      if (fb0) base.value = fb0.value || "";
      var fm0 = $("fModel");
      if (fm0) model.value = fm0.value || "";
      var fk0 = $("fKey");
      if (fk0) key.value = fk0.value || "";
      // 首次安装：默认落到第一个真实服务商，省得用户先面对一个空下拉
      if (!base.value && preset.options.length > 1) {
        preset.value = "1";
        src.value = "1";
        src.dispatchEvent(new Event("change"));
        if (fb0) base.value = fb0.value || "";
      }
    }

    function renderStep() {
      Array.prototype.forEach.call(page.querySelectorAll(".m-wiz-step"), function (s) {
        s.classList.toggle("show", Number(s.dataset.step) === step);
      });
      Array.prototype.forEach.call(page.querySelectorAll(".m-wiz-dots i"), function (d, i) {
        d.classList.toggle("on", i < step);
      });
      prev.style.display = step === 1 ? "none" : "";
      next.textContent = step === 3 ? "完成" : "下一步";
      msg.textContent = "";
    }

    function close(mark) {
      if (mark) { try { localStorage.setItem("hj_wizard_done", "1"); } catch (e) {} }
      if (WIZ && WIZ.parentNode) WIZ.parentNode.removeChild(WIZ);
      WIZ = null;
      if (layer) HJLayers.remove(layer);
    }
    var layer = HJLayers.push({ id: "wizard", close: function () { close(false); } });

    page.querySelector(".m-wiz-skip").onclick = function () { close(true); };
    prev.onclick = function () { if (step > 1) { step--; renderStep(); } };
    next.onclick = function () {
      if (step < 3) { step++; renderStep(); return; }
      var b = base.value.trim(), k = key.value.trim(), m = model.value.trim();
      if (!b) { msg.textContent = "还缺接口地址"; return; }
      if (!k) { msg.textContent = "还缺 API Key"; return; }
      if (!m) { msg.textContent = "还缺模型名"; return; }
      var fb = $("fBase"), fk = $("fKey"), fm = $("fModel"), fp = $("fPreset");
      if (fp) fp.value = preset.value;
      if (fb) fb.value = b;
      if (fk) fk.value = k;
      if (fm) fm.value = m;
      var c = (window.HJ && HJ._cfgSaveQuiet) ? HJ._cfgSaveQuiet() : null;
      if (!c) { msg.textContent = "保存失败：请检查三个字段"; return; }
      close(true);
      if (window.HJDialog) HJDialog.toast("模型已配置");
    };

    page.querySelector(".w-fetch").onclick = function () {
      var b = base.value.trim(), k = key.value.trim();
      if (!b || !k) { msg.textContent = "先填接口地址和 Key"; return; }
      var btn = this;
      btn.disabled = true; btn.textContent = "获取中…";
      msg.textContent = "";
      fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { baseUrl: b, apiKey: k, model: "" } })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok && j.models && j.models.length) {
          models.innerHTML = "";
          j.models.forEach(function (n) {
            var o = document.createElement("option"); o.value = n; o.textContent = n;
            models.appendChild(o);
          });
          models.style.display = "block";
          model.value = j.models[0];
          msg.className = "m-wiz-msg ok";
          msg.textContent = "拿到 " + j.models.length + " 个模型";
        } else {
          msg.className = "m-wiz-msg bad";
          msg.textContent = (j && (j.error || j.hint)) || "接口没有返回模型列表，可手动填写";
        }
      }).catch(function () {
        msg.className = "m-wiz-msg bad";
        msg.textContent = "网络错误，连不上模型接口";
      }).then(function () {
        btn.disabled = false; btn.textContent = "获取列表";
      });
    };
    models.onchange = function () { model.value = models.value; };

    renderStep();
    setTimeout(function () { try { preset.focus(); } catch (e) {} }, 60);
  }

  function maybeWizard() {
    var done = false;
    try { done = localStorage.getItem("hj_wizard_done") === "1"; } catch (e) {}
    if (done) return;
    fetch("/api/status").then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.configured) return;
      setTimeout(wizard, 500);
    }).catch(function () {});
  }

  /* =========================================================
     五、启停与对外接口
     ========================================================= */
  window.HJPages = {
    back: function () {
      if (!SET.built || !$("cfgModal") || !$("cfgModal").classList.contains("show")) return false;
      if (SET.sub && SET.showSub) { SET.showSub(""); return true; }
      return false;
    },
    wizard: wizard,
    settings: function () {
      var b = $("btnCfg");
      if (b) b.click();
    }
  };

  function apply() {
    if (!onMobile()) return;
    buildSettings();
    buildHistory();
    buildAbout();
    buildLog();
    buildCrop();
    maybeWizard();
  }
  if (MQ.addEventListener) MQ.addEventListener("change", apply);
  else if (MQ.addListener) MQ.addListener(apply);

  function ready() {
    // solver.js 的 HJ / DOM 就位后再改造
    var n = 0;
    (function tick() {
      if (window.HJ && window.HJ._cfgSaveQuiet) return apply();
      if (++n > 60) return apply();
      setTimeout(tick, 100);
    })();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
