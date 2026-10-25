/* =========================================================
   何解 · 手机端交互补丁（mobile-ui.js）
   ---------------------------------------------------------
   职责只有三件事，全部只在 max-width:760px 下生效：
     1. 把顶栏塞不下的控件（年级/图形/画法 + 历史/导出/设置/主题 + 解题）
        搬进「⋯」底部面板；回到桌面宽度时原样搬回去（位置、事件都不丢）；
     2. 造三个手机专用结构：⋯ 面板、抽屉遮罩、画布/解答之间的拖拽条；
     3. 布局变化后触发一次 resize + 2D/3D 重新适配，避免图形糊/错位。

   不改任何现有 id / class；不删元素；只在需要时创建自己的节点。
   ========================================================= */
(function () {
  "use strict";

  if (window.HJMobile) return;

  var MQ = window.matchMedia("(max-width: 760px)");
  var HTML = document.documentElement;

  var built = false;
  var moved = [];          // 被搬走的元素：[{el, parent, next}]
  var refs = {};           // 自建节点
  var rafId = 0;

  // ui.js 一上来就会按当前宽度把分栏夹窄（412px 下夹成 150/150），这个夹紧值会留在内存里。
  // 回到桌面宽度时以「用户上次保存的布局」为准，没存过就用 ui.css 的默认 236/404。
  var DEFAULT_LAYOUT = { left: 236, right: 404, leftCollapsed: false, rightCollapsed: false };
  function persistedLayout() {
    try {
      var o = JSON.parse(localStorage.getItem("solver_layout_v1") || "null");
      if (o && typeof o.left === "number" && typeof o.right === "number") return o;
    } catch (e) {}
    return null;
  }

  var OPT_IDS = ["gradeWrap", "dimWrap", "viewWrap"];
  var ACT_IDS = ["btnHist", "btnHtml", "btnCfg", "btnTheme"];

  function $(id) { return document.getElementById(id); }

  function mk(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---------------- 自建结构 ---------------- */
  function build() {
    if (built) return;
    built = true;

    refs.scrim = mk("div");
    refs.scrim.id = "mScrim";
    document.body.appendChild(refs.scrim);

    refs.sheet = mk("div");
    refs.sheet.id = "mSheet";
    refs.sheet.setAttribute("role", "dialog");
    refs.sheet.setAttribute("aria-label", "更多");
    refs.sheet.innerHTML =
      '<div class="m-handle"></div>' +
      '<div class="m-sec-t">解题选项</div>' +
      '<div class="m-opts"></div>' +
      '<div class="m-sec-t">更多</div>' +
      '<div class="m-acts"></div>' +
      '<button class="m-done" type="button">完成</button>';
    document.body.appendChild(refs.sheet);
    refs.opts = refs.sheet.querySelector(".m-opts");
    refs.acts = refs.sheet.querySelector(".m-acts");
    refs.done = refs.sheet.querySelector(".m-done");

    // ⋯ 按钮
    refs.menu = mk("button", null,
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>' +
      '<circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>');
    refs.menu.id = "mMenuBtn";
    refs.menu.type = "button";
    refs.menu.title = "更多";
    refs.menu.setAttribute("aria-label", "更多");

    // 对象面板入口（画布左上，和工具栏同一行）
    refs.objBtn = mk("button", null,
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
      '<path d="M9 3v18M9 9h12"/></svg><span>对象</span>');
    refs.objBtn.id = "mObjBtn";
    refs.objBtn.type = "button";
    refs.objBtn.title = "几何对象";

    // 画布 / 解答之间的拖拽条
    refs.grip = mk("div");
    refs.grip.id = "mGrip";
    refs.grip.setAttribute("role", "separator");
    refs.grip.title = "拖动调整画布高度";

    // 抽屉关闭键
    refs.drawerX = mk("button", "m-drawer-x",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M18 6 6 18M6 6l12 12"/></svg>');
    refs.drawerX.type = "button";
    refs.drawerX.title = "关闭对象面板";

    // 画布工具栏：下载收进“工具”，整条可横向收起
    refs.toolToggle = mk("button", "m-tool-toggle", ">");
    refs.toolToggle.type = "button";
    refs.toolToggle.id = "mToolToggle";
    refs.toolToggle.title = "收起工具栏";
    refs.toolsBtn = mk("button", "m-tool-btn",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>' +
      '<circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>');
    refs.toolsBtn.type = "button";
    refs.toolsBtn.id = "mToolsBtn";
    refs.toolsBtn.title = "工具";
    refs.toolPop = mk("div", "m-tool-pop");
    refs.toolPop.id = "mToolPop";
    refs.toolPop.innerHTML = '<button type="button" data-act="png">导出 PNG</button>';

    // 答案卡底部动作条：改答案 / 追问 / 微调（P1）
    refs.ansBar = mk("div", "m-ans-actions");
    refs.ansBar.id = "mAnsActions";
    refs.refineBtn = mk("button", "chat-jump m-refine-btn", "微调");
    refs.refineBtn.type = "button";
    refs.refineBtn.id = "mRefineBtn";
    refs.refineBtn.title = "打开微调区";

    // 分步讲解条：播放/展开/全部收进“更多”菜单（P1）
    refs.stepMenu = mk("div", "m-step-menu");
    refs.stepMenu.id = "mStepMenu";
    refs.stepMore = mk("button", "m-step-more", "⋯");
    refs.stepMore.type = "button";
    refs.stepMore.id = "mStepMore";
    refs.stepMore.title = "更多步骤操作";
    refs.stepMore.setAttribute("aria-label", "更多步骤操作");

    // 测量：默认收成一枚小胶囊
    refs.measureChip = mk("button", "m-measure-chip");
    refs.measureChip.type = "button";
    refs.measureChip.id = "mMeasureChip";
    refs.measureChip.innerHTML = '<span class="n">测量</span><span class="chev">▾</span>';
    if (window.MutationObserver) {
      var mb = $("measure");
      if (mb) {
        refs.measureMo = new MutationObserver(syncMeasure);
        refs.measureMo.observe(mb, { childList: true, subtree: true });
      }
    }
    syncMeasure();

    // 小题选择器：把整行小题标签收成一个“全部/第(1)问”下拉
    refs.subPick = mk("button", "m-sub-pick");
    refs.subPick.type = "button";
    refs.subPick.id = "mSubPick";
    refs.subPick.innerHTML = '<span class="n">全部</span><span class="chev">▾</span>';
    refs.subPop = mk("div", "m-sub-pop");
    refs.subPop.id = "mSubPop";
    if (window.MutationObserver) {
      var st = $("subTabs");
      if (st) {
        // 弹簧胶囊（.tab-ind）滑行时每帧改 inline style，会以 60fps 触发本观察器；
        // 它不影响「当前选到哪一问」的文案，直接跳过这类变更
        refs.subMo = new MutationObserver(function (ms) {
          for (var i = 0; i < ms.length; i++) {
            var t = ms[i].target;
            if (t && t.classList && t.classList.contains("tab-ind")) continue;
            syncSubPick();
            return;
          }
        });
        refs.subMo.observe(st, { childList: true, subtree: true, attributes: true, characterData: true });
      }
    }
    syncSubPick();

    wire();
  }

  function syncSubPick() {
    var st = $("subTabs"), pick = refs.subPick;
    if (!st || !pick) return;
    var btns = st.querySelectorAll("button");
    var shown = btns.length > 0 && st.style.display !== "none";
    pick.style.display = shown ? "inline-flex" : "none";
    var on = null;
    for (var i = 0; i < btns.length; i++) if (btns[i].classList.contains("on")) { on = btns[i]; break; }
    var n = pick.querySelector(".n");
    if (n) n.textContent = on ? on.textContent.trim() : (btns[0] ? btns[0].textContent.trim() : "全部");
    if (!shown) closeSubPop();
  }

  function syncMeasure() {
    var box = $("measure"), chip = refs.measureChip;
    if (!box || !chip) return;
    var n = box.querySelectorAll(".m").length;
    chip.style.display = n ? "inline-flex" : "none";
    var nEl = chip.querySelector(".n");
    if (nEl) nEl.textContent = "测量 " + n + " 项";
    if (!n) box.classList.remove("m-open");
    chip.classList.toggle("on", box.classList.contains("m-open"));
  }

  function mount() {
    var topbar = document.querySelector(".topbar");
    var stageTop = $("stageTop");
    var main = $("main");
    var right = $("rightPanel");
    var left = $("leftPanel");
    var ph = left && left.querySelector(".ph");

    if (topbar && refs.menu.parentNode !== topbar) topbar.appendChild(refs.menu);
    if (stageTop && refs.objBtn.parentNode !== stageTop) stageTop.insertBefore(refs.objBtn, stageTop.firstChild);
    if (main && refs.grip.parentNode !== main) main.insertBefore(refs.grip, right || null);
    if (ph && refs.drawerX.parentNode !== ph) ph.appendChild(refs.drawerX);

    var toolbar = $("toolbar");
    if (toolbar) {
      if (refs.toolsBtn.parentNode !== toolbar) toolbar.appendChild(refs.toolsBtn);
      // P1：收起键并进工具栏本体，不再单独一颗浮在右边
      if (refs.toolToggle.parentNode !== toolbar) toolbar.appendChild(refs.toolToggle);
    }
    if (stageTop && refs.toolPop.parentNode !== stageTop) stageTop.appendChild(refs.toolPop);
    var stage = $("stage");
    if (stage && refs.measureChip.parentNode !== stage) stage.appendChild(refs.measureChip);

    ensureStepbarMobile();

    var st = $("subTabs");
    if (st && refs.subPop && st.parentNode !== refs.subPop) refs.subPop.appendChild(st);
    if (stageTop && refs.subPop.parentNode !== stageTop) stageTop.appendChild(refs.subPop);
    if (stageTop && refs.subPick.parentNode !== stageTop) stageTop.insertBefore(refs.subPick, stageTop.firstChild);
  }

  function unmount() {
    var st = $("subTabs"), stWrap = $("subTabsWrap");
    if (st && stWrap && st.parentNode !== stWrap) stWrap.appendChild(st);
    [refs.menu, refs.objBtn, refs.grip, refs.drawerX, refs.toolToggle, refs.toolsBtn, refs.toolPop, refs.measureChip, refs.subPick, refs.subPop].forEach(function (n) {
      if (n && n.parentNode) n.parentNode.removeChild(n);
    });
    var tb = $("toolbar"); if (tb) tb.classList.remove("m-collapsed");
    var mb = $("measure"); if (mb) mb.classList.remove("m-open");
    if (refs.toolPop) refs.toolPop.classList.remove("show");
    if (refs.toolsBtn) refs.toolsBtn.classList.remove("on");
    restoreStepbarMobile();
    if (refs.stepMenu && refs.stepMenu.parentNode) refs.stepMenu.parentNode.removeChild(refs.stepMenu);
    if (refs.stepMore && refs.stepMore.parentNode) refs.stepMore.parentNode.removeChild(refs.stepMore);
    if (refs.ansBar && refs.ansBar.parentNode) refs.ansBar.parentNode.removeChild(refs.ansBar);
  }

  /* 分步讲解条（P1）：上一步/下一步保留在条上，播放/展开/全部收进菜单 */
  function ensureStepbarMobile() {
    var bar = $("stepbar");
    if (!bar) return;
    if (bar.getAttribute("data-m-step") === "1") {
      if (refs.stepMenu.parentNode !== bar) bar.appendChild(refs.stepMenu);
      if (refs.stepMore.parentNode !== bar) bar.appendChild(refs.stepMore);
      return;
    }
    var prev = bar.querySelector('[data-act="prev"]');
    var next = bar.querySelector('[data-act="next"]');
    if (prev) prev.textContent = "上一步";
    if (next) next.textContent = "下一步";
    ["play", "exp", "all"].forEach(function (a) {
      var b = bar.querySelector('[data-act="' + a + '"]');
      if (!b) return;
      b.classList.add("m-step-menu-item");
      if (a === "exp") b.textContent = "展开说明";
      if (a === "all") b.textContent = "全部步骤";
      refs.stepMenu.appendChild(b);
    });
    bar.appendChild(refs.stepMenu);
    bar.appendChild(refs.stepMore);
    bar.setAttribute("data-m-step", "1");
  }
  function restoreStepbarMobile() {
    var bar = $("stepbar");
    if (!bar || bar.getAttribute("data-m-step") !== "1") return;
    ["play", "exp", "all"].forEach(function (a) {
      var b = refs.stepMenu.querySelector('[data-act="' + a + '"]');
      if (b) bar.appendChild(b);
    });
    var prev = bar.querySelector('[data-act="prev"]');
    var next = bar.querySelector('[data-act="next"]');
    if (prev) prev.textContent = "◀";
    if (next) next.textContent = "▶";
    var exp = bar.querySelector('[data-act="exp"]');
    var all = bar.querySelector('[data-act="all"]');
    if (exp) exp.textContent = "▾";
    if (all) all.textContent = "⤢";
    bar.removeAttribute("data-m-step");
  }
  function closeStepMenu() {
    if (!refs.stepMenu || !refs.stepMore) return;
    refs.stepMenu.classList.remove("show");
    refs.stepMore.classList.remove("on");
  }

  /* 答案卡（P1）：定位按钮搬到答案下方，改答案/追问到底部动作条 */
  function moveAnswerActions() {
    var card = $("ansCard"), ans = $("answer"), loc = $("subLocate");
    var edit = $("ansEditBtn"), chat = $("chatJump");
    if (!card || !ans) return;
    if (loc && loc.parentNode !== card) {
      moved.push({ el: loc, parent: loc.parentNode, next: loc.nextSibling });
      card.insertBefore(loc, ans);
    }
    if (edit && chat) {
      if (edit.parentNode !== refs.ansBar) {
        moved.push({ el: edit, parent: edit.parentNode, next: edit.nextSibling });
        refs.ansBar.appendChild(edit);
      }
      if (chat.parentNode !== refs.ansBar) {
        moved.push({ el: chat, parent: chat.parentNode, next: chat.nextSibling });
        refs.ansBar.appendChild(chat);
      }
      if (refs.refineBtn.parentNode !== refs.ansBar) refs.ansBar.appendChild(refs.refineBtn);
      if (refs.ansBar.parentNode !== card) card.appendChild(refs.ansBar);
    }
  }

  /* ---------------- 微调卡片（方案 A） ---------------- */
  function moveInto(el, parent) {
    if (!el || !parent || el.parentNode === parent) return;
    moved.push({ el: el, parent: el.parentNode, next: el.nextSibling });
    parent.appendChild(el);
  }

  function buildRefineA() {
    var refine = $("refine"), body = $("refineBody");
    if (!refine || !body) return;
    if ($("mRefineA")) { syncRefineA(); return; }

    var panel = $("rightPanel");
    var anchor = panel && panel.querySelector(".anbody");
    var chat = $("chatCard");
    if (anchor && refine.parentNode !== anchor) {
      moved.push({ el: refine, parent: refine.parentNode, next: refine.nextSibling });
      if (chat && chat.parentNode === anchor) anchor.insertBefore(refine, chat.nextSibling);
      else anchor.appendChild(refine);
    }
    refine.classList.add("m-refine-card", "m-refine-hidden");
    refine.classList.remove("collapsed");

    var oldRow = $("refineRow"), oldOpts = $("refineOpts");
    if (oldRow) oldRow.classList.add("m-refine-old");
    if (oldOpts) oldOpts.classList.add("m-refine-old");

    var a = mk("div", "m-refine-a");
    a.id = "mRefineA";

    var inputWrap = mk("div", "m-refine-input");
    moveInto($("rin"), inputWrap);
    moveInto($("rinCount"), inputWrap);

    var target = mk("div", "m-refine-target");
    target.innerHTML = '<span class="k">改什么</span><div class="m-refine-seg"></div>';
    var seg = target.querySelector(".m-refine-seg");
    [["auto", "智能判断"], ["figure", "只改图形"], ["text", "只改解析"]].forEach(function (p) {
      var b = mk("button", "m-refine-seg-btn", p[1]);
      b.type = "button";
      b.dataset.v = p[0];
      b.addEventListener("click", function () {
        var sel = $("rtarget");
        if (!sel) return;
        sel.value = p[0];
        try { sel.dispatchEvent(new Event("change")); } catch (e) { if (sel.onchange) sel.onchange(); }
        syncRefineA();
      });
      seg.appendChild(b);
    });

    var actions = mk("div", "m-refine-actions");
    var scope = mk("button", "m-refine-pill");
    scope.type = "button";
    scope.id = "mRefineScopePill";
    scope.innerHTML = '范围 <b>全部小题</b><span class="chev">▾</span>';
    scope.addEventListener("click", function () { openRefineSheet("scope"); });
    var dim = mk("button", "m-refine-pill");
    dim.type = "button";
    dim.id = "mRefineDimPill";
    dim.innerHTML = '图形 <b>不改类型</b><span class="chev">▾</span>';
    dim.addEventListener("click", function () { openRefineSheet("dim"); });
    actions.appendChild(scope);
    actions.appendChild(dim);
    moveInto($("btnRefine"), actions);

    var hint = $("refineHint"), chips = $("chips"), ver = $("verCard");
    a.appendChild(inputWrap);
    a.appendChild(target);
    a.appendChild(actions);
    if (hint) moveInto(hint, a);
    if (chips) moveInto(chips, a);
    if (ver) moveInto(ver, a);
    body.insertBefore(a, body.firstChild);

    buildRefineSheet();
    refs.refineA = a;
    refs.refineScope = scope;
    refs.refineDim = dim;

    if (window.MutationObserver && $("rscopeBtn")) {
      if (refs.scopeMo) refs.scopeMo.disconnect();
      refs.scopeMo = new MutationObserver(function () { syncScopePill(); });
      refs.scopeMo.observe($("rscopeBtn"), { childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    }
    ["rtarget", "rdim", "rscope"].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener("change", syncRefineA);
    });
    syncRefineA();

    if (!refs.refineNewBound) {
      refs.refineNewBound = true;
      document.addEventListener("hj-new-result", function () {
        if (!MQ.matches) return;
        closeRefineSheet();
        var r = $("refine");
        if (r) r.classList.add("m-refine-hidden", "collapsed");
      });
    }
  }

  function syncRefineA() {
    var rt = $("rtarget"), seg = document.querySelector("#mRefineA .m-refine-seg");
    if (rt && seg) {
      Array.prototype.forEach.call(seg.children, function (b) {
        b.classList.toggle("on", b.dataset.v === (rt.value || "auto"));
      });
    }
    var rd = $("rdim"), dim = $("mRefineDimPill");
    if (rd && dim) {
      var opt = rd.options[rd.selectedIndex];
      dim.querySelector("b").textContent = opt ? opt.textContent : "不改类型";
    }
    syncScopePill();
  }

  function syncScopePill() {
    var pill = $("mRefineScopePill");
    if (!pill) return;
    var wrap = $("rscopeWrap"), sel = $("rscope");
    var showWrap = wrap && wrap.style.display !== "none";
    var showSel = sel && sel.style.display !== "none" && sel.options.length > 0;
    if (!showWrap && !showSel) { pill.style.display = "none"; return; }
    pill.style.display = "";
    var label = "全部小题";
    if (showWrap) {
      var b = $("rscopeBtn");
      label = b ? b.textContent.trim() : "全部小题";
    } else {
      var o = sel.options[sel.selectedIndex];
      label = o ? o.textContent.trim() : "全部";
    }
    pill.querySelector("b").textContent = label;
  }

  function buildRefineSheet() {
    if (refs.refineSheet) return;
    var sheet = mk("div", "m-refine-sheet");
    sheet.id = "mRefineSheet";
    sheet.innerHTML =
      '<div class="m-refine-sheet-scrim"></div>' +
      '<div class="m-refine-sheet-panel">' +
        '<div class="m-refine-sheet-grab"></div>' +
        '<h3></h3><div class="m-refine-sheet-sub"></div>' +
        '<div class="m-refine-sheet-body"></div>' +
        '<button type="button" class="m-refine-sheet-cancel">取消</button>' +
      '</div>';
    document.body.appendChild(sheet);
    refs.refineSheet = sheet;
    refs.refineSheetBody = sheet.querySelector(".m-refine-sheet-body");
    refs.refineSheetTitle = sheet.querySelector("h3");
    refs.refineSheetSub = sheet.querySelector(".m-refine-sheet-sub");
    refs.refineSheetCancel = sheet.querySelector(".m-refine-sheet-cancel");
    sheet.querySelector(".m-refine-sheet-scrim").addEventListener("click", closeRefineSheet);
    sheet.querySelector(".m-refine-sheet-panel").addEventListener("click", function (e) { e.stopPropagation(); });
    refs.refineSheetCancel.addEventListener("click", closeRefineSheet);
  }

  function openRefineSheet(kind) {
    if (!refs.refineSheet) buildRefineSheet();
    closeRefineSheet();
    var body = refs.refineSheetBody;
    body.innerHTML = "";
    var title = "", sub = "", cancel = "取消";

    if (kind === "scope") {
      var wrap = $("rscopeWrap"), pop = $("rscopePop"), sel = $("rscope");
      if (wrap && wrap.style.display !== "none" && pop) {
        refs.scopePop = pop;
        refs.scopeWrap = wrap;
        pop.classList.add("m-in-sheet");
        body.appendChild(pop);
        title = "微调范围";
        sub = "默认整题；也可以只改某几个小问。";
        cancel = "完成";
      } else if (sel && sel.style.display !== "none" && sel.options.length) {
        title = "微调范围";
        sub = "选择这次要改的部分。";
        cancel = "完成";
        Array.prototype.forEach.call(sel.options, function (o) {
          var b = mk("button", "m-refine-opt" + (sel.value === o.value ? " on" : ""));
          b.type = "button";
          b.innerHTML = '<span class="tx">' + o.textContent + '</span><span class="sp"></span><span class="check">' + (sel.value === o.value ? "✓" : "") + '</span>';
          b.addEventListener("click", function () {
            sel.value = o.value;
            try { sel.dispatchEvent(new Event("change")); } catch (e) { if (sel.onchange) sel.onchange(); }
            syncRefineA();
            closeRefineSheet();
          });
          body.appendChild(b);
        });
      } else {
        return;
      }
    } else if (kind === "dim") {
      var rd = $("rdim");
      if (!rd) return;
      title = "微调后的图形类型";
      sub = "默认保持当前类型，不改画法。";
      Array.prototype.forEach.call(rd.options, function (o) {
        var b = mk("button", "m-refine-opt" + (rd.value === o.value ? " on" : ""));
        b.type = "button";
        b.innerHTML = '<span class="tx">' + o.textContent + '</span><span class="sp"></span><span class="check">' + (rd.value === o.value ? "✓" : "") + '</span>';
        b.addEventListener("click", function () {
          rd.value = o.value;
          try { rd.dispatchEvent(new Event("change")); } catch (e) { if (rd.onchange) rd.onchange(); }
          syncRefineA();
          closeRefineSheet();
        });
        body.appendChild(b);
      });
    } else {
      return;
    }

    refs.refineSheetTitle.textContent = title;
    refs.refineSheetSub.textContent = sub;
    refs.refineSheetCancel.textContent = cancel;
    refs.refineSheet.classList.add("show");
  }

  function closeRefineSheet() {
    var sheet = refs.refineSheet;
    if (!sheet) return;
    sheet.classList.remove("show");
    if (refs.scopePop && refs.scopePop.parentNode === refs.refineSheetBody) {
      refs.scopePop.classList.remove("m-in-sheet");
      if (refs.scopeWrap) refs.scopeWrap.appendChild(refs.scopePop);
    }
    refs.scopePop = null;
    refs.scopeWrap = null;
    if (refs.refineSheetBody) refs.refineSheetBody.innerHTML = "";
  }

  function openRefineCard() {
    var refine = $("refine");
    if (!refine) return;
    try { if (window.HJSheetDebug) window.HJSheetDebug.set(0); } catch (e) {}
    refine.classList.remove("m-refine-hidden", "collapsed");
    syncRefineA();
    var rin = $("rin");
    // 不再 smooth scroll + 多段定时器：键盘弹出时由 mobile-sheet 的去抖逻辑统一校正一次。
    setTimeout(function () {
      if (!rin) return;
      try { rin.focus({ preventScroll: true }); }
      catch (e) { try { rin.focus(); } catch (e2) {} }
    }, 80);
  }

  function cleanupRefineA() {
    closeRefineSheet();
    if (refs.refineSheet && refs.refineSheet.parentNode) refs.refineSheet.parentNode.removeChild(refs.refineSheet);
    refs.refineSheet = null; refs.refineSheetBody = null; refs.refineSheetTitle = null; refs.refineSheetSub = null; refs.refineSheetCancel = null;
    if (refs.scopeMo) { refs.scopeMo.disconnect(); refs.scopeMo = null; }
    if (refs.refineA && refs.refineA.parentNode) refs.refineA.parentNode.removeChild(refs.refineA);
    refs.refineA = null; refs.refineScope = null; refs.refineDim = null;
    var r = $("refine");
    if (r) r.classList.remove("m-refine-card", "m-refine-hidden");
    var row = $("refineRow"), opts = $("refineOpts");
    if (row) row.classList.remove("m-refine-old");
    if (opts) opts.classList.remove("m-refine-old");
  }

  /* ---------------- 事件 ---------------- */
  function wire() {
    refs.menu.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (refs.sheet.classList.contains("show")) closeAll(); else openSheet();
    });

    refs.scrim.addEventListener("click", closeAll);
    refs.done.addEventListener("click", closeAll);
    refs.objBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openDrawer();
    });
    refs.drawerX.addEventListener("click", closeAll);

    refs.toolToggle.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var tb = $("toolbar");
      if (!tb) return;
      var col = tb.classList.toggle("m-collapsed");
      refs.toolToggle.textContent = col ? "<" : ">";
      refs.toolToggle.title = col ? "展开工具栏" : "收起工具栏";
      closeToolPop();
    });
    refs.toolsBtn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var open = refs.toolPop.classList.contains("show");
      if (open) closeToolPop();
      else { refs.toolPop.classList.add("show"); refs.toolsBtn.classList.add("on"); }
    });
    refs.toolPop.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button[data-act]");
      if (!b) return;
      if (b.dataset.act === "png") {
        var png = document.querySelector('#toolbar [data-act="png"]');
        if (png) png.click();
      }
      closeToolPop();
    });
    refs.stepMore.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var open = refs.stepMenu.classList.contains("show");
      if (open) closeStepMenu();
      else { refs.stepMenu.classList.add("show"); refs.stepMore.classList.add("on"); }
    });
    refs.stepMenu.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (b) setTimeout(closeStepMenu, 0);
    });
    var stepbar = $("stepbar");
    if (stepbar && !stepbar.__mStepBound) {
      stepbar.__mStepBound = true;
      stepbar.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("[data-act=prev],[data-act=next]")) closeStepMenu();
      });
    }
    document.addEventListener("hj-new-result", function () {
      closeStepMenu();
      closeToolPop();
      closeSubPop();
    });
    refs.subPick.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (refs.subPop.classList.contains("show")) closeSubPop();
      else { refs.subPop.classList.add("show"); refs.subPick.classList.add("on"); }
    });
    refs.subPop.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (!b) return;
      setTimeout(function () { syncSubPick(); closeSubPop(); }, 30);
    });
    refs.measureChip.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var box = $("measure");
      if (!box) return;
      box.classList.toggle("m-open");
      refs.measureChip.classList.toggle("on", box.classList.contains("m-open"));
    });
    document.addEventListener("click", function (e) {
      if (refs.toolPop.classList.contains("show") &&
          !refs.toolPop.contains(e.target) && !refs.toolsBtn.contains(e.target)) {
        closeToolPop();
      }
      if (refs.subPop.classList.contains("show") &&
          !refs.subPop.contains(e.target) && !refs.subPick.contains(e.target)) {
        closeSubPop();
      }
      if (refs.stepMenu.classList.contains("show") &&
          !refs.stepMenu.contains(e.target) && !refs.stepMore.contains(e.target)) {
        closeStepMenu();
      }
      var box = $("measure");
      if (box && box.classList.contains("m-open") &&
          !box.contains(e.target) && !refs.measureChip.contains(e.target)) {
        box.classList.remove("m-open");
        refs.measureChip.classList.remove("on");
      }
    });

    // 面板里的动作按钮：点完顺手收起面板（主题开关除外，用户可能想看着它切）
    refs.acts.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (!b) return;
      if (b.id === "btnTheme") { setTimeout(themeLabel, 0); return; }
      setTimeout(closeAll, 0);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeAll();
    });

    refs.refineBtn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      openRefineCard();
    });

    bindGrip();
  }

  function closeToolPop() {
    if (refs.toolPop) refs.toolPop.classList.remove("show");
    if (refs.toolsBtn) refs.toolsBtn.classList.remove("on");
  }
  function closeSubPop() {
    if (refs.subPop) refs.subPop.classList.remove("show");
    if (refs.subPick) refs.subPick.classList.remove("on");
  }

  function bindGrip() {
    var grip = refs.grip;
    grip.addEventListener("pointerdown", function (e) {
      var main = $("main"), stage = $("stage");
      if (!main || !stage) return;
      e.preventDefault();
      var startY = e.clientY;
      var startH = stage.getBoundingClientRect().height;
      var maxH = Math.max(220, main.getBoundingClientRect().height - 170);
      try { grip.setPointerCapture(e.pointerId); } catch (x) {}

      function move(ev) {
        var h = Math.max(200, Math.min(maxH, startH + (ev.clientY - startY)));
        main.style.setProperty("--m-stage-h", Math.round(h) + "px");
      }
      function up() {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        refresh(true);
      }
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
  }

  /* ---------------- 面板 / 抽屉开关 ---------------- */
  // 主题按钮本身只有图标，面板里给它补一行文字（跟着当前主题换说法）
  function themeLabel() {
    var tb = $("btnTheme");
    if (!tb) return;
    tb.setAttribute("data-m-label",
      document.documentElement.getAttribute("data-theme") === "dark" ? "日间模式" : "夜间模式");
  }

  function openSheet() {
    if (!built) return;
    themeLabel();
    closeDrawer();
    refs.scrim.classList.add("show");
    refs.sheet.classList.add("show");
  }
  function closeSheet() {
    if (!built) return;
    refs.sheet.classList.remove("show");
    refs.scrim.classList.remove("show");
  }
  function openDrawer() {
    if (!built) return;
    // P3：对象面板不再是左侧抽屉，改为解答浮层里的子页；再点一次同一按钮收起
    if (window.HJMobile && window.HJMobile.isObjectOpen && window.HJMobile.isObjectOpen()) {
      window.HJMobile.closeObjects();
      return;
    }
    if (window.HJMobile && window.HJMobile.openObjects) { window.HJMobile.openObjects(); return; }
    closeSheet();
    var left = $("leftPanel");
    if (left) left.classList.add("m-open");
    refs.scrim.classList.add("show");
  }
  function closeDrawer() {
    if (!built) return;
    if (window.HJMobile && window.HJMobile.isObjectOpen && window.HJMobile.isObjectOpen()) {
      window.HJMobile.closeObjects();
      return;
    }
    var left = $("leftPanel");
    if (left) left.classList.remove("m-open");
    refs.scrim.classList.remove("show");
  }
  function closeAll() { closeSheet(); closeDrawer(); }

  /* ---------------- 搬迁 / 还原 ---------------- */
  function moveIn() {
    if (moved.length) return;   // 已经搬过了（matchMedia 可能连发两次）
    var topbar = document.querySelector(".topbar");
    var go = $("go");

    OPT_IDS.concat(ACT_IDS).forEach(function (id) {
      var e = $(id);
      if (!e) return;
      moved.push({ el: e, parent: e.parentNode, next: e.nextSibling });
      (OPT_IDS.indexOf(id) >= 0 ? refs.opts : refs.acts).appendChild(e);
    });

    if (go && topbar) {
      moved.push({ el: go, parent: go.parentNode, next: go.nextSibling });
      topbar.insertBefore(go, refs.menu);
    }
  }

  function moveOut() {
    for (var i = moved.length - 1; i >= 0; i--) {
      var m = moved[i];
      if (!m.parent) continue;
      try {
        if (m.parent.isConnected) {
          if (m.next && m.next.parentNode === m.parent) m.parent.insertBefore(m.el, m.next);
          else m.parent.appendChild(m.el);
        } else {
          var app = $("app");
          if (app) app.appendChild(m.el);
        }
      } catch (e) {
        // 节点被另一层搬过，记录的 next 可能已不在原 parent 下；保底放回 #app
        try { var a2 = $("app"); if (a2 && m.el.parentNode !== a2) a2.appendChild(m.el); } catch (e2) {}
      }
    }
    moved = [];
  }

  /* ---------------- 尺寸变化后的重排 ---------------- */
  function refresh(fit) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(function () {
      rafId = 0;
      try { window.dispatchEvent(new Event("resize")); } catch (e) {}
      try { if (window.HJ && window.HJ._onResize) window.HJ._onResize(); } catch (e) {}
      if (fit) {
        // 容器尺寸变了，JSXGraph 会跟着改 SVG 尺寸但保留旧视窗，
        // 这一步把视图重新装进新画布（等价于点一下工具栏的「复位视图」）
        setTimeout(function () {
          var w = $("welcome");
          var hasFig = w && w.classList.contains("hidden");
          var b = document.querySelector('#toolbar button[data-act="fit"]');
          if (hasFig && b) b.click();
        }, 120);
      }
    });
  }

  /* ---------------- 进入 / 退出手机布局 ---------------- */
  function apply() {
    if (!MQ.matches) return;
    build();
    mount();
    HTML.classList.add("m-mobile");

    moveIn();
    moveAnswerActions();

    // 微调区默认收起：手机上它占 150px，会把答案挤得只剩一行
    var refine = $("refine");
    if (refine && !refine.classList.contains("collapsed")) {
      refine.classList.add("collapsed");
      refs.refineAdded = true;
    }
    buildRefineA();
    refresh(true);
  }

  function revert() {
    // 先让 sheet 还原它搬过的节点（btnHist 等原本被本文件放进了 mSheet），
    // 再执行本文件的 moveOut；顺序反了会把按钮留进已隐藏的 mSheet。
    try { if (window.HJSheetDebug && HJSheetDebug.off) HJSheetDebug.off(); } catch (e) {}
    try {
      if (window.HJMobile && window.HJMobile.isObjectOpen && window.HJMobile.isObjectOpen()) {
        window.HJMobile.closeObjects();
      }
      var refine = $("refine");
      if (refine && refs.refineAdded) {
        refine.classList.remove("collapsed");
        refs.refineAdded = false;
      }
      moveOut();
      cleanupRefineA();
      closeAll();
      unmount();
    } finally {
      HTML.classList.remove("m-mobile");
      // 自建节点在桌面没有对应样式，收起来免得露馅
      [refs.scrim, refs.sheet, refs.grip, refs.objBtn, refs.menu, refs.drawerX, refs.toolToggle, refs.toolsBtn, refs.toolPop, refs.measureChip, refs.subPick, refs.subPop].forEach(function (n) {
        if (n) n.style.display = "none";
      });
    }

    // 手机宽度下 ui.js 的 fitLayout() 会把分栏宽度夹小，回到桌面时还原
    var src = persistedLayout() || DEFAULT_LAYOUT;
    if (src && window.HJ && window.HJ.layout) {
      var L = window.HJ.layout;
      L.left = src.left;
      L.right = src.right;
      L.leftCollapsed = !!src.leftCollapsed;
      L.rightCollapsed = !!src.rightCollapsed;
      try { if (window.HJ.applyLayout) window.HJ.applyLayout(); } catch (e) {}
    }
    refresh(false);
  }

  function onMq() {
    if (MQ.matches) {
      [refs.scrim, refs.sheet, refs.grip, refs.objBtn, refs.menu, refs.drawerX, refs.toolToggle, refs.toolsBtn, refs.toolPop, refs.measureChip, refs.subPick, refs.subPop].forEach(function (n) {
        if (n) n.style.display = "";
      });
      apply();
    } else {
      revert();
    }
  }

  if (MQ.addEventListener) MQ.addEventListener("change", onMq);
  else if (MQ.addListener) MQ.addListener(onMq);

  /* 首次上布局要等 ui.js 的 init 跑完（window.HJ 就位），否则记不到桌面分栏宽度，
     回到桌面时就被 ui.js 的 fitLayout() 夹成 150/150 了。
     本文件在 solver.js 之后、DOMContentLoaded 之前执行，所以这里要等一等。 */
  function whenReady(fn) {
    if (window.HJ && window.HJ.layout) return fn();
    var n = 0;
    (function tick() {
      if (window.HJ && window.HJ.layout) return fn();
      if (++n > 40) return fn();     // 2 秒还等不到也照常上，别把布局卡住
      setTimeout(tick, 50);
    })();
  }

  // 首次：只有真的在手机宽度才建节点（桌面端一行 DOM 都不动）
  if (MQ.matches) whenReady(apply);

  window.HJMobile = {
    isMobile: function () { return MQ.matches; },
    apply: apply,
    revert: revert,
    refresh: refresh,
    openSheet: openSheet,
    closeSheet: closeSheet,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    closeAll: closeAll
  };
})();
