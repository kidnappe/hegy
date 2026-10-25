/* mobile/src/localapi.js — 把桌面 serve.js 的 /api/* 在 WebView 进程内实现一遍
 *
 * 为什么不是「把 serve.js 塞进手机」：手机没有端口概念，也不该起 HTTP 服务。
 * boot.js 接管 window.fetch / window.EventSource，把 /api/* 直接转到这里（进程内调用），
 * 所以 solver.js / ui.js 一行都不用改。
 *
 * 硬性口径：**返回体形状必须与 serve.js 逐条一致**。
 * 前端有大量 `if (j && j.items)` 之类的静默降级——形状不对不会报错，只会莫名其妙没数据。
 * 契约表见 mobile/ARCH.md §2。
 *
 * 形态：
 *   浏览器  window.HXApi = { handle(method, path, body), subscribe(id, fn), init() }
 *   Node    module.exports = createApi;  // 自检脚本注入假 post / 内存 store
 *
 * 与桌面的差异（有意为之）：
 *   - 任务事件：SSE → 订阅回调（subscribe），snapshot 形状不变；
 *   - LLM：流式 → 非流式（PoC 结论），进度用 400ms 心跳推进百分比；
 *     阶段文案只写「在做什么」，时间/字数统一交给手机进度浮卡显示，避免两处重复；
 *   - 存储：~/.hegy → Hegy/records + index.json；
 *   - 配置：settings.json → Preferences；
 *   - 换目录 / 打开目录 / 选目录：手机上不存在 → NOT_SUPPORTED。
 */
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory;
  else root.HXApi = factory({});
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi(opts) {
  opts = opts || {};
  // 工厂是独立函数，拿不到 UMD 包装层的 root 参数，这里自己取一次全局对象
  var root = typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : {});

  var TASK_TTL = 15 * 60 * 1000;
  var ERRLOG_MAX = 300;
  var LOG_KEY = "hegy.errors.v1";
  var LOG_FILE = "Preferences:hegy.errors.v1";   // 界面「完整记录存于 …」显示用
  var EXAMPLE_URL = "example_main.js";           // prepare.js 把 example_*.js 拷到 www 根；目前唯一非 mock 示例

  var core = opts.core || null;
  var store = opts.store || null;
  var cfgMod = opts.cfg || null;
  var http = opts.http || null;
  var prefs = opts.prefs || null;

  var TASKS = new Map();
  var ERRLOG = [];
  var ready = null;

  // ---------------- 依赖装配（懒初始化） ----------------
  function capPrefs() {
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
  function fetchText(url) {
    if (typeof window === "undefined" || !window.fetch) return Promise.resolve("");
    return window.fetch(url).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
  }
  // few-shot 示例：桌面是扫目录取第一个 example_*.js；浏览器没有目录列表，
  // 约定 prepare.js 把示例拷到 www 根、名字是 example_main.js（找不到就退化为无示例）。
  function loadExample() {
    return fetchText(EXAMPLE_URL).then(function (t) {
      return t ? { name: EXAMPLE_URL, text: t } : null;
    });
  }
  function init() {
    if (ready) return ready;
    ready = Promise.resolve().then(function () {
      if (!prefs) prefs = capPrefs();
      if (core) return null;
      return Promise.all([fetchText("prompt.txt"), fetchText("chat-prompt.txt"), loadExample()]).then(function (r) {
        if (!r[0]) throw new Error("prompt.txt 读取失败");
        core = root.HXCore.create({ prompt: r[0], chatPrompt: r[1], example: r[2] });
        return null;
      });
    }).then(function () {
      if (!cfgMod) cfgMod = root.HXCfg.create(prefs);
      if (!http) http = root.HXHttp.create({});
      if (!store) store = root.HXStoreFactory(root.HXStoreAdapter);
      return logLoad();
    });
    return ready;
  }

  // ---------------- 错误日志：内存 300 条 + Preferences 持久化 ----------------
  // 只记 host，绝不落 apiKey（safeHost 只取 origin，raw 里也不含鉴权头）。
  function logLoad() {
    return Promise.resolve(prefs.get(LOG_KEY)).then(function (txt) {
      if (!txt) return;
      var arr = null;
      try { arr = JSON.parse(txt); } catch (e) { arr = null; }
      if (!Array.isArray(arr)) return;
      ERRLOG.length = 0;
      arr.slice(0, ERRLOG_MAX).forEach(function (r) { if (r && typeof r === "object") ERRLOG.push(r); });
    }).catch(function () {});
  }
  function logSave() {
    try {
      var p = prefs.set(LOG_KEY, JSON.stringify(ERRLOG));
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) {}
  }
  function logError(t, info, meta, extra) {
    var rec = {
      ts: Date.now(),
      taskId: (t && t.id) || "",
      kind: (t && t.kind) || "",
      snippet: String((t && t.snippet) || "").slice(0, 60),
      code: info.code,
      title: info.title,
      hint: info.hint,
      http: info.httpStatus || 0,
      net: info.netCode || "",
      model: (meta && meta.model) || "",
      host: (meta && meta.host) || "",
      elapsedMs: (t && t.elapsedMs) || 0,
      raw: String(info.raw || "").slice(0, 4000)
    };
    if (extra) {
      if (extra.finishReason) rec.finishReason = String(extra.finishReason);
      if (extra.maxTokens) rec.maxTokens = Number(extra.maxTokens) || 0;
      if (extra.reasoningChars) rec.reasoningChars = Number(extra.reasoningChars) || 0;
      if (extra.contentChars != null) rec.contentChars = Number(extra.contentChars) || 0;
      if (extra.usage) rec.usage = extra.usage;
    }
    ERRLOG.unshift(rec);
    if (ERRLOG.length > ERRLOG_MAX) ERRLOG.length = ERRLOG_MAX;
    logSave();
    return rec;
  }

  // ---------------- 任务注册表（替代 serve.js 的 TASKS + SSE） ----------------
  function sweep() {
    var now = Date.now();
    TASKS.forEach(function (t, id) { if (t.status !== "running" && now - t.created > TASK_TTL) TASKS.delete(id); });
  }
  function snapshot(t, final) {
    var d = { id: t.id, kind: t.kind, snippet: t.snippet || "", status: t.status, progress: Math.round(t.progress), stage: t.stage, received: t.received };
    if (t.reasoning) d.reasoning = t.reasoning;
    // 追问是纯文本：running 时把当前已生成文本带出去（非流式时通常是空串）
    if (!final && t.kind === "chat") d.partial = t.partial || "";
    if (final) { d.result = t.result; d.error = t.error; d.message = t.message; d.err = t.err || null; }
    return d;
  }
  function emit(t, final) {
    if (!t.subs.size) return;
    var snap = snapshot(t, final);
    t.subs.forEach(function (fn) { try { fn(snap); } catch (e) {} });
  }
  function createTask(kind) {
    var id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var t = {
      id: id, kind: kind, created: Date.now(), status: "running", progress: 3, stage: "准备题目…",
      received: 0, reasoning: 0, partial: "", result: null, error: null, message: "", err: null,
      subs: new Set(), timer: null, elapsedMs: 0, cancelled: false,
      ctrl: typeof AbortController !== "undefined" ? new AbortController() : null,
      thinking: 0
    };
    TASKS.set(id, t);
    if (TASKS.size > 400) sweep();
    return t;
  }
  // 400ms 心跳缓动、封顶 cap（照抄 serve.js 的 startProgress 手感）。
  // 非流式拿不到增量，进入等待后把阶段固定成「模型思考中…」；已用时间由进度浮卡自己走秒，
  // 这里不再拼「已 Ns」，否则浮卡的时间和阶段文案会重复。
  function startProgress(t, cap) {
    if (t.timer) clearInterval(t.timer);
    t.timer = setInterval(function () {
      if (t.status !== "running") return;
      var changed = false;
      if (t.progress < cap) {
        t.progress = Math.min(cap, t.progress + Math.max(0.5, (cap - t.progress) * 0.05));
        changed = true;
      }
      if (t.kind !== "chat" && t.thinking && t.stage !== "模型思考中…") {
        t.stage = "模型思考中…";
        changed = true;
      }
      if (changed) emit(t);
    }, 400);
  }
  function finish(t) {
    if (t.timer) { clearInterval(t.timer); t.timer = null; }
    t.elapsedMs = Date.now() - t.created;
    if (t.result) t.result.elapsedMs = t.elapsedMs;
    emit(t, true);
    t.subs.clear();
  }
  // 任务失败的唯一出口：短文案给界面，完整信息进日志。
  function failTask(t, code, message, httpStatus, meta, extra) {
    var info = core.classifyError(code, message, httpStatus);
    t.status = "error";
    t.error = code || "ERROR";
    t.message = String(message == null ? "" : message);
    t.err = { code: info.code, title: info.title, hint: info.hint, http: info.httpStatus };
    t.progress = 100; t.stage = "失败";
    t.elapsedMs = Date.now() - t.created;
    logError(t, info, meta, extra);
    finish(t);
  }
  function startTask(kind, req) {
    var t = createTask(kind);
    var lastMsg = Array.isArray(req.messages) && req.messages.length ? req.messages[req.messages.length - 1].content : "";
    t.snippet = String(req.instruction || req.question || lastMsg || "").replace(/\s+/g, " ").trim().slice(0, 24) || "(图片题)";
    Promise.resolve().then(function () { return runTask(t, req); });
    return t;
  }

  // ---------------- 配置解析（请求里带了就用请求的，否则读 Preferences） ----------------
  function resolveCfg(body) {
    var c = body && body.config;
    if (c && c.baseUrl && c.apiKey) return Promise.resolve(c);
    return cfgMod.getConfig();
  }

  // ---------------- 任务执行 ----------------
  function stageForDelta(t, n, rc) {
    t.received = n; t.reasoning = rc || 0;
    // 阶段只描述当前动作；字数放在浮卡右侧的统计里，别在两行里各写一遍。
    t.stage = (t.reasoning > 0 && n === 0) ? "模型推理中…" : "模型输出中…";
    emit(t);
  }
  function runChatTask(t, req) {
    var meta = {};
    return Promise.resolve().then(function () { return resolveCfg({ config: req.config }); }).then(function (cfg) {
      if (!cfg) { failTask(t, "NO_CONFIG", "", 0, meta); return null; }
      meta = { model: cfg.model || "", host: core.safeHost(cfg.baseUrl) };
      var payload = core.buildChatPayload(cfg, req);
      t.progress = 12; t.stage = "AI 正在回答…"; emit(t);
      startProgress(t, 90);
      return http.chat(cfg, payload, {
        signal: t.ctrl ? t.ctrl.signal : null,
        onDelta: function (n, content, rc) {
          t.received = n; t.reasoning = rc || 0; t.partial = String(content || "");
          t.stage = "AI 正在回答…"; emit(t);
        }
      }).then(function (call) {
        if (t.cancelled) return null;
        var text = String((call && call.content) || "").trim();
        if (!text) {
          failTask(t, "EMPTY_REPLY", "", 0, meta, {
            finishReason: (call && call.finishReason) || "",
            maxTokens: payload.max_tokens,
            reasoningChars: String((call && call.reasoning) || "").length,
            contentChars: 0,
            usage: (call && call.usage) || null
          });
          return null;
        }
        t.result = { text: text, usage: (call && call.usage) || core.estimateUsage(call && call.content, payload) };
        t.status = "done"; t.progress = 100; t.stage = "完成"; finish(t);
        return null;
      });
    }).catch(function (e) {
      if (t.cancelled) return;      // 取消引起的 abort 不是错误，状态已由 cancel 写好
      failTask(t, e && e.httpStatus ? ("LLM_HTTP_" + e.httpStatus) : ((e && e.message) || "ERROR"), core.errRaw(e), e && e.httpStatus, meta);
    });
  }
  function runTask(t, req) {
    if (req.mode === "chat") return runChatTask(t, req);
    var meta = {};
    return Promise.resolve().then(function () { return resolveCfg({ config: req.config }); }).then(function (cfg) {
      if (!cfg) { failTask(t, "NO_CONFIG", "", 0, meta); return null; }
      meta = { model: cfg.model || "", host: core.safeHost(cfg.baseUrl) };

      var isRefine = req.mode === "refine";
      var channel = core.promptChannel(req, isRefine);
      var build = function (note) {
        return isRefine
          ? core.buildRefinePayload(Object.assign({}, cfg, { stream: cfg.stream }), req, channel)
          : core.buildSolvePayload(cfg, req, note, channel);
      };
      var callOpts = { signal: t.ctrl ? t.ctrl.signal : null, onDelta: function (n, content, rc) { stageForDelta(t, n, rc); } };

      t.progress = 10; t.stage = "调用大模型…"; emit(t);
      t.thinking = Date.now(); t.thinkSec = -1;
      startProgress(t, 86);

      var built = build("");
      var payload = built.payload;
      var promptInfo = built.prompt;

      return http.chat(cfg, payload, callOpts).then(function (call) {
        if (t.cancelled) return null;
        var obj = core.parseModelJson(call.content);
        var attempts = 1;
        var issues = obj ? core.validateResult(obj) : { ok: false, issues: ["不是合法 JSON"] };
        // 自动通道的窄后校验：三视图/展开图题被模型输出成单个 3D 场景时，强制重试一次。
        var routeQ = String((req.question || req.questionText || (obj && obj.questionText) || "")).trim();
        var route = core.autoRouteCheck(req, obj, isRefine, routeQ);
        var routeRetried = false;
        if (route.issue) {
          issues.ok = false;
          issues.issues = issues.issues.concat(route.issue);
        }
        if (!obj || !issues.ok) {
          attempts = 2;
          if (route.issue) routeRetried = true;
          t.stage = "结果不完整，自动重试…（第 2 次）"; t.received = 0; t.reasoning = 0;
          t.progress = Math.min(t.progress, 40);
          t.thinking = Date.now(); t.thinkSec = -1;
          emit(t);
          payload = build(issues.issues.join("；") || "不是合法 JSON").payload;
          // 空正文通常 = 推理把预算吃光（finish_reason=length）。第二次直接给 128K，
          // 仍不够就带着 finish_reason / usage 进错误日志，别再记一条空 raw。
          if (!String(call.content || "").trim()) payload.max_tokens = 131072;
          return http.chat(cfg, payload, callOpts).then(function (call2) {
            if (t.cancelled) return null;
            var obj2 = core.parseModelJson(call2.content);
            var v2 = obj2 ? core.validateResult(obj2) : { ok: false, issues: ["不是合法 JSON"] };
            var route2 = core.autoRouteCheck(req, obj2, isRefine, routeQ);
            var v2StructOk = v2.ok;
            if (route2.issue) {
              v2.ok = false;
              v2.issues = v2.issues.concat(route2.issue);
            }
            // 结构合格就接受第二次结果（哪怕通道仍不对），避免退回第一次的坏结果。
            if (obj2 && (v2StructOk || !obj)) {
              obj = obj2;
              call = { content: call2.content, usage: call2.usage || call.usage, reasoning: call2.reasoning || "", finishReason: call2.finishReason || "" };
              issues = v2; route = route2;
            } else if (!obj2 && !obj) {
              // 两次都没解析出 JSON：保留第二次的 finishReason / reasoning 供失败日志定位。
              call = call2;
            }
            return applyResult(t, req, meta, {
              obj: obj, call: call, issues: issues, route: route, routeRetried: routeRetried,
              routeQ: routeQ, promptInfo: promptInfo, payload: payload, attempts: attempts, isRefine: isRefine
            });
          });
        }
        return applyResult(t, req, meta, {
          obj: obj, call: call, issues: issues, route: route, routeRetried: routeRetried,
          routeQ: routeQ, promptInfo: promptInfo, payload: payload, attempts: attempts, isRefine: isRefine
        });
      });
    }).catch(function (e) {
      if (t.cancelled) return;
      failTask(t, e && e.httpStatus ? ("LLM_HTTP_" + e.httpStatus) : ((e && e.message) || "ERROR"), core.errRaw(e), e && e.httpStatus, meta);
    });
  }
  // 解析 → 校验 → 归一化 → 溯源回填（逐条照抄 serve.js 的 runTask 后半段）
  function applyResult(t, req, meta, x) {
    if (t.cancelled) return null;
    var obj = x.obj, call = x.call, issues = x.issues, route = x.route;
    t.progress = 92; t.stage = "解析结果…"; emit(t);
    if (!obj) {
      failTask(t, "MODEL_NOT_JSON", String(call.content || "").slice(0, 4000), 0, meta, {
        finishReason: call.finishReason || "",
        maxTokens: x.payload && x.payload.max_tokens,
        reasoningChars: String(call.reasoning || "").length,
        contentChars: String(call.content || "").length,
        usage: call.usage || null
      });
      return null;
    }

    t.progress = 96; t.stage = "校验图形…"; emit(t);
    var result = core.normalizeResult(obj);
    // 手机端读题图返回的题文先清洗一次：双重转义 Unicode / Latin-1 乱码 / 控制符，
    // 避免原题卡出现“æµ‹è¯•”或 “\u4f8b” 这类不可读文本。只动题文，不碰答案和解析。
    if (core.cleanQuestionText) result.questionText = core.cleanQuestionText(result.questionText);
    result.usage = call.usage || core.estimateUsage(call.content, x.payload);
    result.valid = issues.ok;
    result.issues = issues.issues;
    var stepWarn = core.stepsWarn(obj, x.routeQ);
    result.stepsMissing = !!stepWarn;
    result.warnings = stepWarn ? [stepWarn] : [];
    result.attempts = x.attempts;
    result.routeExpected = route.expected;
    result.routeActual = core.figKind(obj);
    result.routeRetried = x.routeRetried;
    result.routeIssue = route.issue;
    result.promptVer = x.promptInfo.ver;
    result.promptHash = x.promptInfo.hash;
    result.promptChannel = x.promptInfo.channel;
    result.promptBytes = x.promptInfo.bytes;
    result.view = core.cleanView(req.view);
    if (x.isRefine) {
      result.refined = true;
      // 溯源字段由后端按请求回填，不信任模型回显
      var hasAnsImg = Array.isArray(req.answerImages) && req.answerImages.length > 0;
      if (req.givenAnswer) result.givenAnswer = String(req.givenAnswer);
      if (hasAnsImg) {
        result.givenFromImage = true;
        if (!req.givenAnswer) result.givenAnswer = String(result.givenAnswerText || "").trim() || "（答案图片）";
      }
      if (req.givenAnswer || hasAnsImg) {
        result.givenScope = req.scope === "current" ? "current" : (req.scope === "option" ? "option" : "all");
        result.givenQuestionIndex = Number.isInteger(req.questionIndex) ? req.questionIndex : -1;
        result.givenOption = req.scope === "option" ? String(req.option || "").toUpperCase() : "";
      }
      // target=text 但答案数值真的变了、模型又没写提醒 → 服务端补一句（§63.7 P4 / §71）
      if (String(req.target || "auto") === "text") {
        var prevAns = String(((req.previous || {}).answer) || "").trim();
        var nextAns = String(result.answer || "").trim();
        var flat = function (s) { return s.replace(/[\s${}\\]/g, ""); };
        if (prevAns && nextAns && flat(prevAns) !== flat(nextAns) && !/图形|重画|未同步/.test(String(result.answerNote || ""))) {
          result.answerNote = "文字改动改变了答案，图形仍是旧的，请用「微调 → 图形」重画。";
          result.warnings = (result.warnings || []).concat("target=text 答案已变，图形未同步（服务端补的提醒）");
        }
      }
    }
    t.result = result; t.status = "done"; t.progress = 100; t.stage = "完成"; finish(t);
    return null;
  }

  // ---------------- 路由 ----------------
  function ok(json) { return { status: 200, json: json }; }
  function bad(status, json) { return { status: status, json: json }; }

  function solve(body) {
    body = body || {};
    var question = String(body.question || "").trim();
    if (question) { var e = core.checkText(question, core.Q_MAX); if (e) return bad(400, { error: "BAD_INPUT", message: e }); }
    var im = core.checkImages(body.images);
    if (im.error) return bad(400, { error: "BAD_IMAGE", message: im.error });
    if (!question && !im.images.length) return bad(400, { error: "empty", message: "请填写题目或粘贴图片" });
    var t = startTask("solve", {
      mode: "solve", question: question, images: im.images,
      grade: core.cleanGrade(body.grade), dim: body.dim, view: core.cleanView(body.view),
      config: body.config, stream: body.stream
    });
    return ok({ taskId: t.id, eventsUrl: "/api/task/" + t.id + "/events" });
  }
  function refine(body) {
    body = body || {};
    var givenAnswer = String(body.givenAnswer || "").trim();
    if (givenAnswer) {
      var ge = core.checkText(givenAnswer, core.GIVEN_ANS_MAX);
      if (ge) return bad(400, { error: "BAD_INPUT", message: ge });
    }
    var instruction = (body.instruction || "").trim() || (givenAnswer ? "按用户给定答案重新生成完整解答与图形" : "");
    if (!instruction) return bad(400, { error: "empty", message: "请填写修改要求" });
    var e = core.checkText(instruction, core.RIN_MAX);
    if (e) return bad(400, { error: "BAD_INPUT", message: e });
    var im = core.checkImages(body.images);
    if (im.error) return bad(400, { error: "BAD_IMAGE", message: im.error });
    var aim = core.checkImages(body.answerImages);
    if (aim.error) return bad(400, { error: "BAD_IMAGE", message: aim.error });
    var answerImages = aim.images;
    var rawQi = Number(body.questionIndex);
    var questionIndex = Number.isInteger(rawQi) && rawQi >= 0 && rawQi < 50 ? rawQi : -1;
    var rawScope = String(body.scope || "");
    var scope = rawScope === "current" && questionIndex >= 0 ? "current" : (rawScope === "option" ? "option" : "all");
    var option = scope === "option" ? String(body.option || "").toUpperCase().slice(0, 1) : "";
    var target = (givenAnswer || answerImages.length) ? "answer" : body.target;
    var t = startTask("refine", {
      mode: "refine", question: (body.question || "").trim(), questionText: String(body.questionText || ""),
      images: im.images, answerImages: answerImages,
      grade: core.cleanGrade(body.grade), dim: body.dim, view: core.cleanView(body.view),
      target: target, config: body.config, instruction: instruction, scope: scope,
      questionIndex: questionIndex, option: option,
      perQuestion: Array.isArray(body.perQuestion) ? body.perQuestion : null,
      givenAnswer: givenAnswer, previous: body.previous || {}, stream: body.stream
    });
    return ok({ taskId: t.id, eventsUrl: "/api/task/" + t.id + "/events" });
  }
  function chat(body) {
    body = body || {};
    var messages = core.cleanChatMessages(body.messages);
    if (!messages.length) return bad(400, { error: "empty", message: "请先输入想问的问题" });
    if (messages[messages.length - 1].role !== "user") return bad(400, { error: "BAD_MESSAGES", message: "最后一条必须是用户问题" });
    var last = messages[messages.length - 1];
    var e = core.checkText(last.content, core.CHAT_MAX_MSG);
    if (e) return bad(400, { error: "BAD_INPUT", message: e });
    var im = core.checkImages(body.images);
    if (im.error) return bad(400, { error: "BAD_IMAGE", message: im.error });
    var question = String(body.question || "").trim();
    var questionText = String(body.questionText || "").trim();
    if (!question && !questionText && !String(body.answer || "").trim() && !String(body.analysis || "").trim()) {
      return bad(400, { error: "NO_CONTEXT", message: "缺少题目上下文，请先解一道题" });
    }
    var t = startTask("chat", {
      mode: "chat", question: question, questionText: questionText, messages: messages,
      images: im.images, grade: core.cleanGrade(body.grade),
      answer: String(body.answer || ""), analysis: String(body.analysis || ""),
      subQuestions: Array.isArray(body.subQuestions) ? body.subQuestions : null,
      renderCode: typeof body.renderCode === "string" ? body.renderCode : "",
      render3d: body.render3d || null,
      config: body.config, stream: body.stream
    });
    return ok({ taskId: t.id, eventsUrl: "/api/task/" + t.id + "/events" });
  }
  function taskRoute(method, p, body) {
    var rest = p.slice("/api/task/".length).split("/");
    var t = TASKS.get(rest[0]);
    if (!t) return bad(404, { error: "NO_TASK" });
    if (rest[1] === "cancel") {
      if (t.status === "running") {
        t.cancelled = true;
        // CapacitorHttp 不支持 abort：这里只是尽力而为，真正的丢弃靠回调里的 t.cancelled 判断
        if (t.ctrl) { try { t.ctrl.abort(); } catch (e) {} }
        t.status = "error"; t.error = "CANCELLED"; t.message = "已取消"; t.stage = "已取消"; t.progress = 100;
        finish(t);
      }
      return ok({ ok: true, id: t.id, status: t.status });
    }
    if (rest[1] === "events") return ok(snapshot(t, t.status !== "running"));  // 事件走 subscribe，这里只兜底
    return ok(snapshot(t, t.status !== "running"));
  }
  function listTasks() {
    var arr = Array.from(TASKS.values()).map(function (t) { return snapshot(t, t.status !== "running"); }).reverse();
    return ok({ tasks: arr.slice(0, 30) });
  }
  function logsRoute(method, qs) {
    if (method === "POST") {
      ERRLOG.length = 0;
      logSave();
      return ok({ ok: true });
    }
    var m = /(?:^|&)limit=(\d+)/.exec(qs || "");
    var limit = m ? Math.max(1, Math.min(ERRLOG_MAX, Number(m[1]))) : 100;
    return ok({ entries: ERRLOG.slice(0, limit), file: LOG_FILE, total: ERRLOG.length });
  }
  function modelsRoute(body) {
    return resolveCfg(body).then(function (cfg) {
      if (!cfg) return ok({ error: "还没填模型配置", hint: "先填好接口地址和 Key" });
      return http.models(cfg).then(function (r) {
        var st = r && r.status != null ? Number(r.status) : 0;
        if (st < 200 || st >= 300) {
          // 测试连接 / 获取列表也要说人话：402 就说额度不足，别丢一句 "fetch failed"。
          var info = core.classifyError("LLM_HTTP_" + st, String((r && r.text) || "").slice(0, 800), st);
          return ok({ ok: false, error: info.title, hint: info.hint, status: st });
        }
        var j = (r && r.json) || {};
        var ids = ((j.data || j.models) || []).map(function (m) { return m.id || m.name; }).filter(Boolean);
        return ok({ ok: true, models: ids });
      });
    }).catch(function (e) {
      var info = core.classifyError((e && e.message) || "ERROR", core.errRaw(e), 0);
      return ok({ ok: false, error: info.title, hint: info.hint });
    });
  }
  function storeRoute(method, p, body) {
    body = body || {};
    if (method === "GET" && p === "/api/store/info") return store.info().then(ok);
    if (method === "GET" && p === "/api/store/index") return store.index().then(ok);
    if (method === "GET" && p.indexOf("/api/store/record/") === 0) {
      var id = decodeURIComponent(p.slice("/api/store/record/".length));
      return store.record(id).then(function (r) {
        return r ? ok(r) : bad(404, { error: "NOT_FOUND" });
      });
    }
    if (p === "/api/store/save") {
      var rec = body.record;
      if (!rec || !rec.id) return Promise.resolve(bad(400, { error: "no record" }));
      return store.save({ record: rec, thumb: body.thumb !== undefined ? body.thumb : null }).then(function (r) {
        return r.ok ? ok({ ok: true, id: r.id, dir: r.dir }) : bad(400, { error: r.error || "SAVE_FAIL" });
      });
    }
    if (p === "/api/store/meta") {
      return store.patchMeta({ id: body.id, meta: body.meta || {} }).then(function (r) {
        if (r.ok) return ok({ ok: true, meta: r.meta });
        return r.error === "NOT_FOUND" ? bad(404, { error: "NOT_FOUND" }) : bad(400, { error: r.error || "BAD_ID" });
      });
    }
    if (p === "/api/store/delete") {
      return store.remove(body.id).then(function (r) {
        return r.ok ? ok({ ok: true }) : bad(400, { error: r.error || "BAD_ID" });
      });
    }
    if (p === "/api/store/purge") {
      return store.purge().then(function (r) { return ok({ ok: true, removed: r.removed }); });
    }
    if (p === "/api/store/migrate") {
      var arr = Array.isArray(body.records) ? body.records : [];
      var n = 0;
      return arr.reduce(function (chain, item) {
        return chain.then(function () {
          var r = item && item.record ? item.record : item;
          var thumb = (item && item.thumb) || null;
          if (!r || !r.id) return null;
          return store.save({ record: r, thumb: thumb }).then(function (x) { if (x.ok) n++; }).catch(function () {});
        });
      }, Promise.resolve()).then(function () {
        return ok({ ok: true, imported: n, dir: (store._paths && store._paths.dir) || "Hegy" });
      });
    }
    // 换目录 / 打开目录 / 选目录：桌面专属，手机上没有这个概念
    if (p === "/api/store/dir" || p === "/api/store/open" || p === "/api/store/pick") {
      return Promise.resolve(ok({ error: "NOT_SUPPORTED", message: "手机上不支持换目录" }));
    }
    return Promise.resolve(bad(404, { error: "NO_ROUTE" }));
  }
  function cfgRoute(method, body) {
    if (method === "GET") return cfgMod.getConfig().then(function (c) { return ok({ config: c }); });
    var c = (body && body.config) || null;
    return cfgMod.save(c).then(function (okv) {
      return okv ? ok({ ok: true }) : bad(500, { error: "WRITE_FAIL" });
    });
  }
  function statusRoute() {
    return cfgMod.getConfig().then(function (c) { return ok({ configured: !!c }); });
  }

  function route(method, rawPath, body) {
    var p = String(rawPath || "");
    if (p.indexOf("http://") === 0 || p.indexOf("https://") === 0) {
      var m = p.match(/^[a-z]+:\/\/[^/]+(\/.*)$/i);
      p = m ? m[1] : p;
    }
    var qs = "";
    var qi = p.indexOf("?");
    if (qi >= 0) { qs = p.slice(qi + 1); p = p.slice(0, qi); }
    method = String(method || "GET").toUpperCase();

    if (method === "POST" && p === "/api/solve") return Promise.resolve(solve(body));
    if (method === "POST" && p === "/api/refine") return Promise.resolve(refine(body));
    if (method === "POST" && p === "/api/chat") return Promise.resolve(chat(body));
    if (method === "POST" && p === "/api/models") return modelsRoute(body);
    if (method === "GET" && p === "/api/tasks") return Promise.resolve(listTasks());
    if (p === "/api/logs") return Promise.resolve(logsRoute("GET", qs));
    if (p === "/api/logs/clear") return Promise.resolve(logsRoute(method === "POST" ? "POST" : "GET", qs));
    if (p.indexOf("/api/task/") === 0) return Promise.resolve(taskRoute(method, p, body));
    if (p.indexOf("/api/store/") === 0) return storeRoute(method, p, body);
    if (p === "/api/cfg") return cfgRoute(method, body);
    if (p === "/api/status") return statusRoute();
    return Promise.resolve(bad(404, { error: "NO_ROUTE" }));
  }

  // ---------------- 对外 ----------------
  function handle(method, path, body) {
    return init().then(function () {
      return route(method, path, body);
    }).catch(function (e) {
      return { status: 500, json: { error: String((e && e.message) || e) } };
    });
  }
  // 订阅任务快照：语义与 serve.js 的 SSE 一致——首帧立刻一次、running 时持续、终态后结束。
  // 返回 Promise<unsub>（boot.js 的 LocalES 依赖这个约定）。
  function subscribe(id, fn) {
    return init().then(function () {
      var t = TASKS.get(String(id));
      if (!t) throw new Error("NO_TASK");
      var sub = function (snap) { try { fn(snap); } catch (e) {} };
      if (t.status === "running") t.subs.add(sub);
      sub(snapshot(t, t.status !== "running"));
      return function () { t.subs.delete(sub); };
    });
  }

  // 原题卡兜底：历史记录里可能有旧版本留下的乱码题文，渲染前再清洗一次。
  // core 还没初始化时（首页还没发过请求）返回原文，不影响启动。
  function cleanText(s) {
    if (core && core.cleanQuestionText) return core.cleanQuestionText(s);
    return String(s == null ? "" : s);
  }
  return { handle: handle, subscribe: subscribe, init: init, cleanText: cleanText };
});
