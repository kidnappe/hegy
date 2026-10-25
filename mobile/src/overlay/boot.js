/* boot.js — 把 solver.js 的「插座」从 HTTP 换成本地实现。
 *
 * solver.js / ui.js 一行都不改：它们照旧 fetch("/api/...")、new EventSource(...)，
 * 这里在脚本加载阶段接管这两个全局，把 /api/* 转给 localapi.js（进程内），
 * 其余请求（vendor、assets、导出用的静态资源）照常走 WebView 原生 fetch。
 *
 * 只在 Capacitor 原生壳里生效；浏览器里打开同一份 www 时自动跳过（方便对着 8099 调 UI）。
 */
(function () {
  var native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var force = /[?&]localapi=1/.test(location.search);
  if (!native && !force) return;
  if (!window.HXApi) { console.error("[boot] localapi.js 未加载，/api/* 将走网络"); return; }

  var origFetch = window.fetch ? window.fetch.bind(window) : null;

  function isApi(url) {
    var u = String(url || "");
    if (u.indexOf("/api/") === 0) return true;
    if (u.indexOf(location.origin + "/api/") === 0) return u.slice(location.origin.length);
    return false;
  }
  function pathOf(url) {
    var u = String(url || "");
    if (u.indexOf(location.origin) === 0) u = u.slice(location.origin.length);
    return u;
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var p = isApi(url);
    if (!p) {
      // 导出离线 HTML 时会按桌面路径 fetch("/solver/vendor/jsxgraph.js") 把依赖内联进产物。
      // 手机上 www 就是站点根目录（没有 /solver 这一层），不剥掉前缀就会 404、导出直接失败。
      var u2 = String(url || "");
      var abs = u2.indexOf(location.origin) === 0;
      var rel = abs ? u2.slice(location.origin.length) : u2;
      if (rel.indexOf("/solver/") === 0) {
        rel = rel.slice("/solver".length);
        var fixed = abs ? location.origin + rel : rel;
        if (typeof input === "string") return origFetch(fixed, init);
        try { return origFetch(new Request(fixed, input), init); } catch (e) { return origFetch(fixed, init); }
      }
      return origFetch ? origFetch(input, init) : Promise.reject(new Error("no fetch"));
    }
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var body = null;
    if (init && init.body) {
      if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch (e) { body = init.body; } }
      else body = init.body;
    }
    return window.HXApi.handle(method, pathOf(url), body).then(function (r) {
      var text = JSON.stringify(r.json == null ? {} : r.json);
      return new Response(text, {
        status: r.status || 200,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    });
  };

  /* EventSource：只服务 /api/task/:id/events。用 localapi 的订阅通道推送同一份 snapshot，
   * 语义与 serve.js 的 SSE 一致（首帧立刻一次、running 时持续、终态后 end）。
   * 订阅不可用时主动触发 onerror，前端会自动回落到 1.5s 轮询 /api/task/:id。 */
  function LocalES(url) {
    var self = this;
    this.url = String(url || "");
    this.readyState = 0;
    this.onmessage = null;
    this.onerror = null;
    this.onopen = null;
    this._unsub = null;
    this._closed = false;
    var m = this.url.match(/\/api\/task\/([^/]+)\/events/);
    if (!m) { setTimeout(function () { self._fail(); }, 0); return; }
    var id = decodeURIComponent(m[1]);
    Promise.resolve(window.HXApi.subscribe(id, function (snap) {
      if (self._closed) return;
      if (self.readyState === 0) { self.readyState = 1; if (self.onopen) try { self.onopen({}); } catch (e) {} }
      if (self.onmessage) {
        try { self.onmessage({ data: JSON.stringify(snap), type: "message" }); } catch (e) { console.error("[boot] onmessage", e); }
      }
      if (snap && snap.status && snap.status !== "running") self.close();
    })).then(function (unsub) {
      if (typeof unsub === "function") self._unsub = unsub;
      else self._fail();
    }).catch(function () { self._fail(); });
  }
  LocalES.prototype._fail = function () {
    if (this._closed) return;
    this.readyState = 2;
    if (this.onerror) { try { this.onerror({ type: "error" }); } catch (e) {} }
  };
  LocalES.prototype.close = function () {
    this._closed = true;
    this.readyState = 2;
    if (this._unsub) { try { this._unsub(); } catch (e) {} this._unsub = null; }
  };
  LocalES.CONNECTING = 0; LocalES.OPEN = 1; LocalES.CLOSED = 2;
  window.EventSource = LocalES;

  console.log("[boot] /api/* → localapi（原生壳）");

  /* ---------------- 导出落盘：<a download> → 写文件 + 系统分享 ----------------
   * 桌面靠 a[download] 直接存到「下载」目录；WebView 里这个动作是**静默失败**的
   * （点「导出」什么都不发生，也不报错）。手机上正确的做法是写进 App 缓存再拉起分享面板，
   * 用户可以存到「文件」、发微信、发邮件。solver.js 的 download() 会 append 一个 <a> 再 click，
   * 所以这里在捕获阶段拦下来。 */
  (function installDownloadShim() {
    var P = (window.Capacitor && window.Capacitor.Plugins) || {};
    var FS = P.Filesystem, SH = P.Share;
    if (!FS) return;
    function toast(msg, kind) {
      if (window.HJ && window.HJ.toast) { try { window.HJ.toast(msg, kind || "ok"); return; } catch (e) {} }
      console.log("[download] " + msg);
    }
    function b64(buf) {
      var bytes = new Uint8Array(buf), s = "", CH = 0x8000;
      for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return btoa(s);
    }
    function save(href, name) {
      toast("正在准备文件…", "ok");
      fetch(href).then(function (r) { return r.blob(); }).then(function (blob) {
        return blob.arrayBuffer().then(function (ab) {
          var path = "exports/" + String(name || "hejie-export").replace(/[\\/:*?"<>|]/g, "_");
          return FS.writeFile({ path: path, data: b64(ab), directory: "CACHE", recursive: true }).then(function () {
            return FS.getUri({ path: path, directory: "CACHE" });
          });
        });
      }).then(function (r) {
        if (!SH) { toast("已保存到 App 缓存：" + r.uri, "ok"); return; }
        return SH.share({ title: name, files: [r.uri], dialogTitle: "保存或分享" })
          .catch(function (e) { if (!/cancel/i.test(String(e && e.message))) toast("分享失败：" + (e && e.message), "bad"); });
      }).catch(function (e) {
        toast("导出失败：" + ((e && e.message) || e), "bad");
      });
    }
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      var a = t && t.closest ? t.closest("a[download]") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (!/^(blob:|data:)/.test(href)) return;   // 普通链接不接管
      ev.preventDefault();
      ev.stopPropagation();
      save(href, a.getAttribute("download"));
    }, true);
  })();
})();
