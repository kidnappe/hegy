/* mobile/src/bridge/http.js — LLM 网络桥（MVP 非流式）
 *
 * 为什么单独一层：
 *   桌面 serve.js 用 Node 的 fetch + SSE 流式；手机端按 PoC 结论先做**非流式**
 *   （stream:false，一次拿整段 JSON），走 CapacitorHttp 原生通道（PoC-1 已验证）。
 *   把「怎么发请求」收在这一个文件里，将来换流式插件只改这里。
 *
 * 契约：window.HXHttp.create({ post }) → { chat(cfg, payload, o), models(cfg) }
 *   post 可注入（自检脚本用假实现）；缺省用 Capacitor.Plugins.CapacitorHttp。
 *   post({url, headers, data, readTimeout, connectTimeout, signal}) →
 *        Promise<{status, data}>   // 非 2xx **不抛**，与 CapacitorHttp 语义一致
 *
 * 两个 PoC 坑（必须保留）：
 *   1) readTimeout 放到 600000：切后台约 70s 进程被冻结，OkHttp 仍按墙钟计时，120s 必超。
 *   2) 推理模型的 max_tokens 同时限制 reasoning_content：给太少会得到空 content 且
 *      finish_reason=length。额度由 payload builder 统一给（解题/微调 64K），宿主在
 *      「空正文」时升到 128K 再重试一次；这里只负责发请求，不再自加一层重试，
 *      否则两层重试叠加会连发 3~4 次几分钟的长请求。
 */
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory;
  else root.HXHttp = { create: factory };
})(typeof globalThis !== "undefined" ? globalThis : this, function createHttp(opts) {
  opts = opts || {};
  var readTimeout = opts.readTimeout || 600000;
  var connectTimeout = opts.connectTimeout || 20000;
  var MAX_TOKENS = 8192;

  // CapacitorHttp 缺省实现；没有原生壳时退回 WebView fetch（PoC-2：国内厂商都放行 CORS，
  // 浏览器里带 ?localapi=1 调试时也能用）。
  function capPost(o) {
    var cap = (typeof window !== "undefined" && window.Capacitor) || null;
    var P = cap && cap.Plugins && cap.Plugins.CapacitorHttp;
    if (P && typeof P.post === "function") {
      return P.post({
        url: o.url,
        headers: o.headers,
        data: o.data,
        readTimeout: o.readTimeout || readTimeout,
        connectTimeout: o.connectTimeout || connectTimeout
      });
    }
    return fetch(o.url, {
      method: "POST",
      headers: o.headers,
      body: JSON.stringify(o.data),
      signal: o.signal
    }).then(function (r) {
      return r.text().then(function (t) { return { status: r.status, data: t }; });
    });
  }
  var post = typeof opts.post === "function" ? opts.post : capPost;

  function httpErr(status, body) {
    var e = new Error("HTTP_" + status);
    e.httpStatus = status;
    e.body = body;
    return e;
  }
  // CapacitorHttp 的 data 可能是已解析对象，也可能是字符串；统一成 {status, json, text}。
  function norm(r) {
    var status = r && r.status != null ? Number(r.status) : 0;
    var data = r ? r.data : null;
    if (typeof data === "string") {
      try { return { status: status, json: JSON.parse(data), text: data }; } catch (e) { return { status: status, json: null, text: data }; }
    }
    if (data && typeof data === "object") {
      var tx = "";
      try { tx = JSON.stringify(data); } catch (e) { tx = ""; }
      return { status: status, json: data, text: tx };
    }
    return { status: status, json: null, text: data == null ? "" : String(data) };
  }
  function call(url, headers, data, signal) {
    return Promise.resolve().then(function () {
      return post({ url: url, headers: headers, data: data, readTimeout: readTimeout, connectTimeout: connectTimeout, signal: signal });
    });
  }

  function parseChat(j) {
    var ch = (j && j.choices && j.choices[0]) || {};
    var msg = ch.message || {};
    return {
      content: msg.content || "",
      reasoning: msg.reasoning_content || "",
      usage: (j && j.usage) || null,
      finishReason: ch.finish_reason || ""
    };
  }

  // 非流式一次取回。o.onDelta 只是给将来流式留的钩子（非流式不会调用）。
  function chat(cfg, payload, o) {
    o = o || {};
    var base = String((cfg && cfg.baseUrl) || "").replace(/\/$/, "");
    if (!base) return Promise.reject(httpErr(0, "缺少 baseUrl"));
    var body = {};
    Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
    body.stream = false;                       // MVP 明确非流式
    if (body.max_tokens == null) body.max_tokens = MAX_TOKENS;
    var headers = { "content-type": "application/json", authorization: "Bearer " + cfg.apiKey };
    function once(tokens) {
      body.max_tokens = tokens;
      return call(base + "/chat/completions", headers, body, o.signal).then(function (r) {
        var res = norm(r);
        if (res.status < 200 || res.status >= 300) throw httpErr(res.status, String(res.text || "").slice(0, 800));
        if (!res.json) throw httpErr(200, "返回不是 JSON：" + String(res.text || "").slice(0, 400));
        return parseChat(res.json);
      });
    }
    return once(body.max_tokens);
  }

  // 测试连接 / 拉模型列表：非 2xx 不抛，交给调用方按状态码说人话。
  function models(cfg) {
    var base = String((cfg && cfg.baseUrl) || "").replace(/\/$/, "");
    if (!base) return Promise.resolve({ status: 0, json: null, text: "缺少 baseUrl" });
    var cap = (typeof window !== "undefined" && window.Capacitor) || null;
    var P = cap && cap.Plugins && cap.Plugins.CapacitorHttp;
    var headers = { authorization: "Bearer " + cfg.apiKey };
    var p;
    if (P && typeof P.get === "function") {
      p = P.get({ url: base + "/models", headers: headers, readTimeout: readTimeout, connectTimeout: connectTimeout });
    } else {
      p = fetch(base + "/models", { headers: headers }).then(function (r) {
        return r.text().then(function (t) { return { status: r.status, data: t }; });
      });
    }
    return Promise.resolve(p).then(norm);
  }

  return {
    chat: chat,
    models: models,
    call: call,
    MAX_TOKENS: MAX_TOKENS,
    readTimeout: readTimeout,
    connectTimeout: connectTimeout
  };
});
