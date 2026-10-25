/* mobile/src/bridge/cfg.js — 模型配置（Preferences）
 *
 * 为什么不用 localStorage：Capacitor WebView 的 localStorage 会随 WebView 数据清理丢，
 * 而且桌面把配置放在 ~/.hegy/settings.json，手机上对应的是「App 私有存储」。
 *
 * 口径（与桌面 settings.json 的 model 段完全一致，前端只认这套字段）：
 *   { baseUrl, apiKey, model, temperature, priceIn, priceOut, currency }
 *
 * apiKey 额外单独存一份（hegy.apikey.v1）：
 *   GET /api/cfg 必须把 apiKey 回填给前端，否则设置面板显示空、测试连接必失败。
 *   MVP 不做 Keystore 加密（PoC 未验证），但把读写收敛在这里，将来换
 *   capacitor-secure-storage-plugin 只改这个文件。
 *
 * 形态：window.HXCfg.create({ get, set, remove }) —— get/set/remove 都是 Promise。
 */
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory;
  else root.HXCfg = { create: factory };
})(typeof globalThis !== "undefined" ? globalThis : this, function createCfg(storage) {
  var SETTINGS_KEY = "hegy.settings.v1";
  var APIKEY_KEY = "hegy.apikey.v1";

  // 缺省存储：Capacitor Preferences；没有原生壳时退回 localStorage（仅浏览器调试用）
  function capStorage() {
    var cap = (typeof window !== "undefined" && window.Capacitor) || null;
    var P = cap && cap.Plugins && cap.Plugins.Preferences;
    if (P && typeof P.get === "function") {
      return {
        get: function (k) { return P.get({ key: k }).then(function (r) { return r && r.value != null ? r.value : null; }); },
        set: function (k, v) { return P.set({ key: k, value: String(v) }); },
        remove: function (k) { return P.remove({ key: k }); }
      };
    }
    return {
      get: function (k) { try { return Promise.resolve(window.localStorage.getItem(k)); } catch (e) { return Promise.resolve(null); } },
      set: function (k, v) { try { window.localStorage.setItem(k, String(v)); } catch (e) {} return Promise.resolve(); },
      remove: function (k) { try { window.localStorage.removeItem(k); } catch (e) {} return Promise.resolve(); }
    };
  }
  storage = storage || capStorage();
  if (typeof storage.remove !== "function") storage.remove = function (k) { return storage.set(k, ""); };

  function parse(txt) {
    if (!txt) return {};
    try { var j = JSON.parse(txt); return j && typeof j === "object" ? j : {}; } catch (e) { return {}; }
  }
  function load() {
    return Promise.resolve(storage.get(SETTINGS_KEY)).then(parse);
  }
  // 前端只认这 7 个字段；apiKey 不在 settings 里时从单独那份回填。
  function getConfig() {
    return Promise.all([load(), Promise.resolve(storage.get(APIKEY_KEY))]).then(function (a) {
      var s = a[0] || {}, key = a[1] || "";
      var m = s.model;
      if (!m || typeof m !== "object") return null;
      var out = {
        baseUrl: String(m.baseUrl || ""),
        apiKey: String(m.apiKey || key || ""),
        model: String(m.model || ""),
        temperature: m.temperature != null ? Number(m.temperature) : 0.2,
        priceIn: m.priceIn != null && m.priceIn !== "" ? Number(m.priceIn) : null,
        priceOut: m.priceOut != null && m.priceOut !== "" ? Number(m.priceOut) : null,
        currency: m.currency || null
      };
      return out;
    });
  }
  // 与桌面 POST /api/cfg 的字段归一化逐条一致；传 null 等于清空。
  function save(c) {
    if (!c || typeof c !== "object") {
      return Promise.all([Promise.resolve(storage.set(SETTINGS_KEY, JSON.stringify({}))), Promise.resolve(storage.remove(APIKEY_KEY))]).then(function () { return true; });
    }
    var m = {
      baseUrl: String(c.baseUrl || ""),
      apiKey: String(c.apiKey || ""),
      model: String(c.model || ""),
      temperature: c.temperature != null ? Number(c.temperature) : 0.2,
      priceIn: c.priceIn != null && c.priceIn !== "" ? Number(c.priceIn) : null,
      priceOut: c.priceOut != null && c.priceOut !== "" ? Number(c.priceOut) : null,
      currency: c.currency || null
    };
    return Promise.all([
      Promise.resolve(storage.set(SETTINGS_KEY, JSON.stringify({ model: m }))),
      Promise.resolve(storage.set(APIKEY_KEY, m.apiKey))
    ]).then(function () { return true; });
  }

  return { load: load, getConfig: getConfig, save: save, SETTINGS_KEY: SETTINGS_KEY, APIKEY_KEY: APIKEY_KEY };
});
