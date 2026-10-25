/* =========================================================
   何解 · 关于页（桌面端 / 手机端共用）
   ---------------------------------------------------------
   数据来源：GitHub Releases（按 tag 前缀分端）
     - 电脑端发布：tag 形如  v1.1.0
     - 手机端发布：tag 形如  mobile-v0.1.0
   版本号来源：
     - 电脑端：桌面壳 main.js 加载页面时带 ?appv=（读 desktop/package.json）
     - 手机端：mobile/tools/prepare.js 打包时注入 window.HEGY_MOBILE_VERSION
     - 浏览器直接打开（开发）：显示「开发版」
   缓存：localStorage，30 分钟；离线时回退缓存并标注。
   新版本入口：角标「有新版本」→ 点击打开发布页（CFG.site，GitHub Pages），
     在发布页选包下载。不再走应用内下载——安装包托管在 github.com，国内经常连不通，
     桌面壳的 downloadUpdate / installUpdate 接口保留（desktop/main.js），但当前未接。
   ========================================================= */
(function () {
  /* ==================== ★ 需要你填的配置 ★ ==================== */
  var CFG = {
    // GitHub 仓库（owner/repo）。发布 Release 时按上面的 tag 约定打 tag，
    // Release 正文用 Markdown 列表（- 开头），「关于页」会原样渲染成条目。
    repo: "kidnappe/hegy",           // 例："your-name/hegy"
    // 发布页（「有新版本」点下去就开这里）。留空则退回 Releases 页。
    site: "https://kidnappe.github.io/hegy/",
    // 爱发电主页链接。没有就留空字符串，版本行右侧的入口会自动隐藏。
    afdian: "https://afdian.com/a/zhouxuano6",
    // 版权署名与起始年份
    author: "zhouxuan",
    since: 2026,
    // 软件许可说明（仓库根目录 LICENSE = GNU AGPL-3.0 全文）
    licenseNote: "本程序为自由软件，按 GNU AGPL-3.0 授权使用，不提供任何担保；第三方组件许可见下方列表。",
    // 第三方组件（与 solver/vendor/LICENSES.md 保持一致）
    thirdParty: [
      { name: "JSXGraph", ver: "1.12.2", lic: "LGPL-3.0 / MIT（按 MIT 使用）" },
      { name: "KaTeX", ver: "0.19.0", lic: "MIT" },
      { name: "three.js", ver: "r127", lic: "MIT" },
      { name: "Lucide Icons", ver: "1.59.0", lic: "ISC" }
    ]
  };
  /* ============================================================ */

  var CACHE_KEY = "hegy_about_releases_v1";
  var TTL = 30 * 60 * 1000;
  var state = { wired: false, end: null, list: null, listErr: null };
  /* upd.latest：当前端有比本地版本更新的 Release 时填 tag（不含 mobile- 前缀），
     由 renderVer 计算；角标文案 / 启动红点都读它。 */
  var upd = { latest: "" };

  function $(id) { return document.getElementById(id); }
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isMobileUI() { return document.documentElement.classList.contains("m-mobile"); }
  function desk() { return window.HEGY_DESKTOP || null; }

  function currentVersion() {
    try {
      var q = new URLSearchParams(location.search).get("appv");
      if (q) return { v: q, end: "desktop" };
      if (window.HEGY_MOBILE_VERSION) return { v: window.HEGY_MOBILE_VERSION, end: "mobile" };
    } catch (e) {}
    return { v: "", end: isMobileUI() ? "mobile" : "desktop" };
  }
  function repoUrl() { return CFG.repo ? "https://github.com/" + CFG.repo : ""; }
  function issuesUrl() { return CFG.repo ? "https://github.com/" + CFG.repo + "/issues" : ""; }

  /* ---------- 版本比较：数字段逐段比，段数不齐按缺 0 ---------- */
  function isNewer(latest, cur) {
    if (!latest || !cur) return false;
    var a = String(latest).replace(/^v/i, "").split(".");
    var b = String(cur).replace(/^v/i, "").split(".");
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var x = parseInt(a[i] || "0", 10) || 0, y = parseInt(b[i] || "0", 10) || 0;
      if (x !== y) return x > y;
    }
    return false;
  }

  /* ---------- Releases：拉取 / 缓存 / 分端 ---------- */
  function readCache() {
    try {
      var j = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (j && j.t && Array.isArray(j.list)) return j;
    } catch (e) {}
    return null;
  }
  function writeCache(list, etag) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), list: list, etag: etag || "" })); } catch (e) {}
  }
  function splitEnds(list) {
    var desktop = [], mobile = [];
    (list || []).forEach(function (r) {
      if (r.draft) return;
      (String(r.tag_name || "").indexOf("mobile-") === 0 ? mobile : desktop).push(r);
    });
    return { desktop: desktop, mobile: mobile };
  }
  /* 统一返回 Promise<{status, etag, body}>。桌面壳优先走主进程直连（渲染进程 fetch 走系统代理，
     共享出口 IP 常被 GitHub 限流 403；Node 主进程不读系统代理）；主进程网络失败退回渲染进程 fetch。 */
  function ghFetch(url, etag) {
    var browserFetch = function () {
      var h = { "Accept": "application/vnd.github+json" };
      if (etag) h["If-None-Match"] = etag;
      return fetch(url, { headers: h }).then(function (r) {
        return r.text().then(function (b) { return { status: r.status, etag: r.headers.get("etag") || "", body: b }; });
      });
    };
    var d = desk();
    if (d && d.aboutFetch) {
      return d.aboutFetch(url, etag).then(function (res) {
        if (!res || res.error) return browserFetch();
        return res;
      }).catch(browserFetch);
    }
    return browserFetch();
  }
  function fetchReleases(cb, force) {
    if (!CFG.repo) { cb(new Error("no-repo")); return; }
    var cached = readCache();
    if (!force && cached && Date.now() - cached.t < TTL) { cb(null, cached.list, true); return; }
    /* 带缓存 etag 走条件请求：内容没变时 GitHub 回 304，不计入限流额度（未认证 60 次/小时/IP） */
    ghFetch("https://api.github.com/repos/" + CFG.repo + "/releases?per_page=30", (cached && cached.etag) || "")
    .then(function (res) {
      if (!res) throw new Error("bad payload");
      if (res.status === 304 && cached) { writeCache(cached.list, cached.etag); cb(null, cached.list, true); return; }
      if (res.status === 403 || res.status === 429) {
        throw new Error(/rate limit/i.test(res.body || "")
          ? "HTTP " + res.status + " · GitHub 接口限流（共享代理出口 IP 常被打满，未认证 60 次/小时/IP）——稍后再试，或暂时直连"
          : "HTTP " + res.status + " · 代理或网络拦截了 api.github.com，试试更换代理节点或直连");
      }
      if (res.status !== 200) throw new Error("HTTP " + res.status);
      var list = JSON.parse(res.body);
      if (!Array.isArray(list)) throw new Error("bad payload");
      writeCache(list, res.etag);
      cb(null, list, false);
    }).catch(function (e) { cb(e, cached ? cached.list : null, false); });
  }

  /* ---------- Release 正文（Markdown 列表 → 轻量 HTML） ---------- */
  function renderBody(md) {
    var lines = String(md || "").split(/\r?\n/);
    var out = [], ul = false;
    function closeUl() { if (ul) { out.push("</ul>"); ul = false; } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (/^#{1,6}\s/.test(ln)) { closeUl(); continue; }
      var m = ln.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
      if (m) {
        if (!ul) { out.push('<ul class="ab-ul">'); ul = true; }
        out.push("<li>" + esc(m[1]) + "</li>");
      } else if (ln.trim()) {
        closeUl();
        out.push('<p class="ab-p">' + esc(ln.trim()) + "</p>");
      }
    }
    closeUl();
    return out.join("");
  }
  function fmtDate(iso) {
    try { return new Date(iso).toISOString().slice(0, 10); } catch (e) { return ""; }
  }
  function releaseRow(r) {
    return '<div class="ab-rel">' +
      '<div class="ab-rel-h"><span class="ab-ver">' + esc(r.tag_name) + "</span>" +
      (r.prerelease ? '<span class="ab-pre">预发布</span>' : "") +
      '<span class="ab-date">' + esc(fmtDate(r.published_at)) + "</span></div>" +
      (r.name && r.name !== r.tag_name ? '<div class="ab-name">' + esc(r.name) + "</div>" : "") +
      renderBody(r.body) + "</div>";
  }

  /* ---------- 新版本角标：点击去发布页 ---------- */
  /* 桌面端 / 手机端行为一致。安装包挂在 github.com，国内常连不通，所以入口统一指向
     发布页（github.io），下载与镜像都在那边；发布页没配才退回 Releases 页。 */
  function downloadUrl() {
    if (CFG.site) return CFG.site;
    return CFG.repo ? repoUrl() + "/releases" : "";
  }
  function renderNewBadge() {
    var nw = $("aboutNew");
    if (!nw) return;
    var go = !!downloadUrl();
    nw.textContent = upd.latest ? "有新版本 " + upd.latest + (go ? " · 去下载" : "") : "";
    nw.title = go ? "打开发布页下载新版" : "";
    nw.classList.toggle("update", go);
    if (go) { nw.setAttribute("role", "button"); nw.setAttribute("tabindex", "0"); }
    else { nw.removeAttribute("role"); nw.removeAttribute("tabindex"); }
  }
  function onNewBadgeClick() {
    var url = downloadUrl();
    if (url) openExternal(url);
  }

  /* ---------- 各状态渲染 ---------- */
  function box(cls, html) { return '<div class="' + cls + '">' + html + "</div>"; }
  function renderLog() {
    var host = $("aboutReleases");
    if (!host) return;
    if (!CFG.repo) {
      host.innerHTML = box("ab-hint", "还没配置 GitHub 仓库。<br>在 <b>solver/about.js</b> 顶部的 repo 里填 owner/repo，发布 Release 后这里会自动拉取更新记录。");
      return;
    }
    if (state.listErr && !state.list) {
      host.innerHTML = box("ab-hint bad", "更新记录加载失败：" + esc(state.listErr.message || "") +
        '<br><button class="ab-retry" id="abRetry" type="button">重试</button>');
      var b = $("abRetry");
      if (b) b.onclick = function () { loadLog(true); };
      return;
    }
    if (!state.list) {
      host.innerHTML = box("ab-hint", "正在从 GitHub 拉取更新记录…");
      return;
    }
    var ends = splitEnds(state.list), arr = ends[state.end] || [];
    if (!arr.length) {
      host.innerHTML = box("ab-hint", (state.end === "mobile" ? "手机端" : "电脑端") +
        "还没有发布记录。发 Release 时 tag 用「" + (state.end === "mobile" ? "mobile-v0.1.0" : "v1.1.0") + "」这种格式就会出现在这里。");
      return;
    }
    var html = "";
    if (state.listErr && state.list) html += box("ab-hint", "拉取未成功（可能被限流），以下为本地缓存。");
    for (var i = 0; i < arr.length; i++) html += releaseRow(arr[i]);
    host.innerHTML = html;
  }
  function renderLegal() {
    var host = $("aboutLegal");
    if (!host) return;
    var li = "";
    for (var i = 0; i < CFG.thirdParty.length; i++) {
      var t = CFG.thirdParty[i];
      li += '<li><b>' + esc(t.name) + "</b><span>" + esc(t.ver) + " · " + esc(t.lic) + "</span></li>";
    }
    var yr = new Date().getFullYear();
    host.innerHTML =
      '<p class="ab-p">「何解」（Hegy）由 ' + esc(CFG.author) + " 自 " + esc(CFG.since) + " 年起开发。</p>" +
      '<p class="ab-p">© ' + esc(CFG.since) + (yr > CFG.since ? "–" + yr : "") + " " + esc(CFG.author) + "。" + esc(CFG.licenseNote) + "</p>" +
      (repoUrl()
        ? '<p class="ab-p ab-links">' +
          '<a href="' + esc(repoUrl()) + '" target="_blank" rel="noopener" data-ext="' + esc(repoUrl()) + '">GitHub 仓库</a>' +
          "<span>·</span>" +
          '<a href="' + esc(issuesUrl()) + '" target="_blank" rel="noopener" data-ext="' + esc(issuesUrl()) + '">问题反馈</a></p>'
        : '<p class="ab-p ab-links"><span class="ab-hint-inline">仓库地址未配置（solver/about.js）</span></p>') +
      '<div class="ab-tp"><div class="ab-tp-t">第三方组件</div><ul>' + li + "</ul></div>";
  }
  function renderVer() {
    var cur = currentVersion();
    var el = $("aboutVer"), nw = $("aboutNew");
    if (!el) return;
    el.textContent = cur.v ? ((cur.end === "mobile" ? "手机端 " : "电脑端 ") + "v" + cur.v) : "开发版";
    if (nw) {
      var latest = "", rel = null;
      if (state.list && CFG.repo) {
        var ends = splitEnds(state.list), arr = ends[cur.end] || [];
        rel = arr[0] || null;
        if (rel) latest = String(rel.tag_name || "").replace(/^mobile-/i, "");
      }
      var has = isNewer(latest, cur.v);
      nw.hidden = !has;
      upd.latest = has ? latest : "";
      renderNewBadge();
    }
  }

  function loadLog(force, done) {
    function finish(err) { if (done) done(err || null); }
    if (!CFG.repo) { renderLog(); finish(); return; }
    var cached = readCache();
    if (!force && cached && Date.now() - cached.t < TTL) {
      state.list = cached.list; state.listErr = null; renderLog(); renderVer(); finish(); return;
    }
    if (!force && cached) { state.list = cached.list; state.listErr = null; renderLog(); renderVer(); }
    state.listErr = null;
    if (!state.list) renderLog();
    fetchReleases(function (err, list, fromCache) {
      state.listErr = err || null;
      state.list = list || state.list;
      renderLog();
      renderVer();
      finish(err);
    }, force);
  }

  /* ---------- 打开 / 关闭（对齐既有弹层习惯：rAF 加 .show） ---------- */
  function open() {
    var m = $("aboutModal");
    if (!m) return;
    clearNewDot();
    var cur = currentVersion();
    setEnd(cur.end === "mobile" ? "mobile" : "desktop");
    renderVer();
    renderLegal();
    loadLog(false);
    requestAnimationFrame(function () { m.classList.add("show"); });
  }
  function close() {
    var m = $("aboutModal");
    if (m) m.classList.remove("show");
  }

  /* ---------- 启动静默检查：有新版本 → 设置按钮红点 + 轻提示（不弹窗，不打扰） ----------
     延迟 8s 等界面/网络稳定；复用 loadLog 的 30 分钟缓存 + ETag（304 不耗额度，桌面走主进程直连）。
     点红点直达关于页；打开过关于页红点即消。提示条复用 ui.css 的 .toast 样式（#toastHost）。 */
  var bootChecked = false;
  function ensureDotStyle() {
    if (document.getElementById("btnCfgDotStyle")) return;
    var st = document.createElement("style");
    st.id = "btnCfgDotStyle";
    st.textContent = "#btnCfg{position:relative}" +
      "#btnCfgDot{position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-radius:50%;" +
      "background:var(--warn,#e8590c);border:2px solid var(--panel,#fff);cursor:pointer;display:none}" +
      "#btnCfgDot.show{display:block;animation:abNewDot 2.4s ease-in-out infinite}" +
      "@keyframes abNewDot{0%,100%{transform:scale(1);opacity:.95}50%{transform:scale(1.3);opacity:.5}}";
    document.head.appendChild(st);
  }
  function showNewDot(ver) {
    var btn = $("btnCfg");
    if (!btn) return;
    ensureDotStyle();
    var dot = document.getElementById("btnCfgDot");
    if (!dot) {
      dot = document.createElement("span");
      dot.id = "btnCfgDot";
      btn.appendChild(dot);
      dot.addEventListener("click", function (e) {
        e.stopPropagation(); e.preventDefault();
        open();
      });
    }
    dot.title = "有新版本 " + ver + "，点击查看并下载";
    dot.classList.add("show");
  }
  function clearNewDot() {
    var dot = document.getElementById("btnCfgDot");
    if (dot) dot.classList.remove("show");
  }
  function bootToast(text) {
    var host = $("toastHost");
    if (!host) {   /* ui.js 的 toast() 是用到才建宿主，这里同样兜底创建 */
      host = document.createElement("div");
      host.id = "toastHost";
      document.body.appendChild(host);
    }
    var t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = "<span>" + esc(text) + "</span>";
    host.appendChild(t);
    requestAnimationFrame(function () { requestAnimationFrame(function () { t.classList.add("in"); }); });
    setTimeout(function () {
      t.style.maxHeight = t.offsetHeight + "px";
      void t.offsetWidth;
      t.classList.add("out");
      t.style.maxHeight = "0px";
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 340);
    }, 5200);
  }
  function checkOnBoot() {
    if (bootChecked || !CFG.repo) return;
    bootChecked = true;
    loadLog(false, function () {
      if (!upd.latest) return;   /* renderVer 里已算好：有比当前更新的 Release 才非空 */
      showNewDot(upd.latest);
      bootToast("有新版本 " + upd.latest + "，点设置按钮上的红点去下载");
    });
  }

  function setEnd(end) {
    state.end = end;
    var seg = document.querySelectorAll("#aboutModal .ab-seg button");
    for (var i = 0; i < seg.length; i++) seg[i].classList.toggle("on", seg[i].dataset.end === end);
    renderLog();
  }
  function setPane(name) {
    var tabs = document.querySelectorAll("#aboutModal .ab-tab button");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("on", tabs[i].dataset.pane === name);
    $("pane-log").hidden = name !== "log";
    $("pane-legal").hidden = name !== "legal";
  }

  /* ---------- 外链：桌面壳/浏览器直接开新窗；手机走系统分享 ---------- */
  function openExternal(url) {
    if (isMobileUI() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
      try {
        window.Capacitor.Plugins.Share.share({ title: "何解 · Hegy", url: url, dialogTitle: "分享链接" });
        return;
      } catch (e) {}
    }
    window.open(url, "_blank", "noopener");
  }

  function init() {
    if (state.wired) return;
    var m = $("aboutModal");
    if (!m) return;
    state.wired = true;

    var entry = $("btnAbout");
    if (entry) entry.addEventListener("click", open);
    var x = $("btnAboutX");
    if (x) x.addEventListener("click", close);
    m.addEventListener("mousedown", function (e) { if (e.target === m) close(); });

    var nw = $("aboutNew");
    if (nw) {
      nw.addEventListener("click", onNewBadgeClick);
      nw.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNewBadgeClick(); }
      });
    }

    var tabs = m.querySelectorAll(".ab-tab button");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () { setPane(this.dataset.pane); });
    }
    var seg = m.querySelectorAll(".ab-seg button");
    for (var j = 0; j < seg.length; j++) {
      seg[j].addEventListener("click", function () { setEnd(this.dataset.end); });
    }
    /* 刷新：绕过 30 分钟缓存重新拉一次；拉取期间图标转圈，结束（成功或失败）后停下。
       失败时不动按钮——列表区自己会显示「加载失败 + 重试」。 */
    var rf = $("aboutRefresh");
    if (rf) {
      rf.addEventListener("click", function () {
        if (rf.classList.contains("busy")) return;
        rf.classList.add("busy");
        loadLog(true, function () {
          rf.classList.remove("busy");
          rf.classList.toggle("ok", !state.listErr);
          setTimeout(function () { rf.classList.remove("ok"); }, 1200);
        });
      });
    }
    var sp = $("aboutAfdian");
    if (sp) {
      if (CFG.afdian) { sp.href = CFG.afdian; sp.hidden = false; }
      sp.addEventListener("click", function (e) {
        if (!CFG.afdian) { e.preventDefault(); return; }
        if (isMobileUI()) { e.preventDefault(); openExternal(CFG.afdian); }
        /* 桌面壳 / 浏览器：交给 target="_blank"（Electron 会转系统浏览器） */
      });
    }
    m.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[data-ext]");
      if (a && isMobileUI()) { e.preventDefault(); openExternal(a.dataset.ext); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  setTimeout(checkOnBoot, 8000);   /* 启动静默检查（见上）：有新版本挂红点 + 轻提示 */

  window.HJAbout = { open: open, close: close, reload: function () { loadLog(true); } };
})();
