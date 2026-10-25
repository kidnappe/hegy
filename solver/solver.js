(function () {
  var $ = function (id) { return document.getElementById(id); };
  var LS_KEY = "solver_cfg_v1";

  // 确认框：手机端走 layers.js 的 Material 对话框；桌面端回退原生 confirm。
  function hjConfirm(opts) {
    if (window.HJDialog && window.HJDialog.confirm) return window.HJDialog.confirm(opts);
    var text = (opts && (opts.native || opts.message || opts.title)) || "";
    return Promise.resolve(window.confirm(text));
  }

  function escHtml(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function mathHTML(text) {
    // ① 先把字面量 "\n"（反斜杠 + n，模型偶尔用双转义写换行）还原成真换行。
    //    但绝不能在 $...$ 公式里动手：`\neq`、`\notin`、`\nu` 都是以 "\n" 开头的 LaTeX 命令，
    //    直接 replace(/\\n/g) 会把 `\overrightarrow{BM}\cdot\vec n=\lambda-1-\lambda=-1\neq0`
    //    劈成两半（`\vec` / `\neq` 被截断），KaTeX 报 "Unexpected end of input in a macro argument"。
    //    做法：把 $...$ / $$...$$ / \[...\] / \(...\) 切成独立的「公式段」，只对非公式段做替换。
    var s = String(text == null ? "" : text);
    s = s.split(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/).map(function (seg, i) {
      return (i % 2 === 1) ? seg : seg.replace(/\\n/g, "\n");
    }).join("");
    if (!window.katex || !window.katex.renderToString) return escHtml(s);
    var store = [];
    function stash(expr, display) {
      var html;
      try {
        html = window.katex.renderToString(expr, { displayMode: display, throwOnError: false });
      } catch (e) {
        html = escHtml(display ? "$$" + expr + "$$" : "$" + expr + "$");
      }
      // ① 去掉 KaTeX 屏幕阅读用的 MathML 层：
      //    它在中文混排里会溢出 1px 盒子并上浮，把「公式与后面中文」拆成两行。
      //    我们这里是给正常视力用户看的，视觉层足够，MathML 层只会捣乱。
      html = String(html).replace(/<span class="katex-mathml">[\s\S]*?<\/span>/g, "");
      // ② 压平格式用的换行/缩进（外层是 white-space:pre-wrap，会当成真实换行）
      html = html.replace(/\r?\n\s*/g, "").replace(/>\s+</g, "><");
      // ③ 行内公式整块包裹：窄屏下 KaTeX 会在运算符处断行（如 ∠DFE=½(∠C− / ∠B)），
      //    包成 inline-block 后整块换行；实在放不下时在块内横向滚动。
      //    （独立公式块 .katex-display 不动；应用内无 .katex-holder 样式，不受影响）
      if (!display) html = '<span class="katex-holder">' + html + "</span>";
      store.push(html);
      return "\u0000" + (store.length - 1) + "\u0000";
    }
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, function (m, e) { return stash(e.trim(), true); });
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, function (m, e) { return stash(e.trim(), true); });
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, function (m, e) { return stash(e.trim(), false); });
    s = s.replace(/\$([^$\n]+?)\$/g, function (m, e) { return stash(e.trim(), false); });
    // ⑤ 兜底：模型偶尔完全不写分隔符，直接把 LaTeX 混在正文里（如「h=\sqrt{3}」「AP^2=AO^2+OP^2」）。
    //    在已有公式占位符之外，把带 LaTeX 特征的连续片段直接交给 KaTeX 渲染（补 $ 分隔符的动作在这一步完成）
    //    （真正的修复在 prompt.txt：要求所有数学内容都用 $...$ 包裹；这里只是容错）
    var BARE_CH = /[A-Za-z0-9\\{}^_=+\-*/<>.,()[\]|'′°]/; // 公式片段内允许出现的字符
    var BARE_SIG = /\\[a-zA-Z]{2,}|[A-Za-z)\]}][\^_]\{?[0-9A-Za-z{\\]/;   // 判定「这里像公式」的信号（要求 ^ / _ 前面是字母或括号，避免误伤文件名 r1792_853）
    function markBare(seg) {
      var out = "", i = 0;
      while (i < seg.length) {
        var m = BARE_SIG.exec(seg.slice(i));
        if (!m) { out += seg.slice(i); break; }
        var at = i + m.index, a = at, b = at;
        while (a > 0 && BARE_CH.test(seg[a - 1])) a--;
        while (b < seg.length && BARE_CH.test(seg[b])) b++;
        var run = seg.slice(a, b);
        if (run.length < 3 || !BARE_SIG.test(run)) { out += seg.slice(i, at + 1); i = at + 1; continue; }
        out += seg.slice(i, a) + stash(run.trim(), false);
        i = b;
      }
      return out;
    }
    s = s.replace(/\u0000\d+\u0000|[^\u0000]+/g, function (chunk) {
      return chunk.charCodeAt(0) === 0 ? chunk : markBare(chunk);
    });
    s = escHtml(s);
    // 模型偶尔会在关键结论两侧写 **加粗**（尤其追问流式输出）。
    // 转义后再处理，只认成对的 **，不会影响 $公式$（公式此时是 \u0000N\u0000 占位符）。
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return store[Number(i)]; });
    // 换行统一转 <br>：容器不再使用 white-space:pre-wrap
    // （pre-wrap 会让 KaTeX 的 min-content 宽度计算把公式字符当成换行点，
    //   导致公式末尾的 ")" 被挤到下一行）
    s = s.replace(/\r\n|\r|\n/g, "<br>");
    return s;
  }
  window.mathHTML = mathHTML;

  // ================= 解析分块（多小问 / 选择题按块区分） =================
  // 应用内与导出页共用：只会用到 escHtml / mathHTML，导出时整段 toString() 内联。
  function anaSplit(text) {
    var t = String(text == null ? "" : text), lines = t.split(/\n/), marks = [];
    var LINE_MARK = /^\s*(?:[（(]([A-Ha-h])[）)]|[（(](\d{1,2})[）)]|([A-Ha-h])\s*[．.、:：)）])\s*/;
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(LINE_MARK);
      // 数字标记只认「带括号」的形式（（1）/(1)）：写成 "1) …" 的通常是解题步骤，不当小问切
      if (m) {
        var raw = String(m[1] || m[2] || m[3] || "").toUpperCase();
        // 数字标记显示成 (1)/(2)（与 subQuestions.label 一致），字母标记就是 A/B/C/D
        marks.push({ i: i, raw: raw, tag: /^\d+$/.test(raw) ? "(" + raw + ")" : raw });
      }
    }
    function valid(list, kind) {
      if (list.length < 2) return false;
      if (list[0].raw !== (kind === "letter" ? "A" : "1")) return false;
      for (var j = 1; j < list.length; j++) {
        var a = list[j - 1].raw, b = list[j].raw;
        if (kind === "letter") {
          if (!/^[A-H]$/.test(b) || b.charCodeAt(0) <= a.charCodeAt(0)) return false;
        } else {
          if (!/^\d{1,2}$/.test(b) || Number(b) <= Number(a)) return false;
        }
      }
      return true;
    }
    var letters = marks.filter(function (x) { return x.raw.length === 1 && x.raw >= "A" && x.raw <= "H"; });
    var nums = marks.filter(function (x) { return /^\d{1,2}$/.test(x.raw); });
    var use = null;
    if (valid(letters, "letter")) { use = letters; }
    else if (valid(nums, "num")) { use = nums; }
    if (!use) return null;
    var blocks = [];
    for (var k = 0; k < use.length; k++) {
      var from = use[k].i, to = (k + 1 < use.length) ? use[k + 1].i : lines.length;
      var body = lines.slice(from, to).join("\n").replace(LINE_MARK, "").trim();
      if (!body) return null;
      blocks.push({ tag: use[k].tag, text: body });
    }
    if (blocks.length < 2) return null;
    // 2026-10-20：第一个小问标记之前的「共同准备 / 总述」也要保留。
    // 只挂在数组上，不改变 anaSplit 的返回类型（scopeItems 仍按数组用）。
    blocks.lead = lines.slice(0, use[0].i).join("\n").trim();
    return blocks;
  }
  // 解析渲染：多小问优先用 subQuestions 的结构化数据，其次识别文本里的「A.」「(1)」标记
  // 2026-10-20（HANDOVER §51 第 3 条）：多小问时，若顶层解析自己已经按小问分了段（行首有「（1）」「A．」这类标记），
  // 就只渲染顶层这一份。否则「全部」视图会把同一份解答读两遍 —— 实测小问解析有 73~82% 的内容
  // 已经在顶层出现过，用户实际要读的字数是两份之和（最典型：02:20 那条顶层 2698 字 + 小问 376 字）。
  // 兜底：顶层只是「概述」时（比各小问加起来还短，或压根没分段），仍按「总述 + 各问」拼，避免丢推导。
  function anaHTML(text, subs) {
    var t = String(text == null ? "" : text).trim();
    var self = anaSplit(t);
    var list = (subs || []).map(function (s) {
      return { tag: String((s && s.label) || "").replace(/[^\dA-Ha-h（()）]/g, "") || "", text: String((s && s.analysis) || "").trim() };
    }).filter(function (b) { return b.text; });
    var subLen = 0;
    for (var q = 0; q < list.length; q++) subLen += list[q].text.length;
    var blocks = null;
    if (self && self.length >= 2 && t.length >= subLen) {
      blocks = self;                                  // 顶层已分段且不比小问短：它本身就是完整解答，只渲染它
    } else if (list.length >= 2) {
      blocks = list;
      if (t) blocks.unshift({ tag: "", text: t, lead: true });   // 总述 + 各小问
    } else if (self && self.length >= 2) {
      blocks = self;
    }
    // 2026-10-20：SELF 分支只包含 (1)(2)(3) 各块，会丢掉第一个标记之前的
    // 「共同准备 / 总述」。把它作为灰色 lead 块补回，避免默认「全部」视图缺推导。
    if (self && blocks === self && self.lead) {
      blocks = [{ tag: "", text: self.lead, lead: true }].concat(self);
    }
    if (!blocks || blocks.length < 2) return mathHTML(text || "");
    var out = '<div class="ana-blks">', ci = 0;
    blocks.forEach(function (b) {
      var k = b.lead ? "lead" : String(ci % 4);
      if (!b.lead) ci++;
      out += '<div class="ana-blk' + (b.lead ? " lead" : "") + '" data-k="' + k + '">' +
        (b.tag ? '<span class="ana-tag">' + escHtml(b.tag) + "</span>" : "") +
        '<div class="ana-tx">' + mathHTML(b.text) + "</div></div>";
    });
    return out + "</div>";
  }
  window.anaHTML = anaHTML;

  // 「全部」视图的答案：有小问就按 (1)(2)(3) 分块显示，点某块可直接跳到该问。
  // 之前直接渲染顶层 answer（模型常写成「（1）…；（2）…」一整行），看上去没有分问。
  function ansAllHTML(r) {
    var subs = (r && r.subQuestions) || [];
    // 小问答案基本是空的（模型只写了顶层）→ 退回顶层答案，别把内容弄丢
    var filled = 0;
    for (var q = 0; q < subs.length; q++) if (String((subs[q] && subs[q].answer) || "").trim()) filled++;
    if (subs.length >= 2 && filled >= Math.ceil(subs.length / 2)) {
      var out = '<div class="ana-blks ans-blks">';
      // 顶层 answer 若是「（1）…（2）…」这种拼接，就和小问块重复，不再显示；
      // 若是一句总述（如「关键结论：∠DFE=10°」），作为灰色 lead 块保留。
      var lead = String((r && r.answer) || "").trim();
      var dup = /[（(]\s*1\s*[）)][\s\S]*[（(]\s*2\s*[）)]/.test(lead) || /^\s*[（(]\s*1\s*[）)]/.test(lead);
      if (lead && !dup) out += '<div class="ana-blk lead"><div class="ana-tx">' + mathHTML(lead) + "</div></div>";
      subs.forEach(function (s, i) {
        var lb = String((s && s.label) || ("(" + (i + 1) + ")")).trim();
        out += '<div class="ana-blk ans-blk" data-k="' + (i % 4) + '" data-sub="' + i + '" role="button" tabindex="0" title="点这里只看第' + escHtml(lb) + '问">' +
          '<span class="ana-tag">' + escHtml(lb) + "</span>" +
          '<div class="ana-tx">' + mathHTML((s && s.answer) || "本问未给答案") + "</div></div>";
      });
      return out + "</div>";
    }
    var t = String((r && r.answer) || "").trim();
    return mathHTML(t || "模型未给答案");
  }

  var PRESETS = [
    { name: "— 选择预设 —", base: "", hint: "" },
    { name: "DeepSeek", base: "https://api.deepseek.com/v1", hint: "deepseek-flash" },
    { name: "OpenAI", base: "https://api.openai.com/v1", hint: "gpt-4o-mini" },
    { name: "Kimi (Moonshot)", base: "https://api.moonshot.cn/v1", hint: "moonshot-v1-8k" },
    { name: "通义千问 (DashScope)", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", hint: "qwen-plus" },
    { name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", hint: "glm-4-flash" },
    { name: "Groq (免费)", base: "https://api.groq.com/openai/v1", hint: "llama-3.3-70b-versatile" },
    { name: "OpenRouter", base: "https://openrouter.ai/api/v1", hint: "deepseek/deepseek-chat" },
    { name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", hint: "gemini-2.0-flash" },
    { name: "Ollama 本地", base: "http://127.0.0.1:11434/v1", hint: "qwen2.5:7b" },
    { name: "自定义", base: "", hint: "" }
  ];

  var modelOptions = [];

  // 内置参考价表（每百万 token 输入/输出，用于未填单价时的资费估算）
  // 更新于 2026-10-18，来源（官方定价页）：
  //   DeepSeek api-docs.deepseek.com（空闲时段·缓存未命中价，高峰×2，缓存命中更低）
  //   OpenAI openai.com/api/pricing
  //   阿里云百炼 help.aliyun.com/zh/model-studio/model-pricing（华北2北京，非思考模式）
  //   智谱 bigmodel.cn/pricing
  //   Kimi platform.moonshot.cn/docs/pricing
  //   Google ai.google.dev/gemini-api/docs/pricing
  //   Groq console.groq.com/docs/models
  // 注：实际账单还受缓存命中、批处理、地域、限时折扣影响，仅供估算。
  var PRICES = [
    ["deepseek-flash", 1, 4, "¥"],
    ["deepseek-v4-flash", 1, 4, "¥"],
    ["deepseek-v4-pro", 4.5, 13.5, "¥"],
    ["deepseek-chat", 1, 4, "¥"],
    ["deepseek-reasoner", 1, 4, "¥"],
    ["gpt-5-mini", 0.25, 2, "$"],
    ["gpt-4o-mini", 0.15, 0.6, "$"],
    ["gpt-4.1-mini", 0.4, 1.6, "$"],
    ["gpt-5.2", 1.75, 14, "$"],
    ["gpt-4.1", 2, 8, "$"],
    ["gpt-4o", 2.5, 10, "$"],
    ["qwen3.8-max", 12, 36, "¥"],
    ["qwen3.7-max", 12, 36, "¥"],
    ["qwen3.7-plus", 2, 8, "¥"],
    ["qwen-max", 2.4, 9.6, "¥"],
    ["qwen-plus", 0.8, 2, "¥"],
    ["qwen-turbo", 0.3, 0.6, "¥"],
    ["glm-5.3-flash", 0.8, 2.8, "¥"],
    ["glm-5.3", 8, 28, "¥"],
    ["glm-4.7-flash", 0, 0, "¥"],
    ["glm-4-flash", 0, 0, "¥"],
    ["kimi-k3", 20, 100, "¥"],
    ["kimi-k2.7-code", 6.5, 27, "¥"],
    ["kimi-k2.6", 6.5, 27, "¥"],
    ["moonshot", 12, 12, "¥"],
    ["kimi", 12, 12, "¥"],
    ["gemini-3.8-flash", 0.75, 3.75, "$"],
    ["gemini-3.1-flash-lite", 0.25, 1.5, "$"],
    ["gemini-3.1-pro", 2, 12, "$"],
    ["gemini-3-flash", 0.5, 3, "$"],
    ["gemini-2.5-flash", 0.3, 2.5, "$"],
    ["llama-3.3-70b-versatile", 0.59, 0.79, "$"],
    ["gpt-oss-120b", 0.15, 0.6, "$"]
  ];
  function priceFor(model, cfg) {
    if (cfg && cfg.priceIn != null && cfg.priceOut != null) return { in: cfg.priceIn, out: cfg.priceOut, cur: cfg.currency || "$" };
    var m = String(model || "").toLowerCase();
    for (var i = 0; i < PRICES.length; i++) if (m.indexOf(PRICES[i][0]) >= 0) return { in: PRICES[i][1], out: PRICES[i][2], cur: PRICES[i][3] };
    return null;
  }
  function fmtMoney(v, cur) {
    var s = v < 0.01 ? v.toFixed(4) : v.toFixed(3);
    return cur + s;
  }
  function setMeta(elapsedMs, usage, model, cfg) {
    var el = $("meta");
    var parts = [];
    if (elapsedMs != null) parts.push("<b>耗时</b> " + (elapsedMs / 1000).toFixed(1) + " s");
    if (usage) {
      var pt = usage.prompt_tokens, ct = usage.completion_tokens, tt = usage.total_tokens;
      parts.push("<b>token</b> " + (tt != null ? tt : "?") + (pt != null ? "，入 " + pt + " / 出 " + ct : "") + (usage.estimated ? " ~估" : ""));
      var p = priceFor(model, cfg);
      if (p && pt != null && ct != null) {
        var cost = (pt / 1e6) * p.in + (ct / 1e6) * p.out;
        parts.push("<b>资费</b> 约 " + fmtMoney(cost, p.cur));
      } else {
        parts.push("<b>资费</b> —");
      }
    }
    if (!parts.length) { el.style.display = "none"; el.innerHTML = ""; return ""; }
    el.style.display = "block"; el.innerHTML = parts.join(" · ");
    return parts.join(" · ").replace(/<[^>]+>/g, "");
  }
  function costText(usage, model, cfg) {
    if (!usage || usage.prompt_tokens == null) return "";
    var p = priceFor(model, cfg);
    if (!p) return "";
    var cost = (usage.prompt_tokens / 1e6) * p.in + (usage.completion_tokens / 1e6) * p.out;
    return "约 " + fmtMoney(cost, p.cur) + (usage.estimated ? "~" : "");
  }

  // 模型配置：优先存到 ~/.hegy/settings.json（与 exe 位置解耦），localStorage 作为运行时缓存/兜底
  var cfgCache = null;
  function loadCfg() {
    if (cfgCache) return cfgCache;
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "null") || null; } catch (e) { return null; }
  }
  function saveCfg(c) {
    cfgCache = c || null;
    try { if (c) localStorage.setItem(LS_KEY, JSON.stringify(c)); else localStorage.removeItem(LS_KEY); } catch (e) {}
    // 异步写回磁盘配置
    storePost("/api/cfg", { config: c || null }, function (j) {
      if (j && j.error) {
        var s = $("status");
        if (s) s.textContent = "配置已在本机生效，但写入配置文件失败";
      }
    });
    refreshStatus();
  }
  // 启动时把磁盘配置读进内存（磁盘为准；磁盘为空则把本地旧配置迁过去）
  function initCfg(done) {
    storeGet("/api/cfg", function (j) {
      var disk = (j && j.config) || null;
      var local = null;
      try { local = JSON.parse(localStorage.getItem(LS_KEY) || "null") || null; } catch (e) {}
      if (disk && disk.baseUrl && disk.apiKey) {
        cfgCache = disk;
        try { localStorage.setItem(LS_KEY, JSON.stringify(disk)); } catch (e) {}
      } else if (local && local.baseUrl && local.apiKey) {
        // 磁盘没有、本地有 → 迁移一次
        cfgCache = local;
        storePost("/api/cfg", { config: local }, function () {});
      } else {
        cfgCache = disk || local || null;
      }
      refreshStatus();
      if (done) done();
    });
  }
  function refreshStatus() {
    var c = loadCfg();
    var on = !!(c && c.baseUrl && c.apiKey && c.model);
    // 指示点现在挂在左边的「模型」chip 上
    var chip = $("cfg");
    if (chip) {
      var dot = chip.querySelector(".dot");
      if (dot) dot.className = "dot" + (on ? " on" : "");
      var t = chip.querySelector(".chip-t");
      if (t) t.textContent = on ? (c.model + " · 已配置") : "未配置模型";
      chip.title = on ? ("当前模型：" + c.model + "，点击修改") : "点击配置模型";
      chip.classList.toggle("on", on);
    }
    // 设置弹窗里「模型配置」条目的摘要
    var sum = $("accModelSum");
    if (sum) sum.textContent = on ? (c.model || "已配置") : "未配置";
  }

  var menu = $("modelMenu");
  function renderMenu(filter) {
    var q = filter ? $("fModel").value.trim().toLowerCase() : "";
    var list = modelOptions.filter(function (m) { return !q || m.toLowerCase().indexOf(q) >= 0; });
    menu.innerHTML = "";
    if (!list.length) {
      var e = document.createElement("div"); e.className = "empty";
      e.textContent = modelOptions.length ? "无匹配模型" : "点上方“获取列表”从接口拉取模型，或手动输入模型名";
      menu.appendChild(e);
    } else {
      list.forEach(function (m) {
        var d = document.createElement("div"); d.className = "item"; d.textContent = m;
        d.onmousedown = function (ev) { ev.preventDefault(); $("fModel").value = m; hideMenu(); };
        menu.appendChild(d);
      });
    }
    menu.classList.add("show");
  }
  function showMenu(filter) { renderMenu(filter); }
  function hideMenu() { menu.classList.remove("show"); }
  $("fModel").addEventListener("focus", function () { showMenu(false); });
  $("fModel").addEventListener("input", function () { showMenu(true); });
  $("fModel").addEventListener("keydown", function (e) { if (e.key === "Escape") hideMenu(); });
  $("btnCaret").onclick = function () { if (menu.classList.contains("show")) hideMenu(); else showMenu(false); $("fModel").focus(); };
  document.addEventListener("mousedown", function (e) {
    if (!$("fModel").contains(e.target) && !menu.contains(e.target) && e.target !== $("btnCaret")) hideMenu();
  });
  function setModelOptions(ids) { modelOptions = ids.slice(); }

  var presetSel = $("fPreset");
  PRESETS.forEach(function (p, i) { var o = document.createElement("option"); o.value = String(i); o.textContent = p.name; presetSel.appendChild(o); });
  presetSel.onchange = function () {
    var p = PRESETS[Number(presetSel.value)];
    if (!p) return;
    if (p.base) $("fBase").value = p.base;
    $("fModel").value = "";
    $("fModel").placeholder = p.hint || "点“获取列表”，或手动输入模型名";
    setModelOptions([]);
    hideMenu();
    $("cfgMsg").className = "msg"; $("cfgMsg").textContent = p.base ? "已填入接口地址，点“获取列表”拉取该服务商的真实模型" : "";
  };

  // which: "model" = 只展开模型配置；"all" = 两条都展开
  function openModal(which) {
    var c = loadCfg() || {};
    $("fBase").value = c.baseUrl || "";
    $("fKey").value = c.apiKey || "";
    $("fModel").value = c.model || "";
    $("fTemp").value = c.temperature != null ? c.temperature : 0.2;
    $("fPin").value = c.priceIn != null ? c.priceIn : "";
    $("fPout").value = c.priceOut != null ? c.priceOut : "";
    $("fCur").value = c.currency || "";
    modelOptions = c.model ? [c.model] : [];
    var idx = -1;
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].base && PRESETS[i].base === c.baseUrl) idx = i;
    presetSel.value = String(idx >= 0 ? idx : 0);
    $("fModel").placeholder = (idx >= 0 && PRESETS[idx].hint) ? PRESETS[idx].hint : "点“获取列表”，或手动输入模型名";
    $("cfgMsg").textContent = ""; $("cfgDetail").textContent = ""; hideMenu();
    histDirLoad();
    applyAcc(which === "all" ? "all" : "model");
    $("cfgModal").classList.add("show");
    if (which === "all") { try { $("cfgModal").querySelector(".modal").scrollTop = 0; } catch (e) {} }
  }
  // 设置条目展开策略：model = 只展开模型配置；all = 两条都展开
  function applyAcc(mode) {
    var m = document.querySelector('#cfgModal .acc[data-acc=model]');
    var s = document.querySelector('#cfgModal .acc[data-acc=store]');
    if (!m || !s) return;
    if (mode === "all") { m.classList.add("open"); s.classList.add("open"); }
    else { m.classList.add("open"); s.classList.remove("open"); }
    syncAccFoot();
  }
  // 「测试连接」只跟模型配置有关，模型条目收起时隐藏
  function syncAccFoot() {
    var m = document.querySelector('#cfgModal .acc[data-acc=model]');
    var t = $("btnTest");
    if (m && t) t.style.display = m.classList.contains("open") ? "" : "none";
  }
  function closeModal() { hideMenu(); $("cfgModal").classList.remove("show"); }
  function collect() {
    var pin = $("fPin").value.trim(), pout = $("fPout").value.trim();
    return {
      baseUrl: $("fBase").value.trim(), apiKey: $("fKey").value.trim(), model: $("fModel").value.trim(),
      temperature: Number($("fTemp").value) || 0.2,
      priceIn: pin === "" ? null : Number(pin), priceOut: pout === "" ? null : Number(pout),
      currency: $("fCur").value.trim() || null
    };
  }

  // 「设置」进入：两条都展开
  $("btnCfg").onclick = function () { openModal("all"); };
  // 左上角「未配置模型 / 模型名」进入：只展开模型配置，记录折叠
  var cfgChip = $("cfg");
  if (cfgChip) cfgChip.onclick = function () { openModal("model"); };
  $("btnClose").onclick = closeModal;
  var btnCfgClose = $("btnCfgClose");
  if (btnCfgClose) btnCfgClose.onclick = closeModal;
  $("cfgModal").addEventListener("click", function (e) { if (e.target === $("cfgModal")) closeModal(); });

  // 设置项：条目式折叠
  (function initAcc() {
    var secs = document.querySelectorAll("#cfgModal .acc");
    Array.prototype.forEach.call(secs, function (sec) {
      var h = sec.querySelector(".acc-h");
      if (!h) return;
      h.addEventListener("click", function () { sec.classList.toggle("open"); syncAccFoot(); });
    });
  })();

  // ================= 皮肤（「外观」条目；口径见 SKIN-SYSTEM.md） =================
  // 预览卡的色板来自 HJSkin.SKINS（皮肤数据），切换只走 HJSkin.set：
  // 改 <html data-skin> + 派发 hj:skin，画布跟随见 applyCanvasSkin()。
  (function initSkin() {
    var grid = $("skinGrid");
    if (!grid || !window.HJSkin) return;
    HJSkin.SKINS.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "skin-card";
      b.setAttribute("data-skin", s.key);
      var sw = s.swatch || {};
      b.innerHTML =
        '<span class="skin-prev" style="background:' + (sw.bg || "#fff") + '">' +
          '<i style="background:' + (sw.panel || "#fff") + '"></i>' +
          '<i style="background:' + (sw.line || "#ddd") + '"></i>' +
          '<i style="background:#5b5bd6"></i>' +
        '</span>' +
        '<span class="skin-name">' + s.name + '</span>' +
        '<span class="skin-desc">' + s.desc + '</span>';
      b.onclick = function () { HJSkin.set(s.key); };
      grid.appendChild(b);
    });
    var reset = $("btnSkinReset");
    if (reset) reset.onclick = function () { HJSkin.set("default"); };
    function sync() {
      var cur = HJSkin.current();
      var sum = $("accSkinSum");
      if (sum) sum.textContent = (HJSkin.SKINS.filter(function (s) { return s.key === cur; })[0] || {}).name || cur;
      Array.prototype.forEach.call(grid.querySelectorAll(".skin-card"), function (c) {
        c.classList.toggle("on", c.getAttribute("data-skin") === cur);
      });
    }
    document.addEventListener("hj:skin", sync);
    sync();
  })();
  $("eye").onclick = function () { var f = $("fKey"); var p = f.type === "password"; f.type = p ? "text" : "password"; $("eye").textContent = p ? "隐藏" : "显示"; };

  function callModels() { return fetch("/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: collect() }) }).then(function (r) { return r.json(); }); }

  $("btnTest").onclick = function () {
    var cfg = collect();
    if (!cfg.baseUrl || !cfg.apiKey) { $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "请先填写接口地址和 Key"; return; }
    var b = $("btnTest"); b.disabled = true; b.textContent = "测试中…";
    $("cfgMsg").className = "msg"; $("cfgMsg").textContent = "正在调用…";
    callModels()
      .then(function (j) {
        if (j.ok) { $("cfgMsg").className = "msg ok"; $("cfgMsg").textContent = "连接成功，可用模型 " + j.models.length + " 个"; if (j.models.length) { setModelOptions(j.models); showMenu(false); } }
        else if (j.error) { $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "失败：" + j.error + (j.hint ? "（" + j.hint + "）" : ""); }
        else { $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "接口无响应"; }
      })
      .catch(function (e) { $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "网络错误：连不上本地服务"; })
      .then(function () { b.disabled = false; b.textContent = "测试连接"; });
  };

  $("btnModels").onclick = function () {
    var cfg = collect();
    if (!cfg.baseUrl || !cfg.apiKey) { $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "请先填写接口地址和 Key"; return; }
    var b = $("btnModels"); b.disabled = true; b.textContent = "获取中…";
    callModels()
      .then(function (j) {
        if (j.ok && j.models.length) { setModelOptions(j.models); showMenu(false); $("cfgMsg").className = "msg ok"; $("cfgMsg").textContent = "已获取 " + j.models.length + " 个模型，从下拉里选"; }
        else { $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = j.error ? ("获取失败：" + j.error + (j.hint ? "（" + j.hint + "）" : "")) : "该接口未返回模型列表，可手动填写模型名"; }
      })
      .catch(function (e) { $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "网络错误：连不上本地服务"; })
      .then(function () { b.disabled = false; b.textContent = "获取列表"; });
  };

  $("btnSave").onclick = function () {
    var cfg = collect();
    if (!cfg.baseUrl) { $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "请填写接口地址"; return; }
    if (!cfg.apiKey) { $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "请填写 API Key"; return; }
    if (!cfg.model) { $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "请填写/选择模型名"; return; }
    saveCfg(cfg);
    closeModal();
  };

  var images = [];
  var imgOriginals = Object.create(null);   // 裁剪后的图 → 原图，支持反复从原图重裁
  var PENDING = null;                       // 拍照/相册暂存图：确认前不进 images
  function rememberImage(src, original) { if (src) imgOriginals[src] = original || src; }
  function originalOf(src) { return imgOriginals[src] || src; }
  function resetImages(list) {
    images = (list || []).slice();
    imgOriginals = Object.create(null);
    images.forEach(function (src) { rememberImage(src, src); });
    PENDING = null;
    renderThumbs();
  }
  function renderThumbs() {
    var t = $("thumbs");
    t.innerHTML = "";
    images.forEach(function (src, i) {
      var d = document.createElement("div"); d.className = "thumb";
      var im = document.createElement("img"); im.src = src; im.title = "点开放大";
      im.onclick = function () { openLightbox(src); };
      d.appendChild(im);
      var c = document.createElement("button"); c.className = "crop"; c.title = "裁剪这张图";
      c.innerHTML = '<svg viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>';
      c.onclick = function (e) { e.stopPropagation(); cropOpen(i); };
      d.appendChild(c);
      var x = document.createElement("button"); x.className = "x"; x.textContent = "×"; x.title = "移除";
      x.onclick = function () { images.splice(i, 1); renderThumbs(); };
      d.appendChild(x); t.appendChild(d);
    });
    syncImgTools();
  }
  // 输入区这一行只在「有题图 / 有进行中的任务」时出现，避免 idle 时多占 8px 间距
  function syncImgTools() {
    var tools = $("imgTools"), pg = $("imgProgress");
    if (!tools) return;
    tools.classList.toggle("idle", !images.length && !(pg && pg.classList.contains("on")));
  }
  function openLightbox(src) { $("lightboxImg").src = src; $("lightbox").classList.add("show"); }
  function closeLightbox() { $("lightbox").classList.remove("show"); $("lightboxImg").src = ""; }
  $("lightbox").onclick = closeLightbox;
  var lbX = $("lbClose");
  if (lbX) lbX.onclick = function (e) { e.stopPropagation(); closeLightbox(); };
  // ================= 图片裁剪：框选区域 → 采纳后才进输入框 =================
  // 拍照/相册先进入 PENDING，只有点 ✓ 才 images.push；点 ✗ / 返回 / 取消都丢弃。
  // 已有缩略图重裁时从原图打开，确认后替换当前图；原图一直保留，可反复重裁。
  // mode：image = 裁剪题目图片（替换/新增）；figure = 只保存「题图区域」，原图不动
  var CROP = { idx: -1, src: "", sel: null, drag: null, token: 0, ready: false, pending: false, busy: false, mode: "image" };
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function cropCopy(s) { return s ? { x: s.x, y: s.y, w: s.w, h: s.h } : null; }
  function cropFullSel() { return { x: 0, y: 0, w: 1, h: 1 }; }
  function cropSelOf(b) {
    if (!b) return cropFullSel();
    var x = clamp01(Number(b.x) || 0), y = clamp01(Number(b.y) || 0);
    var w = Math.max(0, Math.min(clamp01(Number(b.w) || 0), 1 - x));
    var h = Math.max(0, Math.min(clamp01(Number(b.h) || 0), 1 - y));
    if (w < 0.02 || h < 0.02) return cropFullSel();
    return { x: x, y: y, w: w, h: h };
  }
  function cropOpen(idx) {
    if (!images[idx]) return false;
    return cropOpenSrc(originalOf(images[idx]), idx, "edit", { mode: "image" });
  }
  function cropOpenPending() {
    if (!PENDING) return false;
    return cropOpenSrc(PENDING.src, -1, PENDING.from || "shot", { mode: "image" });
  }
  // 手机端原题卡：在整张原图上框出题图区域，只写 figureBox，不替换原图。
  function cropOpenFigure(src, imgIdx, box) {
    if (!src) return false;
    return cropOpenSrc(src, (typeof imgIdx === "number" ? imgIdx : 0), "figure", {
      mode: "figure",
      sel: cropSelOf(box)
    });
  }
  function discardPending() { PENDING = null; }
  function cropOpenSrc(src, idx, from, opts) {
    if (!src) return false;
    opts = opts || {};
    CROP.mode = opts.mode === "figure" ? "figure" : "image";
    CROP.idx = (typeof idx === "number" ? idx : -1);
    CROP.src = src;
    CROP.pending = CROP.mode === "image" && CROP.idx < 0;
    CROP.sel = opts.sel ? cropSelOf(opts.sel) : cropFullSel();
    CROP.drag = null;
    CROP.ready = false;
    CROP.busy = false;
    CROP.token++;
    var mine = CROP.token;
    var im = $("cropImg");
    im.onload = function () {
      if (mine !== CROP.token) return;
      CROP.ready = true;
      setTimeout(function () {
        if (mine !== CROP.token) return;
        cropLayout(); cropDraw(); cropPreview();
      }, 20);
    };
    im.onerror = function () {
      if (mine !== CROP.token) return;
      CROP.ready = false;
      $("cropMsg").textContent = "图片加载失败，请重拍或换一张";
    };
    im.src = src;
    var fig = CROP.mode === "figure";
    var title = $("cropTitle");
    if (title) title.textContent = fig ? "框选题图" : "框选图片";
    var retake = $("cropRetake");
    if (retake) retake.style.display = CROP.pending ? "" : "none";
    var ok = $("cropOk");
    if (ok) ok.textContent = fig ? "✓ 保存题图" : (CROP.pending ? "✓ 用这张" : "✓ 替换");
    var cancel = $("cropCancel");
    if (cancel) cancel.textContent = CROP.pending ? "✗ 不要" : "✗ 取消";
    $("cropSize").textContent = "整张图";
    $("cropMsg").textContent = fig
      ? "拖动边角框住题目里的图形区域，点 ✓ 保存；原图会保留"
      : (CROP.pending
        ? "拖动边角调整题目区域，点 ✓ 采纳，✗ 放弃"
        : "拖动边角调整，点 ✓ 替换当前图片");
    $("cropModal").classList.add("show");
    requestAnimationFrame(function () {
      if (mine !== CROP.token) return;
      cropLayout(); cropDraw(); cropPreview();
    });
    return true;
  }
  function cropClose() {
    CROP.token++;
    CROP.drag = null; CROP.ready = false; CROP.busy = false;
    CROP.idx = -1; CROP.src = ""; CROP.sel = null; CROP.pending = false; CROP.mode = "image";
    discardPending();
    var modal = $("cropModal");
    if (modal) modal.classList.remove("show");
    var im = $("cropImg");
    if (im) { try { im.removeAttribute("src"); } catch (e) {} }
    var cv = $("cropPreview");
    if (cv) { try { cv.width = 1; cv.height = 1; } catch (e) {} }
  }
  // 让 #cropFrame 严格等于图片显示区域：选框百分比、手指坐标、预览都按同一块矩形算
  function cropLayout() {
    var stage = $("cropStage"), frame = $("cropFrame"), im = $("cropImg");
    if (!stage || !frame || !im || !CROP.ready) return;
    var nw = im.naturalWidth, nh = im.naturalHeight;
    if (!nw || !nh) return;
    var cs = window.getComputedStyle(stage);
    var aw = stage.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    var ah = stage.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    if (aw < 20 || ah < 20) return;
    var s = Math.min(aw / nw, ah / nh, 3);
    frame.style.width = Math.max(1, Math.round(nw * s)) + "px";
    frame.style.height = Math.max(1, Math.round(nh * s)) + "px";
  }
  function cropDraw() {
    var s = CROP.sel, b = $("cropSel");
    if (!b) return;
    if (!s) { b.style.display = "none"; return; }
    b.style.display = "block";
    b.style.left = (s.x * 100) + "%"; b.style.top = (s.y * 100) + "%";
    b.style.width = (s.w * 100) + "%"; b.style.height = (s.h * 100) + "%";
    cropPreviewSoon();
  }
  var cropPrevRaf = 0;
  function cropPreviewSoon() {
    if (cropPrevRaf) return;
    cropPrevRaf = requestAnimationFrame(function () { cropPrevRaf = 0; cropPreview(); });
  }
  function cropPreview() {
    var im = $("cropImg"), cv = $("cropPreview");
    if (!im || !cv || !CROP.ready) return;
    var nw = im.naturalWidth, nh = im.naturalHeight;
    if (!nw || !nh) return;
    var s = CROP.sel || cropFullSel();
    var sx = Math.max(0, Math.min(nw - 1, Math.round(s.x * nw)));
    var sy = Math.max(0, Math.min(nh - 1, Math.round(s.y * nh)));
    var sw = Math.max(1, Math.min(nw - sx, Math.round(s.w * nw)));
    var sh = Math.max(1, Math.min(nh - sy, Math.round(s.h * nh)));
    var k = Math.min(480 / sw, 190 / sh, 1);
    var cw = Math.max(1, Math.round(sw * k)), ch = Math.max(1, Math.round(sh * k));
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    var ctx = cv.getContext("2d");
    try {
      ctx.clearRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
      ctx.drawImage(im, sx, sy, sw, sh, 0, 0, cw, ch);
    } catch (e) {}
    var whole = s.x <= 0.0005 && s.y <= 0.0005 && s.w >= 0.999 && s.h >= 0.999;
    $("cropSize").textContent = whole
      ? "整张图 · " + nw + "×" + nh
      : sw + " × " + sh + " px · " + Math.round(s.w * 100) + "% × " + Math.round(s.h * 100) + "%";
    $("cropMsg").textContent = (sw < 12 || sh < 12)
      ? "选区太小，再拉大一点"
      : (CROP.mode === "figure"
          ? "拖动边角框住题目里的图形区域，点 ✓ 保存；原图会保留"
          : (CROP.pending ? "拖动边角调整题目区域，点 ✓ 采纳，✗ 放弃"
                          : "拖动边角调整，点 ✓ 替换当前图片"));
  }
  function cropRel(e) {
    var f = $("cropFrame"), r = f.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }
  function cropRect(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }
  (function initCrop() {
    var stage = $("cropStage");
    if (!stage) return;
    stage.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      var p = cropRel(e); if (!p) return;
      var s = CROP.sel;
      var corner = (e.target && e.target.dataset) ? (e.target.dataset.corner || "") : "";
      if (corner) {
        CROP.drag = { mode: "resize", corner: corner, start: p, base: cropCopy(s || cropFullSel()) };
      } else if (s && p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
        CROP.drag = { mode: "move", start: p, base: cropCopy(s) };
      } else {
        CROP.drag = { mode: "new", start: p, prev: cropCopy(s) };
        CROP.sel = { x: p.x, y: p.y, w: 0, h: 0 };
        cropDraw();
      }
      try { stage.setPointerCapture(e.pointerId); } catch (er) {}
      e.preventDefault();
    }, { passive: false });
    stage.addEventListener("pointermove", function (e) {
      var d = CROP.drag; if (!d) return;
      var p = cropRel(e); if (!p) return;
      if (d.mode === "new") {
        CROP.sel = cropRect(d.start, p);
      } else if (d.mode === "move") {
        var dx = p.x - d.start.x, dy = p.y - d.start.y;
        CROP.sel = {
          x: Math.max(0, Math.min(1 - d.base.w, d.base.x + dx)),
          y: Math.max(0, Math.min(1 - d.base.h, d.base.y + dy)),
          w: d.base.w, h: d.base.h
        };
      } else {
        var b = d.base, x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
        if (d.corner.indexOf("w") >= 0) x1 = p.x;
        if (d.corner.indexOf("e") >= 0) x2 = p.x;
        if (d.corner.indexOf("n") >= 0) y1 = p.y;
        if (d.corner.indexOf("s") >= 0) y2 = p.y;
        CROP.sel = cropRect({ x: x1, y: y1 }, { x: x2, y: y2 });
      }
      cropDraw();
      e.preventDefault();
    }, { passive: false });
    function cropEnd() {
      var d = CROP.drag;
      CROP.drag = null;
      if (d && d.mode === "new" && (!CROP.sel || CROP.sel.w < 0.02 || CROP.sel.h < 0.02)) {
        CROP.sel = d.prev || cropFullSel();
      }
      cropDraw();
    }
    ["pointerup", "pointercancel"].forEach(function (ev) { stage.addEventListener(ev, cropEnd); });
    $("cropFull").onclick = function () { CROP.sel = cropFullSel(); cropDraw(); };
    $("cropCancel").onclick = cropClose;
    $("cropClose").onclick = cropClose;
    var retake = $("cropRetake");
    if (retake) retake.onclick = function () {
      var cam = window.HJSystemCamera;
      cropClose();
      if (cam && cam.open) setTimeout(function () { cam.open(); }, 140);
    };
    $("cropOk").onclick = function () {
      if (CROP.busy || !CROP.ready) {
        if (!CROP.ready) $("cropMsg").textContent = "图片还没加载完，稍等一下";
        return;
      }
      var s = CROP.sel || cropFullSel(), im = $("cropImg");
      var nw = im.naturalWidth, nh = im.naturalHeight;
      if (!nw || !nh) { $("cropMsg").textContent = "图片还没加载完，稍等一下"; return; }
      var sx = Math.round(s.x * nw), sy = Math.round(s.y * nh);
      var sw = Math.round(s.w * nw), sh = Math.round(s.h * nh);
      if (sw < 12 || sh < 12) { $("cropMsg").textContent = "框太小了，再拉大一点"; return; }
      var token = CROP.token, idx = CROP.idx, pending = CROP.pending, src = CROP.src;
      var whole = s.x <= 0.0005 && s.y <= 0.0005 && s.w >= 0.999 && s.h >= 0.999;
      // 题图模式：只保存归一化选区，原图（images）一个字都不改，随时可以重新框。
      if (CROP.mode === "figure") {
        if (!last || !last.result) { $("cropMsg").textContent = "当前没有可保存的题目"; return; }
        var nb = {
          x: Math.round(s.x * 1000) / 1000,
          y: Math.round(s.y * 1000) / 1000,
          w: Math.round(s.w * 1000) / 1000,
          h: Math.round(s.h * 1000) / 1000
        };
        if (idx > 0) nb.image = idx;
        last.result.figureBox = nb;
        qFigCache = {};
        if (lastHistoryId) updateHistory({ id: lastHistoryId, figureBox: nb });
        renderQCard(last.result);
        try {
          document.dispatchEvent(new CustomEvent("hj-figure-change", { detail: { box: nb, index: idx } }));
        } catch (e) {}
        $("status").textContent = "已保存题图区域（只影响显示，不改动解答）";
        cropClose();
        return;
      }
      CROP.busy = true;
      function commit(u) {
        CROP.busy = false;
        if (token !== CROP.token || !$("cropModal").classList.contains("show")) return;
        if (!u) { $("cropMsg").textContent = "裁剪失败，换一张图试试"; return; }
        if (pending) {
          images.push(u);
          rememberImage(u, src);
          renderThumbs();
          qWarn("");
          if (window.HJ && HJ.toast) HJ.toast("已加入题目图片，可以继续框选或点「解题」", "ok");
        } else {
          if (!images[idx]) { $("cropMsg").textContent = "这张图已经不在了"; return; }
          images[idx] = u;
          rememberImage(u, src);
          renderThumbs();
          qWarn("");
          if (window.HJ && HJ.toast) HJ.toast("已换成裁剪后的图片，点「解题」用新图重新解", "ok");
        }
        cropClose();
      }
      if (whole) { commit(src); return; }
      var cv = document.createElement("canvas");
      cv.width = sw; cv.height = sh;
      var out = "";
      try {
        cv.getContext("2d").drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
        out = cv.toDataURL("image/png");
      } catch (e) { out = ""; }
      if (!out) { CROP.busy = false; $("cropMsg").textContent = "裁剪失败，换一张图试试"; return; }
      // 跟上传走同一套缩放：太大就压到 IMG_EDGE / IMG_TARGET 以内，别让请求体炸掉
      fitImage(out, commit);
    };
    if (window.ResizeObserver) {
      try { new ResizeObserver(function () { cropLayout(); }).observe(stage); } catch (e) {}
    }
    window.addEventListener("resize", function () {
      if ($("cropModal") && $("cropModal").classList.contains("show")) cropLayout();
    });
  })();

  // Esc：按层级从上到下关闭一个（图片放大 > 日志 > 设置/历史 > 下拉菜单）
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if ($("cropModal") && $("cropModal").classList.contains("show")) { cropClose(); return; }
    if ($("lightbox").classList.contains("show")) { closeLightbox(); return; }
    if ($("logModal") && $("logModal").classList.contains("show")) { closeLog(); return; }
    if ($("aboutModal") && $("aboutModal").classList.contains("show")) { if (window.HJAbout) window.HJAbout.close(); return; }
    if ($("cfgModal") && $("cfgModal").classList.contains("show")) { closeModal(); return; }
    if ($("histModal") && $("histModal").classList.contains("show")) { closeHist(); return; }
  });

  // ================= 解题记录（落盘到磁盘文件夹，条数不限） =================
  var HIST_KEY = "solver_history_v1";      // 旧版浏览器存储，仅用于一次性迁移
  var history = [];                        // 列表用 meta（不含正文，省内存）
  var recCache = {};                       // id -> 完整记录（本次会话加载/保存过的）
  var storeDir = "";

  function storeGet(p, cb) { fetch(p).then(function (r) { return r.json(); }).then(cb).catch(function () { cb(null); }); }
  function storePost(p, body, cb) {
    fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json(); }).then(function (j) { if (cb) cb(j); })
      .catch(function (e) { if (cb) cb({ error: String((e && e.message) || e) }); });
  }
  function fmtTime(ts) { try { return new Date(ts).toLocaleString(); } catch (e) { return ""; } }
  function isMobileUI() { return document.documentElement.classList.contains("m-mobile"); }
  function logHintText(s) {
    s = String(s || "");
    if (!isMobileUI()) return s;
    return s.replace(/点左下角「日志」看详情/g, "到「设置 → 诊断 → 错误日志」看详情")
            .replace(/完整信息见左下角「日志」/g, "完整信息见「设置 → 诊断」");
  }
  function histGroupName(ts) {
    var d = new Date(ts), now = new Date();
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0) return "今天";
    if (diff === 1) return "昨天";
    if (diff > 1 && diff < 7) return "本周";
    return d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月";
  }

  // 列表缩略图：把第一张图缩成小图存进 meta，列表就不用加载大图
  function makeThumb(dataUrl, cb) {
    if (!dataUrl || !/^data:image\//.test(String(dataUrl))) return cb(null);
    try {
      var im = new Image();
      im.onload = function () {
        try {
          var w = 160, h = Math.max(1, Math.round((im.height || 1) * (w / Math.max(1, im.width))));
          var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(im, 0, 0, w, h);
          cb(cv.toDataURL("image/jpeg", 0.6));
        } catch (e) { cb(null); }
      };
      im.onerror = function () { cb(null); };
      im.src = dataUrl;
    } catch (e) { cb(null); }
  }
  function metaOf(rec, thumb) {
    var q = String(rec.question || "");
    return { id: rec.id, ts: rec.ts || Date.now(), question: q.slice(0, 200), qlen: q.length,
      questionText: String(rec.questionText || "").slice(0, 300),
      grade: rec.grade || "", model: rec.model || "", refined: rec.refined || 0,
      verCount: Array.isArray(rec.versions) ? rec.versions.length : 0,
      promptVer: rec.promptVer || "", promptHash: rec.promptHash || "", promptChannel: rec.promptChannel || "",
      elapsedMs: rec.elapsedMs != null ? rec.elapsedMs : null, usage: rec.usage || null, cost: rec.cost || "",
      imgCount: (rec.images || []).length, chatCount: Array.isArray(rec.chat) ? rec.chat.length : 0,
      has3d: !!rec.render3d, hasCode: !!rec.renderCode, thumb: thumb || null };
  }
  function metaById(id) { return history.filter(function (x) { return x.id === id; })[0] || null; }
  function metaApply(rec, thumb) {
    var nm = metaOf(rec, thumb), m = metaById(rec.id);
    if (m) { for (var k in nm) m[k] = nm[k]; return m; }
    history.unshift(nm); return nm;
  }
  function loadHistory() {
    storeGet("/api/store/index", function (j) {
      if (j && j.items) { history = j.items; storeDir = j.dir || ""; } else if (!j) { $("histMsg").textContent = "读取记录文件夹失败，服务未响应"; }
      renderHistory();
      if ($("histSub")) $("histSub").textContent = isMobileUI()
        ? "共 " + history.length + " 条 · 点任意一条回看"
        : "记录保存在：" + (storeDir || "读取中…") + "　—— 条数不限，点任意一条即可回看。保存位置可在「设置」里修改。";
    });
  }
  // 旧版存在浏览器里的记录 → 一次性搬进文件夹（失败则保留，下次再试）
  function migrateOldHistory(done) {
    var old = [];
    try { old = JSON.parse(localStorage.getItem(HIST_KEY) || "[]") || []; } catch (e) { old = []; }
    if (!old.length) return done(0);
    var items = [], i = 0;
    (function next() {
      if (i >= old.length) {
        storePost("/api/store/migrate", { records: items }, function (j) {
          if (j && j.ok) { try { localStorage.removeItem(HIST_KEY); } catch (e) {} done(j.imported || 0); }
          else done(0);
        });
        return;
      }
      var rec = old[i++];
      makeThumb(rec && rec.images && rec.images[0], function (thumb) { items.push({ record: rec, thumb: thumb }); next(); });
    })();
  }
  function addHistory(rec) {
    recCache[rec.id] = rec;
    metaApply(rec, null);
    renderHistory();
    makeThumb(rec.images && rec.images[0], function (thumb) {
      var m = metaById(rec.id);
      if (m) { m.thumb = thumb; if (thumb) renderHistory(); }
      storePost("/api/store/save", { record: rec, thumb: thumb }, function (j) {
        if (j && j.error) $("status").textContent = "记录保存失败：" + (j.message || j.error);
      });
    });
  }
  function recFull(id, cb) {
    if (recCache[id]) return cb(recCache[id]);
    storeGet("/api/store/record/" + encodeURIComponent(id), function (j) {
      if (j && j.id) { recCache[id] = j; cb(j); } else cb(null);
    });
  }

  // ================= 拖入 JSON 导入记录 =================
  // 支持三种形态：单条记录、数组、{records:[...]}（导出/备份包）
  function normalizeImports(raw) {
    var list = [];
    if (!raw) return list;
    if (Array.isArray(raw)) list = raw;
    else if (raw.records && Array.isArray(raw.records)) list = raw.records;
    else if (raw.items && Array.isArray(raw.items)) return []; // 这是索引，不含正文
    else list = [raw];
    return list.filter(function (r) {
      return r && typeof r === "object" && (r.renderCode || r.render3d || r.answer || r.analysis);
    });
  }
  // ================= 拖入「何解」导出的离线 HTML = 还原记录 =================
  // 从页面脚本里取 `var NAME=<JSON>`：按括号/引号配对截取，避免正则啃不动嵌套
  function jsonOnPage(src, name) {
    var key = "var " + name + "=", i = src.indexOf(key);
    if (i < 0) return null;
    var j = i + key.length, raw = null;
    if (src[j] === '"') {
      var esc = false;
      for (var k = j + 1; k < src.length; k++) {
        var c0 = src[k];
        if (esc) { esc = false; continue; }
        if (c0 === "\\") { esc = true; continue; }
        if (c0 === '"') { raw = src.slice(j, k + 1); break; }
      }
    } else if (src[j] === "{" || src[j] === "[") {
      var depth = 0, inStr = false, esc2 = false;
      for (var k2 = j; k2 < src.length; k2++) {
        var c = src[k2];
        if (inStr) {
          if (esc2) { esc2 = false; continue; }
          if (c === "\\") { esc2 = true; continue; }
          if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") { depth--; if (!depth) { raw = src.slice(j, k2 + 1); break; } }
      }
    }
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function isExportHtml(txt) {
    return /var HJ_REC=/.test(txt) || /<title>动态几何 · 解题<\/title>/.test(txt);
  }
  // 导出页页脚的导出时间："由「何解」导出 · 2026/10/19 13:47:58"
  function footTimeOnPage(txt) {
    var m = txt.match(/<p class="foot">([\s\S]*?)<\/p>/);
    if (!m) return 0;
    var d = m[1].replace(/<[^>]+>/g, "").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
    if (!d) return 0;
    var t = new Date(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]).getTime();
    return isNaN(t) ? 0 : t;
  }
  function recordFromExportHtml(txt) {
    if (!isExportHtml(txt)) return null;
    // 新版导出：原始数据（题干/答案/解析源码）都随文件保存，完整还原
    var rec = jsonOnPage(txt, "HJ_REC");
    if (rec && typeof rec === "object" && (rec.answer || rec.analysis || rec.render3d || rec.renderCode)) {
      rec.imported = true;
      if (!rec.ts) rec.ts = footTimeOnPage(txt) || Date.now();
      if (!rec.id) rec.id = "r" + rec.ts + "_" + Math.floor(Math.random() * 1000);
      return rec;
    }
    // 旧版导出：只存了渲染结果 + 图形数据，题干与公式源码没有，尽力还原图形
    var scene = jsonOnPage(txt, "SCENE"), code = jsonOnPage(txt, "RENDERCODE");
    if (!scene && !code) return null;
    var ts = footTimeOnPage(txt) || Date.now();
    var h = 0, seed = String(scene ? JSON.stringify(scene) : code);
    for (var i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0; // 内容指纹：同一文件重复导入不会产生多条
    return {
      id: "r" + ts + "_" + (Math.abs(h) % 1000),
      ts: ts,
      question: "", grade: "", model: "导入（离线导出）", images: [],
      answer: "", analysis: "（该文件由旧版「何解」导出，未保存题干与公式源码，答案与解析请直接打开导出文件查看；本题的图形与交互已完整恢复。）",
      renderCode: code || "", render3d: scene || null, imported: true
    };
  }
  // .json 拖入可能是三种东西：普通记录 JSON、备份包 {records:[…]}、
  // 或记录文件夹里的单文件（第 1 行 meta + 第 2 行 body，见 serve.js 的 packRecord）
  function parseRecordJson(txt) {
    try { return JSON.parse(txt); } catch (e) {}
    var lines = String(txt).split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length >= 2) {
      try {
        var meta = JSON.parse(lines[0]), body = JSON.parse(lines[1]);
        if (meta && body && typeof meta === "object" && typeof body === "object") {
          // 与 serve.js 的 readRecord() 同口径：以 body 为主，补回 id/ts 及 meta 独有字段
          var rec = Object.assign({}, body, { id: meta.id, ts: meta.ts });
          ["question", "grade", "model", "usage", "elapsedMs", "cost", "refined"].forEach(function (k) {
            if (rec[k] == null && meta[k] != null) rec[k] = meta[k];
          });
          return rec;
        }
      } catch (e2) {}
    }
    return null;
  }
  function importRecords(list, done) {
    var ok = 0, skip = 0, i = 0, newestId = null, newestTs = -1;
    (function next() {
      if (i >= list.length) return done(ok, skip, newestId);
      var src = list[i++];
      var r;
      try { r = JSON.parse(JSON.stringify(src)); } catch (e) { skip++; return next(); }
      if (!r || typeof r !== "object") { skip++; return next(); }
      // 补齐字段，避免历史列表/回看异常
      if (!r.id) r.id = "r" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      if (!r.ts) r.ts = Date.now();
      if (r.question == null) r.question = "";
      if (r.questionText == null) r.questionText = "";
      if (!Array.isArray(r.images)) r.images = [];
      if (r.analysis == null) r.analysis = "";
      if (r.answer == null) r.answer = "";
      if (!r.model) r.model = "导入";
      r.imported = true;
      if (r.ts >= newestTs) { newestTs = r.ts; newestId = r.id; }
      // 记录里可能带 base64 图片，先压成缩略图
      makeThumb(r.images && r.images[0], function (thumb) {
        recCache[r.id] = r;
        storePost("/api/store/save", { record: r, thumb: thumb }, function (j) {
          if (j && j.error) skip++; else ok++;
          next();
        });
      });
    })();
  }
  function importFromText(text, name) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { if (window.HJ && HJ.toast) HJ.toast("导入失败：" + (name || "文件") + " 不是有效的 JSON", "bad"); return; }
    var list = normalizeImports(data);
    if (!list.length) { if (window.HJ && HJ.toast) HJ.toast("导入失败：文件里没有可用的解题记录", "bad"); return; }
    if (window.HJ && HJ.toast) HJ.toast("正在导入 " + list.length + " 条记录…");
    importRecords(list, function (ok, skip, newestId) {
      loadHistory();
      setTimeout(function () {
        // 用 toast 回执（状态栏会被 renderResult 覆盖，不能依赖它）
        if (window.HJ && HJ.toast) {
          if (ok) HJ.toast("已导入 " + ok + " 条记录" + (skip ? "，失败 " + skip + " 条" : ""), "ok");
          else HJ.toast("导入失败" + (skip ? "（" + skip + " 条均不合法）" : ""), "bad");
        }
        // 导入完成后自动展示最后一条
        if (ok && history.length) {
          var first = history[0];
          if (first) loadRecord(first);
        }
      }, 350);
    });
  }
  function readFileAsText(file, cb) {
    var fr = new FileReader();
    fr.onload = function () { cb(String(fr.result || "")); };
    fr.onerror = function () { cb(""); };
    fr.readAsText(file, "utf-8");
  }
  // 全局拖入：JSON 文件 = 导入记录；图片 = 加到题目输入
  function initDropImport() {
    var body = document.body, depth = 0;
    var tip = document.createElement("div");
    tip.id = "dropMask";
    tip.innerHTML = '<div class="dm-card"><div class="dm-t">松手即可导入</div><div class="dm-s">支持 JSON 记录文件与「何解」导出的 HTML；图片会加到题目输入框</div></div>';
    body.appendChild(tip);
    function show(on) { tip.classList.toggle("show", !!on); }
    body.addEventListener("dragenter", function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") < 0) return;
      e.preventDefault(); depth++; show(true);
    });
    body.addEventListener("dragover", function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") < 0) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    });
    body.addEventListener("dragleave", function (e) {
      depth = Math.max(0, depth - 1);
      if (!depth) show(false);
    });
    body.addEventListener("drop", function (e) {
      var fs = (e.dataTransfer && e.dataTransfer.files) || [];
      if (!fs.length) return;
      // 题目输入框自己有 drop 处理，这里只在"非输入框"区域接管
      var inQ = e.target && e.target.closest && e.target.closest("#q");
      depth = 0; show(false);
      var jsons = [], htmls = [], imgs = [];
      for (var i = 0; i < fs.length; i++) {
        var f = fs[i];
        if (/\.json$/i.test(f.name) || f.type === "application/json") jsons.push(f);
        else if (/\.html?$/i.test(f.name) || f.type === "text/html") htmls.push(f);
        else if (/^image\//.test(f.type)) imgs.push(f);
      }
      if (!jsons.length && !htmls.length && !imgs.length) return;
      if (jsons.length || htmls.length) e.preventDefault();
      imgs.forEach(function (f) { if (window.SolverDebug && SolverDebug.addImageFile) SolverDebug.addImageFile(f); });
      if (!jsons.length && !htmls.length) return;
      // 逐个读文件、合并后统一导入（.json 直接解析；导出的 .html 提取内嵌记录）
      var files = jsons.map(function (f) { return { f: f, html: false }; })
        .concat(htmls.map(function (f) { return { f: f, html: true }; }));
      var all = [], k = 0, bad = 0;
      (function next() {
        if (k >= files.length) {
          if (!all.length) {
            if (window.HJ && HJ.toast) HJ.toast(bad ? "导入失败：文件无法解析或不是解题记录" : "导入失败：文件里没有可用的解题记录", "bad");
            return;
          }
          importFromText(JSON.stringify(all.length === 1 ? all[0] : { records: [].concat.apply([], all) }));
          return;
        }
        var it = files[k++];
        readFileAsText(it.f, function (txt) {
          if (!txt) { bad++; return next(); }
          try {
            var dd = it.html ? recordFromExportHtml(txt) : parseRecordJson(txt);
            var ls = dd ? normalizeImports(dd) : [];
            if (ls.length) all.push(ls); else bad++;
          } catch (err) { bad++; }
          next();
        });
      })();
    });
  }
  function updateHistory(rec) {
    var id = rec && rec.id; if (!id) return;
    var apply = function (full) {
      if (!full) return;
      Object.keys(rec).forEach(function (k) { full[k] = rec[k]; });
      recCache[id] = full;
      var m = metaApply(full, (metaById(id) || {}).thumb);
      storePost("/api/store/save", { record: full, thumb: (m && m.thumb) || null }, function () {});
      renderHistory();
    };
    if (recCache[id]) apply(recCache[id]); else recFull(id, apply);
  }
  // —— 记录文件夹设置（设置弹窗内） ——
  var histDirCur = "";
  function histDirLoad() {
    storeGet("/api/store/info", function (j) {
      if (!j) return;
      histDirCur = j.dir || "";
      $("fHistDir").value = histDirCur;
      $("histDirMsg").className = "msg";
      $("histDirMsg").textContent = "当前已有 " + (j.count || 0) + " 条记录";
      var sum = $("accStoreSum");
      if (sum) sum.textContent = (j.count || 0) + " 条";
    });
  }
  async function applyHistDir(cb) {
    var want = ($("fHistDir").value || "").trim();
    if (!want || want === histDirCur) return cb(true);
    var migrate = history.length ? await hjConfirm({
      title: "要把现有记录一起搬走吗？",
      message: "新文件夹会接管 " + history.length + " 条记录。取消则只换位置，老记录留在原文件夹。",
      okText: "一起搬",
      cancelText: "只换位置"
    }) : false;
    storePost("/api/store/dir", { dir: want, migrate: migrate }, function (j) {
      if (j && j.ok) {
        histDirCur = j.dir; storeDir = j.dir; $("fHistDir").value = j.dir;
        $("histDirMsg").className = "msg ok";
        $("histDirMsg").textContent = "已切换" + (j.moved ? "，搬过来 " + j.moved + " 个记录文件" : "") + "，当前 " + (j.count || 0) + " 条";
        loadHistory();
        cb(true);
      } else {
        $("histDirMsg").className = "msg bad";
        $("histDirMsg").textContent = "设置失败：" + ((j && (j.message || j.error)) || "未知错误");
        cb(false);
      }
    });
  }
  $("btnHistDirPick").onclick = function () {
    $("histDirMsg").className = "msg"; $("histDirMsg").textContent = "请在弹出的窗口里选择文件夹…";
    storePost("/api/store/pick", {}, function (j) {
      if (j && j.dir) { $("fHistDir").value = j.dir; $("histDirMsg").textContent = "已选择，点“应用”生效"; }
      else $("histDirMsg").textContent = "没有选择文件夹";
    });
  };
  $("btnHistDirApply").onclick = function () { applyHistDir(function () {}); };
  $("btnHistDirOpen").onclick = function () { storePost("/api/store/open", {}, function () {}); };
  var histQuery = "";                      // 桌面历史搜索关键字（手机端隐藏搜索框，始终为空）
  var HIST_ICON_GRADE = '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>';
  var HIST_ICON_CHAT = '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>';
  var HIST_ICON_CLOCK = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
  var HIST_ICON_COST = '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';
  function histMatches(rec) {
    if (!histQuery) return true;
    var hay = [rec.question || "", rec.questionText || "", rec.model || "", rec.grade || "", fmtTime(rec.ts)]
      .join("\n").toLowerCase();
    var terms = histQuery.toLowerCase().split(/\s+/);
    for (var i = 0; i < terms.length; i++) {
      if (terms[i] && hay.indexOf(terms[i]) < 0) return false;
    }
    return true;
  }
  function histTimeShort(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return fmtTime(ts); }
  }
  function histTag(icon, text, cls) {
    var sp = document.createElement("span");
    sp.className = "hist-tag" + (cls ? " " + cls : "");
    sp.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (icon || "") + '</svg><span class="tg-t"></span>';
    sp.lastChild.textContent = text;
    return sp;
  }
  function renderHistory() {
    var box = $("histList");
    if (!box) return;
    box.innerHTML = "";
    var mob = isMobileUI();
    var items = (!mob && histQuery) ? history.filter(histMatches) : history;
    var cntEl = $("histCount"), hintEl = $("histHint");
    if (cntEl) cntEl.textContent = history.length ? (histQuery ? items.length + " / " + history.length : history.length + " 条") : "";
    if (hintEl) hintEl.textContent = histQuery ? (items.length ? "匹配 " + items.length + " 条" : "没有匹配") : "输入关键字筛选";
    box.classList.toggle("no-anim", !!histQuery);
    if (!history.length) {
      box.innerHTML = mob
        ? '<div class="hist-empty">还没有记录，解一道题就会出现在这里</div>'
        : '<div class="hist-empty">' +
          '<span class="hist-empty-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-history"/></svg></span>' +
          '<b>还没有记录</b><span>解一道题就会出现在这里</span></div>';
      if (mob && $("histSub")) $("histSub").textContent = "共 0 条 · 点任意一条回看";
      return;
    }
    if (!items.length) {
      box.innerHTML = '<div class="hist-empty">' +
        '<span class="hist-empty-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-list"/></svg></span>' +
        '<b>没有找到匹配的记录</b><span>换个关键词试试，或清空搜索。</span>' +
        '<button type="button" id="histEmptyClear">清空搜索</button></div>';
      var eb = $("histEmptyClear");
      if (eb) eb.onclick = function () { clearHistSearch(); };
      if (mob && $("histSub")) $("histSub").textContent = "共 " + history.length + " 条 · 点任意一条回看";
      return;
    }
    var lastGroup = "";
    items.forEach(function (rec, index) {
      var g = histGroupName(rec.ts);
      if (g !== lastGroup) {
        var gh = document.createElement("div");
        gh.className = "hist-group";
        gh.textContent = g;
        box.appendChild(gh);
        lastGroup = g;
      }
      var it = document.createElement("div"); it.className = "hist-item";
      var qtText = rec.question || rec.questionText || "";
      // 摘要里不显示 LaTeX 源码：题目常带 $...$ / \frac，转成可读纯文本再截断
      var snippet = qtText ? texPlainText(String(qtText)).slice(0, 80) : (rec.imgCount ? "[图片题]" : "(空)");
      if (!mob) {
        it.tabIndex = 0;
        it.setAttribute("role", "button");
        it.setAttribute("aria-label", "打开记录：" + snippet);
        it.style.setProperty("--i", String(Math.min(index, 12)));
      }
      if (rec.thumb) {
        var th = document.createElement("div"); th.className = "thumb-sm";
        var im = document.createElement("img"); im.src = rec.thumb;
        im.onclick = function (ev) { ev.stopPropagation(); recFull(rec.id, function (f) { openLightbox((f && f.images && f.images[0]) || rec.thumb); }); };
        th.appendChild(im); it.appendChild(th);
      } else if (rec.imgCount) {
        var th2 = document.createElement("div"); th2.className = "thumb-sm";
        var ph = document.createElement("div"); ph.className = "thumb-ph";
        if (mob) {
          ph.textContent = "图 " + rec.imgCount;
        } else {
          ph.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-image"/></svg><span></span>';
          ph.lastChild.textContent = rec.imgCount + " 图";
        }
        ph.onclick = function (ev) { ev.stopPropagation(); recFull(rec.id, function (f) { if (f && f.images && f.images[0]) openLightbox(f.images[0]); }); };
        th2.appendChild(ph); it.appendChild(th2);
      } else if (!mob) {
        var th0 = document.createElement("div"); th0.className = "thumb-sm none";
        th0.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-box"/></svg>';
        it.appendChild(th0);
      }
      var meta = document.createElement("div"); meta.className = "meta";
      var qt = document.createElement("div"); qt.className = "qtext";
      qt.textContent = snippet;
      meta.appendChild(qt);
      var subText = fmtTime(rec.ts) + (rec.model ? " · " + rec.model : "") + (rec.grade ? " · " + rec.grade : "") + (rec.imgCount ? " · " + rec.imgCount + " 图" : "") + (rec.chatCount ? " · 追问 " + rec.chatCount + " 条" : "") + (rec.elapsedMs != null ? " · " + (rec.elapsedMs / 1000).toFixed(1) + "s" : "") + (rec.usage && rec.usage.total_tokens != null ? " · " + rec.usage.total_tokens + " tok" : "") + (rec.cost ? " · " + rec.cost : "") + (rec.verCount > 1 ? " · " + rec.verCount + " 版" : (rec.refined ? " · 已微调" : ""));
      if (mob) {
        var sub = document.createElement("div"); sub.className = "sub";
        sub.textContent = subText;
        meta.appendChild(sub);
      } else {
        it.title = subText;
        var tags = document.createElement("div"); tags.className = "hist-tags";
        tags.appendChild(histTag('<use href="#i-history"/>', histTimeShort(rec.ts), "time"));
        if (rec.model) tags.appendChild(histTag('<use href="#i-sparkles"/>', rec.model, "model"));
        if (rec.grade) tags.appendChild(histTag(HIST_ICON_GRADE, rec.grade, "grade"));
        if (rec.imgCount) tags.appendChild(histTag('<use href="#i-image"/>', rec.imgCount + " 图"));
        if (rec.chatCount) tags.appendChild(histTag(HIST_ICON_CHAT, "追问 " + rec.chatCount));
        if (rec.elapsedMs != null) tags.appendChild(histTag(HIST_ICON_CLOCK, (rec.elapsedMs / 1000).toFixed(1) + "s"));
        if (rec.verCount > 1) tags.appendChild(histTag('<use href="#i-layers"/>', rec.verCount + " 版"));
        else if (rec.refined) tags.appendChild(histTag('<use href="#i-wand-2"/>', "已微调"));
        if (rec.cost) tags.appendChild(histTag(HIST_ICON_COST, rec.cost));
        meta.appendChild(tags);
      }
      it.appendChild(meta);
      function removeRec() {
        draftClear(rec.id); rprefClear(rec.id);
        if (pendingReview && pendingReview.recId === rec.id) cancelPending();
        delete recCache[rec.id];
        history = history.filter(function (x) { return x.id !== rec.id; });
        storePost("/api/store/delete", { id: rec.id }, function () {});
        renderHistory();
      }
      var del;
      if (mob) {
        // 手机上删除藏在左滑操作栏里：常驻 ✕ 会挤占摘要，也容易误触
        var row = document.createElement("div"); row.className = "hist-row";
        var rail = document.createElement("div"); rail.className = "hist-rail";
        rail.setAttribute("aria-hidden", "true");
        del = document.createElement("button");
        del.type = "button";
        del.className = "hist-del";
        del.tabIndex = -1;
        del.setAttribute("aria-label", "删除这条记录");
        del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg><span>删除</span>';
        del.onclick = function (ev) {
          ev.stopPropagation();
          if (window.HJDialog) {
            HJDialog.confirm({
              title: "删除这条记录？",
              message: "删除后无法恢复。",
              okText: "删除",
              danger: true
            }).then(function (ok) {
              document.dispatchEvent(new CustomEvent("hj-swipe-close"));
              if (ok) removeRec();
            });
          } else if (confirm("删除这条记录？删除后无法恢复。")) {
            removeRec();
          }
        };
        rail.appendChild(del);
        row.appendChild(rail);
        row.appendChild(it);
        box.appendChild(row);
      } else {
        del = document.createElement("button");
        del.type = "button";
        del.className = "del";
        del.title = "删除此条";
        del.setAttribute("aria-label", "删除这条记录");
        del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash-2"/></svg>';
        del.onclick = function (ev) {
          ev.stopPropagation();
          hjConfirm({
            title: "删除这条记录？",
            message: "删除后无法恢复。",
            okText: "删除",
            danger: true,
            native: "删除这条记录？删除后无法恢复。"
          }).then(function (ok) { if (ok) removeRec(); });
        };
        it.appendChild(del);
        box.appendChild(it);
      }
      it.onclick = function () {
        if (it.__hjSwiped) { it.__hjSwiped = false; return; }
        loadRecord(rec);
      };
      if (!mob) {
        it.onkeydown = function (e) {
          if (e.target !== it) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            loadRecord(rec);
          }
        };
      }
    });
    if (mob && $("histSub")) $("histSub").textContent = "共 " + history.length + " 条 · 点任意一条回看";
    try { document.dispatchEvent(new CustomEvent("hj-history-changed")); } catch (e) {}
  }
  function clearHistSearch() {
    histQuery = "";
    var hs = $("histSearch"), wrap = $("histSearchWrap");
    if (hs) hs.value = "";
    if (wrap) wrap.classList.remove("has-q");
    renderHistory();
  }
  function discardRunningTasks() {
    var running = TASKS.filter(function (e) { return e.status === "running"; });
    if (!running.length) return;
    running.forEach(function (e) {
      e.discard = true;
      if (e.opts && e.opts.chat) e.discardChat = true;
      closeEntryES(e);
      if (e.id) fetch("/api/task/" + e.id + "/cancel", { method: "POST" }).catch(function () {});
    });
    // 进行中的任务已取消，不再让它们回写当前已清空的界面
    TASKS = TASKS.filter(function (e) { return e.status !== "running"; });
    taskSave();
  }
  function goHome() {
    if (pendingReview) cancelPending();
    discardRunningTasks();
    flushStyleSave();
    chatActive = null;
    var oldId = lastHistoryId;
    last = null; lastHistoryId = null; subQs = null; subIdx = -1;
    autoFixCount = 0; verPreviewVid = 0; lastSolveSeq = solveSeq;
    retryShow(false);
    if (oldId) draftClear(oldId);
    // 输入区
    $("q").value = ""; resetImages([]); qWarn("");
    $("rin").value = ""; updCount(); rWarn("");
    // 解答区
    $("meta").style.display = "none"; $("meta").innerHTML = "";
    $("answer").className = "hint"; $("answer").textContent = "—";
    $("analysis").className = "hint"; $("analysis").textContent = "—";
    $("subTabs").innerHTML = ""; $("subTabs").style.display = "none"; $("subTabs").classList.remove("show"); $("subLocate").innerHTML = "";
    window.HJTabs && window.HJTabs.sync($("subTabs"), false);
    $("qFigFloat").hidden = true; $("qTextFloat").hidden = true;
    $("qText").innerHTML = ""; $("qFig").innerHTML = "";
    qFigCache = {};
    qFloatSet($("qTextFloat"), true); qFloatSet($("qFigFloat"), true);
    $("verPreview").classList.remove("show");
    renderScope();
    renderVersions();
    $("chatIn").value = ""; renderChat(null);
    $("chatJump").style.display = "none";
    ansEditClose();
    $("ansEditBtn").style.display = "none"; $("ansEditBtn").disabled = false; $("ansEditBtn").textContent = "改答案"; $("ansEditBtn").title = "";
    $("ansNote").style.display = "none"; $("ansNote").innerHTML = "";
    $("err").style.display = "none";
    refineLocked = false; refineState("idle");
    // 释放 2D/3D 画布并回到欢迎页
    try { render(""); } catch (e) {}
    $("status").textContent = "就绪";
    panelOpen = false; renderPanel();
    closeHist();
    $("q").focus();
  }
  function loadRecord(rec) {
    var id = typeof rec === "string" ? rec : (rec && rec.id);
    if (!id) { $("status").textContent = "记录读取失败"; return; }
    // 切换记录前必须清掉上一轮的「版本预览」状态：
    // verPreviewVid 是全局的，如果不在这里复位，从「A 记录正在预览 v1」直接打开 B 记录后，
    // 预览锁会跟着串到 B 上（预览条还显示 A 的 v1），样式面板整个不渲染、尺寸滑杆调不动，
    // 只有刷新页面才恢复 —— 这正是 §43.2 用户报的现象。
    flushStyleSave();
    verPreviewVid = 0;
    if ($("verPreview")) $("verPreview").classList.remove("show");
    recFull(id, function (full) {
      if (!full) { $("status").textContent = "记录读取失败，文件可能已被移动或删除"; return; }
      commitPending();
      retryShow(false);
      $("q").value = full.question || "";
      resetImages(full.images || []);
      gradeApply(full.grade || "");
      last = { question: full.question || "", images: (full.images || []).slice(), cfg: loadCfg(), grade: full.grade || "", result: full };
      lastHistoryId = full.id;
      $("rin").value = draftLoad(full.id);
      updCount(); rWarn("");
      autoFixCount = 0;
      chatActive = null; chatWarn("");
      renderResult(full);
      $("status").textContent = "记录 " + fmtTime(full.ts) + (full.renderCode ? " · 脚本 " + full.renderCode.length + " 字节" : "") + (full.refined ? " · 已微调" : "");
      closeHist();
    });
  }
  function openHist() {
    if (!isMobileUI()) {
      histQuery = "";
      var hs = $("histSearch"), hw = $("histSearchWrap");
      if (hs) hs.value = "";
      if (hw) hw.classList.remove("has-q");
    }
    renderHistory();
    $("histMsg").textContent = "";
    $("histModal").classList.add("show");
  }
  function closeHist() { $("histModal").classList.remove("show"); }
  var histSearchEl = $("histSearch");
  if (histSearchEl) {
    histSearchEl.addEventListener("input", function () {
      histQuery = histSearchEl.value.trim();
      var hw = $("histSearchWrap");
      if (hw) hw.classList.toggle("has-q", !!histSearchEl.value);
      renderHistory();
    });
    histSearchEl.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        clearHistSearch();
        histSearchEl.blur();
      }
    });
  }
  var histSearchClearEl = $("histSearchClear");
  if (histSearchClearEl) {
    histSearchClearEl.onclick = function () {
      clearHistSearch();
      if (histSearchEl) histSearchEl.focus();
    };
  }
  $("btnHist").onclick = openHist;
  if ($("btnHome")) {
    $("btnHome").onclick = goHome;
    $("btnHome").onkeydown = function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goHome(); }
    };
  }
  $("btnHistClose").onclick = closeHist;
  var histX = $("btnHistX");
  if (histX) histX.onclick = closeHist;
  $("histModal").addEventListener("click", function (e) { if (e.target === $("histModal")) closeHist(); });
  $("btnHistClear").onclick = async function () {
    if (!history.length) { $("histMsg").textContent = "没有记录"; return; }
    if (!(await hjConfirm({
      title: "清空全部记录？",
      message: history.length + " 条记录会被删除，无法恢复。",
      okText: "清空",
      danger: true,
      native: "确定清空全部 " + history.length + " 条记录吗？\n会删除记录文件夹里的文件，无法恢复。"
    }))) return;
    cancelPending();
    recCache = {}; history = [];
    storePost("/api/store/purge", {}, function () { renderHistory(); $("histMsg").textContent = "已清空"; });
    try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(RSPREF_KEY); } catch (e) {}
  };
  var Q_MAX = 1000, RIN_MAX = 200;
  var IMG_MIN = 10 * 1024, IMG_MAX = 20 * 1024 * 1024, IMG_EDGE = 4096, IMG_TARGET = 8 * 1024 * 1024;
  var BAD_INPUT_RE = /```|<script|javascript:|onerror=|onload=|document\.cookie|localStorage|sessionStorage|window\.parent|window\.top|postMessage\(|XMLHttpRequest|fetch\(|WebSocket|eval\(|new Function|system prompt|ignore previous|开发者指令|系统提示词|忽略之前|忽略上面/i;
  function badInput(text) {
    if (BAD_INPUT_RE.test(String(text || ""))) return "仅支持自然语言描述，请勿输入代码、脚本或系统指令";
    return "";
  }
  function qWarn(msg) {
    var w = $("qWarn");
    if (!w) return;
    if (msg) { w.textContent = msg; w.classList.add("show"); } else { w.textContent = ""; w.classList.remove("show"); }
  }
  var RHINT = "说明自动暂存；多小问 / 选择题可只改某一问或某一选项";
  function rWarn(msg) {
    var h = $("refineHint");
    if (msg) { h.textContent = msg; h.classList.add("bad"); } else { h.textContent = RHINT; h.classList.remove("bad"); }
  }
  function updCount() {
    [["q", "qCount", Q_MAX], ["rin", "rinCount", RIN_MAX]].forEach(function (p) {
      var el = $(p[0]), c = $(p[1]);
      if (!el || !c) return;
      var n = el.value.length;
      c.textContent = n + "/" + p[2];
      c.className = "count" + (n >= p[2] ? " full" : (n >= p[2] * 0.9 ? " near" : ""));
    });
  }
  function sniffImage(b) {
    if (!b || b.length < 4) return "";
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
    if (b.length >= 12 && String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" && String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP") return "webp";
    return "";
  }
  function fitImage(dataUrl, cb) {
    var im = new Image();
    im.onload = function () {
      var w = im.naturalWidth, h = im.naturalHeight;
      var needScale = Math.max(w, h) > IMG_EDGE;
      var needShrink = dataUrl.length * 0.75 > IMG_TARGET;
      if (!needScale && !needShrink) { cb(dataUrl); return; }
      var s = needScale ? IMG_EDGE / Math.max(w, h) : 1;
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(im, 0, 0, c.width, c.height);
      var qt = 0.9, out = c.toDataURL("image/jpeg", qt);
      while (out.length * 0.75 > IMG_TARGET && qt > 0.5) { qt -= 0.1; out = c.toDataURL("image/jpeg", qt); }
      cb(out);
    };
    im.onerror = function () { cb(dataUrl); };
    im.src = dataUrl;
  }
  function decodeImageFile(file, allowSmall) {
    return new Promise(function (resolve) {
      if (!file) { resolve(null); return; }
      if (!allowSmall && file.size < IMG_MIN) { qWarn("图片文件过小，不足 10KB，可能是误截图，请重新截图"); resolve(null); return; }
      if (file.size > IMG_MAX) { qWarn("图片过大，" + (file.size / 1048576).toFixed(1) + " MB，单张不超过 20MB"); resolve(null); return; }
      file.arrayBuffer().then(function (buf) {
        if (!sniffImage(new Uint8Array(buf))) { qWarn("仅支持 JPG、PNG、WebP 格式的图片"); resolve(null); return; }
        var fr = new FileReader();
        fr.onload = function () {
          fitImage(String(fr.result), function (u) {
            if (!u) { qWarn("读取图片失败"); resolve(null); return; }
            resolve(u);
          });
        };
        fr.onerror = function () { qWarn("读取图片失败"); resolve(null); };
        fr.readAsDataURL(file);
      }).catch(function () { qWarn("读取图片失败"); resolve(null); });
    });
  }
  // 直接加入输入框（粘贴/拖入/旧调用）
  function addImageFile(file, allowSmall) {
    return decodeImageFile(file, allowSmall).then(function (u) {
      if (!u) return null;
      images.push(u);
      rememberImage(u, u);
      renderThumbs();
      qWarn("");
      return u;
    });
  }
  // 拍照/相册先暂存，等框选页确认后才进 images
  function stageImageFile(file, allowSmall, from) {
    return decodeImageFile(file, allowSmall).then(function (u) {
      if (!u) return null;
      PENDING = { src: u, from: from || "shot" };
      return u;
    });
  }
  function addImageBlob(blob) { if (blob) addImageFile(new File([blob], "paste.png", { type: blob.type || "image/png" })); }

  $("q").addEventListener("input", function () { updCount(); });
  $("q").addEventListener("paste", function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    var got = false;
    for (var i = 0; i < items.length; i++) if (items[i].type && items[i].type.indexOf("image") === 0) { addImageBlob(items[i].getAsFile()); got = true; }
    if (got) e.preventDefault();
  });
  ["dragover", "dragenter"].forEach(function (ev) { $("q").addEventListener(ev, function (e) { e.preventDefault(); $("q").classList.add("drop"); }); });
  ["dragleave", "drop"].forEach(function (ev) { $("q").addEventListener(ev, function (e) { e.preventDefault(); $("q").classList.remove("drop"); }); });
  $("q").addEventListener("drop", function (e) {
    var fs = (e.dataTransfer && e.dataTransfer.files) || [];
    for (var i = 0; i < fs.length; i++) addImageFile(fs[i]);
  });
  // 「粘贴图片」按钮已从界面移除，但粘贴/拖入图片的能力保留：
  // 题干框内 Ctrl+V、拖拽图片、以及全窗口拖入图片仍然可用。
  (function () {
    var bp = $("btnPaste");
    if (!bp) return;
    bp.onclick = function () {
      if (navigator.clipboard && navigator.clipboard.read) {
        navigator.clipboard.read().then(function (its) {
          its.forEach(function (it) { it.getType("image/png").then(addImageBlob).catch(function () {}); });
        }).catch(function () { $("status").textContent = "无法读取剪贴板，请改用 Ctrl+V 粘贴"; });
      } else { $("status").textContent = "浏览器不支持读取剪贴板，请用 Ctrl+V"; }
    };
  })();

  // ================= 2D 交互控制层 =================
  // 自 v2 起：对象列表 / 步骤条 / 显示控制 / 小题范围 全部由 ui.js 的视图层统一渲染与写入，
  // 这里只保留 locate（聚焦答案）需要的「对象名 → 元素」索引，避免两套显隐逻辑并存。
  var b2d = { names: {} };
  function collectBoardNames() {
    var map = {};
    try {
      var o = window.board && window.board.objects;
      for (var k in o) {
        var el = o[k];
        if (!el || el.name == null || el.name === "") continue;
        var n = String(el.name).trim();
        if (!n) continue;
        (map[n] = map[n] || []).push(el);
      }
    } catch (e) {}
    return map;
  }
  function forName(name, fn) { var a = b2d.names[name]; if (!a) return; a.forEach(function (el) { try { fn(el); } catch (e) {} }); }
  function hlName(name, on) {
    forName(name, function (el) {
      if (!el.setAttribute) return;
      if (on) {
        if (!el.__hl) el.__hl = { s: el.visProp && el.visProp.strokecolor, w: el.visProp && el.visProp.strokewidth };
        el.setAttribute({ strokeColor: "#e91e63", strokeWidth: 4 });
      } else if (el.__hl) {
        el.setAttribute({ strokeColor: el.__hl.s, strokeWidth: el.__hl.w });
        el.__hl = null;
      }
    });
    try { if (window.board) window.board.update(); } catch (e) {}
  }
  function clearHL() { for (var n in b2d.names) hlName(n, false); }
  function focus2D(names) {
    if (!window.board) return;
    var els = [];
    (names || []).forEach(function (n) { (b2d.names[n] || []).forEach(function (el) { els.push(el); }); });
    if (!els.length) return;
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, any = false;
    els.forEach(function (el) {
      try {
        var b = el.bounds();
        if (b && isFinite(b[0])) { any = true; minX = Math.min(minX, b[0], b[2]); maxX = Math.max(maxX, b[0], b[2]); minY = Math.min(minY, b[1], b[3]); maxY = Math.max(maxY, b[1], b[3]); }
      } catch (e) {}
    });
    if (!any) return;
    var padX = Math.max((maxX - minX) * 0.6, 0.8), padY = Math.max((maxY - minY) * 0.6, 0.8);
    try { window.board.setBoundingBox([minX - padX, maxY + padY, maxX + padX, minY - padY]); window.board.update(); } catch (e) {}
    clearHL();
    (names || []).forEach(function (n) { hlName(n, true); });
  }
  function locate(ft) {
    if (!ft) return;
    var t = ft.target != null ? ft.target : ft.targets;
    if (Array.isArray(t) && t.length && typeof t[0] === "string") { focus2D(t); return; }
    if (typeof t === "string") {
      if (window.board && b2d.names[t]) { focus2D([t]); return; }
      if (window.GGB3D && window.GGB3D.focus) { try { window.GGB3D.focus(Object.assign({}, ft, { target: t })); } catch (e) {} return; }
    }
    if (window.GGB3D && window.GGB3D.focus) { try { window.GGB3D.focus(ft); } catch (e) {} }
  }
  function build2DUI(r) {
    // UI 由 ui.js 统一渲染（对象面板 / 步骤条 / 测量卡 / 显示控制）
    // 这里只留 locate / 高亮需要的「对象名 → 元素」索引
    b2d.names = collectBoardNames();
    if (window.HJ && window.HJ.afterRender2D) {
      try { window.HJ.afterRender2D(r); } catch (e) { console.warn("HJ.afterRender2D", e); }
    }
  }
  // 供 ui.js 的「定位答案」调用
  if (window.HJ) {
    window.HJ._locateImpl = function (ft) { locate(ft); };
  }

  // ================= 渲染（含 #2 校验/自动修正） =================
  var last = null, lastHistoryId = null, autoFixCount = 0;
  var subQs = null, subIdx = -1;

  // LaTeX → 纯文本（摘要 / 列表用；复用 render3d.js 的 texPlain，未加载时退化处理）
  function texPlainText(t) {
    var s = String(t == null ? "" : t);
    if (!/[\\$]/.test(s)) return s;
    if (window.GGB3D && typeof window.GGB3D.texPlain === "function") {
      try { return window.GGB3D.texPlain(s); } catch (e) {}
    }
    return s.replace(/\$/g, "").replace(/\\[A-Za-z]+\s*/g, "").replace(/[{}]/g, "");
  }
  function free2D() {
    try { if (window.board && window.JXG && JXG.JSXGraph && JXG.JSXGraph.freeBoard) JXG.JSXGraph.freeBoard(window.board); } catch (e) {}
    window.board = null;
  }
  // 手动样式（2D）：记录里存 style2d = { 对象名: {size?, strokeWidth?} }，渲染后统一套用。
  // 这段函数会被 toString() 打进离线导出 HTML，所以只能用 window.board，不能引用外层变量。
  function applyStyle2D(map) {
    if (!map || !window.board || !window.board.objects) return;
    var b = window.board, changed = false;
    for (var k in b.objects) {
      var e = b.objects[k]; if (!e || !e.setAttribute) continue;
      var nm = (e.name == null ? "" : String(e.name)).trim();
      var a = map[nm]; if (!a) continue;
      try {
        e.setAttribute(a);
        changed = true;
        // 元素正被悬停高亮时同步保存值，避免移出鼠标时把手动改的样式改回去
        if (e.__hjHover && a && a.strokeWidth != null) e.__hjHover.w = a.strokeWidth;
      } catch (er) {}
    }
    if (changed) { try { b.update(); } catch (er2) {} }
  }
  // ===== 2D 画布文本里的 LaTeX（画布文字不是 DOM/KaTeX，只能转成 HTML 后再交给 JSXGraph） =====
  // 这个函数会被 toString() 打进离线导出 HTML，所以只能引用 window.katex，不能用外层变量。
  function texCanvasHTML(text) {
    var s = String(text == null ? "" : text);
    if (!/\\[A-Za-z]|\$/.test(s)) return null;        // 没有 LaTeX 特征 → 调用方原样不动
    var K = window.katex;
    function render(expr) {
      if (!K || !K.renderToString) return null;
      try {
        var h = K.renderToString(expr, { displayMode: false, throwOnError: false });
        // 画布文字同样要剥掉屏幕阅读用的 MathML 层：它在中文混排里会多占一层盒子，
        // 让画布上的公式和后面的文字对不齐（和 mathHTML 的第 ① 步同一个坑）。
        return String(h).replace(/<span class="katex-mathml">[\s\S]*?<\/span>/g, "")
          .replace(/\r?\n\s*/g, "").replace(/>\s+</g, "><");
      } catch (e) { return null; }
    }
    var out = "", i = 0, n = s.length, hit = false;
    while (i < n) {
      var ch = s[i];
      // $...$ / $$...$$ / \(...\) / \[...\]
      var m = null;
      if (ch === "$") {
        m = /^\$\$([\s\S]+?)\$\$/.exec(s.slice(i)) || /^\$([^$\n]+?)\$/.exec(s.slice(i));
      } else if (ch === "\\" && s[i + 1] === "(") {
        var e1 = s.indexOf("\\)", i + 2); if (e1 > 0) m = [s.slice(i, e1 + 2), s.slice(i + 2, e1)];
      } else if (ch === "\\" && s[i + 1] === "[") {
        var e2 = s.indexOf("\\]", i + 2); if (e2 > 0) m = [s.slice(i, e2 + 2), s.slice(i + 2, e2)];
      }
      if (m) {
        var html = render(m[1].trim());
        if (html) { out += html; hit = true; i += m[0].length; continue; }
      }
      // 裸 LaTeX 片段：从当前反斜杠命令开始，吃掉命令 + 其 {...} 参数 + 紧跟的上下标
      if (ch === "\\") {
        var run = "", j = i;
        // 允许以 ^ / _ 开头（例如紧跟在数字后面的 ^\circ），先补上
        while (j < n && (s[j] === "^" || s[j] === "_")) {
          run += s[j]; j++;
          var cm0 = /^\\[A-Za-z]+/.exec(s.slice(j));
          if (cm0) { run += cm0[0]; j += cm0[0].length; }
          else if (s[j] === "{") { var d0 = 0, t0 = j; for (; t0 < n; t0++) { if (s[t0] === "{") d0++; else if (s[t0] === "}") { d0--; if (d0 === 0) break; } } run += s.slice(j, t0 + 1); j = t0 + 1; }
          else if (j < n) { run += s[j]; j++; }
        }
        while (j < n) {
          var cm = /^\\[A-Za-z]+/.exec(s.slice(j));
          if (!cm) break;
          run += cm[0]; j += cm[0].length;
          // 连续吃参数（最多 2 个，够 \frac{a}{b} / \sqrt{3} / \vec{AB}）
          for (var k = 0; k < 2 && s[j] === "{"; k++) {
            var d = 0, t = j;
            for (; t < n; t++) { if (s[t] === "{") d++; else if (s[t] === "}") { d--; if (d === 0) break; } }
            run += s.slice(j, t + 1); j = t + 1;
          }
          if (s[j] === "_" || s[j] === "^") {   // 带上紧跟的上下标
            run += s[j]; j++;
            if (s[j] === "{") { var d2 = 0, t2 = j; for (; t2 < n; t2++) { if (s[t2] === "{") d2++; else if (s[t2] === "}") { d2--; if (d2 === 0) break; } } run += s.slice(j, t2 + 1); j = t2 + 1; }
            else { var cm2 = /^\\[A-Za-z]+/.exec(s.slice(j)); if (cm2) { run += cm2[0]; j += cm2[0].length; } else if (j < n) { run += s[j]; j++; } }
          }
        }
        if (run) {
          var h2 = render(run);
          if (h2) { out += h2; hit = true; i = j; continue; }
        }
      }
      out += (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch);
      i++;
    }
    return hit ? out : null;
  }
  // 建系题自动铺坐标纸（HANDOVER §72）：画布上有 x/y/z 轴对象时才补网格，
  // 网格压到最底层（否则会盖住图形），每 1 单位一格、不标数字。模型可用 board 选项 grid:false 关掉。
  // 同样会被 toString() 内联进导出页：只能引用 window.board。
  // 2D 坐标轴固定：模型 renderCode 可能把 x/y 轴创建成可拖动元素，
  // 坐标系只能平移/缩放视图，不能被拖走。两端共用。
  function fixAxes2D(b) {
    b = b || window.board;
    if (!b || !b.objects) return 0;
    var n = 0;
    for (var k in b.objects) {
      var e = b.objects[k];
      if (!e) continue;
      var nm = String(e.name || "");
      if (!(e.elType === "axis" || /^[xyz]$/.test(nm))) continue;
      try { e.setAttribute({ fixed: true, highlight: false }); } catch (er) {}
      try { if (e.visProp) e.visProp.fixed = true; } catch (er2) {}
      n++;
    }
    try {
      if (b.defaultAxes) ["x", "y", "z"].forEach(function (a) {
        var ax = b.defaultAxes[a];
        if (ax) { try { ax.setAttribute({ fixed: true, highlight: false }); } catch (e) {} }
      });
    } catch (e) {}
    return n;
  }
  function ensureGrid2D() {
    var b = window.board;
    if (!b || !b.objectsList || !b.create) return false;
    if (b.options && b.options.grid === false) return false;
    var hasAxis = false;
    for (var i = 0; i < b.objectsList.length; i++) {
      var o = b.objectsList[i];
      if (!o) continue;
      if (o.elType === "grid") return false;                 // 已经有网格（模型自己画的）
      if (/^[xyz]$/.test(String(o.name || "")) || o.elType === "axis") hasAxis = true;
    }
    if (!hasAxis) return false;
    // 网格色走皮肤 palette（default = 原值 #e2e2e2，保证默认皮肤不变）
    var pal = (window.HJSkin && HJSkin.palette()) || null;
    var gcol = (pal && pal.grid2d) || "#e2e2e2";
    var g = b.create("grid", [], { majorStep: 1, strokeColor: gcol, strokeWidth: 1, fixed: true, highlight: false });
    var arr = b.elements || [];
    var idx = arr.indexOf(g);
    if (idx > 0) { arr.splice(idx, 1); arr.unshift(g); }      // 第一个元素画在最底层
    b.update();
    return true;
  }
  // 皮肤切换后的画布跟随：给已有网格/默认轴重上 palette 色、通知 3D 换背景与网格。
  // 只改样式不重算几何（SKIN-SYSTEM.md §5.3）；模型自己画的轴/图形是内容色，不动。
  function applyCanvasSkin() {
    var pal = (window.HJSkin && HJSkin.palette()) || null;
    if (!pal) return;
    var b = window.board;
    if (b && b.objects) {
      var changed = false;
      for (var k in b.objects) {
        var e = b.objects[k];
        if (!e || !e.elType) continue;
        if (e.elType === "grid" && pal.grid2d) {
          try { e.setAttribute({ strokeColor: pal.grid2d }); changed = true; } catch (er) {}
        } else if (e.elType === "axis" && pal.axis2d) {
          try { e.setAttribute({ strokeColor: pal.axis2d }); changed = true; } catch (er) {}
        }
      }
      if (changed) { try { b.update(); } catch (er) {} }
    }
    if (window.GGB3D && window.GGB3D.applyPalette) {
      try { window.GGB3D.applyPalette(pal); } catch (er) {}
    }
  }
  document.addEventListener("hj:skin", function () { try { applyCanvasSkin(); } catch (e) { console.warn("applyCanvasSkin", e); } });
  // 遍历 JSXGraph 画板，把所有含 LaTeX 的 text 元素转成 KaTeX HTML
  // （同样会被 toString() 内联进导出页：只能引用 window.board / window.texCanvasHTML）
  function applyTex2D(board) {
    var b = board || (typeof window !== "undefined" ? window.board : null);
    if (!b || !b.objects) return 0;
    var tex = (typeof window !== "undefined" && window.texCanvasHTML) ? window.texCanvasHTML : texCanvasHTML;
    var done = 0;
    function convert(e) {
      if (!e) return;
      try {
        // ⚠️ JSXGraph 在「创建元素时」就已经把文本用 replaceSup 处理过了
        //    （10^\circ 会变成 10<sup>\</sup>circ 存进 plaintext），所以不能读 plaintext。
        //    内核另存了一份原始串 orgText —— 那才是我们要的。
        var raw = null;
        if (typeof e.orgText === "string") raw = e.orgText;
        else if (typeof e.plaintext === "string") raw = e.plaintext;
        else if (e.visProp && typeof e.visProp.text === "string") raw = e.visProp.text;
        if (typeof raw === "string" && raw) {
          var html = tex(raw);
          if (html) {
            e.setAttribute({ parse: false, useKatex: false });
            e.setText(html);
            // setText 会用新内容覆盖 orgText，把原始 LaTeX 留在一个私有属性上，
            // 方便重复渲染（切步骤 / 刷新）时还能拿到原文，不会二次转换。
            e.__hjTexRaw = raw;
            done++;
            return;
          }
          // 已经转换过、重新渲染时：__hjTexRaw 里有原文，直接用
          if (e.__hjTexRaw) {
            var h3 = tex(e.__hjTexRaw);
            if (h3) {
              e.setAttribute({ parse: false, useKatex: false });
              e.setText(h3);
              done++;
              return;
            }
          }
        }
        // 元素名里带 LaTeX（如 name:'\\vec{AB}'）也顺带转换
        var nm = e.name != null ? String(e.name) : "";
        if (nm && /[\\$]/.test(nm) && e.label && typeof e.label.setText === "function") {
          var nh = tex(nm);
          if (nh) {
            try { e.label.setAttribute({ parse: false }); } catch (e3) {}
            e.label.setText(nh);
            done++;
          }
        }
      } catch (er) {}
    }
    for (var k in b.objects) convert(b.objects[k]);
    if (done) { try { b.update(); } catch (e2) {} }
    return done;
  }
  window.texCanvasHTML = texCanvasHTML;
  window.applyTex2D = applyTex2D;
  function render3d(scene, noFix) {
    $("err").style.display = "none";
    free2D();
    var host = $("canvasHost"); host.style.display = "none"; host.innerHTML = "";
    var g = $("g3d"); g.style.display = "block";
    $("status").textContent = "3D 图形 · 可拖动旋转、滚轮缩放";
    try {
      window.GGB3D.render(g, scene);
      try { window.HJGrid && window.HJGrid.apply(); } catch (eP) {}
      autoFixCount = 0;
      if (window.HJ && window.HJ.afterRender3D) {
        try { window.HJ.afterRender3D(scene); } catch (e2) { console.warn("HJ.afterRender3D", e2); }
      }
      return true;
    }
    catch (e) {
      $("err").style.display = "block"; $("err").textContent = "3D 渲染出错：" + e.message;
      if (!noFix) autoFix("3D 渲染报错：" + e.message);
      return false;
    }
  }
  function render(code, result, noFix) {
    var host = $("canvasHost");
    try { if (window.GGB3D) window.GGB3D.dispose(); } catch (e) {}
    $("g3d").style.display = "none";
    host.style.display = "block";
    $("err").style.display = "none";
    free2D();
    host.innerHTML = '<div id="ggb-canvas" class="jxgbox" style="position:absolute;inset:0;"></div>';
    if (!code) {
      $("status").textContent = "未生成图";
      if (window.HJ && window.HJ.clearScene) window.HJ.clearScene();
      return false;
    }
    if (window.HJFX) window.HJFX.count($("status"), code.length, function (v) { return "脚本 " + Math.round(v) + " 字节"; });
    else $("status").textContent = "脚本 " + code.length + " 字节";
    try { (new Function(code))(); autoFixCount = 0; try { fixAxes2D(window.board); } catch (eA) { console.warn("fixAxes2D", eA); } applyStyle2D(result && result.style2d); try { applyTex2D(window.board); } catch (eT) { console.warn("applyTex2D", eT); } try { ensureGrid2D(); } catch (eG) { console.warn("ensureGrid2D", eG); } try { window.HJGrid && window.HJGrid.apply(); } catch (eP) {} try { applyCanvasSkin(); } catch (eC) {} build2DUI(result); return true; }
    catch (e) {
      host.innerHTML = "";
      $("err").style.display = "block";
      $("err").textContent = "渲染出错：" + e.message;
      if (window.HJ && window.HJ.clearScene) window.HJ.clearScene();
      if (!noFix) autoFix("渲染报错：" + e.message);
      return false;
    }
  }

  // ================= 手动样式调整（左栏「对象样式」滑杆） =================
  // 2D：记录里存 style2d 映射；3D：直接改 render3d 场景 JSON。两者都随记录/版本/导出保存。
  var styleSaveTimer = 0;
  function scheduleStyleSave() {
    if (styleSaveTimer) clearTimeout(styleSaveTimer);
    styleSaveTimer = setTimeout(saveManualStyle, 300);
  }
  // 立刻把待写的样式落盘并清掉防抖定时器。
  // 任何「切换上下文」的动作（切版本 / 切记录 / 回首页）都必须先调它：
  // 否则 300ms 的定时器会在切换之后才触发，那时 last.result 已经换成新记录，
  // 就会把旧记录的手动样式写进新记录（或写丢）。
  function flushStyleSave() {
    if (!styleSaveTimer) return;
    clearTimeout(styleSaveTimer);
    styleSaveTimer = 0;
    try { saveManualStyle(); } catch (e) {}
  }
  function saveManualStyle() {
    styleSaveTimer = 0;
    if (!last || !last.result || !lastHistoryId) return;
    if (verPreviewVid) return;   // 版本预览中：不落盘
    var r = last.result;
    // 微调待确认：只改内存里的 pending 结果，等「存为新版本/覆盖当前版本」时随快照落盘
    if (pendingReview && pendingReview.next === r) return;
    var patch = { id: lastHistoryId };
    if (r.style2d) patch.style2d = r.style2d;
    if (r.render3d) patch.render3d = r.render3d;
    if (r.renderCode) patch.renderCode = r.renderCode;
    var lv = verCurrent(r);
    if (lv) {
      if (r.style2d) lv.style2d = r.style2d;
      if (r.render3d) lv.render3d = r.render3d;
      if (r.renderCode) lv.renderCode = r.renderCode;
    }
    var rec = recCache[lastHistoryId];
    if (rec) {
      if (patch.style2d) rec.style2d = patch.style2d;
      if (patch.render3d) rec.render3d = patch.render3d;
      if (patch.renderCode) rec.renderCode = patch.renderCode;
      var cv = verCurrent(rec);
      if (cv) {
        if (patch.style2d) cv.style2d = patch.style2d;
        if (patch.render3d) cv.render3d = patch.render3d;
        if (patch.renderCode) cv.renderCode = patch.renderCode;
      }
      recCache[lastHistoryId] = rec;
      patch.versions = rec.versions; patch.currentVid = rec.currentVid;
    }
    updateHistory(patch);
  }
  function style2D(key, attrs) {
    if (!last || !last.result || !key || !attrs || verPreviewVid) return;
    var map = last.result.style2d || (last.result.style2d = {});
    var cur = map[key] || (map[key] = {});
    Object.keys(attrs).forEach(function (k) { cur[k] = attrs[k]; });
    applyStyle2D(map);
    scheduleStyleSave();
  }
  function style3DChanged() { if (verPreviewVid) return; scheduleStyleSave(); }
  window.HJ._style2D = style2D;
  window.HJ._style3D = style3DChanged;
  window.HJ._styleLocked = function () { return !!verPreviewVid; };
  // 移动端设置页 / 首启向导用：复用同一套字段收集与静默保存
  window.HJ._cfgCollect = collect;
  window.HJ._cfgSaveQuiet = function () {
    var c = collect();
    if (c.baseUrl && c.apiKey && c.model) { saveCfg(c); return c; }
    return null;
  };
  window.HJ._cfgModel = function () { return loadCfg(); };
  window.HJ._histCount = function () { return history.length; };
  window.HJ._renderHistory = renderHistory;
  window.HJ._imageCount = function () { return images.length; };
  window.HJ._cropLast = function () {
    if (!images.length) return false;
    return cropOpen(images.length - 1);
  };
  window.HJ._cropPending = function () { return cropOpenPending(); };
  window.HJ._stageImage = function (file, allowSmall, from) { return stageImageFile(file, allowSmall, from); };
  window.HJ._discardPending = discardPending;
  window.HJ._plain = texPlainText;
  window.HJ._recent = function (n) {
    return history.slice(0, n || 3).map(function (x) {
      return { id: x.id, ts: x.ts, question: x.question, questionText: x.questionText,
        thumb: x.thumb, model: x.model, imgCount: x.imgCount, usage: x.usage };
    });
  };
  window.HJ._openRecord = function (id) {
    for (var i = 0; i < history.length; i++) {
      if (history[i].id === id) { loadRecord(history[i]); return true; }
    }
    return false;
  };

  // ================= 异步任务 + 任务面板（#3） + 流式（#7） =================
  var TK_KEY = "solver_tasks_v1";
  var TASKS = [];
  var taskSeq = 0;
  var solveSeq = 0;      // 解题任务发起序号（用于丢弃过期结果）
  var lastSolveSeq = 0;  // 已经应用到界面的最新解题序号
  var KIND_ICON = { solve: "📐", refine: "✨", autofix: "🩹", chat: "💬" };
  function taskSave() {
    try {
      // 追问任务的上下文在聊天记录里，不放进“刷新后恢复”的任务列表：
      // 否则页面刷新后没有对应的聊天输入，恢复出来也无法继续。
      var out = TASKS.filter(function (e) { return !(e.opts && e.opts.chat); }).slice(0, 12).map(function (e) {
        return { id: e.id, kind: e.kind, label: e.label, snippet: e.snippet, qFull: e.qFull, grade: e.grade, baseId: e.baseId, instruction: e.instruction || "", target: e.target || "", dim: e.dim || "", scope: e.scope || "", option: e.option || "", questionIndex: (typeof e.questionIndex === "number" ? e.questionIndex : -1), givenAnswer: e.givenAnswer || "", status: e.status, stage: e.stage, progress: e.progress, received: e.received, reasoning: e.reasoning || 0, ts: e.ts, doneAt: e.doneAt, error: e.error, message: e.message, recId: e.recId, auto: !!(e.opts && e.opts.auto) };
      });
      localStorage.setItem(TK_KEY, JSON.stringify(out));
    } catch (e) {}
  }
  function closeEntryES(e) { if (e.es) { try { e.es.close(); } catch (e2) {} e.es = null; } if (e.poll) { clearInterval(e.poll); e.poll = null; } }
  // 任务面板默认收起，点状态栏的「N 个进行中」展开（避免遮挡右栏解答）
  var panelOpen = false;
  // ================= 解题按钮状态机（beUI StatefulButton） =================
  // 有解题任务在跑 → busy（转圈）；最近一次解题刚完成 → 打勾脉冲；其余回「解题」。
  // 统一挂在 renderPanel 上（任务每次状态变化都会调它），不在各终点散落改按钮。
  var GO_IDLE_HTML = null, goStateCur = "";
  function goState(s) {
    if (s === goStateCur) return;
    goStateCur = s;
    var b = $("go"); if (!b) return;
    if (!GO_IDLE_HTML) GO_IDLE_HTML = b.innerHTML;
    if (s === "busy") {
      b.disabled = true; b.classList.remove("done"); b.classList.add("busy");
      b.innerHTML = '<svg class="ico hj-spin" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>解题中';
    } else if (s === "done") {
      b.disabled = false; b.classList.remove("busy"); b.classList.add("done");
      b.innerHTML = '<svg class="ico"><use href="#i-check"/></svg>完成';
      setTimeout(function () { if (goStateCur === "done") goState("idle"); }, 1400);
    } else {
      b.disabled = false; b.classList.remove("busy", "done");
      b.innerHTML = GO_IDLE_HTML;
    }
  }
  // ================= 微调按钮状态机（beUI StatefulButton，与 goState 同构） =================
  // 有微调/按答案重画/修正任务在跑 → busy；最近一次刚完成 → 打勾脉冲；其余回「微调」。
  // 审查锁（lockRefine，待确认/撤销回退期间禁用）是另一层：refineLocked 追踪它，
  // busy 结束/idle 都尊重它的 disabled，两套状态互不覆盖。
  var REFINE_IDLE_HTML = null, refineStateCur = "", refineStateLabel = "", refineLocked = false;
  function refineBusyText(label) {
    if (/重画/.test(label || "")) return "重画中";
    if (/修正/.test(label || "")) return "修正中";
    return "微调中";
  }
  function refineState(s, label) {
    if (s === refineStateCur && s !== "busy") return;
    if (s === "busy" && refineStateCur === "busy" && refineStateLabel === (label || "")) return;
    var b = $("btnRefine"); if (!b) return;
    if (!REFINE_IDLE_HTML) REFINE_IDLE_HTML = b.innerHTML;
    refineStateCur = s; refineStateLabel = label || "";
    if (s === "busy") {
      b.disabled = true; b.classList.remove("done"); b.classList.add("busy");
      b.innerHTML = '<svg class="ico hj-spin" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' + refineBusyText(label);
    } else if (s === "done") {
      b.disabled = refineLocked; b.classList.remove("busy"); b.classList.add("done");
      b.innerHTML = '<svg class="ico"><use href="#i-check"/></svg>已微调';
      setTimeout(function () { if (refineStateCur === "done") refineState("idle"); }, 1400);
    } else {
      b.disabled = refineLocked; b.classList.remove("busy", "done");
      b.innerHTML = REFINE_IDLE_HTML;
    }
  }
  function renderPanel() {
    // 解题按钮状态机（见 goState）：只看「解题」类任务；TASKS 新任务在前
    var goRunning = false;
    for (var gi = 0; gi < TASKS.length; gi++) {
      if (TASKS[gi].status !== "running") continue;
      if (TASKS[gi].kind === "solve") { goRunning = true; break; }
    }
    if (goRunning) goState("busy");
    else {
      var goLast = null;
      for (var gj = 0; gj < TASKS.length; gj++) if (TASKS[gj].kind === "solve") { goLast = TASKS[gj]; break; }
      if (goLast && goLast.doneAt && Date.now() - goLast.doneAt < 1500) goState(goLast.status === "done" ? "done" : "idle");
      else goState("idle");
    }
    // 微调按钮状态机：只看「微调/按答案重画/修正」类任务（kind refine/autofix）
    var rfRunning = null;
    for (var ri = 0; ri < TASKS.length; ri++) {
      var tk = TASKS[ri];
      if (tk.status !== "running" || (tk.kind !== "refine" && tk.kind !== "autofix")) continue;
      if (!rfRunning || (tk.ts || 0) > (rfRunning.ts || 0)) rfRunning = tk;
    }
    if (rfRunning) refineState("busy", rfRunning.label);
    else {
      var rfLast = null;
      for (var rj = 0; rj < TASKS.length; rj++) {
        var tk2 = TASKS[rj].kind;
        if (tk2 !== "refine" && tk2 !== "autofix") continue;
        rfLast = TASKS[rj]; break;
      }
      if (rfLast && rfLast.doneAt && Date.now() - rfLast.doneAt < 1500) refineState(rfLast.status === "done" ? "done" : "idle");
      else refineState("idle");
    }
    var runningTasks = TASKS.filter(function (t) { return t.status === "running"; });
    var running = runningTasks.length;
    var latest = null;
    for (var i = 0; i < runningTasks.length; i++) {
      if (!latest || (runningTasks[i].ts || 0) > (latest.ts || 0)) latest = runningTasks[i];
    }
    var latestPct = latest ? Math.max(0, Math.min(100, latest.progress || 0)) : 0;
    // 手机端：把每个任务自己的进度交给标题行内的进度条（微调 / 追问各一条）
    try {
      if (window.HJMobileInlineProgress) {
        window.HJMobileInlineProgress.update(runningTasks.map(function (t) {
          return {
            id: t.id, kind: t.kind || "", label: t.label || "", status: t.status,
            stage: t.stage || "", progress: t.progress || 0,
            received: t.received || 0, reasoning: t.reasoning || 0, ts: t.ts || 0
          };
        }));
      }
    } catch (e) {}
    // 手机端没有状态栏：把任务进度交给画布中央浮卡，别让解题过程变成未知状态
    try {
      if (window.HJMobileProgress) {
        window.HJMobileProgress.update(running, latest ? {
          stage: latest.stage || "", progress: latestPct, received: latest.received || 0,
          reasoning: latest.reasoning || 0,
          ts: latest.ts || 0, label: latest.label || "", kind: latest.kind || "", count: running
        } : null);
      }
    } catch (e) {}
    var p = $("taskPanel"); if (!p) return;
    // 题图/图片选择框右侧的主进度条（状态栏右下角的小进度条继续保留）
    var ip = $("imgProgress");
    if (ip) {
      if (running && latest) {
        var ipPct = Math.round(latestPct);
        ip.classList.add("on");
        ip.setAttribute("aria-valuenow", String(ipPct));
        ip.setAttribute("aria-valuetext", (latest.stage || "进行中") + " " + ipPct + "%");
        var ipStage = ip.querySelector(".ip-stage");
        var ipPctEl = ip.querySelector(".ip-pct");
        var ipFill = ip.querySelector(".ip-fill");
        if (ipStage) ipStage.textContent = (running > 1 ? "正在处理 " + running + " 个任务 · " : "") + (latest.label || "任务") + " · " + (latest.stage || "进行中");
        if (ipPctEl) ipPctEl.textContent = ipPct + "%";
        if (ipFill) ipFill.style.width = latestPct + "%";
        ip.title = "最新：" + (latest.label || "任务") + " · " + (latest.stage || "进行中") + " " + ipPct + "%";
      } else {
        ip.classList.remove("on");
        ip.setAttribute("aria-valuenow", "0");
        ip.removeAttribute("aria-valuetext");
        var ipFillOff = ip.querySelector(".ip-fill");
        if (ipFillOff) ipFillOff.style.width = "0%";
      }
      syncImgTools();
    }
    var sb = $("sbTask");
    if (sb) {
      sb.innerHTML = "";
      if (running) {
        var d = document.createElement("span"); d.className = "dot"; sb.appendChild(d);
        sb.appendChild(document.createTextNode(running + " 个进行中"));
        if (latest) {
          var track = document.createElement("span");
          track.className = "sb-progress";
          track.setAttribute("role", "progressbar");
          track.setAttribute("aria-valuemin", "0");
          track.setAttribute("aria-valuemax", "100");
          track.setAttribute("aria-valuenow", String(Math.round(latestPct)));
          var fill = document.createElement("i");
          fill.style.width = latestPct + "%";
          track.appendChild(fill);
          sb.appendChild(track);
          var pctEl = document.createElement("span");
          pctEl.className = "sb-pct";
          pctEl.textContent = Math.round(latestPct) + "%";
          sb.appendChild(pctEl);
        }
        sb.classList.add("busy");
        sb.title = latest
          ? ("最新：" + (latest.label || "任务") + " · " + (latest.stage || "进行中") + " " + Math.round(latestPct) + "%（点击查看全部）")
          : "点开查看任务进度";
      } else if (TASKS.length) {
        sb.appendChild(document.createTextNode("任务 " + TASKS.length + " 条"));
        sb.classList.remove("busy");
        sb.title = "查看任务记录";
      } else {
        sb.textContent = ""; sb.classList.remove("busy");
        sb.title = "查看任务记录";
      }
    }
    if (!TASKS.length) { p.style.display = "none"; p.innerHTML = ""; panelOpen = false; return; }
    var done = TASKS.length - running;
    p.style.display = panelOpen ? "block" : "none";
    if (!panelOpen) { p.innerHTML = ""; return; }
    p.innerHTML = "";
    var head = document.createElement("div"); head.className = "tp-head";
    var ht = document.createElement("span"); ht.className = "tp-head-t";
    ht.textContent = running ? (running + " 个进行中" + (done ? " · " + done + " 个已完成" : "")) : (done + " 个已完成");
    head.appendChild(ht);
    // 头部只留两个动作：清除已完成（次要，灰）｜收起（主要，强调色）。
    // 原来的 ✕ 和「收起」功能完全重复，删掉，避免三个控件挤在一行。
    var hb = document.createElement("span"); hb.className = "tp-head-acts";
    if (done) {
      var cb = document.createElement("button"); cb.className = "tp-clear"; cb.textContent = "清除已完成";
      cb.title = "清掉已完成 / 失败的任务记录（进行中的不受影响）";
      cb.onclick = function () { TASKS = TASKS.filter(function (t) { return t.status === "running"; }); taskSave(); renderPanel(); };
      hb.appendChild(cb);
    }
    var cl = document.createElement("button"); cl.className = "tp-clear accent"; cl.textContent = "收起";
    cl.title = "收起任务面板";
    cl.onclick = function () { panelOpen = false; renderPanel(); };
    hb.appendChild(cl);
    head.appendChild(hb);
    p.appendChild(head);
    function relTime(ts) {
      if (!ts) return "";
      var d = Date.now() - ts; if (d < 0) d = 0;
      if (d < 60000) return "刚刚";
      if (d < 3600000) return Math.floor(d / 60000) + " 分钟前";
      var dt = new Date(ts), h = dt.getHours(), m = dt.getMinutes();
      return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
    }
    function removeEntry(e) {
      if (e.status === "running") { fetch("/api/task/" + e.id + "/cancel", { method: "POST" }).catch(function () {}); closeEntryES(e); }
      TASKS = TASKS.filter(function (x) { return x !== e; });
      taskSave(); renderPanel();
    }
    TASKS.slice().sort(function (a, b) { return (b.status === "running" ? 1 : 0) - (a.status === "running" ? 1 : 0) || (b.ts || 0) - (a.ts || 0); }).forEach(function (e) {
      var bad = e.status === "error" || e.status === "lost";
      var icon = KIND_ICON[e.kind] || "📐";
      // 已完成 / 失败：紧凑单行（卡片只留给进行中的任务，避免面板被历史任务撑满）
      if (e.status !== "running") {
        var row = document.createElement("div");
        row.className = "tp-row" + (bad ? " bad" : "");
        row.setAttribute("data-id", e.id);
        var ic = document.createElement("span"); ic.className = "tp-ico"; ic.textContent = icon;
        var ti = document.createElement("span"); ti.className = "tp-row-title";
        ti.textContent = (e.label || "任务") + " · " + (texPlainText(e.snippet || "") || "(图片题)");
        var mt = document.createElement("span"); mt.className = "tp-row-meta";
        mt.textContent = e.status === "done" ? (relTime(e.ts) || "完成")
          : e.status === "lost" ? "已失效"
          : "失败：" + (e.errTitle || e.error || "错误");
        mt.title = bad ? (e.errHint || e.message || e.error || "错误") : (e.stage || "完成");
        var acts = document.createElement("span"); acts.className = "tp-row-acts";
        if (e.status === "done" && e.recId) {
          var vw = document.createElement("button"); vw.className = "tp-view"; vw.textContent = "查看";
          vw.onclick = function () {
            if (metaById(e.recId)) loadRecord(e.recId); else $("status").textContent = "记录已被删除，无法查看";
          };
          acts.appendChild(vw);
        }
        var rm2 = document.createElement("button"); rm2.className = "tp-x"; rm2.textContent = "✕";
        rm2.title = "移除这条记录";
        rm2.onclick = function () { removeEntry(e); };
        acts.appendChild(rm2);
        row.appendChild(ic); row.appendChild(ti); row.appendChild(mt); row.appendChild(acts);
        p.appendChild(row);
        return;
      }
      var c = document.createElement("div");
      c.className = "tp-card";
      c.setAttribute("data-id", e.id);
      var t1 = document.createElement("div"); t1.className = "tp-title";
      t1.textContent = icon + " " + (e.label || "任务") + " · " + (texPlainText(e.snippet || "") || "(图片题)");
      c.appendChild(t1);
      var st = document.createElement("div"); st.className = "tp-stage";
      st.textContent = e.stage || "进行中…";
      c.appendChild(st);
      var bar = document.createElement("div"); bar.className = "tp-bar";
      var fill = document.createElement("div"); fill.className = "tp-fill"; fill.style.width = Math.max(0, Math.min(100, e.progress || 0)) + "%";
      bar.appendChild(fill); c.appendChild(bar);
      var meta = document.createElement("div"); meta.className = "tp-meta";
      meta.textContent = Math.round(e.progress || 0) + "%" + (e.received ? " · 已接收 " + e.received + " 字" : "");
      c.appendChild(meta);
      var acts = document.createElement("div"); acts.className = "tp-acts";
      var cx2 = document.createElement("button"); cx2.textContent = "取消";
      cx2.onclick = function () { fetch("/api/task/" + e.id + "/cancel", { method: "POST" }).catch(function () {}); };
      acts.appendChild(cx2);
      var rm3 = document.createElement("button"); rm3.className = "rm"; rm3.textContent = "✕"; rm3.title = "取消并移除";
      rm3.onclick = function () { removeEntry(e); };
      acts.appendChild(rm3);
      c.appendChild(acts);
      p.appendChild(c);
    });
  }
  // ============ 错误文案：界面只说一句人话，完整信息进「日志」 ============
  // 与服务端 serve.js 的 classifyError 同一套口径；服务端没给 err（旧进程 / 纯网络错误）时本地兜底。
  var ERR_HINT = {
    NO_CONFIG: ["还没填模型配置", "点右上角「设置」，填好 baseUrl、API Key 和模型名"],
    EMPTY_REPLY: ["模型没返回内容", "重试一次；连着出现就换一个模型"],
    MODEL_NOT_JSON: ["模型没按格式回答", "重试一次；经常这样说明这个模型不擅长按格式输出，换一个"],
    VALIDATE_FAIL: ["图形数据不完整", "重试一次；多次失败可以把题目拆成小问分别解"],
    CANCELLED: ["已取消", ""],
    NO_TASK: ["任务已失效", "重新发起一次"],
    ERROR: ["出错了", "重试一次；还不行就点左下角「日志」看详情"]
  };
  var HTTP_HINT = {
    400: ["请求被模型拒绝", "多半是模型名写错、图片太大或内容超长，点「日志」看服务端原话"],
    401: ["API Key 无效", "检查设置里的 Key 是否填错或已过期"],
    402: ["API 额度不足", "去服务商充值，或换一个有额度的 Key"],
    403: ["没有访问权限", "这个 Key 不能用该模型，或所在地区不支持"],
    404: ["地址或模型不存在", "检查设置里的 baseUrl 结尾和模型名"],
    408: ["请求超时", "重试一次"],
    413: ["图片或内容太大", "换一张小一点的题图，或把题目拆短"],
    422: ["参数不被接受", "这个模型可能不支持 JSON 模式或图片，换一个模型"],
    429: ["请求太频繁", "等 10 秒再试，或别同时开多个任务"],
    500: ["模型服务出错", "服务商那边的问题，稍后重试"],
    502: ["模型服务暂时不可用", "稍后重试"],
    503: ["模型服务繁忙", "稍后重试"],
    504: ["模型服务超时", "稍后重试"]
  };
  // 把任务结果里的错误摊成 { title（≤10 字）, hint（一句怎么办）, code, http }
  function errInfo(d) {
    if (d && d.err && d.err.title) {
      return { title: d.err.title, hint: d.err.hint || "", code: d.err.code || d.error || "", http: d.err.http || 0 };
    }
    var code = String((d && d.error) || "ERROR");
    var msg = String((d && d.message) || "");
    var m = code.match(/^LLM_HTTP_(\d+)$/);
    if (m) {
      var st = Number(m[1]);
      var h = HTTP_HINT[st] || (st >= 500 ? ["模型服务出错", "服务商那边的问题，稍后重试"] : ["请求被拒绝", "检查模型配置后重试"]);
      return { title: h[0], hint: h[1], code: code, http: st };
    }
    if (/ECONNREFUSED/.test(msg)) return { title: "连不上模型服务", hint: "baseUrl 可能写错，或本地服务没启动", code: code, http: 0 };
    if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return { title: "找不到服务器地址", hint: "域名写错了，或者电脑断网了", code: code, http: 0 };
    if (/ETIMEDOUT|timed out|timeout/i.test(msg)) return { title: "请求超时", hint: "网络慢或模型响应太久，重试一次", code: code, http: 0 };
    if (/ECONNRESET|socket hang up|aborted/i.test(msg)) return { title: "连接被中断", hint: "网络或代理不稳定，重试一次", code: code, http: 0 };
    var t = ERR_HINT[code] || ERR_HINT.ERROR;
    return { title: t[0], hint: t[1], code: code, http: 0 };
  }

  function settle(entry, d) {
    if (!d || entry.terminal || entry.discard) return;
    if (d.progress != null) {
      entry.progress = d.progress; entry.stage = d.stage; entry.received = d.received;
      entry.reasoning = d.reasoning || 0;
      if (entry.opts.chat && d.partial != null) chatStreamSet(entry, d.partial);
      taskSave(); renderPanel();
    }
    if (d.status === "running") return;
    entry.terminal = true;
    closeEntryES(entry);
    if (d.status === "done") {
      retryShow(false);
      entry.status = "done"; entry.stage = "完成"; entry.doneAt = Date.now();
      taskSave(); renderPanel();
      if (entry.opts.chat) { chatFinish(entry, d.result); taskSave(); renderPanel(); return; }
      if (applyTaskResult(entry, d.result)) entry.recId = entry.baseId || lastHistoryId || "";
      taskSave(); renderPanel();
    } else {
      // 界面只留一句人话；原始 body / 堆栈全部进「日志」，想看细节点左下角。
      var info = errInfo(d);
      entry.status = "error"; entry.error = d.error; entry.message = d.message;
      entry.errTitle = info.title; entry.errHint = logHintText(info.hint); entry.errCode = info.code;
      entry.doneAt = Date.now();
      taskSave(); renderPanel();
      unlockAnsEdit();
      logMarkErr();
      if (entry.opts.chat) { chatFail(entry, d); return; }
      if (entry.opts.auto) { $("status").textContent = "自动修正失败：" + info.title; return; }
      $("status").textContent = "失败：" + info.title;
      $("answer").className = "hint"; $("analysis").className = "hint";
      $("answer").textContent = info.title;
      var hint = logHintText(info.hint || "重试一次");
      $("analysis").textContent = hint + (hint.indexOf("日志") >= 0 ? "" : "（完整信息见" + (isMobileUI() ? "「设置 → 诊断」" : "左下角「日志」") + "）");
      if (!entry.opts.chat && !entry.opts.auto && !entry.opts.update) retryShow(true);
    }
  }
  // 返回 false 表示结果已过期、未应用（调用方不要再覆盖任务记录 id）
  function applyTaskResult(entry, r) {
    unlockAnsEdit();
    if (!r) { $("status").textContent = "失败：未返回结果"; return true; }
    // 解题结果按发起顺序应用：更晚发起的题已经显示后，先发起的旧任务再返回就不覆盖
    // （页面刷新后恢复的旧任务 seq=0，一定会被新任务覆盖）
    if (!entry.opts.update && !entry.opts.auto) {
      if ((entry.seq || 0) < lastSolveSeq) {
        entry.stage = "结果已过期，未覆盖当前解答";
        return false;
      }
      lastSolveSeq = entry.seq || 0;
    }
    if ((entry.opts.update || entry.opts.auto) && !last) { entry.stage = "结果未应用，页面已刷新"; return true; }
    if (entry.opts.auto) { handleResult(r, true, true, entry); return true; }
    if (entry.opts.update) {
      draftClear(lastHistoryId); $("rin").value = ""; updCount(); rWarn("");
      handleResult(r, true, false, entry);
      return true;
    }
    handleResult(r, false, false, entry);
    return true;
  }
  function startPoll(entry) {
    if (entry.poll || entry.terminal) return;
    entry.poll = setInterval(function () {
      fetch("/api/task/" + entry.id).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.error === "NO_TASK") {
          entry.terminal = true; closeEntryES(entry);
          entry.status = "lost"; entry.stage = "任务已失效"; entry.doneAt = Date.now();
          taskSave(); renderPanel();
          return;
        }
        settle(entry, d);
      }).catch(function () {});
    }, 1500);
  }
  function watchTask(entry) {
    var url = "/api/task/" + entry.id + "/events";
    try {
      entry.es = new EventSource(url);
      entry.es.onmessage = function (ev) { var d; try { d = JSON.parse(ev.data); } catch (e) { return; } settle(entry, d); };
      entry.es.onerror = function () { if (entry.terminal) return; closeEntryES(entry); startPoll(entry); };
    } catch (e) { startPoll(entry); }
  }
  function runTask(url, body, label, opts) {
    opts = opts || {};
    retryShow(false);
    if (TASKS.filter(function (t) { return t.status === "running"; }).length >= 6) {
      $("status").textContent = "任务太多，最多 6 个进行中，请先等待或取消";
      return null;
    }
    var kind = opts.chat ? "chat" : (opts.auto ? "autofix" : (opts.update ? "refine" : "solve"));
    var chatMsg = (opts.chat && body.messages && body.messages.length) ? String(body.messages[body.messages.length - 1].content || "") : "";
    var entry = {
      id: "p" + Date.now().toString(36) + "_" + (++taskSeq),
      kind: kind, label: label,
      snippet: String(body.instruction || body.question || chatMsg || "").replace(/\s+/g, " ").slice(0, 22) || "图片题",
      qFull: body.question || "", grade: body.grade || "", baseId: opts.baseId || "",
      instruction: body.instruction || "", target: body.target || "", dim: body.dim || "",
      scope: body.scope || "", option: body.option || "",
      questionIndex: (typeof body.questionIndex === "number" ? body.questionIndex : -1),
      perQuestion: Array.isArray(body.perQuestion) ? body.perQuestion : null,
      givenAnswer: body.givenAnswer || "",
      images: Array.isArray(body.images) ? body.images.slice() : [],
      opts: { update: !!opts.update, auto: !!opts.auto, chat: !!opts.chat },
      seq: (opts.update || opts.auto || opts.chat) ? 0 : (++solveSeq),
      status: "running", stage: "提交任务…", progress: 3, received: 0, reasoning: 0,
      ts: Date.now(), doneAt: 0, error: "", message: "", recId: "",
      es: null, poll: null, terminal: false
    };
    TASKS.unshift(entry);
    taskSave(); renderPanel();
    if (!entry.opts.update && !entry.opts.chat) {
      $("meta").style.display = "none";
      $("answer").innerHTML = "…"; $("analysis").innerHTML = "…";
      $("answer").className = "hint"; $("analysis").className = "hint";
      $("subTabs").innerHTML = ""; $("subTabs").style.display = "none"; $("subLocate").innerHTML = "";
      window.HJTabs && window.HJTabs.sync($("subTabs"), false);
      ansEditClose();
      if ($("ansEditBtn")) $("ansEditBtn").style.display = "none";
      if ($("ansNote")) { $("ansNote").style.display = "none"; $("ansNote").innerHTML = ""; }
    }
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (entry.discard) return;
        if (!j || j.error) {
          entry.status = "error"; entry.error = (j && j.error) || "NO_TASK"; entry.message = (j && j.message) || ""; entry.doneAt = Date.now(); entry.terminal = true;
          entry.errTitle = errInfo({ error: entry.error, message: entry.message }).title;
          entry.errHint = errInfo({ error: entry.error, message: entry.message }).hint;
          taskSave(); renderPanel();
          if (entry.error === "NO_CONFIG") { openModal(); $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "请先配置模型"; }
          if (entry.opts.chat) { chatFail(entry, { error: entry.error, message: entry.message }); return; }
          if (!entry.opts.chat) unlockAnsEdit();
          if (entry.error !== "NO_CONFIG" && !entry.opts.auto) { $("status").textContent = "失败：" + entry.errTitle; }
          if (entry.error !== "NO_CONFIG") retryFailUI(entry, entry.errTitle, entry.errHint);
          return;
        }
        entry.id = j.taskId;
        taskSave();
        watchTask(entry);
      })
      .catch(function (e) {
        entry.status = "error"; entry.error = "NETWORK"; entry.message = e.message; entry.doneAt = Date.now(); entry.terminal = true;
        entry.errTitle = "网络请求失败"; entry.errHint = "检查网络后重试一次";
        taskSave(); renderPanel();
        if (entry.opts.chat) chatFail(entry, { error: "NETWORK", message: e.message });
        else { unlockAnsEdit(); $("status").textContent = "失败：" + entry.errTitle; retryFailUI(entry, entry.errTitle, entry.errHint); }
      });
    return entry;
  }
  function initTasks() {
    try {
      var arr = JSON.parse(localStorage.getItem(TK_KEY) || "[]") || [];
      arr.forEach(function (o) {
        if (o.kind === "chat") return;
        var running = o.status === "running";
        TASKS.push({
          id: o.id, kind: o.kind || "solve", label: o.label || "解题", snippet: o.snippet || "", qFull: o.qFull || "", grade: o.grade || "", baseId: o.baseId || "",
          instruction: o.instruction || "", target: o.target || "", dim: o.dim || "", scope: o.scope || "", option: o.option || "",
          questionIndex: (typeof o.questionIndex === "number" ? o.questionIndex : -1), givenAnswer: o.givenAnswer || "",
          opts: { update: o.kind === "refine" || o.kind === "autofix", auto: !!o.auto },
          status: running ? "running" : o.status, stage: o.stage || "", progress: o.progress || 0, received: o.received || 0, reasoning: o.reasoning || 0,
          ts: o.ts || Date.now(), doneAt: o.doneAt || 0, error: o.error || "", message: o.message || "", recId: o.recId || "",
          es: null, poll: null, terminal: !running
        });
      });
      renderPanel();
      TASKS.filter(function (e) { return e.status === "running"; }).forEach(function (e) { startPoll(e); });
    } catch (e) {}
  }
  function autoFix(msg) {
    if (verPreviewVid) { verExitPreview(); return; }
    if (pendingReview) { revertPending("新微调结果渲染失败，已自动回退"); return; }
    if (!last || !last.result) return;
    if (autoFixCount >= 2) { $("status").textContent = "图形渲染失败，已自动修正 2 次仍失败"; return; }
    autoFixCount++;
    $("status").textContent = "图形渲染失败，正在自动修正，第 " + autoFixCount + " 次…";
    refine("上次生成的脚本在本机渲染时报错：" + msg + "。请修正该错误并重新输出完整 JSON。", true);
  }

  // ================= 微调（#4） =================
  var DRAFT_KEY = "solver_refine_draft_v1";
  var RSPREF_KEY = "solver_refine_prefs_v1";
  function draftLoad(id) { if (!id) return ""; try { var m = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); return typeof m[id] === "string" ? m[id] : ""; } catch (e) { return ""; } }
  function draftSave(id, text) {
    if (!id) return;
    try {
      var m = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") || {};
      if (String(text || "").trim()) m[id] = text; else delete m[id];
      localStorage.setItem(DRAFT_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  function draftClear(id) {
    if (!id) return;
    try { var m = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") || {}; delete m[id]; localStorage.setItem(DRAFT_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function rprefLoad(id) { if (!id) return null; try { var m = JSON.parse(localStorage.getItem(RSPREF_KEY) || "{}") || {}; return m[id] || null; } catch (e) { return null; } }
  function rprefSave(id, prefs) {
    if (!id) return;
    try { var m = JSON.parse(localStorage.getItem(RSPREF_KEY) || "{}") || {}; m[id] = prefs || {}; localStorage.setItem(RSPREF_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function rprefClear(id) {
    if (!id) return;
    try { var m = JSON.parse(localStorage.getItem(RSPREF_KEY) || "{}") || {}; delete m[id]; localStorage.setItem(RSPREF_KEY, JSON.stringify(m)); } catch (e) {}
  }
  // 微调选项（改什么 / 换不换图形类型），全局记忆
  var ROPT_KEY = "solver_refine_opts_v1";
  function roptTarget() { return $("rtarget") ? ($("rtarget").value || "auto") : "auto"; }
  function roptDim() { return $("rdim") ? ($("rdim").value || "") : ""; }
  function roptSave() {
    try { localStorage.setItem(ROPT_KEY, JSON.stringify({ target: roptTarget(), dim: roptDim() })); } catch (e) {}
  }
  function roptLoad() {
    try {
      var m = JSON.parse(localStorage.getItem(ROPT_KEY) || "{}") || {};
      if ($("rtarget") && m.target) $("rtarget").value = m.target;
      if ($("rdim") && m.dim != null) $("rdim").value = m.dim;
    } catch (e) {}
  }
  if ($("rtarget")) $("rtarget").onchange = function () { roptSave(); };
  if ($("rdim")) $("rdim").onchange = function () { roptSave(); };
  roptLoad();
  function setRin(text) { $("rin").value = text; draftSave(lastHistoryId, text); updCount(); $("rin").focus(); }

  // ================= 微调审查流（待确认 / 撤销回退） =================
  var pendingReview = null;
  function lockRefine() {
    refineLocked = true;
    $("btnRefine").disabled = true; $("btnRefine").title = "请先处理当前 AI 微调结果：存为新版本、覆盖当前版本或撤销回退";
    var ae = $("ansEditBtn"); if (ae) { ae.disabled = true; ae.title = $("btnRefine").title; }
  }
  function unlockRefine() {
    refineLocked = false;
    $("btnRefine").disabled = false; $("btnRefine").title = "";
    var ae = $("ansEditBtn"); if (ae) { ae.disabled = false; ae.title = ""; }
  }
  function unlockAnsEdit() { var b = $("ansEditBtn"); if (b) { b.disabled = false; b.textContent = "改答案"; } }
  function showReviewBar() {
    var box = $("rbKeepQs");
    if (box) {
      box.innerHTML = "";
      var p = pendingReview;
      var qs = (p && p.perQuestion) ? p.perQuestion.map(function (x) { return x.i; }) : [];
      if (qs.length) {
        var h = document.createElement("span"); h.className = "kq-h"; h.textContent = "保留：";
        box.appendChild(h);
        qs.forEach(function (qi) {
          var lb = document.createElement("label");
          var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true; cb.dataset.qi = qi;
          lb.appendChild(cb);
          lb.appendChild(document.createTextNode(subLabel(qi)));
          box.appendChild(lb);
        });
      }
    }
    $("reviewBar").classList.add("show");
  }
  function hideReviewBar() { $("reviewBar").classList.remove("show"); }
  function snapshotRec(rec) {
    var o = {};
    ["answer", "analysis", "questionText", "figureBox", "renderCode", "render3d", "style2d", "steps", "controls", "focusTargets", "subQuestions", "usage", "elapsedMs", "cost", "refined", "answerAdjusted", "answerNote", "givenAnswer", "givenScope", "givenQuestionIndex", "givenOption", "givenFromImage", "givenAnswerText", "promptVer", "promptHash", "promptChannel", "promptBytes", "routeExpected", "routeActual", "routeRetried", "routeIssue", "stepsMissing", "warnings"].forEach(function (k) { o[k] = rec ? rec[k] : undefined; });
    return o;
  }

  // ================= 微调记录（版本快照，方案 1） =================
  // 记录 body 里新增 versions[]，每次微调追加一个版本而不是覆盖；currentVid 指向当前版本。
  // 顶层字段始终是「当前版本」的镜像 —— 渲染 / 历史列表 / 缩略图 / 导出 / 拖回全部沿用旧逻辑。
  // usage / elapsedMs / cost 也按版本快照：微调记录里要能看到每一版自己的 token 与资费。
  var VER_FIELDS = ["answer", "analysis", "renderCode", "render3d", "style2d", "steps", "controls", "focusTargets", "subQuestions", "questionText", "figureBox", "usage", "elapsedMs", "cost", "answerAdjusted", "answerNote", "givenAnswer", "givenScope", "givenQuestionIndex", "givenOption", "givenFromImage", "givenAnswerText", "promptVer", "promptHash", "promptChannel", "promptBytes", "routeExpected", "routeActual", "routeRetried", "routeIssue", "stepsMissing", "warnings"];
  var VER_MAX = 12;   // 单条记录最多保留的版本数（含初始版）
  function verSnapshot(rec, extra) {
    var v = { vid: 0, ts: Date.now(), kind: "solve", label: "" };
    // 所有字段都显式快照（缺省记 null）：否则 3D→2D 的版本里没有 render3d 键，
    // 切回该版本时旧的 render3d 不会被清掉，仍会渲染成 3D。
    VER_FIELDS.forEach(function (k) { v[k] = (rec && rec[k] !== undefined) ? rec[k] : null; });
    if (extra) Object.keys(extra).forEach(function (k) { v[k] = extra[k]; });
    return v;
  }
  function verShape(rec) {
    // 惰性兼容：老记录没有 versions → 把顶层当成 v1（只在内存里补，不单独落盘）
    if (rec && Array.isArray(rec.versions) && rec.versions.length) return rec.versions;
    if (!rec) return [];
    rec.versions = [verSnapshot(rec, { vid: 1, kind: "solve", label: "初始解答" })];
    rec.currentVid = 1;
    return rec.versions;
  }
  function verCurrent(rec) {
    var list = verShape(rec);
    if (!list.length) return null;
    var cur = rec && rec.currentVid;
    for (var i = 0; i < list.length; i++) if (list[i].vid === cur) return list[i];
    return list[list.length - 1];
  }
  function verNextId(rec) {
    var list = verShape(rec), mx = 0;
    list.forEach(function (v) { if (v && v.vid > mx) mx = v.vid; });
    return mx + 1;
  }
  function verFigKind(v) { return v && v.render3d ? "3D" : (v && v.renderCode ? "2D" : "无图"); }
  function verAutoLabel(v) {
    if (!v) return "";
    if (v.label) return v.label;
    if (v.kind === "solve") return "初始解答";
    var bits = [];
    if (v.dim === "2d") bits.push("2D 平面图");
    else if (v.dim === "3d") bits.push("3D 立体图");
    if (v.target === "text") bits.push("只改解析");
    else if (v.target === "figure") bits.push("只改图形");
    else if (v.target === "answer") {
      bits.push("按答案重画");
      if (v.givenScope === "current" && v.givenQuestionIndex >= 0) bits.push("第 (" + (v.givenQuestionIndex + 1) + ") 问");
    }
    if (!bits.length) bits.push(verFigKind(v) === "无图" ? "微调" : verFigKind(v) + " 图形");
    return bits.join(" · ");
  }
  function verView(rec, v) {
    var out = Object.assign({}, rec);
    VER_FIELDS.forEach(function (k) { out[k] = (v && v[k] !== undefined) ? v[k] : null; });
    return out;
  }
  // 把某个版本写回顶层（不落盘，调用方决定何时保存）
  function verApplyTo(rec, v) {
    if (!rec || !v) return rec;
    VER_FIELDS.forEach(function (k) { rec[k] = (v[k] === undefined ? null : v[k]); });
    rec.currentVid = v.vid;
    rec.refined = Math.max(0, verShape(rec).length - 1);
    return rec;
  }
  function verAppend(rec, v) {
    var list = verShape(rec).slice();
    list.push(v);
    if (list.length > VER_MAX) list = list.slice(list.length - VER_MAX);
    rec.versions = list;
    rec.currentVid = v.vid;
    return rec;
  }
  function verDrop(rec, vid) {
    var list = verShape(rec).filter(function (v) { return v.vid !== vid; });
    rec.versions = list;
    if (rec.currentVid === vid) rec.currentVid = list.length ? list[list.length - 1].vid : 0;
    return rec;
  }
  function verTime(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  // ================= 微调记录抽屉（渲染 + 预览 + 切回） =================
  var verOpen = false, verPreviewVid = 0;
  try { verOpen = localStorage.getItem("solver_ver_open_v1") === "1"; } catch (e) {}
  function verStateRec() {
    var rec = (lastHistoryId && recCache[lastHistoryId]) || null;
    if (rec) return rec;
    return (last && last.result) || null;
  }
  function verCostLine(v, curVid, rec) {
    // 新版本自带 usage/cost；旧记录里没有的，只在它是当前版时用记录顶层数据兜底。
    var u = v.usage || (v.vid === curVid && rec ? rec.usage : null);
    var tt = (u && u.total_tokens != null) ? u.total_tokens
      : ((u && u.prompt_tokens != null && u.completion_tokens != null) ? u.prompt_tokens + u.completion_tokens : null);
    var cost = v.cost || "";
    if (!cost && u) cost = costText(u, (rec && rec.model) || (last && last.cfg && last.cfg.model) || "", last && last.cfg);
    var text = "tokens " + (tt != null ? tt : "—") + " · 资费 " + (cost || "—");
    var title = "";
    if (u) {
      title = "输入 " + (u.prompt_tokens != null ? u.prompt_tokens : "?") +
        " / 输出 " + (u.completion_tokens != null ? u.completion_tokens : "?") +
        (u.estimated ? "（估算）" : "");
    }
    return { text: text, title: title };
  }
  function renderVersions() {
    var box = $("verCard"); if (!box) return;
    var rec = verStateRec();
    var list = rec ? verShape(rec) : [];
    // 只有 1 个版本（还没微调过 / 已删到只剩 1 版）就不占地方
    if (!list.length || list.length < 2) { box.style.display = "none"; return; }
    box.style.display = "";
    box.classList.toggle("open", verOpen);
    var curVid = rec.currentVid || (list[list.length - 1] || {}).vid;
    if (!verOpen) {
      $("verCount").textContent = list.length + " 个版本";
      return;
    }
    $("verCount").textContent = list.length + " 个版本";
    var box2 = $("verList"); box2.innerHTML = "";
    // 新的在上面
    list.slice().sort(function (a, b) { return (b.vid || 0) - (a.vid || 0); }).forEach(function (v) {
      var it = document.createElement("div");
      it.className = "ver-item" + (v.vid === curVid ? " cur" : "");
      it.setAttribute("data-vid", String(v.vid));
      var dot = document.createElement("span"); dot.className = "ver-dot"; it.appendChild(dot);
      var main = document.createElement("div"); main.className = "ver-main";
      var l1 = document.createElement("div"); l1.className = "ver-l1";
      var nm = document.createElement("b"); nm.textContent = "v" + v.vid; l1.appendChild(nm);
      var kind = verFigKind(v);
      var bg = document.createElement("span");
      bg.className = "ver-badge" + (kind === "3D" ? " d3" : (kind === "2D" ? " d2" : ""));
      bg.textContent = kind; l1.appendChild(bg);
      var lb = document.createElement("span"); lb.textContent = verAutoLabel(v); l1.appendChild(lb);
      if (v.vid === curVid) { var nw = document.createElement("span"); nw.className = "ver-now"; nw.textContent = "当前"; l1.appendChild(nw); }
      var tm = document.createElement("span"); tm.className = "ver-time"; tm.textContent = verTime(v.ts);
      l1.appendChild(tm);
      main.appendChild(l1);
      var vc = verCostLine(v, curVid, rec);
      var costEl = document.createElement("div");
      costEl.className = "ver-cost";
      costEl.textContent = vc.text;
      if (vc.title) costEl.title = vc.title;
      main.appendChild(costEl);
      if (v.instruction) {
        var ins = document.createElement("div"); ins.className = "ver-ins";
        ins.textContent = "「" + v.instruction + "」";
        ins.title = v.instruction;
        main.appendChild(ins);
      }
      it.appendChild(main);
      var acts = document.createElement("span"); acts.className = "ver-acts";
      if (v.vid !== curVid) {
        var use = document.createElement("button");
        use.title = "设为当前";
        use.innerHTML = '<svg class="ico-sm"><use href="#i-check"/></svg>';
        use.onclick = function (ev) { ev.stopPropagation(); verSwitch(v.vid); };
        acts.appendChild(use);
      }
      var cp = document.createElement("button");
      cp.title = "复制为新记录（两版并存，互不影响）";
      cp.innerHTML = '<svg class="ico-sm"><use href="#i-copy"/></svg>';
      cp.onclick = function (ev) { ev.stopPropagation(); verFork(v.vid); };
      acts.appendChild(cp);
      if (list.length > 1) {
        var rm = document.createElement("button"); rm.className = "danger"; rm.title = "删除这一版";
        rm.innerHTML = '<svg class="ico-sm"><use href="#i-trash-2"/></svg>';
        rm.onclick = function (ev) { ev.stopPropagation(); verRemove(v.vid); };
        acts.appendChild(rm);
      }
      it.appendChild(acts);
      it.onclick = function () { verPreview(v.vid); };
      box2.appendChild(it);
    });
  }
  function verPreview(vid) {
    var rec = verStateRec(); if (!rec) return;
    var list = verShape(rec), v = null;
    for (var i = 0; i < list.length; i++) if (list[i].vid === vid) v = list[i];
    if (!v || !last) return;
    var curVid = rec.currentVid || 0;
    flushStyleSave();                    // 先把待写的样式落盘，再切上下文
    verPreviewVid = (vid === curVid) ? 0 : vid;
    // 预览只影响内存里的 last.result，不写记录
    var view = verView(rec, v);
    view.versions = rec.versions; view.currentVid = v.vid;
    last.result = view;
    renderResult(view);
    if (verPreviewVid) {
      var bar = $("verPreview");
      bar.classList.add("show");
      $("verPreviewTxt").textContent = "预览 v" + v.vid + " · " + verFigKind(v);
      $("status").textContent = "正在预览 v" + v.vid + "（未保存）";
    } else {
      $("verPreview").classList.remove("show");
      $("status").textContent = "已回到当前版本 v" + curVid;
    }
    renderVersions();
  }
  function verExitPreview() {
    flushStyleSave();
    verPreviewVid = 0;
    $("verPreview").classList.remove("show");
    var rec = verStateRec();
    if (rec && last) { last.result = Object.assign({}, rec); renderResult(last.result); }
    renderVersions();
  }
  function verSwitch(vid) {
    var rec = recCache[lastHistoryId] || null;
    if (!rec) return;
    var list = verShape(rec), v = null;
    for (var i = 0; i < list.length; i++) if (list[i].vid === vid) v = list[i];
    if (!v) return;
    flushStyleSave();
    verApplyTo(rec, v);
    recCache[lastHistoryId] = rec;
    var patch = Object.assign({ id: lastHistoryId }, snapshotRec(rec), { versions: rec.versions, currentVid: rec.currentVid });
    updateHistory(patch);
    if (last) last.result = Object.assign({}, rec);
    verPreviewVid = 0;
    $("verPreview").classList.remove("show");
    renderResult(rec);
    renderVersions();
    $("status").textContent = "已切换到 v" + vid + "（" + verFigKind(v) + "）";
  }
  function verFork(vid) {
    var rec = recCache[lastHistoryId] || null;
    if (!rec) return;
    var list = verShape(rec), v = null;
    for (var i = 0; i < list.length; i++) if (list[i].vid === vid) v = list[i];
    if (!v) return;
    var nid = "r" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    var copy = verView(rec, v);
    copy.id = nid; copy.ts = Date.now(); copy.refined = 0;
    delete copy.versions; delete copy.currentVid;
    copy.parentId = lastHistoryId;
    recCache[nid] = copy;
    metaApply(copy, null);
    renderHistory();
    makeThumb(copy.images && copy.images[0], function (thumb) {
      storePost("/api/store/save", { record: copy, thumb: thumb }, function (j) {
        if (j && j.error) $("status").textContent = "复制失败：" + (j.message || j.error);
      });
    });
    $("status").textContent = "已把 v" + vid + " 复制为一条新记录（历史里可找到）";
  }
  async function verRemove(vid) {
    var rec = recCache[lastHistoryId] || null;
    if (!rec) return;
    var list = verShape(rec);
    if (list.length <= 1) return;
    var v = null;
    for (var i = 0; i < list.length; i++) if (list[i].vid === vid) v = list[i];
    if (!v) return;
    if (!(await hjConfirm({
      title: "删除 v" + vid + "？",
      message: "删除后无法恢复，但其他版本不受影响。",
      okText: "删除",
      danger: true,
      native: "删除 v" + vid + "（" + verFigKind(v) + "）？\n\n删除后无法恢复，但其他版本不受影响。"
    }))) return;
    var wasCur = (rec.currentVid === vid);
    verDrop(rec, vid);
    if (wasCur) {
      var nv = verCurrent(rec);
      if (nv) verApplyTo(rec, nv);
    }
    recCache[lastHistoryId] = rec;
    updateHistory(Object.assign({ id: lastHistoryId }, snapshotRec(rec), { versions: rec.versions, currentVid: rec.currentVid }));
    if (last) last.result = Object.assign({}, rec);
    verPreviewVid = 0;
    $("verPreview").classList.remove("show");
    renderResult(rec);
    renderVersions();
    $("status").textContent = "已删除 v" + vid;
  }
  if ($("verToggle")) $("verToggle").onclick = function () {
    verOpen = !verOpen;
    try { localStorage.setItem("solver_ver_open_v1", verOpen ? "1" : "0"); } catch (e) {}
    renderVersions();
  };
  if ($("verPreviewBack")) $("verPreviewBack").onclick = verExitPreview;

  function commitPending(mode) {
    if (!pendingReview) return;
    var p = pendingReview; pendingReview = null; hideReviewBar(); unlockRefine();
    var keep = (mode === "replace") ? "replace" : "version";
    var base = recCache[p.recId] || null;
    var next = snapshotRec(p.next);
    // 「保留哪几道小题」：没勾的小题从旧记录取回，勾了的用这次的新结果
    var keepBox = $("rbKeepQs");
    if (keepBox && p.perQuestion && p.perQuestion.length) {
      var boxes = [].slice.call(keepBox.querySelectorAll("input[type=checkbox]"));
      if (boxes.length) {
        var kept = {}, keptN = 0;
        boxes.forEach(function (cb) { if (cb.checked) { kept[cb.dataset.qi] = true; keptN++; } });
        if (!keptN) { $("status").textContent = "请至少保留一道小题（全不勾等于放弃这次微调）"; return; }
        if (keptN < p.perQuestion.length) {
          var oldSubs = (p.old && p.old.subQuestions) || [];
          var newSubs = next.subQuestions || [];
          next.subQuestions = newSubs.map(function (sub, i) { return kept[i] ? sub : (oldSubs[i] || sub); });
          // 整段 analysis 也用合并后的各问重拼：只改 subQuestions 的话，"取消勾选"只在小问视图里生效，
          // 导出 / 纯文本 / 下一轮微调读到的还是新文字（§72.11 限制 1）。
          // 总述沿用旧解析里第一问之前的那段；某问没有 analysis 时回落到旧解析里同标签的段落。
          var ob = anaSplit((p.old && p.old.analysis) || "");
          var oldByTag = {};
          (ob || []).forEach(function (b) { oldByTag[b.tag] = b.text; });
          var parts = [];
          if (ob && ob.lead) parts.push(ob.lead);
          next.subQuestions.forEach(function (sub, i) {
            var lb = String((sub && sub.label) || ("(" + (i + 1) + ")"));
            var tx = String((sub && sub.analysis) || "").trim() || oldByTag[lb] || "";
            if (tx) parts.push(lb + " " + tx);
          });
          if (parts.length) next.analysis = parts.join("\n\n");
        }
      }
    }
    // 用原始记录做底，避免 recCache 缺失时丢题干/图片
    var rec = base ? base : Object.assign({ id: p.recId }, snapshotRec(p.old), { question: (last && last.question) || "", images: (last && last.images) || [] });
    var cur = verCurrent(rec);
    var given = next.givenAnswer || p.givenAnswer || "";
    var v = Object.assign({}, next, {
      vid: keep === "replace" && cur ? cur.vid : verNextId(rec),
      ts: Date.now(),
      kind: "refine",
      label: p.label || "",
      instruction: p.instruction || "",
      target: p.target || "",
      dim: p.dim || "",
      scope: p.scope || "",
      option: p.option || "",
      givenAnswer: given || null,
      givenScope: given ? (next.givenScope || p.scope || "all") : null,
      givenQuestionIndex: given ? (next.givenQuestionIndex != null ? next.givenQuestionIndex : p.questionIndex) : null,
      givenOption: given ? (next.givenOption || p.option || null) : null
    });
    // 这一版自己的花费：token 来自本次微调响应，资费按当前模型价格表估算。
    v.usage = next.usage || null;
    v.elapsedMs = next.elapsedMs != null ? next.elapsedMs : null;
    v.cost = costText(v.usage, (last && last.cfg && last.cfg.model) || (rec && rec.model) || "", last && last.cfg) || next.cost || "";
    if (keep === "replace" && cur) {
      var list = verShape(rec).map(function (x) { return x.vid === cur.vid ? Object.assign({}, v, { vid: cur.vid }) : x; });
      rec.versions = list;
    } else {
      verAppend(rec, v);
    }
    verApplyTo(rec, v);
    rec.refined = Math.max(0, verShape(rec).length - 1);
    recCache[p.recId] = rec;
    updateHistory(Object.assign({ id: p.recId }, snapshotRec(rec), { versions: rec.versions, currentVid: rec.currentVid, refined: rec.refined }));
    renderVersions();
    if (last && last.result) {
      last.result.versions = rec.versions; last.result.currentVid = rec.currentVid;
      last.result.usage = rec.usage || null;
      last.result.elapsedMs = rec.elapsedMs != null ? rec.elapsedMs : null;
      last.result.cost = rec.cost || "";
    }
  }
  function cancelPending() { if (!pendingReview) return; pendingReview = null; hideReviewBar(); unlockRefine(); }
  function revertPending(reason) {
    if (!pendingReview) return;
    var p = pendingReview; pendingReview = null; hideReviewBar(); unlockRefine();
    var rec = recCache[p.recId] || null;
    var back = rec ? Object.assign({}, rec) : Object.assign({}, p.old);
    if (last) { last.result = back; renderResult(back); }
    $("status").textContent = reason ? ("已自动回退原版，" + reason) : "已撤销微调，恢复原版";
  }
  $("rbKeep").onclick = function () { if (!pendingReview) return; commitPending("version"); $("status").textContent += " · 已存为新版本"; };
  $("rbOverwrite").onclick = function () { if (!pendingReview) return; commitPending("replace"); $("status").textContent += " · 已覆盖当前版本"; };
  $("rbRevert").onclick = function () { revertPending(""); };
  $("rbLocate").onclick = function () {
    var c = $("canvasHost");
    c.style.transition = "box-shadow .25s"; c.style.boxShadow = "inset 0 0 0 4px #5b5bd6";
    setTimeout(function () { c.style.boxShadow = ""; }, 900);
  };
  window.addEventListener("beforeunload", function () { commitPending(); });
  // 多选状态：sel = {小题下标: true}，txt = {小题下标: 该问的微调意见}
  var MSC = { sel: {}, txt: {}, sig: "" };
  function subLabel(i) {
    var s = subQs && subQs[i];
    return (s && s.label) || ("(" + (i + 1) + ")");
  }
  function mselSync() {
    var btn = $("rscopeBtn"), all = $("rscopeAll");
    if (!btn) return;
    var picked = Object.keys(MSC.sel);
    if (!all || all.checked || !picked.length) { btn.textContent = "全部小题"; btn.classList.remove("on"); return; }
    if (picked.length === 1) btn.textContent = "仅 " + subLabel(parseInt(picked[0], 10));
    else btn.textContent = "已选 " + picked.length + " 问";
    btn.classList.add("on");
  }
  function buildMultiScope(items) {
    var list = $("rscopeList"), all = $("rscopeAll");
    if (!list) return;
    var sig = items.map(function (it) { return it.t; }).join("|");
    if (MSC.sig !== sig) { MSC = { sel: {}, txt: {}, sig: sig }; }   // 换了一道题就清空
    list.innerHTML = "";
    items.forEach(function (it) {
      var qi = parseInt(it.v, 10);
      var row = document.createElement("div");
      row.className = "msel-row" + (MSC.sel[qi] ? " on" : "");
      row.dataset.qi = qi;
      var lb = document.createElement("label");
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!MSC.sel[qi];
      lb.appendChild(cb);
      lb.appendChild(document.createTextNode(it.t));
      var inp = document.createElement("input");
      inp.className = "msel-in"; inp.maxLength = 120;
      inp.placeholder = "这一问怎么改（可留空）";
      inp.value = MSC.txt[qi] || "";
      inp.oninput = function () { MSC.txt[qi] = inp.value; };
      cb.onchange = function () {
        if (cb.checked) { MSC.sel[qi] = true; row.classList.add("on"); }
        else { delete MSC.sel[qi]; row.classList.remove("on"); }
        if (all) all.checked = false;
        mselSync();
      };
      row.appendChild(lb); row.appendChild(inp);
      list.appendChild(row);
    });
    if (all) all.checked = !Object.keys(MSC.sel).length;
    mselSync();
  }
  function renderScope() {
    var sel = $("rscope"), wrap = $("rscopeWrap");
    if (!sel || !wrap) return;
    var cfg = scopeItems();
    if (!cfg) { sel.style.display = "none"; sel.innerHTML = ""; wrap.style.display = "none"; return; }
    if (cfg.multi) {
      sel.style.display = "none";
      wrap.style.display = "";
      buildMultiScope(cfg.items);
      return;
    }
    wrap.style.display = "none";
    sel.style.display = "";
    sel.innerHTML = "";
    var all = document.createElement("option"); all.value = "-1"; all.textContent = cfg.all; sel.appendChild(all);
    cfg.items.forEach(function (it) {
      var o = document.createElement("option"); o.value = it.v; o.textContent = it.t;
      sel.appendChild(o);
    });
    var pref = rprefLoad(lastHistoryId) || {};
    var want = pref.option ? ("o:" + String(pref.option).toUpperCase())
      : (typeof pref.questionIndex === "number" && pref.questionIndex >= 0 ? String(pref.questionIndex) : "-1");
    var has = [].slice.call(sel.options).some(function (o) { return o.value === want; });
    sel.value = has ? want : "-1";
    sel.onchange = function () {
      var v = String(sel.value);
      if (v.indexOf("o:") === 0) rprefSave(lastHistoryId, { option: v.slice(2) });
      else rprefSave(lastHistoryId, { questionIndex: parseInt(v, 10) });
    };
  }
  // 能微调的「范围」：优先小问（subQuestions），否则看解析是不是按选项 A．B．C．分段的
  function scopeItems() {
    if (subQs && subQs.length >= 2) {
      return { all: "全部小题", multi: true, items: subQs.map(function (s, i) {
        return { v: String(i), t: ((s && s.label) || ("(" + (i + 1) + ")")) };
      }) };
    }
    var r = last && last.result;
    var blocks = r ? anaSplit(r.analysis) : null;
    if (!blocks || blocks.length < 2) return null;
    var letters = blocks.filter(function (b) { return /^[A-H]$/.test(b.tag); });
    // 只有「整段解析都是选项」时才提供按选项微调，避免误判普通段落
    if (letters.length !== blocks.length) return null;
    return { all: "全部选项", items: letters.map(function (b) { return { v: "o:" + b.tag, t: "仅选项 " + b.tag }; }) };
  }
  function curRefineScope() {
    var out = { questionIndex: -1, scope: "all", option: "", perQuestion: [] };
    var wrap = $("rscopeWrap");
    if (wrap && wrap.style.display !== "none") {
      var all = $("rscopeAll");
      if (all && all.checked) return out;                    // 全部小题
      var picked = Object.keys(MSC.sel).map(Number).sort(function (a, b) { return a - b; })
        .map(function (qi) { return { i: qi, text: String(MSC.txt[qi] || "").trim() }; });
      if (picked.length === 1) { out.questionIndex = picked[0].i; out.scope = "current"; }
      else if (picked.length > 1) { out.scope = "multi"; }
      out.perQuestion = picked;
      return out;
    }
    var sel = $("rscope");
    if (sel && sel.style.display !== "none" && sel.value) {
      var v = String(sel.value);
      if (v.indexOf("o:") === 0) { out.option = v.slice(2); out.scope = "option"; }
      else { var qi = parseInt(v, 10); if (qi >= 0) { out.questionIndex = qi; out.scope = "current"; } }
    }
    return out;
  }
  (function initMsel() {
    var btn = $("rscopeBtn"), pop = $("rscopePop"), all = $("rscopeAll");
    if (!btn || !pop) return;
    // 弹层用 fixed 定位：微调区 #refine / #rightPanel 都是 overflow:hidden，absolute 会被裁掉
    function mselOpen() {
      var r = btn.getBoundingClientRect();
      pop.style.position = "fixed";
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 372)) + "px";
      pop.style.bottom = (window.innerHeight - r.top + 6) + "px";
      pop.style.width = "min(360px, calc(100vw - 24px))";
      pop.classList.add("show");
    }
    btn.onclick = function (e) {
      e.stopPropagation();
      if (pop.classList.contains("show")) pop.classList.remove("show"); else mselOpen();
    };
    window.addEventListener("resize", function () { pop.classList.remove("show"); });
    document.addEventListener("click", function (e) {
      if (!pop.classList.contains("show")) return;
      if (pop.contains(e.target) || btn.contains(e.target)) return;
      pop.classList.remove("show");
    });
    if (all) all.onchange = function () {
      if (!all.checked) return;          // 取消「全部」= 尚未选具体小题，语义仍是全部
      MSC.sel = {}; MSC.txt = {};
      var rows = $("rscopeList") ? $("rscopeList").querySelectorAll(".msel-row") : [];
      [].forEach.call(rows, function (r) {
        r.classList.remove("on");
        var cb = r.querySelector("input[type=checkbox]"); if (cb) cb.checked = false;
      });
      mselSync();
    };
  })();

  function refine(instruction, isAuto, extra) {
    extra = extra || {};
    var given = extra.givenAnswer ? String(extra.givenAnswer) : "";
    var ansImg = extra.answerImage ? String(extra.answerImage) : "";
    var byAnswer = !!(given || ansImg);
    var L = last;
    if (!L || !L.result) { $("status").textContent = "请先解一道题，再微调"; return; }
    if (!isAuto && verPreviewVid) { verExitPreview(); $("status").textContent = "已回到当前版本，请重新发起微调"; return; }
    if (pendingReview && !isAuto) { $("status").textContent = "请先处理当前 AI 微调结果：存为新版本、覆盖当前版本或撤销回退"; return; }
    if (!isAuto) {
      rWarn("");
      var be = badInput(instruction);
      if (be) { rWarn(be); return; }
      if (String(instruction).length > RIN_MAX) { rWarn("微调说明过长，最多 " + RIN_MAX + " 字"); return; }
    }
    var cfg = loadCfg();
    if (!cfg || !cfg.baseUrl || !cfg.apiKey) { openModal(); $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "请先配置模型"; return; }
    if (!isAuto) {
      $("ansEditBtn").disabled = true; $("ansEditBtn").textContent = byAnswer ? "重画中…" : "微调中…";
    }
    var sc = isAuto ? { questionIndex: -1, scope: "all", option: "" } : (extra.scopeObj || curRefineScope());
    // 逐问意见：勾了几道小题就按"第 (k) 问：……"追加到总要求后面，服务端再按 scope=multi 展开成清单
    if (!isAuto && sc.perQuestion && sc.perQuestion.length) {
      var lines = sc.perQuestion.filter(function (p) { return p.text; }).map(function (p) {
        return "第 " + (p.i + 1) + " 问：" + p.text;
      });
      if (lines.length) instruction = (instruction ? instruction + "\n" : "") + lines.join("\n");
    }
    var body = {
      question: L.question,
      questionText: (L.result && L.result.questionText) || "",
      images: (L.images || []).slice(),
      grade: gradeGet(),
      view: viewGet(),
      previous: { answer: L.result.answer, analysis: L.result.analysis, questionText: L.result.questionText || "", figureBox: L.result.figureBox || null, renderCode: L.result.renderCode, render3d: L.result.render3d, subQuestions: L.result.subQuestions || null },
      instruction: instruction,
      target: isAuto ? "auto" : roptTarget(),
      dim: isAuto ? "" : roptDim(),
      scope: sc.scope,
      questionIndex: sc.questionIndex,
      option: sc.option,
      perQuestion: (sc.perQuestion && sc.perQuestion.length) ? sc.perQuestion : null,
      config: cfg,
      stream: true
    };
    // 按用户给定答案重画：目标固定为 answer，图形类型保持原样。
    // 给了文字答案 → givenAnswer；只给了答案截图 → answerImages（由模型读图识别，服务端加【答案图片】规则）。
    if (byAnswer) {
      body.target = "answer"; body.dim = "";
      if (given) body.givenAnswer = given;
      if (ansImg) body.answerImages = [ansImg];
    }
    runTask("/api/refine", body, isAuto ? "修正" : (byAnswer ? "按答案重画" : "微调"), { update: true, auto: isAuto, baseId: lastHistoryId });
  }
  $("btnRefine").onclick = function () {
    var ins = $("rin").value.trim();
    if (!ins) {
      // 只勾了小题、只在逐问意见里写了内容时，总要求可以留空
      var sc0 = curRefineScope();
      var hasPer = (sc0.perQuestion || []).some(function (p) { return p.text; });
      if (!hasPer) { window.HJFX && HJFX.shake($("rin")); $("rin").focus(); return; }
    }
    refine(ins, false);
  };
  $("rin").addEventListener("input", function () { draftSave(lastHistoryId, $("rin").value); updCount(); rWarn(""); });
  $("rin").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("btnRefine").onclick(); } });
  // 常用微调词条：带 target 的点击后自动把「微调对象」切到对应项
  var CHIPS = [
    { t: "解析再详细一些，多写推导步骤", target: "text" },
    { t: "解析写得更通俗，适合当前年级", target: "text" },
    { t: "只改解析，图形保持不动", target: "text" },
    { t: "把动点改成可拖动的滑块" },
    { t: "标出所有直角符号" },
    { t: "关键辅助线与轨迹用虚线" }
  ];
  CHIPS.forEach(function (it) {
    var b = document.createElement("button"); b.textContent = it.t;
    b.onclick = function () {
      if (it.target && $("rtarget")) { $("rtarget").value = it.target; roptSave(); }
      setRin(it.t);
    };
    $("chips").appendChild(b);
  });
  updCount();
  window.SolverDebug = { scope: function () { return curRefineScope(); }, addImageFile: addImageFile, stageImageFile: stageImageFile, cropPending: cropOpenPending, cropOpen: cropOpen, figureCrop: cropOpenFigure, cropFigure: cropFigure, discardPending: discardPending, fitImage: fitImage, images: function () { return images; }, last: function () { return last; }, recId: function () { return lastHistoryId; }, versions: function () { var r = (last && last.result) || null; return r ? { list: verShape(r).slice(), currentVid: r.currentVid || 0 } : null; }, previewVid: function () { return verPreviewVid; }, renderQCard: renderQCard, anaSplit: anaSplit, anaHTML: anaHTML, review: function () { return pendingReview ? { recId: pendingReview.recId, refinedNext: pendingReview.refinedNext, target: pendingReview.target, givenAnswer: pendingReview.givenAnswer, questionIndex: pendingReview.questionIndex } : null; }, ansEdit: function () { return { open: ansEditIsOpen(), scope: ansEditScope, text: $("ansEditIn") ? $("ansEditIn").value : "" }; }, tasks: function () { return TASKS.map(function (t) { return { id: t.id, kind: t.kind, status: t.status, recId: t.recId, stage: t.stage, progress: t.progress, received: t.received, reasoning: t.reasoning || 0 }; }); }, chat: function () { return chatActive ? { recId: chatActive.recId, status: chatActive.status, text: chatActive.text, error: chatActive.error || "" } : null; } };

  // ================= 小题拆分（#6） =================
  function renderSubTabs() {
    var box = $("subTabs"); if (!box) return;
    box.innerHTML = "";
    // 只有真正拆出多个小问时才显示顶部分段切换；单问仍用底部步骤条
    if (!subQs || subQs.length < 2) {
      box.style.display = "none"; box.classList.remove("show");
      window.HJTabs && window.HJTabs.sync(box, false);
      return;
    }
    box.classList.add("show"); box.style.display = "flex";
    var items = [{ label: "全部", idx: -1 }].concat(subQs.map(function (s, i) { return { label: (s && s.label) || ("(" + (i + 1) + ")"), idx: i }; }));
    items.forEach(function (it) {
      var b = document.createElement("button");
      var lb = String(it.label || "").trim();
      // 文本包一层 .lbl：弹簧胶囊（.tab-ind）要垫在文字之下、按钮底色之上（见 ui.css）
      var sp = document.createElement("span");
      sp.className = "lbl";
      sp.textContent = it.idx < 0 ? "全部" : (/^[（(][^）)]+[）)]$/.test(lb) ? "第" + lb + "问" : lb);
      b.appendChild(sp);
      if (subIdx === it.idx) { b.className = "on"; b.setAttribute("aria-current", "page"); }
      b.onclick = function () { showSub(it.idx, true); };
      box.appendChild(b);
    });
    window.HJTabs && window.HJTabs.sync(box, true);
  }
  // 「全部」答案里的分问块：点一下 = 跳到该问（与顶部标签同一条路径）
  (function () {
    var box = $("answer"); if (!box) return;
    function pick(e) {
      var el = e.target;
      while (el && el !== box && !(el.getAttribute && el.getAttribute("data-sub") != null)) el = el.parentNode;
      if (!el || el === box) return;
      var i = Number(el.getAttribute("data-sub"));
      if (isFinite(i) && i >= 0) { e.preventDefault(); showSub(i, true); }
    }
    box.addEventListener("click", pick);
    box.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") pick(e); });
  })();
  function subJumpAnswer() {
    var body = document.querySelector(".anbody"), card = $("ansCard");
    if (!body || !card) return;
    try {
      var br = card.getBoundingClientRect(), wr = body.getBoundingClientRect();
      var top = body.scrollTop + (br.top - wr.top) - 8;
      body.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    } catch (e) {
      try { card.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e2) {}
    }
    card.classList.remove("sub-flash");
    void card.offsetWidth;
    card.classList.add("sub-flash");
    setTimeout(function () { card.classList.remove("sub-flash"); }, 1000);
  }
  function showSub(i, jump) {
    var r = last && last.result; if (!r) return;
    if (ansEditIsOpen()) ansEditClose();
    var prev = subIdx;
    subIdx = i;
    var s = (i >= 0 && r.subQuestions) ? r.subQuestions[i] : null;
    $("answer").className = ""; $("analysis").className = "";
    $("answer").innerHTML = s ? mathHTML(s.answer || "本问未给答案") : ansAllHTML(r);
    $("analysis").innerHTML = s ? mathHTML(s.analysis || "") : anaHTML(r.analysis || "", r.subQuestions);
    // 切问内容淡入（beUI motion tabs 的内容过渡）；subIdx 没变的重渲染不闪
    if (prev !== i && window.HJTabs) { window.HJTabs.swapIn($("answer")); window.HJTabs.swapIn($("analysis")); }
    var lb = $("subLocate"); lb.innerHTML = "";
    var fts = s ? (s.focusTargets || []) : (r.focusTargets || []);
    window.HJ && (window.HJ._focusTargets = fts);
    fts.forEach(function (ft) {
      var b = document.createElement("button");
      var lab = String(ft.label || "定位");
      // 聚焦按钮的文案常写成「看平面 $BC_1D$」「看 $\alpha$ 与 $\beta$」，要按 KaTeX 渲染
      if (/[\\$]/.test(lab)) b.innerHTML = "◎ " + mathHTML(lab);
      else b.textContent = "◎ " + lab;
      b.onclick = function () { locate(ft); };
      lb.appendChild(b);
    });
    renderSubTabs();
    if (s && s.render3d) render3d(s.render3d, true);
    else if (s && s.renderCode) render(s.renderCode, s, true);
    else {
      // 共用一张图：只改显隐，不重画
      applySubScope(r, i);
    }
    if (jump) requestAnimationFrame(function () { subJumpAnswer(); });
  }

  // ================= 改答案 → 按此答案重画 =================
  // 用户给的是「目标答案」：服务端会先验算，冲突时保留原答案并说明，不会悄悄改题设。
  var ANS_EDIT_MAX = 4000;
  var ansEditScope = null;
  var ansEditInit = "";       // 打开编辑器时的初始文本
  var ansEditImg = "";        // 已附加的答案截图（dataURL），点「按此答案重画」时才随请求发给模型
  function ansEditIsOpen() { var b = $("ansEdit"); return !!(b && b.style.display !== "none"); }
  function ansEditClose() {
    ansEditScope = null;
    ansEditImg = "";
    ansImgRender();
    var box = $("ansEdit"); if (box) box.style.display = "none";
    // 标题栏那颗按钮本身就是展开/收起的开关，关掉时把文字改回来
    var b = $("ansEditBtn");
    if (b && !b.disabled) { b.textContent = "改答案"; b.title = ""; }
  }
  // 字数计数已移除（改答案区不再显示 0/4000，只保留 maxlength 硬限制）
  // ---- 答案截图：贴进来只挂一张缩略图，识别发生在点「按此答案重画」之后（模型读图，和题图同一套做法） ----
  function ansImgHint(msg, cls) {
    var t = $("ansImgHint"); if (!t) return;
    t.textContent = msg || "";
    t.className = "ans-img-hint" + (cls ? " " + cls : "");
    t.style.display = msg ? "block" : "none";
  }
  function ansImgRender() {
    var box = $("ansImgBox"), th = $("ansImgThumb");
    if (!box || !th) return;
    if (ansEditImg) {
      th.src = ansEditImg;
      box.style.display = "flex";
    } else {
      th.removeAttribute("src");
      box.style.display = "none";
    }
  }
  function ansImgClear() {
    ansEditImg = "";
    ansImgRender();
    ansImgHint("");
    try { $("ansEditIn").focus(); } catch (e) {}
  }
  function ansImgBlob(blob) {
    if (!blob) return;
    if (blob.size < IMG_MIN) { ansImgHint("图片过小（不足 10KB），可能是误截图，请重新截图", "warn"); return; }
    if (blob.size > IMG_MAX) { ansImgHint("图片过大（超过 20MB），请压缩后再试", "warn"); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var u = String(fr.result || "");
      if (!/^data:image\/(png|jpeg|webp)/.test(u)) { ansImgHint("仅支持 JPG、PNG、WebP 格式的图片", "warn"); return; }
      fitImage(u, function (dataUrl) {
        ansEditImg = dataUrl;
        ansImgRender();
        // 缩略条自己带说明，成功时不再重复一行提示（提示行只留给报错）
        ansImgHint("");
      });
    };
    fr.onerror = function () { ansImgHint("读取图片失败", "warn"); };
    fr.readAsDataURL(blob);
  }
  function ansEditOpen() {
    var L = last;
    if (!L || !L.result) { $("status").textContent = "请先解一道题，再改答案"; return; }
    if (pendingReview) { $("status").textContent = "请先处理当前 AI 微调结果：存为新版本、覆盖当前版本或撤销回退"; return; }
    if (verPreviewVid) { $("status").textContent = "正在预览历史版本，请先回到当前版本再改答案"; return; }
    if ($("ansEditBtn").disabled) return;
    var r = L.result;
    var s = (subIdx >= 0 && r.subQuestions) ? r.subQuestions[subIdx] : null;
    ansEditScope = s ? { scope: "current", questionIndex: subIdx, option: "" } : { scope: "all", questionIndex: -1, option: "" };
    $("ansEdit").style.display = "block";
    $("ansEditIn").value = s ? String(s.answer || "") : String(r.answer || "");
    ansEditInit = String($("ansEditIn").value || "");
    ansEditImg = "";
    ansImgRender();
    ansImgHint("");
    $("ansEditHint").textContent = (s ? "将按第 (" + (subIdx + 1) + ") 问重画；" : "将按整题重画；") +
      "图会以你给的答案为目标重新生成。若答案与题设冲突，AI 会保留原答案并说明。" +
      "也可以上传或粘贴答案截图，点「按此答案重画」时由 AI 读出其中的答案。";
    // 按钮兼作展开/收起的开关：展开后显示「收起」，再点一次就是收起（原来靠区内的「取消」）
    if ($("ansEditBtn")) {
      $("ansEditBtn").textContent = "收起";
      $("ansEditBtn").title = "收起改答案区";
    }
    // 和微调 / 追问一样用 preventScroll：滚动避让统一交给 mobile-sheet 的键盘逻辑，
    // 否则浏览器原生滚动会和它抢，位置来回跳。
    setTimeout(function () {
      try { $("ansEditIn").focus({ preventScroll: true }); }
      catch (e) { try { $("ansEditIn").focus(); } catch (e2) {} }
    }, 0);
  }
  function renderAnsNote(r) {
    var n = $("ansNote"); if (!n) return;
    r = r || (last && last.result);
    if (!r || !r.givenAnswer) { n.style.display = "none"; n.innerHTML = ""; return; }
    var where = (r.givenScope === "current" && r.givenQuestionIndex >= 0)
      ? "第 (" + (r.givenQuestionIndex + 1) + ") 问"
      : (r.givenScope === "option" && r.givenOption ? "选项 " + r.givenOption : "整题");
    // 答案来自截图时，说明「这张图识别出了什么」，用户才知道 AI 到底按什么在重画
    var from = r.givenFromImage ? "你上传的答案图片" : ("你给的" + where + "答案");
    var ocr = (r.givenFromImage && r.givenAnswerText)
      ? "<details class=\"ans-note-src\"><summary>图片识别原文（点击展开）</summary><div class=\"ans-note-sub\">" + mathHTML(String(r.givenAnswerText)) + "</div></details>"
      : "";
    var note = r.answerNote
      ? "<div class=\"ans-note-main\"><span class=\"ans-note-txt\">" + mathHTML(r.answerNote) + "</span><button type=\"button\" class=\"ans-note-toggle\" style=\"display:none\">展开</button></div>"
      : "";
    var head;
    if (r.answerAdjusted) {
      n.className = "ans-note warn";
      head = from + "与题设不一致，已按验算结果修正。";
    } else {
      n.className = "ans-note ok";
      head = "已按" + from + "重画图形。";
    }
    n.innerHTML = head + note + ocr;
    n.style.display = "block";
    var txt = n.querySelector(".ans-note-txt");
    var btn = n.querySelector(".ans-note-toggle");
    if (txt && btn && (txt.scrollHeight > txt.clientHeight + 1 || String(r.answerNote).length > 60)) {
      btn.style.display = "inline-block";
      btn.onclick = function () {
        var open = txt.classList.toggle("open");
        btn.textContent = open ? "收起" : "展开";
      };
    }
  }
  function redrawWithAnswer() {
    var txt = String($("ansEditIn").value || "").trim();
    if (!txt && !ansEditImg) { $("status").textContent = "请先填写答案，或粘贴一张答案截图"; $("ansEditIn").focus(); return; }
    if (txt.length > ANS_EDIT_MAX) { $("status").textContent = "答案过长，最多 " + ANS_EDIT_MAX + " 字"; return; }
    var be = badInput(txt);
    if (be) { $("status").textContent = be; return; }
    var sc = ansEditScope || { scope: "all", questionIndex: -1, option: "" };
    var img = ansEditImg;
    ansEditClose();
    refine("按用户给定答案重新生成完整解答与图形", false, { givenAnswer: txt, scopeObj: sc, answerImage: img });
  }
  if ($("ansEditBtn")) $("ansEditBtn").onclick = function () { if (ansEditIsOpen()) ansEditClose(); else ansEditOpen(); };
  // 「取消」按钮已移除：展开/收起统一走答案卡标题栏的「改答案」按钮（ansEditBtn 本身就是 toggle）
  if ($("ansImgDel")) $("ansImgDel").onclick = ansImgClear;
  // 上传答案图片：手机端没有 Ctrl+V，只能给一个选择器入口。
  // 走标准 file input —— Android WebView 会唤起系统「相册/文件」选择器；
  // 答案截图整张都是答案，不需要走框选页，选完直接进 ansImgBlob（与粘贴同一条路径）。
  if ($("ansImgPick")) $("ansImgPick").onclick = function () {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.style.display = "none";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      if (f) ansImgBlob(f);
    });
    document.body.appendChild(inp);
    inp.click();
  };
  if ($("ansRedraw")) $("ansRedraw").onclick = redrawWithAnswer;
  if ($("ansEditIn")) {
    $("ansEditIn").addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); redrawWithAnswer(); }
    });
    // 粘贴图片：Ctrl+V 与右键菜单「粘贴」都会触发 paste 事件
    $("ansEditIn").addEventListener("paste", function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf("image") === 0) {
          e.preventDefault();
          ansImgBlob(items[i].getAsFile());
          return;
        }
      }
    });
  }

  // 小题 → 画布显隐范围
  // 约定：targets 列的是「本问需要的元素」，未列出的隐藏；
  //      targets 缺失或为空 → 本维度不生效（退回全显），也就是模型不写就永远不会把图弄坏。
  // 只有出现在任意小问 targets 里的元素才归本维度管，其余（公共底图）一律保持原样。
  function subTargets(s) {
    if (!s) return [];
    if (Array.isArray(s.targets)) return s.targets.filter(Boolean).map(String);
    if (Array.isArray(s.elements)) {
      return s.elements.map(function (e) { return e && (e.targetId || e.target); }).filter(Boolean).map(String);
    }
    return [];
  }
  function applySubScope(r, i) {
    var HJ = window.HJ;
    if (!HJ || !HJ.setSubScope) return;
    var subs = (r && r.subQuestions) || [];
    var all = [], seen = {};
    subs.forEach(function (s) {
      subTargets(s).forEach(function (t) { if (!seen[t]) { seen[t] = true; all.push(t); } });
    });
    var cur = (i >= 0 && subs[i]) ? subTargets(subs[i]) : [];
    // 切小题时步骤归位（撤回步骤高亮 + 步骤条回到「全部」）由 setSubScope 统一处理，
    // 这里不能先改 STEPS.cur，否则它内部就判不出"刚才确实在某个步骤上"。
    HJ.setSubScope(cur, all);
  }

  // ================= 题目卡（图片题对照） =================
  var qFigCache = {};
  function cropFigure(dataUrl, box, cb) {
    if (!dataUrl || !box) return cb("");
    var im = new Image();
    im.onload = function () {
      try {
        var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
        var x = Math.max(0, Math.min(1, Number(box.x) || 0)) * w;
        var y = Math.max(0, Math.min(1, Number(box.y) || 0)) * h;
        var cw = Math.min(w - x, Math.max(8, (Number(box.w) || 0) * w));
        var ch = Math.min(h - y, Math.max(8, (Number(box.h) || 0) * h));
        if (w <= 0 || h <= 0 || cw < 8 || ch < 8) return cb("");
        var cv = document.createElement("canvas");
        cv.width = Math.round(cw); cv.height = Math.round(ch);
        var ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(im, x, y, cw, ch, 0, 0, cv.width, cv.height);
        cb(cv.toDataURL("image/jpeg", 0.85));
      } catch (e) { cb(""); }
    };
    im.onerror = function () { cb(""); };
    im.src = dataUrl;
  }
  function renderQCard(r) {
    var textCard = $("qTextFloat"), figCard = $("qFigFloat");
    if (!textCard || !figCard) return;
    // 换一道题时回到默认状态：两张悬浮卡都收起，只留标题条。
    // 原题图/原题文字默认展开会盖住画布右半边（手机上是整屏），用户明确要求不默认展开。
    //
    // 判定「换了一道题」用 result 对象身份，不能只看 lastHistoryId：
    // 从历史记录打开时 lastHistoryId 可能已经是同一个值（比如按 id 重开同一条、
    // 或微调产生新版本但 id 不变），只比 id 会让这里整段跳过 —— 结果就是题图保持
    // 上一次的展开态，用户看到「从历史打开还是默认展开」。
    if (textCard.__rid !== lastHistoryId || figCard.__res !== (r && r)) {
      textCard.__rid = lastHistoryId;
      figCard.__res = r && r;
      qFloatResetPos(textCard);
      qFloatResetPos(figCard);
      qFloatSet(textCard, true);
      qFloatSet(figCard, true);
    }
    var qTxt = String((last && last.question) || "").trim();
    var recTxt = String((r && r.questionText) || "").trim();
    var imgs = ((last && last.images) || []).filter(function (u) { return /^data:image\//.test(String(u)); });
    var t = $("qText"), f = $("qFig");
    // 题干文字：优先用用户自己输入/粘贴的文字；没有文字时才用模型从图片识别出的题干
    var txt = qTxt || recTxt;
    if (txt) {
      textCard.hidden = false;
      t.innerHTML = mathHTML(txt);
    } else {
      textCard.hidden = true;
      t.innerHTML = "";
    }
    if (!imgs.length) {
      figCard.hidden = true; f.innerHTML = "";
      return;
    }
    figCard.hidden = false;
    f.innerHTML = "";
    function addImg(src, cls, title) {
      var im = document.createElement("img"); im.src = src; im.className = cls || "";
      im.title = title || "点开放大"; im.onclick = function () { openLightbox(src); };
      return im;
    }
    function makeOpen(src, label) {
      var b = document.createElement("button"); b.className = "qfig-open"; b.textContent = label || "查看整张原图";
      b.onclick = function () { openLightbox(src); };
      return b;
    }
    function thumbs(exceptIdx) {
      if (imgs.length < 2) return null;
      var row = document.createElement("div"); row.className = "qfig-row";
      imgs.forEach(function (src, i2) {
        if (i2 === exceptIdx) return;
        row.appendChild(addImg(src, "qfig-thumb", "第 " + (i2 + 1) + " 张图 · 点开放大"));
      });
      return row.childNodes.length ? row : null;
    }
    // 手动框选题图：AI 没给 figureBox 或框得不准时的兜底
    function openCrop(src, imgIdx) {
      f.innerHTML = "";
      var wrap = document.createElement("div"); wrap.className = "crop-wrap";
      var im = document.createElement("img"); im.src = src; im.draggable = false;
      var band = document.createElement("div"); band.className = "crop-box";
      wrap.appendChild(im); wrap.appendChild(band);
      var acts = document.createElement("div"); acts.className = "crop-acts";      var tip = document.createElement("span"); tip.textContent = "在图上拖动，框住题目里的图形区域";
      var save = document.createElement("button"); save.className = "qfig-open"; save.textContent = "保存为题图"; save.disabled = true;
      var cancel = document.createElement("button"); cancel.className = "qfig-open"; cancel.textContent = "取消";
      acts.appendChild(tip); acts.appendChild(save); acts.appendChild(cancel);
      f.appendChild(wrap); f.appendChild(acts);
      var box = null, drag = null;
      function pos(ev) {
        var r = im.getBoundingClientRect();
        return { x: Math.min(Math.max(ev.clientX - r.left, 0), r.width), y: Math.min(Math.max(ev.clientY - r.top, 0), r.height), w: r.width, h: r.height };
      }
      im.addEventListener("pointerdown", function (ev) {
        ev.preventDefault();
        var p = pos(ev); drag = { x: p.x, y: p.y };
        try { im.setPointerCapture(ev.pointerId); } catch (e) {}
        band.style.display = "block";
        band.style.left = p.x + "px"; band.style.top = p.y + "px"; band.style.width = "0px"; band.style.height = "0px";
      });
      im.addEventListener("pointermove", function (ev) {
        if (!drag) return;
        var p = pos(ev);
        var x = Math.min(drag.x, p.x), y = Math.min(drag.y, p.y);
        var w = Math.abs(p.x - drag.x), h = Math.abs(p.y - drag.y);
        band.style.left = x + "px"; band.style.top = y + "px"; band.style.width = w + "px"; band.style.height = h + "px";
        box = { x: x / p.w, y: y / p.h, w: w / p.w, h: h / p.h };
        save.disabled = !(box.w > 0.02 && box.h > 0.02);
      });
      function endDrag() { drag = null; }
      im.addEventListener("pointerup", endDrag);
      im.addEventListener("pointercancel", endDrag);
      save.onclick = function () {
        if (!box || !last) return;
        var nb = { x: Math.round(box.x * 1000) / 1000, y: Math.round(box.y * 1000) / 1000, w: Math.round(box.w * 1000) / 1000, h: Math.round(box.h * 1000) / 1000 };
        if (imgIdx) nb.image = imgIdx;
        last.result.figureBox = nb;
        qFigCache = {};
        updateHistory({ id: lastHistoryId, figureBox: nb });
        renderQCard(last.result);
        $("status").textContent = "已保存题图区域（只影响显示，不改动解答）";
      };
      cancel.onclick = function () { renderQCard(last.result); };
    }
    var fb = (r && r.figureBox) || null;
    var idx = (fb && typeof fb.image === "number" && imgs[fb.image]) ? fb.image : 0;
    if (fb && imgs[idx]) {
      var key = (lastHistoryId || "") + "|" + JSON.stringify(fb);
      if (qFigCache[key]) f.appendChild(addImg(qFigCache[key], "qfig-main", "点开放大题图"));
      else cropFigure(imgs[idx], fb, function (u) {
        if (!u) return;
        qFigCache[key] = u;
        if (figCard.hidden || !last || last.result !== r) return;
        f.insertBefore(addImg(u, "qfig-main", "点开放大题图"), f.firstChild);
      });
      f.appendChild(makeOpen(imgs[idx], "查看整张原图"));
      var recrop = makeOpen(imgs[idx], "重新框选题图");
      recrop.onclick = function () { openCrop(imgs[idx], idx); };
      f.appendChild(recrop);
      var row0 = thumbs(idx);
      if (row0) f.appendChild(row0);
    } else {
      imgs.slice(0, 4).forEach(function (src, i3) { f.appendChild(addImg(src, "qfig-main", "点开放大原图")); });
      if (imgs.length) {
        var acts0 = document.createElement("div"); acts0.className = "qfig-acts";
        var crop = makeOpen(imgs[0], "框选题图");
        crop.onclick = function () { openCrop(imgs[0], 0); };
        var openAll = makeOpen(imgs[0], "查看整张原图");
        acts0.appendChild(crop); acts0.appendChild(openAll);
        f.appendChild(acts0);
      }
    }
    var qOpen = $("qFigOpen");
    if (qOpen) qOpen.onclick = function () { if (imgs.length) openLightbox(imgs[idx] || imgs[0]); };
  }

  // 悬浮原题控件：展开/收起 + 拖拽
  function qFloatResetPos(card) {
    if (!card) return;
    card.style.left = ""; card.style.top = ""; card.style.bottom = ""; card.style.zIndex = "";
    card.style.width = ""; card.style.height = ""; card.style.maxHeight = "";
    card.classList.remove("dragging"); card.classList.remove("sized");
    card.__qsize = null;
  }
  function qFloatClamp(card) {
    if (!card || card.hidden || !$("stage")) return;
    if (!card.style.left && !card.style.top) return;
    var stage = $("stage");
    var sr = stage.getBoundingClientRect(), r = card.getBoundingClientRect();
    var left = parseFloat(card.style.left), top = parseFloat(card.style.top);
    if (!isFinite(left) || !isFinite(top)) return;
    var maxL = Math.max(0, sr.width - r.width), maxT = Math.max(0, sr.height - r.height);
    left = Math.max(0, Math.min(left, maxL));
    top = Math.max(0, Math.min(top, maxT));
    card.style.left = left + "px";
    card.style.top = top + "px";
    card.style.bottom = "auto";
    if (card.classList.contains("sized")) {
      var w = parseFloat(card.style.width), h = parseFloat(card.style.height);
      var maxW = Math.max(150, sr.width - left - 6), maxH = Math.max(92, sr.height - top - 6);
      if (isFinite(w)) card.style.width = Math.max(150, Math.min(w, maxW)) + "px";
      if (isFinite(h)) card.style.height = Math.max(92, Math.min(h, maxH)) + "px";
    }
  }
  function qFloatDrag(card, handle) {
    if (!card || !handle) return;
    var drag = null;
    handle.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      if (ev.target && ev.target.closest && ev.target.closest(".qfloat-btn")) return;
      var stage = $("stage"); if (!stage) return;
      var cr = card.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      drag = { dx: ev.clientX - cr.left, dy: ev.clientY - cr.top, sx: ev.clientX, sy: ev.clientY, moved: false };
      card.style.left = (cr.left - sr.left) + "px";
      card.style.top = (cr.top - sr.top) + "px";
      card.style.bottom = "auto";
      card.style.zIndex = "11";
      card.classList.add("dragging");
      try { handle.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    handle.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      if (Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) > 3) drag.moved = true;
      var stage = $("stage"); if (!stage) return;
      var sr = stage.getBoundingClientRect(), r = card.getBoundingClientRect();
      var left = ev.clientX - drag.dx - sr.left, top = ev.clientY - drag.dy - sr.top;
      left = Math.max(0, Math.min(left, sr.width - r.width));
      top = Math.max(0, Math.min(top, sr.height - r.height));
      card.style.left = left + "px";
      card.style.top = top + "px";
      ev.preventDefault();
    });
    function end(ev) {
      if (!drag) return;
      var moved = drag.moved; drag = null;
      card.classList.remove("dragging");
      try { handle.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (moved) {
        card.__hjDragged = true;
        setTimeout(function () { card.__hjDragged = false; }, 0);
      }
      qFloatClamp(card);
    }
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  // 展开窗口的右下角手柄：按像素无级调整宽高
  function qFloatResize(card, handle) {
    if (!card || !handle) return;
    var rs = null;
    handle.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      var stage = $("stage"); if (!stage) return;
      var cr = card.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      var left = cr.left - sr.left, top = cr.top - sr.top;
      // 固定左上角，尺寸变化时窗口不跳
      card.style.left = left + "px";
      card.style.top = top + "px";
      card.style.bottom = "auto";
      card.style.width = cr.width + "px";
      card.style.height = cr.height + "px";
      card.style.maxHeight = "none";
      card.style.zIndex = "11";
      card.classList.add("sized");
      rs = { x: ev.clientX, y: ev.clientY, w: cr.width, h: cr.height, left: left, top: top };
      try { handle.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    });
    handle.addEventListener("pointermove", function (ev) {
      if (!rs) return;
      var stage = $("stage"); if (!stage) return;
      var sr = stage.getBoundingClientRect();
      var minW = 170, minH = 100;
      var maxW = Math.max(minW, sr.width - rs.left - 6), maxH = Math.max(minH, sr.height - rs.top - 6);
      var w = Math.max(minW, Math.min(maxW, rs.w + (ev.clientX - rs.x)));
      var h = Math.max(minH, Math.min(maxH, rs.h + (ev.clientY - rs.y)));
      card.style.width = Math.round(w) + "px";
      card.style.height = Math.round(h) + "px";
      ev.preventDefault();
    });
    function end(ev) {
      if (!rs) return;
      rs = null;
      try { handle.releasePointerCapture(ev.pointerId); } catch (e) {}
      card.__qsize = { w: card.style.width, h: card.style.height };
      qFloatClamp(card);
    }
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  function qFloatSet(card, collapsed) {
    if (!card) return;
    collapsed = !!collapsed;
    var wasCollapsed = card.classList.contains("collapsed");
    if (collapsed && !wasCollapsed) {
      // 收起前记住用户调过的尺寸，展开时恢复
      if (card.classList.contains("sized") || card.style.width || card.style.height) {
        card.__qsize = { w: card.style.width, h: card.style.height };
      }
      card.style.width = ""; card.style.height = ""; card.style.maxHeight = "";
      card.classList.remove("sized");
    } else if (!collapsed && wasCollapsed) {
      if (card.__qsize) {
        card.style.width = card.__qsize.w || "";
        card.style.height = card.__qsize.h || "";
        card.style.maxHeight = "none";
        card.classList.add("sized");
      }
    }
    // beUI Bouncy Accordion：浮卡本体宽高过渡——收起时宽高一起收成标题条，展开时弹回。
    // 起点=切换前的实际尺寸，终点=切换后的实际尺寸；sized 卡（用户调过尺寸）展开的
    // 终点就是恢复的 inline 尺寸，结束后保留 inline；非 sized 卡清掉 inline 交还 CSS。
    // 减动效或尺寸没变化时直接切换。
    var qReduce = false;
    try { qReduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var cardAnim = !qReduce && wasCollapsed !== collapsed;
    var startH = 0, startW = 0;
    if (cardAnim) { startH = card.offsetHeight; startW = card.offsetWidth; }
    card.classList.toggle("collapsed", collapsed);
    if (cardAnim) {
      var endH = card.offsetHeight, endW = card.offsetWidth;
      if (Math.abs(startH - endH) > 2 || Math.abs(startW - endW) > 2) {
        card.style.height = startH + "px"; card.style.width = startW + "px";
        void card.offsetHeight;
        var easeQ = collapsed ? "cubic-bezier(.4,0,.2,1)" : "cubic-bezier(.34,1.45,.64,1)";
        card.style.transition = "height .28s " + easeQ + ", width .28s " + easeQ;
        card.style.height = endH + "px"; card.style.width = endW + "px";
        setTimeout(function () {
          card.style.transition = "";
          if (!card.classList.contains("sized")) { card.style.height = ""; card.style.width = ""; }
        }, 310);
      }
    }
    var btn = card.querySelector(".qfloat-fold");
    if (btn) {
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.title = collapsed ? "展开" : "收起";
      var sign = btn.querySelector(".qfold-sign");
      var word = btn.querySelector(".qfold-word");
      // 用 svg 画 +/−：文字 "+" 的字形中线比 svg 图标低 1px，两者并排会看起来没对齐。
      // 竖杠常驻、由卡片收起态经 CSS 弹性显隐（.qfold-v，见 ui.css）——
      // 不再整体替换 innerHTML，否则每次折叠都会打断形变过渡
      if (sign && !sign.firstElementChild) {
        sign.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path class="qfold-v" d="M12 5v14"/></svg>';
      }
      if (word) word.textContent = collapsed ? "展开" : "收起";
    }
    requestAnimationFrame(function () { qFloatClamp(card); });
  }
  (function initQFloat() {
    var tCard = $("qTextFloat"), fCard = $("qFigFloat");
    var tHead = $("qTextHead"), fHead = $("qFigHead");
    if (tCard) {
      var tFold = $("qTextFold");
      if (tHead) {
        tHead.addEventListener("click", function (e) {
          if (tCard.__hjDragged) { tCard.__hjDragged = false; return; }
          if (e.target && e.target.closest && e.target.closest(".qfloat-btn")) return;
          qFloatSet(tCard, !tCard.classList.contains("collapsed"));
        });
        tHead.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            qFloatSet(tCard, !tCard.classList.contains("collapsed"));
          }
        });
        qFloatDrag(tCard, tHead);
      }
      if (tFold) tFold.addEventListener("click", function (e) {
        e.stopPropagation();
        qFloatSet(tCard, !tCard.classList.contains("collapsed"));
      });
      qFloatResize(tCard, $("qTextResize"));
    }
    if (fCard) {
      var fFold = $("qFigFold");
      if (fHead) qFloatDrag(fCard, fHead);
      qFloatResize(fCard, $("qFigResize"));
      if (fFold) fFold.addEventListener("click", function () {
        qFloatSet(fCard, !fCard.classList.contains("collapsed"));
      });
    }
    window.addEventListener("resize", function () { qFloatClamp(tCard); qFloatClamp(fCard); });
  })();

  function renderResult(r) {
    ansEditClose();
    subQs = r.subQuestions || null; subIdx = -1;
    renderSubTabs();
    renderScope();
    showSub(-1);
    renderAnsNote(r);
    var ae = $("ansEditBtn");
    if (ae) {
      ae.style.display = (r && (r.answer || (r.subQuestions && r.subQuestions.length))) ? "" : "none";
      ae.disabled = false; ae.textContent = "改答案"; ae.title = "";
    }
    renderQCard(r);
    setMeta(r.elapsedMs, r.usage, last && last.cfg && last.cfg.model, last && last.cfg);
    if (r.render3d) render3d(r.render3d); else render(r.renderCode || "", r);
    renderVersions();
    renderChat(r);
    var note = [];
    if (r.attempts > 1) note.push("自动重试 " + (r.attempts - 1) + " 次");
    if (r.routeRetried && r.routeExpected === "2d" && !r.routeIssue) note.push("已自动改回 2D 多视图");
    if (r.refined) note.push("已微调");
    if (r.valid === false && r.issues && r.issues.length) note.push("结果可能不完整：" + r.issues.join("；"));
    if (note.length) $("status").textContent += " · " + note.join(" · ");
  }

  // 调试/自测入口：把一份合成结果按正常路径渲染出来。
  // ⚠️ 2026-10-20：这个入口以前直接调 handleResult()，而 handleResult 会把结果**落盘成真实记录**，
  //    于是 shot_*.js 这类截图脚本每跑一次就往用户的 Documents\Hegy\records 里塞一条「（测试题）」，
  //    手工删掉还会被后续脚本继续补写（曾一次留下 44 条）。
  //    现在默认**只渲染、不写盘**；确实需要落盘的自测，显式传 { persist: true }，
  //    并且建议用 USERPROFILE=<临时目录> 起独立服务（见 HANDOVER §44.5 的测试隔离建议）。
  window.HJTest = {
    inject: function (r, opts) {
      r = r || {};
      opts = opts || {};
      try {
        if (opts.persist === true) {
          handleResult(r, false, false, { qFull: r.questionText || "（测试题）", images: [], grade: "" });
          return true;
        }
        // 不落盘：直接渲染，并把内存里的“当前记录”伪装成一个不存在的 id，
        // 这样后续任何 saveManualStyle / updateHistory 都不会写到磁盘。
        lastHistoryId = null;
        last = { question: r.questionText || "（测试题）", images: [], cfg: loadCfg(), grade: "", result: r };
        renderResult(r);
        return true;
      } catch (e) { return String(e && e.message || e); }
    },
    showSub: function (i) { showSub(i, false); },
    measure: function () { return (window.HJ && window.HJ._measureAll) ? window.HJ._measureAll() : []; },
    vis: function () {
      var out = {};
      try {
        var b = window.board;
        for (var k in b.objects) {
          var e = b.objects[k], n = (e.name == null ? "" : String(e.name)).trim();
          if (n) out[n] = !!(e.visProp && e.visProp.visible !== false);
        }
      } catch (e) {}
      return out;
    }
  };

  function handleResult(r, isUpdate, isAuto, entry) {
    var cfg = loadCfg();
    var prevRes = (last && last.result) || null;
    // 微调时模型没带回 questionText / figureBox → 沿用原值
    function keepMeta(x) {
      if (!x || !prevRes) return x;
      if (!x.questionText && prevRes.questionText) x.questionText = prevRes.questionText;
      if (!x.figureBox && prevRes.figureBox) x.figureBox = prevRes.figureBox;
      return x;
    }
    if (!isUpdate) {
      commitPending();
      var qTxt = (entry && entry.qFull != null) ? entry.qFull : $("q").value.trim();
      // 图片以提交任务时为准；页面刷新后恢复的任务没有图片副本，退回当前输入框里的图片
      var imgs = (entry && entry.images && entry.images.length) ? entry.images.slice() : images.slice();
      var gr = entry ? (entry.grade || "") : gradeGet();
      r.chat = [];
      last = { question: qTxt, images: imgs, cfg: cfg, grade: gr, result: r };
      autoFixCount = 0;
      chatActive = null; chatWarn("");
      lastHistoryId = "r" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      $("rin").value = "";
      // 初始版本 v1
      var v1 = verSnapshot(r, {
        vid: 1, ts: Date.now(), kind: "solve", label: "初始解答",
        usage: r.usage || null, elapsedMs: r.elapsedMs != null ? r.elapsedMs : null,
        cost: costText(r.usage, (cfg && cfg.model) || "", cfg)
      });
      r.versions = [v1]; r.currentVid = 1;
      addHistory({
        id: lastHistoryId, ts: Date.now(), question: last.question, questionText: r.questionText || "", images: last.images.slice(), grade: last.grade,
        answer: r.answer || "", analysis: r.analysis || "", renderCode: r.renderCode || "", render3d: r.render3d || null,
        style2d: r.style2d || null,
        figureBox: r.figureBox || null,
        steps: r.steps || null, controls: r.controls || null, focusTargets: r.focusTargets || null, subQuestions: r.subQuestions || null,
        versions: r.versions, currentVid: r.currentVid,
        chat: r.chat || [],
        promptVer: r.promptVer || "", promptHash: r.promptHash || "", promptChannel: r.promptChannel || "", promptBytes: r.promptBytes || null,
        routeExpected: r.routeExpected || "", routeActual: r.routeActual || "", routeRetried: r.routeRetried === true, routeIssue: r.routeIssue || "",
        usage: r.usage || null, model: (cfg && cfg.model) || "", elapsedMs: r.elapsedMs, cost: costText(r.usage, cfg && cfg.model, cfg)
      });
    } else if (isAuto) {
      if (!last) return;
      keepMeta(r);
      r.chat = chatArr(prevRes).slice();
      last.result = r;
      var arec = recCache[lastHistoryId] || null;
      var apatch = {
        id: lastHistoryId, answer: r.answer || "", analysis: r.analysis || "", renderCode: r.renderCode || "", render3d: r.render3d || null,
        questionText: r.questionText || "", figureBox: r.figureBox || null,
        steps: r.steps || null, controls: r.controls || null, focusTargets: r.focusTargets || null, subQuestions: r.subQuestions || null,
        promptVer: r.promptVer || "", promptHash: r.promptHash || "", promptChannel: r.promptChannel || "", promptBytes: r.promptBytes || null,
        routeExpected: r.routeExpected || "", routeActual: r.routeActual || "", routeRetried: r.routeRetried === true, routeIssue: r.routeIssue || "",
        usage: r.usage || null, elapsedMs: r.elapsedMs, cost: costText(r.usage, cfg && cfg.model, cfg)
      };
      // 自动修正只是把「当前版本」修对，不新增版本；标签里记一笔，便于回看
      if (arec) {
        var acv = verCurrent(arec);
        if (acv) {
          var anv = Object.assign({}, acv, verSnapshot(r));
          anv.vid = acv.vid; anv.ts = acv.ts; anv.kind = acv.kind || "solve";
          anv.label = acv.label || ""; anv.autoFixes = (acv.autoFixes || 0) + 1;
          anv.cost = costText(r.usage, (cfg && cfg.model) || "", cfg);
          arec.versions = verShape(arec).map(function (x) { return x.vid === acv.vid ? anv : x; });
          verApplyTo(arec, anv);
          arec.refined = Math.max(0, verShape(arec).length - 1);
          recCache[lastHistoryId] = arec;
          apatch.versions = arec.versions; apatch.currentVid = arec.currentVid; apatch.refined = arec.refined;
          if (last.result) { last.result.versions = arec.versions; last.result.currentVid = arec.currentVid; }
        }
      }
      updateHistory(apatch);
    } else {
      if (!last) return;
      var oldRec = recCache[lastHistoryId] || null;
      keepMeta(r);
      r.chat = chatArr(prevRes).slice();
      pendingReview = {
        recId: lastHistoryId, old: snapshotRec(oldRec || last.result), next: r, refinedNext: ((history.filter(function (x) { return x.id === lastHistoryId; })[0] || {}).refined || 0) + 1,
        instruction: (entry && entry.instruction) || "", target: (entry && entry.target) || "", dim: (entry && entry.dim) || "",
        scope: (entry && entry.scope) || "", option: (entry && entry.option) || "",
        questionIndex: (entry && typeof entry.questionIndex === "number" ? entry.questionIndex : -1),
        perQuestion: (entry && entry.perQuestion) || null,
        givenAnswer: (entry && entry.givenAnswer) || ""
      };
      last.result = r;
      renderResult(r);
      if (!pendingReview) return;
      $("status").textContent += " · 微调结果待确认";
      lockRefine();
      showReviewBar();
      return;
    }
    renderResult(r);
  }

  // ================= 追问（多轮问答，不改图） =================
  // 设计原则：追问只产生聊天记录，不写 answer / analysis / renderCode，
  // 因此不会新增版本，也不会打断现有的微调审查流。
  var CHAT_IN_MAX = 1000, CHAT_STORE_MAX = 60, CHAT_SEND_MAX = 24, CHAT_ITEM_MAX = 4000;
  var CHAT_HINT = "只回答问题，不改图形；要改图请用下方「微调」";
  var chatActive = null;   // {recId, text, status:"running"|"error", error, entry}
  var chatOpen = true;     // 追问卡片展开/收起（全局偏好，刷新后记住）
  try { chatOpen = localStorage.getItem("solver_chat_open_v1") !== "0"; } catch (e) {}
  function applyChatOpen() {
    var card = $("chatCard"), b = $("chatFold");
    if (!card) return;
    card.classList.toggle("folded", !chatOpen);
    if (b) {
      b.setAttribute("aria-expanded", chatOpen ? "true" : "false");
      b.title = chatOpen ? "收起追问" : "展开追问";
    }
  }
  function chatArr(r) {
    if (r && Array.isArray(r.chat)) return r.chat;
    if (r && r.id && recCache[r.id] && Array.isArray(recCache[r.id].chat)) return recCache[r.id].chat;
    if (lastHistoryId && recCache[lastHistoryId] && Array.isArray(recCache[lastHistoryId].chat)) return recCache[lastHistoryId].chat;
    return [];
  }
  function chatWarn(msg) {
    var h = $("chatHint"); if (!h) return;
    if (msg) { h.textContent = msg; h.classList.add("bad"); }
    else { h.textContent = CHAT_HINT; h.classList.remove("bad"); }
  }
  function chatSaveArr(recId, arr) {
    if (!recId) return;
    if (lastHistoryId === recId && last && last.result) last.result.chat = arr;
    if (recCache[recId]) recCache[recId].chat = arr;
    updateHistory({ id: recId, chat: arr });
  }
  function chatAppendTo(recId, msg, cb) {
    if (!recId) { if (cb) cb(false); return; }
    var apply = function (full) {
      if (!full) { if (cb) cb(false); return; }
      var arr = Array.isArray(full.chat) ? full.chat.slice() : [];
      arr.push(msg);
      if (arr.length > CHAT_STORE_MAX) arr = arr.slice(arr.length - CHAT_STORE_MAX);
      full.chat = arr;
      recCache[recId] = full;
      if (lastHistoryId === recId && last && last.result) last.result.chat = arr;
      updateHistory({ id: recId, chat: arr });
      if (lastHistoryId === recId) renderChat(last && last.result);
      if (cb) cb(true);
    };
    if (recCache[recId]) apply(recCache[recId]); else recFull(recId, apply);
  }
  function chatResize() {
    var el = $("chatIn"); if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight || 32, 96) + "px";
  }
  function chatScroll() {
    var box = $("chatList"); if (box) box.scrollTop = box.scrollHeight;
  }
  function chatMetaText(arr) {
    var turns = 0;
    arr.forEach(function (m) { if (m && m.role === "user") turns++; });
    return turns ? ("已问 " + turns + " 轮") : "";
  }
  function renderChat(r) {
    var card = $("chatCard"), list = $("chatList");
    if (!card || !list) return;
    if (!last || !last.result || !lastHistoryId) {
      card.style.display = "none"; list.innerHTML = "";
      if ($("chatJump")) $("chatJump").style.display = "none";
      return;
    }
    var arr = (r && Array.isArray(r.chat)) ? r.chat.slice() : chatArr(r || last.result).slice();
    if (r && !Array.isArray(r.chat)) r.chat = arr;
    card.style.display = "";
    applyChatOpen();
    list.innerHTML = "";
    if (!arr.length) {
      var empty = document.createElement("div"); empty.className = "chat-empty";
      empty.textContent = "有不懂的地方，直接问。我会结合当前题目、答案和图形回答。";
      list.appendChild(empty);
      var sugs = document.createElement("div"); sugs.className = "chat-sugs";
      ["这一步为什么成立？", "换一种解法", "这个图怎么看？"].forEach(function (t) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = t;
        b.onclick = function () { $("chatIn").value = t; chatSend(); };
        sugs.appendChild(b);
      });
      list.appendChild(sugs);
    } else {
      arr.forEach(function (m) {
        if (!m || (m.role !== "user" && m.role !== "assistant")) return;
        var wrap = document.createElement("div");
        wrap.className = "chat-msg " + (m.role === "user" ? "user" : "ai");
        var b = document.createElement("div"); b.className = "chat-bubble";
        b.innerHTML = mathHTML(m.content || "");
        wrap.appendChild(b); list.appendChild(wrap);
      });
    }
    if (chatActive && chatActive.recId === lastHistoryId) {
      var w = document.createElement("div"); w.className = "chat-msg ai";
      var b2 = document.createElement("div"); b2.className = "chat-bubble stream";
      b2.id = "chatStreamBubble";
      if (chatActive.status === "error") {
        b2.innerHTML = mathHTML(chatActive.text || "回答失败。");
        var er = document.createElement("span"); er.className = "chat-err";
        er.textContent = chatActive.error || "请重试";
        b2.appendChild(er);
      } else if (chatActive.text) {
        b2.innerHTML = mathHTML(chatActive.text) + '<span class="chat-cursor">▍</span>';
      } else {
        b2.textContent = "思考中…";
      }
      w.appendChild(b2); list.appendChild(w);
    }
    $("chatMeta").textContent = chatMetaText(arr);
    if ($("chatJump")) {
      var turns = arr.filter(function (m) { return m && m.role === "user"; }).length;
      $("chatJump").style.display = "";
      $("chatJump").textContent = turns ? ("追问 " + turns) : "追问";
    }
    $("chatClear").disabled = !arr.length;
    var running = !!(chatActive && chatActive.recId === lastHistoryId && chatActive.status === "running");
    $("chatSend").disabled = running;
    $("chatStop").style.display = running ? "" : "none";
    chatResize();
    setTimeout(chatScroll, 0);
  }
  function chatSend() {
    if (!last || !last.result || !lastHistoryId) { $("status").textContent = "请先解一道题，再追问"; return; }
    if (chatActive && chatActive.status === "running" && chatActive.recId === lastHistoryId) return;
    var text = $("chatIn").value.trim();
    if (!text) { $("chatIn").focus(); return; }
    if (text.length > CHAT_IN_MAX) { chatWarn("问题过长，最多 " + CHAT_IN_MAX + " 字"); return; }
    var be = badInput(text);
    if (be) { chatWarn(be); $("chatIn").focus(); return; }
    var cfg = loadCfg();
    if (!cfg || !cfg.baseUrl || !cfg.apiKey) { openModal(); $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "请先配置模型"; return; }
    var recId = lastHistoryId;
    var r = last.result;
    var arr = chatArr(r).slice();
    arr.push({ role: "user", content: text, ts: Date.now() });
    if (arr.length > CHAT_STORE_MAX) arr = arr.slice(arr.length - CHAT_STORE_MAX);
    r.chat = arr;
    chatSaveArr(recId, arr);
    $("chatIn").value = ""; chatResize(); chatWarn("");
    chatActive = { recId: recId, text: "", status: "running", error: "", entry: null };
    renderChat(r);
    var msgs = arr.filter(function (m) { return m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim(); })
      .slice(-CHAT_SEND_MAX)
      .map(function (m) { return { role: m.role, content: String(m.content || "").slice(0, CHAT_ITEM_MAX) }; });
    var entry = runTask("/api/chat", {
      question: last.question || "",
      questionText: r.questionText || "",
      answer: r.answer || "",
      analysis: r.analysis || "",
      subQuestions: r.subQuestions || null,
      renderCode: r.renderCode || "",
      render3d: r.render3d || null,
      images: (last.images || []).slice(),
      grade: last.grade || gradeGet(),
      messages: msgs,
      config: cfg,
      stream: true
    }, "追问", { chat: true, baseId: recId });
    if (!entry) {
      chatActive = null;
      chatWarn("任务太多，请稍后再问");
      renderChat(r);
      return;
    }
    chatActive.entry = entry;
    renderChat(r);
  }
  function chatStreamSet(entry, text) {
    if (!chatActive || chatActive.recId !== entry.baseId || chatActive.status !== "running") return;
    chatActive.text = String(text || "");
    var b = $("chatStreamBubble");
    if (b) {
      b.innerHTML = mathHTML(chatActive.text) + '<span class="chat-cursor">▍</span>';
      chatScroll();
    }
  }
  function chatFinish(entry, result) {
    if (entry && entry.discardChat) return;
    var recId = entry.baseId || lastHistoryId || "";
    var text = result && result.text ? String(result.text).trim() : "";
    if (!text) { chatFail(entry, { error: "EMPTY_REPLY", message: "模型没有返回文字" }); return; }
    var msg = { role: "assistant", content: text, ts: Date.now(), elapsedMs: (result && result.elapsedMs) || 0, usage: (result && result.usage) || null };
    entry.recId = recId;
    if (chatActive && chatActive.recId === recId) chatActive = null;
    chatAppendTo(recId, msg, function (ok) {
      if (ok && lastHistoryId === recId) $("status").textContent = "已回答（追问）";
      else if (!ok) $("status").textContent = "回答已生成，但聊天记录保存失败";
    });
  }
  function chatFail(entry, d) {
    if (entry && entry.discardChat) return;
    var recId = (entry && entry.baseId) || lastHistoryId || "";
    // 追问失败也只说一句人话；原始信息在「日志」里。
    var msg = (d && d.error) ? errInfo(d).title : "网络错误";
    var partial = (chatActive && chatActive.recId === recId) ? String(chatActive.text || "") : "";
    if (d && d.error === "CANCELLED") {
      chatActive = null;
      if (partial.trim()) {
        chatAppendTo(recId, { role: "assistant", content: partial.trim() + "\n\n（回答已停止）", ts: Date.now() }, function () {});
      } else if (lastHistoryId === recId) {
        renderChat(last && last.result);
      }
      $("status").textContent = "已停止追问";
      return;
    }
    chatActive = { recId: recId, text: partial, status: "error", error: "回答失败：" + msg, entry: entry || null };
    if (lastHistoryId === recId) renderChat(last && last.result);
    $("status").textContent = "追问失败：" + msg;
  }
  function chatStop() {
    if (!chatActive || chatActive.status !== "running" || !chatActive.entry) return;
    fetch("/api/task/" + chatActive.entry.id + "/cancel", { method: "POST" }).catch(function () {});
    $("status").textContent = "正在停止追问…";
  }
  async function chatClear() {
    if (!last || !last.result || !lastHistoryId) return;
    var arr = chatArr(last.result);
    if (!arr.length) return;
    if (!(await hjConfirm({
      title: "清空追问记录？",
      message: "只删除聊天内容，不会影响答案、解析和图形。",
      okText: "清空",
      danger: true,
      native: "清空这道题的追问记录？\n\n只删除聊天内容，不会影响答案、解析和图形。"
    }))) return;
    if (chatActive && chatActive.recId === lastHistoryId && chatActive.status === "running") {
      if (chatActive.entry) {
        chatActive.entry.discardChat = true;
        fetch("/api/task/" + chatActive.entry.id + "/cancel", { method: "POST" }).catch(function () {});
      }
    }
    chatActive = null;
    last.result.chat = [];
    chatSaveArr(lastHistoryId, []);
    chatWarn("");
    renderChat(last.result);
    $("status").textContent = "已清空这道题的追问记录";
  }
  if ($("chatSend")) $("chatSend").onclick = chatSend;
  if ($("chatStop")) $("chatStop").onclick = chatStop;
  if ($("chatClear")) $("chatClear").onclick = chatClear;
  if ($("chatFold")) $("chatFold").onclick = function () {
    chatOpen = !chatOpen;
    try { localStorage.setItem("solver_chat_open_v1", chatOpen ? "1" : "0"); } catch (e) {}
    applyChatOpen();
    if (chatOpen) setTimeout(chatScroll, 0);
  };
  if ($("chatJump")) $("chatJump").onclick = function () {
    var card = $("chatCard"); if (!card) return;
    if (!chatOpen) {
      chatOpen = true;
      try { localStorage.setItem("solver_chat_open_v1", "1"); } catch (e) {}
      applyChatOpen();
    }
    try { card.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { card.scrollIntoView(); }
    setTimeout(function () { if ($("chatIn")) $("chatIn").focus(); }, 320);
  };
  if ($("chatIn")) {
    $("chatIn").addEventListener("input", function () { chatWarn(""); chatResize(); });
    $("chatIn").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault(); chatSend();
      }
    });
  }

  // ================= 年级 / 图形类型（可选） =================
  var GRADE_KEY = "solver_grade_v1";
  function gradeGet() { var el = $("grade"); return el ? el.value : ""; }
  function gradeApply(v) {
    var el = $("grade");
    if (el) { el.value = v || ""; if (window.HJSelect) window.HJSelect.sync(el); }
  }
  function gradeSave(v) { try { localStorage.setItem(GRADE_KEY, v || ""); } catch (e) {} }
  function gradeLoad() { var v = ""; try { v = localStorage.getItem(GRADE_KEY) || ""; } catch (e) {} gradeApply(v); }
  $("grade").addEventListener("change", function () { gradeSave(gradeGet()); });
  gradeLoad();

  var DIM_KEY = "solver_dim_v1";
  function dimGet() { var el = $("dim"); return el ? el.value : ""; }
  function dimApply(v) {
    var el = $("dim");
    if (el) { el.value = v || ""; if (window.HJSelect) window.HJSelect.sync(el); }
  }
  function dimSave(v) { try { localStorage.setItem(DIM_KEY, v || ""); } catch (e) {} }
  function dimLoad() { var v = ""; try { v = localStorage.getItem(DIM_KEY) || ""; } catch (e) {} dimApply(v); }
  if ($("dim")) $("dim").addEventListener("change", function () { dimSave(dimGet()); });
  dimLoad();

  // 画法（解题前选）：look = 像题图（教材把高画长），true = 真实尺寸。
  // 只影响提示词，渲染器不缩放坐标；改完对下一次解题/微调生效。
  var VIEW_KEY = "solver_view_v1";
  function viewGet() { var el = $("view"); return (el && el.value === "look") ? "look" : "true"; }
  function viewApply(v) {
    var el = $("view");
    if (el) { el.value = (v === "look" ? "look" : "true"); if (window.HJSelect) window.HJSelect.sync(el); }
  }
  function viewSave(v) { try { localStorage.setItem(VIEW_KEY, v === "look" ? "look" : "true"); } catch (e) {} }
  function viewLoad() { var v = ""; try { v = localStorage.getItem(VIEW_KEY) || ""; } catch (e) {} viewApply(v); }
  if ($("view")) $("view").addEventListener("change", function () { viewSave(viewGet()); });
  viewLoad();

  // 夜间模式：只换界面外壳，画布仍是白纸（图形颜色是按白底设计的）。
  // 首次进页面由 index.html <head> 里的内联脚本先定主题，这里只负责按钮与图标。
  var THEME_KEY = "solver_theme_v1";
  function themeGet() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function themeApply(t) {
    document.documentElement.setAttribute("data-theme", t);
    var m = $("icoMoon"), s = $("icoSun");
    if (m) m.style.display = (t === "dark" ? "none" : "");
    if (s) s.style.display = (t === "dark" ? "" : "none");
    var b = $("btnTheme");
    if (b) b.title = (t === "dark" ? "切换到日间模式" : "切换到夜间模式");
    // themeToggle 走 View Transition 时本函数在下一帧才执行；任何「点完立刻读
    // data-theme」的调用方（手机设置页）都会读到旧值、把切换方向弄反——
    // 统一广播，让它们监听这个事件再刷新自己的选中态
    try { document.dispatchEvent(new CustomEvent("hj-themechange", { detail: { theme: t } })); } catch (e) {}
  }
  function themeToggle() {
    var t = themeGet() === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    // beUI Theme Toggle：从按钮位置圆形揭示新主题（View Transition API；不支持就瞬切）
    var reduce = false;
    try { reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    if (!document.startViewTransition || reduce) { themeApply(t); return; }
    var b = $("btnTheme"), r = b ? b.getBoundingClientRect() : null;
    var vt = document.startViewTransition(function () { themeApply(t); });
    if (!r || !vt.ready) return;
    vt.ready.then(function () {
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var R = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
      document.documentElement.animate(
        { clipPath: ["circle(0px at " + cx + "px " + cy + "px)", "circle(" + R + "px at " + cx + "px " + cy + "px)"] },
        { duration: 460, easing: "cubic-bezier(.4,0,.2,1)", pseudoElement: "::view-transition-new(root)" }
      );
    }).catch(function () {});
  }
  if ($("btnTheme")) $("btnTheme").addEventListener("click", themeToggle);
  themeApply(themeGet());

  // 失败时的重试按钮：只在顶层「解题」失败后出现，点一下用同一题重新请求。
  // 不放在提示文字里，是因为手机上那句 hint 很容易被当成普通说明直接划过去。
  var retryBtn = null;
  function retryEnsure() {
    if (retryBtn && retryBtn.isConnected) return retryBtn;
    var card = $("ansCard");
    if (!card) return null;
    var b = document.createElement("button");
    b.id = "ansRetry";
    b.type = "button";
    b.className = "ans-retry";
    b.title = "用当前这道题重新请求模型（会再次产生费用）";
    b.innerHTML = '<svg class="ico-sm"><use href="#i-refresh-cw"/></svg><span>重试解题</span>';
    b.addEventListener("click", function () {
      b.disabled = true;
      setTimeout(function () { b.disabled = false; }, 800);
      solve();
    });
    // 放在答案正文之前：手机底部浮层默认只露答案卡顶部，放末尾会被裁到屏幕外。
    var ans = $("answer");
    if (ans && ans.parentNode === card) card.insertBefore(b, ans);
    else card.appendChild(b);
    retryBtn = b;
    return b;
  }
  function retryShow(on) {
    var b = retryEnsure();
    if (b) b.style.display = on ? "" : "none";
  }
  // 请求还没拿到 taskId 就失败（配置 / 网络 / 服务端拒绝）时，也把答案卡切成失败态，
  // 否则重试按钮会孤零零挂在上一题的残留文字下面。
  function retryFailUI(entry, title, hint) {
    if (entry.opts.chat || entry.opts.auto || entry.opts.update) return;
    $("answer").className = "hint";
    $("analysis").className = "hint";
    $("answer").textContent = title || "解题失败";
    $("analysis").textContent = logHintText(hint || "重试一次");
    retryShow(true);
  }
  function solve() {
    var q = $("q").value.trim();
    if (!q && !images.length) { window.HJFX && HJFX.shake($("q")); return; }   // 空输入：抖一下提示，不聚焦
    qWarn("");
    if (q.length > Q_MAX) { qWarn("题目过长，最多 " + Q_MAX + " 字"); return; }
    var be = q ? badInput(q) : "";
    if (be) { qWarn(be); $("q").focus(); return; }
    var cfg = loadCfg();
    if (!cfg || !cfg.baseUrl || !cfg.apiKey) { openModal(); $("cfgMsg").className = "msg bad"; $("cfgMsg").textContent = "请先配置模型"; return; }
    runTask("/api/solve", { question: q, images: images.slice(), grade: gradeGet(), dim: dimGet(), view: viewGet(), config: cfg, stream: true }, "解题", { update: false, auto: false });
  }
  $("go").onclick = solve;
  $("q").addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") solve(); });
  $("sbTask").onclick = function () { panelOpen = !panelOpen; renderPanel(); };

  // ================= 错误日志（状态栏左下角） =================
  // 界面上只显示一句人话；点这里能看到服务端原话、状态码、模型名和完整 body。
  var LOG_UNREAD_KEY = "solver_errlog_unread_v1";
  var logUnread = 0;
  try { logUnread = Number(localStorage.getItem(LOG_UNREAD_KEY) || 0) || 0; } catch (e) { logUnread = 0; }
  var logEntries = [];        // 最近一次从 /api/logs 拿到的条目
  var logLoading = false;

  function logBadge() {
    var b = $("sbLogBadge"), btn = $("sbLog");
    if (!b || !btn) return;
    if (logUnread > 0) {
      b.textContent = logUnread > 99 ? "99+" : String(logUnread);
      b.classList.add("show");
      btn.classList.add("has-err");
      btn.title = "有 " + logUnread + " 条未查看的错误，点开看详情";
    } else {
      b.textContent = "";
      b.classList.remove("show");
      btn.classList.remove("has-err");
      btn.title = "错误日志（这里只显示一句话，完整信息在日志里）";
    }
  }
  function logMarkErr() {
    logUnread++;
    try { localStorage.setItem(LOG_UNREAD_KEY, String(logUnread)); } catch (e) {}
    logBadge();
  }
  function logSeen() {
    logUnread = 0;
    try { localStorage.setItem(LOG_UNREAD_KEY, "0"); } catch (e) {}
    logBadge();
  }
  function logTime(ts) {
    var d = new Date(ts || 0);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function logElapsed(ms) {
    if (!ms) return "";
    return ms < 1000 ? ms + " 毫秒" : (ms / 1000).toFixed(1) + " 秒";
  }
  // 技术信息（面板里展开后显示的就是这一段）
  function logEntryMeta(e) {
    var u = e.usage || null;
    var rt = u && u.completion_tokens_details ? u.completion_tokens_details.reasoning_tokens : 0;
    var usageLine = u && (u.prompt_tokens != null || u.completion_tokens != null)
      ? "tokens：输入 " + (u.prompt_tokens || 0) + " · 输出 " + (u.completion_tokens || 0) + (rt ? "（推理 " + rt + "）" : "")
      : "";
    return [
      e.model ? "模型：" + e.model : "",
      e.host ? "地址：" + e.host : "",
      e.kind ? "任务：" + e.kind + (e.snippet ? " · " + e.snippet : "") : "",
      e.elapsedMs ? "耗时：" + logElapsed(e.elapsedMs) : "",
      e.maxTokens ? "输出上限：" + e.maxTokens : "",
      e.finishReason ? "结束原因：" + e.finishReason : "",
      usageLine,
      e.reasoningChars ? "推理正文：" + e.reasoningChars + " 字（可见正文 " + (e.contentChars || 0) + " 字）" : "",
      e.raw ? "\n—— 服务端原始返回 ——\n" + e.raw : ""
    ].filter(Boolean).join("\n");
  }
  // 复制出去的完整一条（比面板上多「时间 / 错误 / 建议」三行，方便贴给别人）
  function logEntryText(e) {
    return [
      "时间：" + logTime(e.ts),
      "错误：" + (e.title || "") + (e.code ? "（" + e.code + "）" : ""),
      e.hint ? "建议：" + e.hint : "",
      logEntryMeta(e)
    ].filter(Boolean).join("\n");
  }
  function logCopy(text) {
    if (!text) return;
    var done = function () { if (window.HJ && HJ.toast) HJ.toast("已复制", "ok"); else $("status").textContent = "已复制到剪贴板"; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { logCopyFallback(text, done); });
    } else logCopyFallback(text, done);
  }
  function logCopyFallback(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { $("status").textContent = "复制失败，请手动选中"; }
    ta.remove();
  }
  function renderLog() {
    var host = $("logList");
    if (!host) return;
    host.innerHTML = "";
    if (!logEntries.length) {
      var em = document.createElement("div"); em.className = "log-empty";
      em.innerHTML = '<svg><use href="#i-check"/></svg>' + (logLoading ? "正在读取…" : "还没有错误记录。<br>解题失败时，完整信息会自动记在这里。");
      host.appendChild(em);
      return;
    }
    logEntries.forEach(function (e, i) {
      var it = document.createElement("div");
      it.className = "log-item" + (i === 0 ? " open" : "");
      var h = document.createElement("div"); h.className = "log-h";
      var ico = document.createElement("span"); ico.className = "log-ico"; ico.innerHTML = '<svg><use href="#i-triangle"/></svg>';
      var t = document.createElement("span"); t.className = "log-t"; t.textContent = e.title || "出错了";
      var code = document.createElement("span"); code.className = "log-code";
      code.textContent = e.http ? "HTTP " + e.http : (e.code || "");
      var tm = document.createElement("span"); tm.className = "log-time"; tm.textContent = logTime(e.ts);
      var ch = document.createElement("span"); ch.className = "log-chev"; ch.innerHTML = '<svg><use href="#i-chevron-down"/></svg>';
      h.appendChild(ico); h.appendChild(t); h.appendChild(code); h.appendChild(tm); h.appendChild(ch);
      h.onclick = function () { it.classList.toggle("open"); };
      it.appendChild(h);
      if (e.hint) { var hi = document.createElement("div"); hi.className = "log-hint"; hi.textContent = e.hint; it.appendChild(hi); }
      var raw = document.createElement("div"); raw.className = "log-raw";
      raw.textContent = logEntryMeta(e);
      it.appendChild(raw);
      var acts = document.createElement("div"); acts.className = "log-acts";
      var cp = document.createElement("button"); cp.type = "button"; cp.textContent = "复制这条";
      cp.onclick = function (ev) { ev.stopPropagation(); logCopy(logEntryText(e)); };
      acts.appendChild(cp);
      it.appendChild(acts);
      host.appendChild(it);
    });
  }
  function openLog() {
    $("logModal").classList.add("show");
    logSeen();
    logLoading = true; renderLog();
    $("logSub").textContent = "";
    fetch("/api/logs?limit=100").then(function (r) { return r.json(); }).then(function (j) {
      logLoading = false;
      logEntries = (j && j.entries) || [];
      if (j && j.file) { $("logDir").textContent = "完整记录存于 " + j.file; $("logDir").title = j.file; }
      $("logSub").textContent = logEntries.length ? ("最近 " + logEntries.length + " 条（点条目展开原文）") : "";
      renderLog();
    }).catch(function () {
      logLoading = false;
      logEntries = [];
      renderLog();
      $("logDir").textContent = "读不到日志接口，服务可能没启动";
    });
  }
  function closeLog() { $("logModal").classList.remove("show"); }
  if ($("sbLog")) $("sbLog").onclick = openLog;
  if ($("logClose")) $("logClose").onclick = closeLog;
  if ($("logModal")) $("logModal").addEventListener("click", function (e) { if (e.target === $("logModal")) closeLog(); });
  if ($("logClear")) $("logClear").onclick = function () {
    fetch("/api/logs/clear", { method: "POST" }).then(function () {
      logEntries = []; logSeen(); renderLog();
      $("logSub").textContent = "";
      if (window.HJ && HJ.toast) HJ.toast("日志已清空", "ok");
    }).catch(function () {});
  };
  if ($("logCopyAll")) $("logCopyAll").onclick = function () {
    if (!logEntries.length) return;
    logCopy(logEntries.map(logEntryText).join("\n\n" + "─".repeat(30) + "\n\n"));
  };
  logBadge();
  initTasks();

  // ================= 导出（#5） =================
  function tsName() { return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); }
  function download(href, name) {
    var a = document.createElement("a"); a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 200);
  }
  function downloadBlob(text, name) {
    var b = new Blob([text], { type: "text/html;charset=utf-8" });
    var u = URL.createObjectURL(b);
    download(u, name);
    setTimeout(function () { URL.revokeObjectURL(u); }, 6000);
  }
  function svgToImage(svgEl, cb) {
    try {
      var clone = svgEl.cloneNode(true);
      var r = svgEl.getBoundingClientRect();
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(Math.round(r.width)));
      clone.setAttribute("height", String(Math.round(r.height)));
      var s = new XMLSerializer().serializeToString(clone);
      var img = new Image();
      img.onload = function () { cb(img); };
      img.onerror = function () { cb(null); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
    } catch (e) { cb(null); }
  }
  function exportPNG(cb) {
    if ($("g3d").style.display !== "none" && window.GGB3D && window.GGB3D.snapshot) {
      var u = window.GGB3D.snapshot();
      if (u) return cb(u);
    }
    var host = $("canvasHost"); if (!host) return cb("");
    var nodes = host.querySelectorAll("canvas, svg");
    if (!nodes.length) return cb("");
    var rect = host.getBoundingClientRect();
    var W = Math.max(1, Math.round(rect.width * 2)), H = Math.max(1, Math.round(rect.height * 2));
    var c = document.createElement("canvas"); c.width = W; c.height = H;
    var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    var i = 0;
    (function next() {
      if (i >= nodes.length) { overlayTexts(ctx, host, rect, W, H); try { return cb(c.toDataURL("image/png")); } catch (e) { return cb(""); } }
      var n = nodes[i++];
      if (n.tagName.toLowerCase() === "canvas") {
        try { ctx.drawImage(n, 0, 0, W, H); } catch (e) {}
        return next();
      }
      svgToImage(n, function (img) { if (img) { try { ctx.drawImage(img, 0, 0, W, H); } catch (e) {} } next(); });
    })();
  }
  function overlayTexts(ctx, host, hr, W, H) {
    var sx = W / hr.width, sy = H / hr.height;
    var divs = host.querySelectorAll(".JXGtext");
    for (var i = 0; i < divs.length; i++) {
      var d = divs[i];
      var r = d.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      var cs = getComputedStyle(d);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
      var txt = (d.textContent || "").trim();
      if (!txt) continue;
      var fs = parseFloat(cs.fontSize) || 12;
      var lines = txt.split(/\n+/);
      var lh = (r.height / Math.max(1, lines.length));
      if (lh > fs * 2.2) lh = fs * 1.2;
      ctx.save();
      ctx.fillStyle = cs.color || "#000";
      ctx.font = (cs.fontWeight || "400") + " " + (fs * sx) + "px " + (cs.fontFamily || "sans-serif");
      var ta = cs.textAlign;
      var x, align = "left";
      if (ta === "center") { align = "center"; x = (r.left - hr.left + r.width / 2) * sx; }
      else if (ta === "end" || ta === "right") { align = "right"; x = (r.left - hr.left + r.width) * sx; }
      else { x = (r.left - hr.left) * sx; }
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      var y0 = (r.top - hr.top) * sy + (lh * sy) / 2;
      for (var li = 0; li < lines.length; li++) ctx.fillText(lines[li], x, y0 + li * lh * sy);
      ctx.restore();
    }
  }
  // 「导出图片」：新 UI 的工具栏按钮转调这里（补一个隐藏的等价按钮复用逻辑）
  if (!$("btnPng")) {
    var _bp = document.createElement("button");
    _bp.id = "btnPng"; _bp.style.display = "none";
    document.body.appendChild(_bp);
  }
  $("btnPng").onclick = function () {
    $("status").textContent = "正在导出图片…";
    exportPNG(function (u) {
      if (!u) { $("status").textContent = "没有可导出的图形"; return; }
      download(u, "geometry_" + tsName() + ".png");
      $("status").textContent = "已导出 PNG 图片";
    });
  };

  function fetchText(p) { return fetch(p).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.text(); }); }
  function b64FromBuf(buf) {
    var b = new Uint8Array(buf), s = "", CH = 0x8000;
    for (var i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    return btoa(s);
  }
  function inlineKatexCss() {
    return fetchText("/solver/vendor/katex/katex.min.css").then(function (css) {
      var jobs = [];
      css = css.replace(/url\((['"]?)([^)'"]+\.woff2)\1\)/g, function (m, q, p) { jobs.push([m, p]); return m; });
      var chain = Promise.resolve();
      jobs.forEach(function (job) {
        chain = chain.then(function () {
          return fetch("/solver/vendor/katex/" + job[1]).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
            css = css.replace(job[0], "url(data:font/woff2;base64," + b64FromBuf(buf) + ")");
          }).catch(function () {});
        });
      });
      return chain.then(function () { return css; });
    }).catch(function () { return ""; });
  }
  function jsonEmbed(x) {
    return JSON.stringify(x).replace(/<\//g, "<\\/").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  function exportCss() {
    return "html,body{margin:0;height:100%;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;color:#1a1a1a;background:#f7f8fa}" +
      ".wrap{display:flex;height:100%}" +
      ".sw{display:flex;flex-direction:column;flex:1;position:relative;min-width:0;background:#fff;border-right:1px solid #e8e8e8}" +
      "#stage{position:relative;flex:1;min-height:0;overflow:hidden}" +
      "#stage canvas{display:block;position:absolute;left:0;top:0}" +
      "#ggb-canvas{position:absolute;inset:0}" +
      ".actbar{display:none;flex-wrap:wrap;gap:6px;padding:6px 8px;background:#fff;border-top:1px solid #eee;max-height:30%;overflow:auto;z-index:6}" +
      ".actbar button{position:static !important;left:auto !important;right:auto !important;top:auto !important;bottom:auto !important;margin:0 !important;z-index:auto !important}" +
      // 画布上的浮层面板：默认半透明卡片，移动端进一步压缩，保证一屏放得下
      ".g3d-panel{backdrop-filter:blur(2px)}" +
      // 3D 覆盖层贴死在画布内：canvas 会把父容器撑出几像素，
      // 不管住的话 inset:0 会跟着偏移，四个角的面板就整体跑偏（手机上尤其明显）。
      ".g3d-wrap{position:absolute !important;left:0 !important;top:0 !important;right:0 !important;bottom:0 !important;overflow:hidden !important}" +
      ".hj-stack{pointer-events:none}" +
      ".hj-stack>*{pointer-events:auto}" +
      // 折叠按钮：浮在面板左上角（右上角常被面板自己的按钮占着，放左上不打架）
      // 注意不能改 .g3d-panel 的 position（它本来就靠 absolute 定位在四角）
      // 样式与应用内「对象样式」面板那把「−」（ui.css 的 #objStyle .os-hide）保持一致：
      // 20×20、白底、1px 描边、灰色号，hover 变主题紫；不用半透明 ▾ 那种「看不见的角标」。
      ".g3d-panel .hj-fold{position:absolute;top:2px;left:2px;width:20px;height:20px;padding:0 !important;margin:0 !important;" +
        "border:1px solid #e1e4ea !important;background:#fff !important;border-radius:6px;color:#5b636d;" +
        "font-size:15px !important;font-weight:500;line-height:18px !important;cursor:pointer;z-index:4;text-align:center;" +
        "box-shadow:0 1px 3px rgba(20,30,60,.12)}" +
      ".g3d-panel .hj-fold:hover{background:#eef0ff !important;color:#5b5bd6;border-color:#5b5bd6 !important}" +
      // 折叠键占位必须写在 CSS 里并带 !important：
      // 打包后的 JS 会给面板设 inline padding（四边简写），而窄屏媒体查询里还有
      // `.g3d-panel{padding:5px 7px !important}` —— inline 样式打不过 !important，
      // 手机上左内边距就被压回 7px，折叠键盖住标题首字（「聚焦」显示成「焦」）。
      // .g3d-panel.hj-hasfold (0,2,0) 的特异性高于媒体查询里的 .g3d-panel (0,1,0)，稳定胜出。
      ".g3d-panel.hj-hasfold{padding-left:26px !important}" +
      // 收起后只留按钮 + 一行标题（按钮改成静态排在文字后面，不再浮在角落）
      ".g3d-panel.hj-collapsed{max-height:none !important;overflow:visible !important;padding:4px 8px !important;display:flex !important;align-items:center;gap:6px}" +
      ".g3d-panel.hj-collapsed>*:not(.hj-fold){display:none !important}" +
      ".g3d-panel.hj-collapsed::before{content:attr(data-hj-label);font-size:11px;color:#5a6070;white-space:nowrap}" +
      ".g3d-panel.hj-collapsed .hj-fold{position:static !important;width:18px !important;height:18px !important;line-height:16px !important;order:2;" +
        "background:#fff !important;border:1px solid #e1e4ea !important;border-radius:6px !important}" +
      ".g3d-panel.hj-collapsed{padding-left:0 !important}" +
      // 参数面板：手机上滑杆行改成两行（标签+数值 / 整条滑杆），并且绝不许横向溢出。
      // 不加这几条时：标签被 KaTeX 顶宽 → clamp 到 300px，但面板实际只有 ~190px，
      // 右侧数值被裁掉、面板底部出现横向滚动条。
      ".g3d-sliders{box-sizing:border-box;max-width:300px !important;overflow-x:hidden !important;overflow-y:auto}" +
      ".g3d-sliders .g3d-slider-row{min-width:0 !important;flex-wrap:wrap !important}" +
      ".g3d-sliders .g3d-slider-lb{min-width:0 !important;flex:1 1 auto !important;overflow-wrap:anywhere;word-break:break-word}" +
      ".g3d-sliders .g3d-slider-val{flex:0 0 auto !important}" +
      ".g3d-sliders .g3d-slider-inp{flex:1 1 100% !important;min-width:0 !important;width:100% !important;max-width:100% !important;order:3}" +
      "@media (max-width:760px){" +
        ".g3d-panel{padding:5px 7px !important;border-radius:7px !important;box-shadow:0 2px 8px rgba(0,0,0,.10) !important}" +
        ".g3d-panel button{font-size:10.5px !important;padding:2px 6px !important;margin:1px 0 !important;border-radius:5px !important}" +
        ".g3d-panel div,.g3d-panel span{font-size:10.5px !important}" +
        ".g3d-steps,.g3d-answers{max-height:26vh !important;overflow:auto !important}" +
        // 滑块面板最占横向空间：收窄，避免糊住图形。
        // 40vw 在 390px 手机上只有 156px，减掉折叠键占位(26px)后滑杆几乎没地方 ——
        // 改成 52vw（约 203px），足够放下「标签+数值」和整条滑杆。
        ".g3d-sliders{max-width:52vw !important}" +
        ".g3d-sliders input[type=range]{max-width:100% !important}" +
        // 聚焦面板按钮多，限宽避免顶到画面中间
        ".g3d-focus{max-width:34vw !important}" +
        // 移动端把画布和正文改成上下排布，画布占屏高约 52%，正文可滚动但不需要横向滚
        ".wrap{flex-direction:column !important;height:auto !important;min-height:0 !important}" +
        ".sw{flex:none !important;height:52vh !important;border-right:none !important;border-bottom:1px solid #e8e8e8}" +
        ".side{width:auto !important;max-width:100% !important;flex:1 1 auto !important;padding:12px 14px !important}}" +
      ".side{width:420px;max-width:44vw;overflow:auto;padding:16px;background:#fff}" +
      ".side h3{font-size:13px;color:#888;margin:14px 0 6px;font-weight:600}.side h3:first-child{margin-top:0}" +
      ".ans{font-size:15px;line-height:1.6}.ana{font-size:13.5px;line-height:1.7;color:#333}" +
      ".q{font-size:13px;line-height:1.7;color:#333}" +
      ".qnote{font-size:11px;color:#999;margin:7px 0 2px}" +
      ".qfig{margin:8px 0 4px}.qfig img{max-width:100%;border:1px solid #eee;border-radius:7px;display:block}" +
      ".ans,.ana{overflow-wrap:anywhere}" +
      // 导出页的小问标签 / 步骤条 / 开关（2026-10-20）
      ".exp-vers{display:none;flex-wrap:wrap;gap:6px;margin:0 0 6px}" +
      ".exp-vers button{font-size:11.5px;padding:3px 9px;border:1px solid #d8dbe3;border-radius:6px;background:#f7f8fa;color:#555;cursor:pointer}" +
      ".exp-vers button.on{background:#37474f;border-color:#37474f;color:#fff}" +
      ".exp-tabs{display:none;flex-wrap:wrap;gap:6px;margin:0 0 8px}" +
      ".exp-tabs button{font-size:12px;padding:4px 10px;border:1px solid #d8dbe3;border-radius:6px;background:#fff;color:#333;cursor:pointer}" +
      ".exp-tabs button.on{background:#5b5bd6;border-color:#5b5bd6;color:#fff}" +
      ".exp-steps{display:none;margin:2px 0 4px}" +
      ".expsteps{display:flex;flex-wrap:wrap;gap:5px}" +
      ".expsteps button{font-size:11.5px;padding:3px 8px;border:1px solid #d8dbe3;border-radius:6px;background:#fff;color:#333;cursor:pointer}" +
      ".expsteps button.on{background:#e91e63;border-color:#e91e63;color:#fff}" +
      ".expdesc{font-size:12px;color:#555;line-height:1.6;margin:4px 0 2px}" +
      ".expdesc:empty{display:none}" +
      ".exp-ctrls{display:none;flex-wrap:wrap;gap:10px;margin:2px 0 6px}" +
      ".exp-ctrls label{display:flex;align-items:center;gap:4px;font-size:12px;color:#444;cursor:pointer}" +
      // 导出页逐对象显隐（查看层）：默认收起，只影响当前浏览，不改 HJ_REC
      ".exp-objs{display:none;margin:4px 0 8px;border:1px solid #e3e6ef;border-radius:10px;background:#fff;overflow:hidden}" +
      ".exp-objs-hd{display:flex;align-items:center;gap:6px;background:#f6f7fb;padding-right:6px}" +
      ".exp-objs-tg{flex:1;display:flex;align-items:center;gap:6px;min-width:0;font-family:inherit;font-size:12.5px;color:#333;background:transparent;border:0;padding:8px 10px;cursor:pointer;text-align:left}" +
      ".exp-objs-tg .ar{flex:0 0 auto;width:10px;color:#8a9099;font-size:11px}" +
      ".exp-objs-tg .cnt{font-size:11px;color:#8a9099;font-weight:400}" +
      ".exp-objs-reset{flex:0 0 auto;font-family:inherit;font-size:11px;padding:2px 8px;border:1px solid #d8dbe3;border-radius:6px;background:#fff;color:#5b5bd6;cursor:pointer}" +
      ".exp-objs-reset:hover{background:#eef0ff;border-color:#5b5bd6}" +
      ".exp-objs-bd{border-top:1px solid #e8ebf2}" +
      ".exp-objs-bd[hidden]{display:none}" +
      ".exp-objs-tip{font-size:11px;color:#98a0ad;line-height:1.5;padding:6px 10px 4px}" +
      ".exp-objs-list{max-height:260px;overflow:auto;padding:0 0 4px}" +
      ".exp-obj{display:flex;align-items:center;gap:7px;padding:3px 8px 3px 10px;font-size:12.5px;color:#333}" +
      ".exp-obj:hover{background:#f7f8fc}" +
      ".exp-obj .dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:#8b95a1}" +
      ".exp-obj .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".exp-obj.off .nm{color:#a7adba}" +
      ".exp-obj .tag{flex:0 0 auto;font-size:10px;line-height:1.4;color:#98a0ad;border:1px solid #e3e6ef;border-radius:4px;padding:0 3px}" +
      ".exp-obj .act{flex:0 0 auto;width:24px;height:24px;padding:0;display:flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:6px;background:transparent;color:#606874;cursor:pointer}" +
      ".exp-obj .act:hover{background:#eef0ff;color:#5b5bd6;border-color:#dfe2ff}" +
      ".exp-obj .act:disabled{opacity:.35;cursor:default;background:transparent;border-color:transparent}" +
      ".exp-obj .act svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}" +
      "@media (max-width:900px){.exp-objs-list{max-height:40vh}.exp-obj{padding:4px 7px 4px 9px}}" +
      // 解析分块：多小问 / 选择题按块区分（左侧色条 + 标签 + 底色），与应用内一致
      ".ana-blks{margin:2px 0}" +
      ".ana-blk{border-left:3px solid #8b93a7;background:rgba(139,147,167,.05);border-radius:3px;padding:7px 10px;margin:8px 0}" +
      ".ana-blk[data-k=\"0\"]{border-left-color:#5b6bff;background:rgba(91,107,255,.06)}" +
      ".ana-blk[data-k=\"1\"]{border-left-color:#12b886;background:rgba(18,184,134,.07)}" +
      ".ana-blk[data-k=\"2\"]{border-left-color:#f08c00;background:rgba(240,140,0,.07)}" +
      ".ana-blk[data-k=\"3\"]{border-left-color:#e8590c;background:rgba(232,89,12,.06)}" +
      ".ana-blk.lead{border-left-color:#c9ced8;background:rgba(201,206,216,.10)}" +
      ".ana-tag{display:inline-block;font-size:10.5px;font-weight:600;color:#fff;background:#5b6bff;border-radius:4px;padding:0 5px;margin-right:6px;vertical-align:1px;line-height:1.5}" +
      ".ana-blk[data-k=\"1\"] .ana-tag{background:#12b886}" +
      ".ana-blk[data-k=\"2\"] .ana-tag{background:#f08c00}" +
      ".ana-blk[data-k=\"3\"] .ana-tag{background:#e8590c}" +
      ".ana-blk:first-child{margin-top:2px}.ana-blk:last-child{margin-bottom:2px}" +
      // 行内公式不做横向滚动：KaTeX 的 1~2px 宽度舍入会让每个公式下面都出现滚动条。
      // 独立公式仍允许横向滚动，但隐藏滚动条，避免导出页出现大量横条。
      ".katex-holder{display:inline-block;max-width:100%;overflow:visible;vertical-align:baseline}" +
      // 低分辨率下 KaTeX 的长向量箭头 SVG 会糊成实心块：统一改用 CSS 描边箭头
      ".katex .katex-accent .hide-tail{overflow:visible!important}" +
      ".katex .katex-accent .hide-tail>svg{display:none!important}" +
      ".katex .katex-accent .hide-tail::before{content:'';position:absolute;left:0;right:5px;top:50%;height:0;border-top:1.15px solid currentColor;transform:translateY(-.55px)}" +
      ".katex .katex-accent .hide-tail::after{content:'';position:absolute;right:0;top:50%;width:4.5px;height:4.5px;border-top:1.15px solid currentColor;border-right:1.15px solid currentColor;transform:translateY(-50%) rotate(45deg)}" +
      ".katex-display{overflow-x:auto;overflow-y:hidden;padding:2px 0;scrollbar-width:none;-ms-overflow-style:none}" +
      ".katex-display::-webkit-scrollbar{display:none}" +
      ".err{position:absolute;left:12px;bottom:12px;right:12px;color:#b00;background:rgba(255,240,240,.96);padding:8px 10px;border-radius:8px;font-size:12px;display:none;white-space:pre-wrap;z-index:30}" +
      ".foot{font-size:11.5px;color:#bbb;margin-top:22px}" +
      // 窄屏：同一文件按客户端自适应——桌面左图右文，手机上图下解析
      "@media (max-width:900px){" +
      "html,body{height:auto}" +
      ".wrap{display:block;height:auto}" +
      ".sw{height:52vh;min-height:300px;border-right:none;border-bottom:1px solid #e8e8e8}" +
      ".side{width:auto;max-width:none;overflow:visible;padding:14px}" +
      // 解析分块在窄屏收窄内边距，标签不换行
      ".ana-blk{padding:6px 8px;margin:6px 0}" +
      "}";
  }
  // 导出页运行时适配：2D 脚本浮层按钮收编到画布下方操作条；
  // 窄屏时让 2D 画布按容器宽高比取景（否则图形被拉伸变形）。
  // 本函数会被 toString() 内联进导出页，必须自包含。
  function exportUi() {
    function isAbs(el) {
      var cs = getComputedStyle(el);
      return cs.position === "absolute" || cs.position === "fixed";
    }
    // 把脚本自带的浮层面板按「原始方位」归到画布四角，并统一缩小
    // —— 旧做法是抽出所有按钮平铺到底部一条，分组和标题都会丢，手机上还要滚动。
    // 现在保留整个面板（含标题、滑块、步骤说明），只压缩尺寸和留白。
    function dock() {
      try {
        // 2D 的浮层挂在 #ggb-canvas，3D 的挂在 #stage 里的 .g3d-wrap。两者都要收。
        var host2d = document.getElementById("ggb-canvas");
        var host3d = document.getElementById("stage");
        var bar = document.getElementById("actbar");
        if (!host2d && !host3d) return;
        var narrow = window.matchMedia && window.matchMedia("(max-width:760px)").matches;

        // 3D 面板的类名 → 归位角。类名是 render3d.js 里写死的，比读 left/right 可靠：
        // 那些面板的定位写在 cssText 里，且都相对 .g3d-wrap（本身就是 inset:0 覆盖层）。
        var CORNER = {
          "g3d-steps": "lt", "g3d-sliders": "lb", "g3d-answers": "rb", "g3d-focus": "rt",
          "g3d-tabs": "top"
        };

        var roots = [];
        if (host2d) roots.push(host2d);
        if (host3d) roots.push(host3d);
        // 面板挂载点：2D 直接挂 #ggb-canvas，3D 挂 #stage（.g3d-wrap 的父节点）
        var mount = host2d || host3d;

        // 幂等：把上一轮生成的收纳容器拆掉，面板还原成独立元素再重新分组。
        // 不做这一步的话，第二次 dock 会把这些面板当成"static 定位的游离面板"重新塞一遍，
        // 结果全部堆到同一个角。
        roots.forEach(function (h) {
          [].forEach.call(h.querySelectorAll(".hj-stack"), function (box) {
            var parent = box.parentNode;
            if (!parent) return;
            while (box.firstChild) parent.insertBefore(box.firstChild, box);
            parent.removeChild(box);
          });
        });
        // 还原成 absolute。角位判断以「类名映射」为准（render3d 的类名是稳定的），
        // 只有类名认不出的浮层才回退到读 inline left/right —— 而且必须在清空之前读，
        // 否则清成 auto 之后所有面板都会被误判成同一个角。
        roots.forEach(function (h) {
          [].forEach.call(h.querySelectorAll(".g3d-panel, .hj-panel"), function (p) {
            var explicit = null;
            for (var k in CORNER) { if (p.classList.contains(k)) { explicit = CORNER[k]; break; } }
            if (!explicit && !p.__hjCorner) p.__hjCorner = cornerOf(p);
            p.style.position = "absolute";
            p.style.left = p.style.right = p.style.top = p.style.bottom = "auto";
            p.style.transform = "none";
            p.style.maxWidth = "none";
          });
        });
        var panels = [];
        roots.forEach(function (h) { [].forEach.call(h.querySelectorAll(".g3d-panel"), function (p) { panels.push(p); }); });
        // 其他脚本自己造的绝对定位浮层（没有 g3d 类名）也一并收，按 left/right 判角
        function cornerOf(el) {
          var cs = getComputedStyle(el);
          var L = cs.left !== "auto" ? parseFloat(cs.left) : NaN;
          var R = cs.right !== "auto" ? parseFloat(cs.right) : NaN;
          var T = cs.top !== "auto" ? parseFloat(cs.top) : NaN;
          var B = cs.bottom !== "auto" ? parseFloat(cs.bottom) : NaN;
          if (!isNaN(T) && isNaN(L) && isNaN(R)) return "top";
          var right = !isNaN(R) && (isNaN(L) || R < L);
          var bottom = !isNaN(B) && (isNaN(T) || B < T);
          return (right ? "r" : "l") + (bottom ? "b" : "t");
        }
        roots.forEach(function (h) {
          [].forEach.call(h.querySelectorAll("div"), function (d) {
            if (d.id === "ggb-canvas" || d.id === "stage") return;
            if (d.classList.contains("g3d-wrap")) return;
            if (d.classList.contains("g3d-panel")) return;      // 已在上面收了
            if (d.classList.contains("hj-stack")) return;
            if (!d.querySelector("button, input")) return;
            if (!isAbs(d)) return;
            panels.push(d);
          });
        });

        var groups = { lt: [], rt: [], lb: [], rb: [], top: [] };
        panels.forEach(function (p) {
          var c = null;
          for (var k in CORNER) { if (p.classList.contains(k)) { c = CORNER[k]; break; } }
          groups[c || p.__hjCorner || cornerOf(p)].push(p);
        });        // 同一角有多个面板时用列容器串起来，避免互相压住。
        // 注意：3D 面板必须留在 .g3d-wrap 里（那样才跟着画布一起裁切/缩放），
        // 所以容器插回面板原来的父节点，而不是 #stage。
        function stack(corner, list) {
          if (!list.length) return null;
          var box;
          if (list.length === 1) {
            box = list[0];
            // 幂等：每次 dock 都重设成 absolute，避免上一轮留下的 static 固化
            box.style.position = "absolute";
            box.style.maxWidth = narrow ? "46vw" : "300px";
          } else {
            var parent = list[0].parentNode || mount;
            box = document.createElement("div");
            box.className = "hj-stack";
            box.style.cssText = "position:absolute;display:flex;flex-direction:column;gap:5px;" +
              "max-width:" + (narrow ? "46vw" : "300px") + ";";
            list.forEach(function (p) {
              p.style.position = "static";
              p.style.left = p.style.right = p.style.top = p.style.bottom = "auto";
              p.style.transform = "none";
              p.style.maxWidth = "100%";
              p.style.pointerEvents = "auto";
              box.appendChild(p);
            });
            parent.appendChild(box);
          }
          box.style.left = box.style.right = box.style.top = box.style.bottom = "auto";
          var px = narrow ? 8 : 12;
          if (corner === "top") {
            box.style.left = "50%"; box.style.top = (narrow ? 6 : 10) + "px";
            box.style.transform = "translateX(-50%)";
          } else {
            box.style[corner[0] === "l" ? "left" : "right"] = px + "px";
            box.style[corner[1] === "t" ? "top" : "bottom"] = px + "px";
          }
          return box;
        }

        // 面板折叠：点左上角的「−」把整块收成一个标题胶囊，再点展开（展开时是「+」）。
        // 符号与应用内其它收起控件统一：对象样式面板的「−」、原题浮窗的「−/＋」都是这个口径。
        // 只做「整块收起」，不记跨次渲染的状态 —— 面板由 buildUI 重建，新面板默认展开。
        var FOLD_LABEL = { "g3d-steps": "步骤", "g3d-sliders": "参数", "g3d-answers": "答案", "g3d-focus": "聚焦", "g3d-tabs": "图" };
        function addFold(p) {
          if (p.__hjFold || p.querySelector(".hj-fold")) return;
          p.__hjFold = true;
          var b = document.createElement("button");
          b.className = "hj-fold";
          b.type = "button";
          b.textContent = "−";
          b.setAttribute("aria-expanded", "true");
          b.title = "收起";
          // 标题优先用类名映射（稳定、短），
          // 认不出的面板才退回「首个非空文本」——那种常常是按钮文案，不像标题。
          var t = "";
          for (var key in FOLD_LABEL) { if (p.classList.contains(key)) { t = FOLD_LABEL[key]; break; } }
          if (!t) {
            var kids = [].slice.call(p.children).filter(function (c) { return !c.classList.contains("hj-fold"); });
            for (var i = 0; i < kids.length; i++) {
              var s2 = (kids[i].textContent || "").replace(/\s+/g, " ").trim();
              if (s2) { t = s2.slice(0, 8); break; }
            }
          }
          if (!t) t = "面板";
          p.setAttribute("data-hj-label", t);
          // 折叠键占位：加 hj-hasfold，由 CSS 规则统一给左内边距（带 !important，
          // 能压过媒体查询的 .g3d-panel{padding:5px 7px !important}）。
          // 不要在这里写 inline padding — 打包后的压缩循环和窄屏媒体查询都会把它冲掉。
          p.classList.add("hj-hasfold");
          b.addEventListener("click", function (ev) {
            ev.stopPropagation();
            ev.preventDefault();
            var on = p.classList.toggle("hj-collapsed");
            b.textContent = on ? "+" : "−";
            b.title = on ? "展开" : "收起";
            b.setAttribute("aria-expanded", on ? "false" : "true");
          });
          p.insertBefore(b, p.firstChild);
        }
        panels.forEach(addFold);

        stack("lt", groups.lt);
        stack("rt", groups.rt);
        stack("lb", groups.lb);
        stack("rb", groups.rb);
        var topEl = stack("top", groups.top);
        if (topEl) topEl.classList.add("hj-top");

        // 统一压缩：字号、内边距、按钮尺寸都收一档，让一屏塞得下
        var small = narrow ? 11 : 12;
        panels.forEach(function (p) {
          p.style.borderRadius = "8px";
          p.style.padding = narrow ? "6px 8px" : "8px 10px";
          p.style.maxHeight = narrow ? "38vh" : "48vh";
          p.style.overflow = "auto";
          p.style.boxShadow = narrow ? "0 2px 8px rgba(0,0,0,.10)" : "0 4px 16px rgba(0,0,0,.10)";
          [].forEach.call(p.querySelectorAll("button"), function (b) {
            // 折叠键是 20×20 的固定方块（与应用内「对象样式 −」同款），不参与按钮压缩，
            // 否则 padding 一撑就变成扁长条、字也被压小。
            if (b.classList.contains("hj-fold")) return;
            b.style.fontSize = small + "px";
            b.style.padding = narrow ? "3px 7px" : "4px 9px";
            b.style.margin = "2px 0";
            b.style.borderRadius = "6px";
          });
          [].forEach.call(p.querySelectorAll("div,span"), function (t) {
            var f = parseFloat(getComputedStyle(t).fontSize);
            if (f > small + 1.5) t.style.fontSize = small + "px";
          });
          // 折叠键的左内边距不在这里补：上面 p.style.padding 是四边简写会冲掉 paddingLeft，
          // 而窄屏媒体查询更带 !important —— inline 根本压不过。
          // 统一由 CSS 规则 `.g3d-panel.hj-hasfold{padding-left:26px !important}` 负责。
        });

        // 兜底：真正「游离」的按钮（既不在面板里、也不在收纳容器里）才进底栏
        var bs = [];
        roots.forEach(function (h) { [].forEach.call(h.querySelectorAll("button"), function (b) { bs.push(b); }); });
        for (var i = 0; i < bs.length; i++) {
          var b = bs[i];
          if (b.closest && (b.closest(".g3d-panel") || b.closest(".hj-stack"))) continue;
          var holder = b.parentNode, absHolder = null;
          while (holder && holder.nodeType === 1 && roots.indexOf(holder) < 0) {
            if (isAbs(holder)) { absHolder = holder; break; }
            holder = holder.parentNode;
          }
          if (!isAbs(b) && !absHolder) continue;
          if (absHolder && absHolder.__hjDocked) continue;
          if (!bar) continue;
          if (b.__hjMoved) continue;
          b.__hjMoved = true;
          b.style.position = "static";
          b.style.left = b.style.right = b.style.top = b.style.bottom = "auto";
          b.style.zIndex = "auto";
          b.style.margin = "0";
          b.style.fontSize = small + "px";
          b.style.padding = narrow ? "3px 7px" : "4px 9px";
          bar.appendChild(b);
        }
        if (bar && bar.childNodes.length) bar.style.display = "flex";
      } catch (e) {
        try { window.__hjDockErr = String(e && e.stack || e); } catch (e2) {}
      }
    }
    function fit() {
      try {
        if (!(window.matchMedia && window.matchMedia("(max-width:900px)").matches)) return;
        var bs = ((window.JXG && window.JXG.JSXGraph && window.JXG.JSXGraph.boards) || []).slice();
        for (var i = 0; i < bs.length; i++) {
          var b = bs[i];
          if (!b || !b.setBoundingBox || b.keepaspectratio) continue;
          try { b.setBoundingBox(b.getBoundingBox(), true); } catch (e) {}
        }
      } catch (e) {}
    }
    window.__expDock = dock;
    window.__expFit = fit;
    function run() { dock(); fit(); }
    run();
    setTimeout(run, 400);
    setTimeout(run, 1500);
    window.addEventListener("resize", function () { setTimeout(run, 150); });
  }
  // 导出页：小问标签 + 步骤/开关的完整显隐（与 App 同口径）
  // 这个函数会被 toString() 内联进离线 HTML，必须自包含，不能引用 solver.js 外层变量。
  function exportTabs() {
    var BASE = window.HJ_REC || {};
    var R = BASE;
    var SUBS = [], STEPS = [], CTLS = [], is3d = false;
    var curSub = -1, curStep = -1, curVer = -1;
    var subUnion = {}, stepUnion = {}, ctlUnion = {}, scopeMap = {}, shownMap = {}, ctlHidden = {};
    var orig2d = {}, orig3d = {};
    var inited = false;
    // 逐对象显隐：只做查看层。manualHidden 是「用户手动隐藏」的掩码，
    // 只往上叠一层 false，绝不把步骤/小问自动隐藏的对象强行翻出来。
    var objItems = [], objApi = null, objsOpen = false, manualHidden = {};
    var objMo = null, objMoT = null;

    // ---- 名字/颜色小工具（导出页没有 ui.js，必须自包含）----
    function plainName(t) {
      var s = String(t == null ? "" : t);
      if (!/[\\$]/.test(s)) return s;
      if (window.GGB3D && typeof window.GGB3D.texPlain === "function") {
        try { return window.GGB3D.texPlain(s); } catch (e) {}
      }
      return s.replace(/\$/g, "").replace(/\\[A-Za-z]+\s*/g, "");
    }
    var NAME_RULES = [
      [/^(?:segment|seg|edge|line|ln)[_\-]?(.+)$/i, "棱 "],
      [/^(?:vector|vec|arrow)[_\-]?(.+)$/i, "向量 "],
      [/^(?:plane|pl|face|section|sec)[_\-]?(.+)$/i, "面 "],
      [/^(?:aux|helper|hidden)[_\-]?(.+)$/i, "辅助 "],
      [/^(?:circle|circ|k)[_\-]?(.+)$/i, "圆 "],
      [/^(?:dim|dimension)[_\-]?(.+)$/i, "尺寸 "],
      [/^(?:path|traj|track)[_\-]?(.+)$/i, "轨迹 "],
      [/^(?:arc)[_\-]?(.+)$/i, "弧 "],
      [/^(?:sphere|sph)[_\-]?(.+)$/i, "球 "],
      [/^(?:cylinder|cyl)[_\-]?(.+)$/i, "圆柱 "],
      [/^(?:cone)[_\-]?(.+)$/i, "圆锥 "],
      [/^(?:point|pt)[_\-]?([A-Za-z][A-Za-z0-9_\-]*)$/i, ""]
    ];
    var SUB_DIGITS = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
    function subDigits(s) {
      s = String(s || "").replace(/[_\-]/g, "");
      return s.replace(/([A-Za-z])(\d+)/g, function (m, a, d) {
        return a + d.split("").map(function (c) { return SUB_DIGITS[c] || c; }).join("");
      });
    }
    function friendlyName(raw) {
      var s = String(raw == null ? "" : raw).trim();
      if (!s) return "对象";
      if (/[\\$]/.test(s)) { var tp = plainName(s); if (tp) s = tp; }
      if (/[\u4e00-\u9fff]/.test(s)) return s;
      for (var i = 0; i < NAME_RULES.length; i++) {
        var m = s.match(NAME_RULES[i][0]);
        if (m) {
          var body = subDigits(m[1]);
          if (body) return NAME_RULES[i][1] + body;
        }
      }
      return subDigits(s);
    }
    function withPrefix(prefix, s) { return s.indexOf(prefix) === 0 ? s : prefix + " " + s; }
    function color2d(e) {
      try {
        var c = e.visProp && (e.visProp.strokecolor || e.visProp.fillcolor);
        return c && c !== "none" ? c : "#8b95a1";
      } catch (er) { return "#8b95a1"; }
    }
    function mapType3d(t) {
      t = String(t || "");
      if (t.indexOf("point") === 0 || t === "sphere") return "point";
      if (t.indexOf("plane") === 0) return "area";
      return "line";
    }
    var ICON_EYE = '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.2"/></svg>';
    var ICON_EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5c1.9 0 3.5.6 4.9 1.5"/><path d="M21.5 12S18 18.5 12 18.5c-1.9 0-3.5-.6-4.9-1.5"/><path d="M4 4l16 16"/></svg>';
    var ICON_FOCUS = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5"/></svg>';

    function names(s) {
      if (!s) return [];
      if (Array.isArray(s.targets)) return s.targets.filter(Boolean).map(String);
      if (Array.isArray(s.elements)) return s.elements.map(function (e) { return e && (e.targetId || e.target); }).filter(Boolean).map(String);
      return [];
    }
    function add(map, arr) { (arr || []).forEach(function (x) { map[String(x)] = true; }); }
    function controlled(n) { return !!(subUnion[n] || stepUnion[n] || ctlUnion[n]); }
    function el(id) { return document.getElementById(id); }
    function api3d() { return window.GGB3D && window.GGB3D.getApi ? window.GGB3D.getApi() : null; }

    // ---- 多版本：只查看，不改 HJ_REC.currentVid ----
    function getVersion(vid) {
      var list = Array.isArray(BASE.versions) ? BASE.versions : [];
      for (var i = 0; i < list.length; i++) if (String(list[i].vid) === String(vid)) return list[i];
      return null;
    }
    function setVersionData(v) {
      var VF = ["answer", "analysis", "renderCode", "render3d", "style2d", "steps", "controls", "focusTargets", "subQuestions", "questionText", "figureBox", "usage", "elapsedMs", "cost"];
      R = Object.assign({}, BASE);
      if (v) VF.forEach(function (k) { R[k] = (v[k] !== undefined ? v[k] : null); });
      SUBS = Array.isArray(R.subQuestions) ? R.subQuestions : [];
      STEPS = Array.isArray(R.steps) ? R.steps : [];
      CTLS = Array.isArray(R.controls) ? R.controls : [];
      is3d = !!R.render3d;
      curSub = -1; curStep = -1;
      subUnion = {}; stepUnion = {}; ctlUnion = {}; scopeMap = {}; shownMap = {}; ctlHidden = {};
      orig2d = {}; orig3d = {};
      manualHidden = {}; objItems = []; objApi = null;
    }
    function renderVerTabs() {
      var host = el("expVerTabs"); if (!host) return;
      var list = Array.isArray(BASE.versions) ? BASE.versions : [];
      if (list.length < 2) { host.style.display = "none"; return; }
      host.style.display = "flex"; host.innerHTML = "";
      list.forEach(function (v) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = "v" + (v.vid != null ? v.vid : "?");
        if (v.label) b.title = String(v.label);
        if (String(v.vid) === String(curVer)) b.className = "on";
        b.onclick = function () { switchVersion(v.vid); };
        host.appendChild(b);
      });
    }
    function renderFigure(v) {
      var stage = el("stage"); if (!stage) return;
      var bar = el("actbar"); if (bar) bar.innerHTML = "";
      var err = el("err"); if (err) { err.style.display = "none"; err.textContent = ""; }
      if (v && v.render3d) {
        try { if (window.GGB3D && window.GGB3D.dispose) window.GGB3D.dispose(); } catch (e) {}
        window.board = null;
        stage.innerHTML = "";
        try { window.GGB3D.render(stage, v.render3d); }
        catch (e) { var er = el("err"); if (er) { er.style.display = "block"; er.textContent = "3D 渲染出错：" + e.message; } }
      } else {
        try { if (window.GGB3D && window.GGB3D.dispose) window.GGB3D.dispose(); } catch (e0) {}
        try { if (window.board && window.JXG && JXG.JSXGraph && JXG.JSXGraph.freeBoard) JXG.JSXGraph.freeBoard(window.board); } catch (e) {}
        window.board = null;
        stage.innerHTML = '<div id="ggb-canvas" class="jxgbox" style="position:absolute;inset:0"></div>';
        try {
          (new Function((v && v.renderCode) || ""))();
          if (window.__applyStyle2D) window.__applyStyle2D((v && v.style2d) || {});
          if (window.applyTex2D) window.applyTex2D(window.board);
        } catch (e2) {
          var er2 = el("err"); if (er2) { er2.style.display = "block"; er2.textContent = "渲染出错：" + e2.message; }
        }
      }
      if (window.__expDock) { try { window.__expDock(); } catch (e3) {} }
      if (window.__expFit) { try { window.__expFit(); } catch (e4) {} }
    }
    function switchVersion(vid) {
      if (String(vid) === String(curVer)) return;
      var v = getVersion(vid); if (!v) return;
      curVer = v.vid;
      setVersionData(v);
      renderVerTabs();
      renderFigure(v);          // 先重建画板，再按新版本重建标签/步骤/开关
      buildMaps();
      buildObjects();           // 版本切换清空手动显隐，对象清单按新画板重建
      renderCtrls();
      renderSub(-1);
    }

    function buildMaps() {
      subUnion = {}; stepUnion = {}; ctlUnion = {}; ctlHidden = {};
      SUBS.forEach(function (s) { add(subUnion, names(s)); });
      STEPS.forEach(function (s) { add(stepUnion, names(s)); });
      CTLS.forEach(function (c) {
        add(ctlUnion, c.targets || []);
        if (c.default === false) add(ctlHidden, c.targets || []);
      });
    }
    function buildShown() {
      shownMap = {};
      for (var i = 0; i <= curStep && i < STEPS.length; i++) add(shownMap, names(STEPS[i]));
    }
    function setScope() {
      scopeMap = {};
      if (curSub >= 0 && SUBS[curSub]) add(scopeMap, names(SUBS[curSub]));
    }
    function ready() {
      if (is3d) { var a = api3d(); return !!(a && a.byId); }
      return !!(window.board && window.board.objects);
    }

    // ---- 2D ----
    function capture2d() {
      var b = window.board; if (!b || !b.objects) return;
      for (var k in b.objects) {
        var e = b.objects[k]; if (!e) continue;
        var n = e.name == null ? "" : String(e.name || "").trim();
        if (!n || !controlled(n) || (n in orig2d)) continue;
        orig2d[n] = e.visible !== false;
      }
    }
    function clearHl() {
      var b = window.board; if (!b || !b.objects) return;
      for (var k in b.objects) {
        var e = b.objects[k];
        if (!e || !e.__expHl) continue;
        try { e.setAttribute({ strokeColor: e.__expHl.s, strokeWidth: e.__expHl.w }); } catch (er) {}
        e.__expHl = null;
      }
    }
    function highlight2d() {
      clearHl();
      if (curStep < 0 || !STEPS[curStep]) return;
      var b = window.board; if (!b || !b.objects) return;
      var keep = {};
      names(STEPS[curStep]).forEach(function (n) { keep[n] = true; });
      for (var k in b.objects) {
        var e = b.objects[k]; if (!e || !e.setAttribute) continue;
        var n = e.name == null ? "" : String(e.name || "").trim();
        if (!n || !keep[n]) continue;
        try {
          if (!e.__expHl) e.__expHl = { s: e.visProp && e.visProp.strokecolor, w: e.visProp && e.visProp.strokewidth };
          e.setAttribute({ strokeColor: "#e91e63", strokeWidth: 4 });
        } catch (er) {}
      }
      try { b.update(); } catch (er2) {}
    }
    function apply2d() {
      var b = window.board; if (!b || !b.objects) return;
      capture2d();
      for (var k in b.objects) {
        var e = b.objects[k]; if (!e || !e.setAttribute) continue;
        var n = e.name == null ? "" : String(e.name || "").trim();
        if (!n) continue;
        var manual = !!manualHidden[n];
        if (!controlled(n) && !manual && !e.__expManual) continue;
        var vis = orig2d[n] !== false;
        if (curSub >= 0 && subUnion[n] && !scopeMap[n]) vis = false;
        if (curStep >= 0 && stepUnion[n] && !shownMap[n]) vis = false;
        if (ctlHidden[n]) vis = false;
        if (manual) vis = false;
        e.__expManual = manual ? 1 : 0;
        try { e.setAttribute({ visible: vis }); } catch (er) {}
        // 与 App 的 applyView2D 同口径：隐藏的动点/交点固定住，避免“看不见但能拖”的幽灵手柄
        try {
          var t = String(e.elType || "");
          if (t === "glider" || t === "point" || t === "intersection") {
            if (!vis) {
              if (e.__expFix === undefined) e.__expFix = (e.visProp && e.visProp.fixed) ? 1 : 0;
              if (!e.__expFix) e.setAttribute({ fixed: true });
            } else if (e.__expFix === 0) {
              e.setAttribute({ fixed: false });
            }
          }
        } catch (er3) {}
      }
      try { b.update(); } catch (er) {}
      highlight2d();
    }

    // ---- 3D ----
    function apply3d(resetStep) {
      var api = api3d(); if (!api || !api.byId) return;
      window.HJ_EXPORT_SCOPE = { scope: curSub >= 0 ? scopeMap : null, union: subUnion };
      Object.keys(subUnion).forEach(function (id) {
        var it = api.byId[id]; if (!it) return;
        if (!(id in orig3d)) orig3d[id] = !(it.spec && it.spec.visible === false);
      });
      if (resetStep && api.showAllSteps) api.showAllSteps();
      Object.keys(subUnion).forEach(function (id) {
        var it = api.byId[id]; if (!it) return;
        api.setVisible(it, orig3d[id] !== false && (curSub < 0 || !!scopeMap[id]));
      });
      Object.keys(ctlUnion).forEach(function (id) {
        var it = api.byId[id]; if (!it) return;
        if (ctlHidden[id]) api.setVisible(it, false);
      });
    }

    // ---- 答案/解析 ----
    function renderAnswer(i) {
      var s = i >= 0 ? SUBS[i] : null;
      var at = el("ansTitle"), ab = el("ansBody"), nt = el("anaTitle"), nb = el("anaBody");
      if (at) at.textContent = s ? ("答案 · " + (s.label || ("(" + (i + 1) + ")"))) : "答案";
      if (nt) nt.textContent = s ? ("解析 · " + (s.label || ("(" + (i + 1) + ")"))) : "解析";
      if (ab) ab.innerHTML = s ? mathHTML(s.answer || "本问未给答案") : (window.ansAllHTML ? window.ansAllHTML(R) : mathHTML(R.answer || ""));
      if (nb) nb.innerHTML = s ? mathHTML(s.analysis || "") : anaHTML(R.analysis || "", SUBS);
    }

    // ---- UI ----
    function renderTabs() {
      var host = el("expSubTabs"); if (!host) return;
      if (SUBS.length < 2) { host.style.display = "none"; return; }
      host.style.display = "flex"; host.innerHTML = "";
      var items = [{ i: -1, t: "全部" }].concat(SUBS.map(function (s, i) { return { i: i, t: (s && s.label) || ("(" + (i + 1) + ")") }; }));
      items.forEach(function (it) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = it.t;
        if (it.i === curSub) b.className = "on";
        b.onclick = function () { renderSub(it.i); };
        host.appendChild(b);
      });
    }
    function renderSteps() {
      var host = el("expSteps"); if (!host) return;
      if (is3d || !STEPS.length) { host.style.display = "none"; return; }
      host.style.display = "block"; host.innerHTML = "";
      var row = document.createElement("div"); row.className = "expsteps";
      var items = [{ i: -1, t: "全部" }].concat(STEPS.map(function (s, i) { return { i: i, t: (s && s.title) || ("步骤 " + (i + 1)) }; }));
      items.forEach(function (it) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = it.t;
        if (it.i === curStep) b.className = "on";
        b.onclick = function () { renderStep(it.i); };
        row.appendChild(b);
      });
      host.appendChild(row);
      var d = document.createElement("div"); d.className = "expdesc"; d.id = "expStepDesc";
      if (curStep >= 0 && STEPS[curStep] && STEPS[curStep].description) d.innerHTML = mathHTML(STEPS[curStep].description);
      host.appendChild(d);
    }
    function renderCtrls() {
      var host = el("expCtrls"); if (!host) return;
      var list = CTLS.filter(function (c) { return c && Array.isArray(c.targets) && c.targets.length; });
      if (is3d || !list.length) { host.style.display = "none"; return; }
      host.style.display = "flex"; host.innerHTML = "";
      list.forEach(function (c) {
        var label = document.createElement("label");
        var cb = document.createElement("input"); cb.type = "checkbox";
        cb.checked = c.default !== false;
        cb.onchange = function () {
          (c.targets || []).forEach(function (n) { n = String(n); if (cb.checked) delete ctlHidden[n]; else ctlHidden[n] = true; });
          apply2d();
          syncObjs();
        };
        label.appendChild(cb);
        label.appendChild(document.createTextNode(String(c.label || "显示")));
        host.appendChild(label);
      });
    }
    // ---- 逐对象显隐（查看层）----
    function autoVis2d(n) {
      var vis = orig2d[n] !== false;
      if (curSub >= 0 && subUnion[n] && !scopeMap[n]) vis = false;
      if (curStep >= 0 && stepUnion[n] && !shownMap[n]) vis = false;
      if (ctlHidden[n]) vis = false;
      return vis;
    }
    // 3D 的分步数据在 render3d.steps 里，顶层 steps 对 3D 记录通常是 null（只有 2D 才写顶层）。
    // 这里必须分开取，否则「恢复自动」会把所有参与分步的对象一律算成隐藏。
    function steps3d() {
      return (R.render3d && Array.isArray(R.render3d.steps)) ? R.render3d.steps : STEPS;
    }
    function autoVis3d(id) {
      if (orig3d[id] === false) return false;
      if (curSub >= 0 && subUnion[id] && !scopeMap[id]) return false;
      if (ctlHidden[id]) return false;
      var api = objApi || api3d();
      // 3D 的分步面板由 render3d 自己维护，当前步号要问它，不能沿用 exportTabs 的 curStep
      if (api && api.getStep && api.stepEls && api.stepEls[id]) {
        var k = api.getStep();
        var S3 = steps3d();
        if (k >= 0) {
          var shown = false;
          for (var i = 0; i <= k && i < S3.length && !shown; i++) {
            var els = (S3[i] && S3[i].elements) || [];
            for (var j = 0; j < els.length; j++) {
              if (String(els[j] && els[j].targetId) === id) { shown = true; break; }
            }
          }
          if (!shown) return false;
        }
      }
      return true;
    }
    function read2dLite() {
      var out = [], byName = {}, b = window.board;
      if (!b || !b.objects) return out;
      for (var k in b.objects) {
        var e = b.objects[k]; if (!e) continue;
        var t = String(e.elType || "");
        if (t === "text" || t === "image" || t === "label") continue;
        if (t === "arc" || t === "curve" || t === "grid" || t === "slider") continue;
        var name = (e.name == null ? "" : String(e.name)).trim();
        if (!name) continue;
        if (/^[a-z]$/.test(name) || /^P_\{/.test(name)) continue;
        (byName[name] = byName[name] || []).push(e);
      }
      Object.keys(byName).forEach(function (name) {
        var arr = byName[name], e = arr[0];
        var base = true;
        try { base = !(e.visProp && e.visProp.visible === false); } catch (er) {}
        if (!(name in orig2d)) orig2d[name] = base;
        out.push({ key: name, label: friendlyName(name), color: color2d(e), raw: arr, kind: "2d" });
      });
      return out;
    }
    function read3dLite() {
      var api = api3d(); if (!api || !api.items) return [];
      var scene = (window.GGB3D.getScene && window.GGB3D.getScene()) || {};
      var segMap = {}, planeMap = {}, ptLabel = {};
      (scene.segments || []).forEach(function (s) { if (s && s.id != null) segMap[String(s.id)] = s; });
      (scene.planes || []).forEach(function (p) { if (p && p.id != null) planeMap[String(p.id)] = p; });
      (scene.points || []).forEach(function (q) { if (q && q.id != null) ptLabel[String(q.id)] = String(q.label || q.name || q.id); });
      function nm(id) { var k = String(id == null ? "" : id); return friendlyName(ptLabel[k] || k); }
      var out = [];
      api.items.forEach(function (it) {
        if (it.id == null || it.aliasOf) return;
        var key = String(it.id), tt = String(it.type || ""), label = "";
        if (tt === "sphere") label = withPrefix("球", nm(key));
        else if (tt === "circle") label = withPrefix("圆", nm(key));
        else if (tt === "dimension") {
          var dim = (it.spec && it.spec.from && it.spec.to) ? (nm(it.spec.from) + nm(it.spec.to)) : "";
          label = "尺寸" + (dim ? " " + dim : "");
        } else if (tt.indexOf("point") === 0) label = nm(key);
        else if (segMap[key]) label = "棱 " + nm(segMap[key].from) + nm(segMap[key].to);
        else if (planeMap[key]) label = "面 " + (planeMap[key].vertices || []).map(nm).join("");
        else {
          var bl = friendlyName(key);
          if (tt === "cylinder") label = withPrefix("圆柱", bl);
          else if (tt === "cone") label = withPrefix("圆锥", bl);
          else if (tt === "arc") label = withPrefix("弧", bl);
          else if (tt === "path") label = "轨迹 " + bl;
          else if (tt === "arrow") label = "向量 " + bl;
          else if (tt === "label") label = "标注 " + bl;
          else label = bl;
        }
        if (!(key in orig3d)) orig3d[key] = !(it.spec && it.spec.visible === false);
        var type = mapType3d(tt);
        out.push({
          key: key, label: label,
          color: type === "point" ? "#5b5bd6" : (type === "area" ? "#12a150" : "#8b95a1"),
          raw: it, kind: "3d"
        });
      });
      return out;
    }
    function wrap3d(api) {
      if (!api || typeof api.setVisible !== "function" || api.__expWrapped) return;
      var orig = api.setVisible;
      api.__expSetVisible = orig;
      api.setVisible = function (it, v) {
        if (groupHiddenByManual(it)) v = false;
        return orig.call(api, it, v);
      };
      api.__expWrapped = true;
      Object.keys(manualHidden).forEach(function (id) {
        var it = api.byId && api.byId[id];
        if (it) {
          groupOf(it).forEach(function (gi) { try { api.setVisible(gi, false); } catch (er) {} });
        }
      });
    }
    // 重复平面共享同一组 Three 对象，显隐按整组取并集：手动隐藏必须整组一起按下去，
    // 否则「隐藏面 ABCD」只改了别名之一，网格依旧可见。
    function groupOf(it) {
      return (it && it.group && it.group.items && it.group.items.length) ? it.group.items : (it ? [it] : []);
    }
    function groupVisible(it) {
      var list = groupOf(it);
      for (var i = 0; i < list.length; i++) if (list[i].vis !== false) return true;
      return false;
    }
    function groupHiddenByManual(it) {
      var list = groupOf(it);
      for (var i = 0; i < list.length; i++) {
        var gi = list[i];
        if (gi && gi.id != null && manualHidden[String(gi.id)]) return true;
      }
      return false;
    }
    function buildObjects() {
      if (is3d) {
        var api = api3d();
        if (!api || !api.items) { objItems = []; objApi = null; }
        else { wrap3d(api); objApi = api; objItems = read3dLite(); }
      } else {
        objApi = null;
        objItems = read2dLite();
      }
      renderObjsBox();
    }
    function renderObjsBox() {
      var host = el("expObjs"); if (!host) return;
      if (!objItems.length) { host.style.display = "none"; host.innerHTML = ""; return; }
      host.style.display = "block";
      host.innerHTML =
        '<div class="exp-objs-hd">' +
          '<button type="button" class="exp-objs-tg" aria-expanded="' + (objsOpen ? "true" : "false") + '">' +
            '<span class="ar">' + (objsOpen ? "▾" : "▸") + '</span>对象显隐 <span class="cnt">' + objItems.length + '</span>' +
          '</button>' +
          '<button type="button" class="exp-objs-reset">恢复自动</button>' +
        '</div>' +
        '<div class="exp-objs-bd"' + (objsOpen ? "" : " hidden") + '>' +
          '<div class="exp-objs-tip">仅影响本次查看，不改动图形本身</div>' +
          '<div class="exp-objs-list"></div>' +
        '</div>';
      var tg = host.querySelector(".exp-objs-tg");
      var rs = host.querySelector(".exp-objs-reset");
      var bd = host.querySelector(".exp-objs-bd");
      var list = host.querySelector(".exp-objs-list");
      tg.onclick = function () {
        objsOpen = !objsOpen;
        bd.hidden = !objsOpen;
        tg.setAttribute("aria-expanded", objsOpen ? "true" : "false");
        tg.querySelector(".ar").textContent = objsOpen ? "▾" : "▸";
        syncObjs();
      };
      rs.onclick = function () { resetManual(); };
      objItems.forEach(function (o) {
        var row = document.createElement("div");
        row.className = "exp-obj";
        row.dataset.key = o.key;
        var dot = document.createElement("span"); dot.className = "dot"; dot.style.background = o.color; row.appendChild(dot);
        var nm = document.createElement("span"); nm.className = "nm";
        nm.textContent = o.label;
        nm.title = o.label + (o.label !== o.key ? " · " + o.key : "");
        row.appendChild(nm);
        var tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "自动"; tag.style.display = "none"; row.appendChild(tag);
        var eye = document.createElement("button");
        eye.type = "button"; eye.className = "act"; eye.dataset.act = "eye";
        eye.onclick = function (ev) { ev.stopPropagation(); toggleObj(o); };
        row.appendChild(eye);
        var foc = document.createElement("button");
        foc.type = "button"; foc.className = "act"; foc.dataset.act = "focus";
        foc.title = "定位"; foc.innerHTML = ICON_FOCUS;
        foc.onclick = function (ev) { ev.stopPropagation(); locateObj(o); };
        row.appendChild(foc);
        row.__eye = eye; row.__tag = tag;
        list.appendChild(row);
      });
      syncObjs();
    }
    function objVisible(o) {
      if (o.kind === "2d") return autoVis2d(o.key) && !manualHidden[o.key];
      var it = objApi && objApi.byId && objApi.byId[o.key];
      if (!it) return false;
      // 重复平面共享一组 Three 对象，真实可见性按整组取并集
      return it.group ? groupVisible(it) : it.vis !== false;
    }
    function syncObjs() {
      if (is3d) {
        var api = api3d();
        if (api && api !== objApi) { buildObjects(); return; }
      }
      if (!objItems.length) return;
      var host = el("expObjs"); if (!host) return;
      [].forEach.call(host.querySelectorAll(".exp-obj"), function (row) {
        var o = null;
        for (var i = 0; i < objItems.length; i++) if (objItems[i].key === row.dataset.key) { o = objItems[i]; break; }
        if (!o) return;
        var manual = !!manualHidden[o.key];
        var eff = objVisible(o);
        var st = manual ? "m" : (eff ? "v" : "a");
        if (row.__st === st) return;
        row.__st = st;
        row.className = "exp-obj" + (eff ? "" : " off") + (manual ? " manual" : "");
        var eye = row.__eye;
        eye.innerHTML = eff ? ICON_EYE : ICON_EYE_OFF;
        if (manual) { eye.disabled = false; eye.title = "取消手动隐藏"; }
        else if (eff) { eye.disabled = false; eye.title = "隐藏"; }
        else { eye.disabled = true; eye.title = "当前由步骤/小问自动隐藏"; }
        row.__tag.style.display = (manual || eff) ? "none" : "";
      });
    }
    function toggleObj(o) {
      if (manualHidden[o.key]) {
        delete manualHidden[o.key];
        if (o.kind === "3d") {
          var api = objApi;
          var it = api && api.byId && api.byId[o.key];
          if (api && it) {
            groupOf(it).forEach(function (gi) {
              var gid = (gi && gi.id != null) ? String(gi.id) : o.key;
              try { api.setVisible(gi, autoVis3d(gid)); } catch (er) {}
            });
          }
        } else apply2d();
      } else {
        if (o.kind === "3d") {
          var a3 = objApi;
          var it3 = a3 && a3.byId && a3.byId[o.key];
          if (!a3 || !it3 || !objVisible(o)) return;
          manualHidden[o.key] = true;
          // 同组（重复平面）必须整组按下去，只改一个 id 时并集仍为真、面照样可见
          groupOf(it3).forEach(function (gi) { try { a3.setVisible(gi, false); } catch (er) {} });
        } else {
          if (!autoVis2d(o.key)) return;
          manualHidden[o.key] = true;
          apply2d();
        }
      }
      syncObjs();
    }
    function locateObj(o) {
      if (o.kind === "3d") {
        if (window.GGB3D && window.GGB3D.focus) {
          try { window.GGB3D.focus({ target: o.key }); } catch (er) {}
        }
        return;
      }
      var board = window.board, els = o.raw || [];
      if (!board || !els.length) return;
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, any = false;
      els.forEach(function (e) {
        try {
          var b = e.bounds();
          if (b && isFinite(b[0])) {
            any = true;
            minX = Math.min(minX, b[0], b[2]); maxX = Math.max(maxX, b[0], b[2]);
            minY = Math.min(minY, b[1], b[3]); maxY = Math.max(maxY, b[1], b[3]);
          }
        } catch (er) {}
      });
      if (!any) return;
      var padX = Math.max((maxX - minX) * 0.6, 0.8), padY = Math.max((maxY - minY) * 0.6, 0.8);
      try { board.setBoundingBox([minX - padX, maxY + padY, maxX + padX, minY - padY]); board.update(); } catch (er) {}
    }
    function resetManual() {
      var keys = Object.keys(manualHidden);
      manualHidden = {};
      if (is3d) {
        var api = api3d();
        if (api && api.byId) {
          keys.forEach(function (id) {
            var it = api.byId[id];
            if (!it) return;
            groupOf(it).forEach(function (gi) {
              var gid = (gi && gi.id != null) ? String(gi.id) : id;
              try { api.setVisible(gi, autoVis3d(gid)); } catch (er) {}
            });
          });
        }
      } else apply2d();
      syncObjs();
    }
    function installObjWatch() {
      if (objMo || !window.MutationObserver) return;
      var stage = el("stage"); if (!stage) return;
      objMo = new MutationObserver(function () {
        if (!is3d) return;
        if (objMoT) clearTimeout(objMoT);
        objMoT = setTimeout(function () { if (is3d) syncObjs(); }, 60);
      });
      objMo.observe(stage, { childList: true, subtree: true, characterData: true });
    }

    function renderSub(i) {
      curSub = i; curStep = -1; setScope(); buildShown();
      renderAnswer(i); renderTabs(); renderSteps();
      if (is3d) apply3d(true); else apply2d();
      syncObjs();
    }
    function renderStep(k) {
      curStep = k; buildShown(); renderSteps();
      if (!is3d) apply2d();
      syncObjs();
    }
    function init() {
      if (inited) {
        if (!ready()) return;
        if (is3d) apply3d(false); else apply2d();
        syncObjs();
        return;
      }
      var list = Array.isArray(BASE.versions) ? BASE.versions : [];
      curVer = (BASE.currentVid != null ? BASE.currentVid : (list.length ? list[list.length - 1].vid : -1));
      var v = getVersion(curVer);
      if (!v && list.length) { v = list[list.length - 1]; curVer = v.vid; }
      setVersionData(v);
      if (!ready()) return;
      renderVerTabs();
      buildMaps();
      buildObjects();
      renderTabs(); renderSteps(); renderCtrls();
      renderSub(-1);
      installObjWatch();
      inited = true;
    }
    window.__expApplyAll = function () {
      if (!inited) { init(); return; }
      if (is3d) apply3d(false); else apply2d();
      syncObjs();
    };
    setTimeout(init, 0);
    setTimeout(init, 400);
    setTimeout(init, 1500);
  }

  $("btnHtml").onclick = function () {
    var L = last;
    if (!L || !L.result) { $("status").textContent = "先解一道题再导出"; return; }
    var r = L.result;
    $("status").textContent = "正在打包离线 HTML，首次稍慢…";
    var is3d = !!r.render3d;
    // 导出文件里附一份原始记录数据：拖回应用即可还原成记录（题干/答案/解析源码都在）
    var hjRec = {
      id: lastHistoryId || "", ts: r.ts || Date.now(),
      question: L.question || "", grade: L.grade || "", model: (L.cfg && L.cfg.model) || "",
      questionText: r.questionText || "", figureBox: r.figureBox || null,
      answer: r.answer || "", analysis: r.analysis || "", images: (L.images || []).slice(),
      renderCode: r.renderCode || "", render3d: r.render3d || null, style2d: r.style2d || null,
      steps: r.steps || null, controls: r.controls || null, focusTargets: r.focusTargets || null, subQuestions: r.subQuestions || null,
      promptVer: r.promptVer || "", promptHash: r.promptHash || "", promptChannel: r.promptChannel || "", promptBytes: r.promptBytes || null,
      routeExpected: r.routeExpected || "", routeActual: r.routeActual || "", routeRetried: r.routeRetried === true, routeIssue: r.routeIssue || "",
      usage: r.usage || null, elapsedMs: (r.elapsedMs != null ? r.elapsedMs : null),
      cost: r.cost || costText(r.usage, (L.cfg && L.cfg.model) || "", L.cfg), refined: r.refined || 0,
      answerAdjusted: r.answerAdjusted === true,
      answerNote: r.answerNote || "",
      givenAnswer: r.givenAnswer || "",
      givenScope: r.givenScope || "",
      givenQuestionIndex: (r.givenQuestionIndex != null ? r.givenQuestionIndex : -1),
      givenOption: r.givenOption || "",
      givenFromImage: r.givenFromImage === true,
      givenAnswerText: r.givenAnswerText || "",
      versions: (r.versions && r.versions.length) ? r.versions : undefined,
      currentVid: (r.versions && r.versions.length) ? (r.currentVid || r.versions[r.versions.length - 1].vid) : undefined,
      chat: (Array.isArray(r.chat) && r.chat.length) ? r.chat : undefined
    };
    // 题图形状：优先按 figureBox 裁出原图里的图形区域（导出页离线也能单独显示题图）
    var figImgs = (L.images || []).filter(function (u) { return /^data:image\//.test(String(u)); });
    var figIdx = (r.figureBox && typeof r.figureBox.image === "number" && figImgs[r.figureBox.image]) ? r.figureBox.image : 0;
    var figP = new Promise(function (res) {
      if (!r.figureBox || !figImgs[figIdx]) return res("");
      cropFigure(figImgs[figIdx], r.figureBox, function (u) { res(u || ""); });
    });
    var libsP = [fetchText("/solver/vendor/jsxgraph.js"), fetchText("/solver/geometry.js"), fetchText("/solver/vendor/katex/katex.min.js"), fetchText("/solver/shim.js")];
    // 版本切换：只要任意版本是 3D，就要把 three/render3d 一起打进导出页，否则 2D→3D 切不过去
    var has3dVer = is3d || ((r.versions || []).some(function (v) { return !!(v && v.render3d); }));
    if (has3dVer) libsP.push(fetchText("/solver/vendor3d/three.min.js"), fetchText("/solver/vendor3d/OrbitControls.js"), fetchText("/solver/vendor3d/render3d.js"));
    Promise.all([Promise.all(libsP), inlineKatexCss(), figP])
      .then(function (bundle) {
        var all = bundle[0], katexCss = bundle[1], figUrl = bundle[2];
        var libJs = all.map(function (s) { return String(s).replace(/<\/script/gi, "<\\/script"); }).join("\n;\n");
        var mathJs = "(function(){var escHtml=" + escHtml.toString() + ";var mathHTML=" + mathHTML.toString() + ";var anaSplit=" + anaSplit.toString() + ";var anaHTML=" + anaHTML.toString() + ";var ansAllHTML=" + ansAllHTML.toString() + ";var texCanvasHTML=" + texCanvasHTML.toString() + ";var applyTex2D=" + applyTex2D.toString() + ";var applyStyle2D=" + applyStyle2D.toString() + ";window.mathHTML=mathHTML;window.anaHTML=anaHTML;window.ansAllHTML=ansAllHTML;window.texCanvasHTML=texCanvasHTML;window.applyTex2D=applyTex2D;window.__applyStyle2D=applyStyle2D;})();";
        var dataJs, runJs;
        if (is3d) {
          dataJs = "var SCENE=" + jsonEmbed(r.render3d) + ";";
          runJs = "try{GGB3D.render(document.getElementById('stage'),SCENE);}catch(e){var el=document.getElementById('err');el.textContent='3D 渲染出错：'+e.message;el.style.display='block';}";
        } else {
          dataJs = "var RENDERCODE=" + jsonEmbed(r.renderCode || "") + ";var STYLE2D=" + jsonEmbed(r.style2d || {}) + ";";
          runJs = "try{(new Function(RENDERCODE))();(" + applyStyle2D.toString() + ")(STYLE2D);if(window.applyTex2D)window.applyTex2D(window.board);}catch(e){var el=document.getElementById('err');el.textContent='渲染出错：'+e.message;el.style.display='block';}";
        }
        // 初始先渲染完整内容；导出页的 exportTabs() 会按「全部」/小问标签重新渲染
        var ansHtml = mathHTML(r.answer || "");
        var anaHtml = anaHTML(r.analysis || "", r.subQuestions);
        var qHtml = "";
        if (L.question) qHtml += '<h3>题目</h3><div class="q">' + mathHTML(L.question) + "</div>";
        if (r.questionText && r.questionText !== L.question) {
          qHtml += (L.question ? '<div class="qnote">识别自图片的题干</div>' : "<h3>题目</h3>") + '<div class="q">' + mathHTML(r.questionText) + "</div>";
        }
        if (figUrl) qHtml += '<div class="qfig"><img src="' + figUrl + '" alt="题图"/></div>';
        var uiJs = "(" + exportUi.toString() + ")();";
        var tabsJs = "(" + exportTabs.toString() + ")();";
        var recJs = "var HJ_REC=" + jsonEmbed(hjRec) + ";";
        var html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
          "<title>动态几何 · 解题</title><style>" + katexCss + exportCss() + "</style></head><body>" +
          '<div class="wrap"><div class="sw"><div id="stage"><div id="ggb-canvas" class="jxgbox" style="position:absolute;inset:0"></div></div><div id="actbar"></div><div id="err" class="err"></div></div>' +
          '<aside class="side">' + qHtml +
          '<div id="expVerTabs" class="exp-vers"></div>' +
          '<div id="expSubTabs" class="exp-tabs"></div>' +
          '<div id="expSteps" class="exp-steps"></div>' +
          '<div id="expCtrls" class="exp-ctrls"></div>' +
          '<div id="expObjs" class="exp-objs"></div>' +
          '<h3 id="ansTitle">答案</h3><div class="ans" id="ansBody">' + ansHtml + '</div>' +
          '<h3 id="anaTitle">解析</h3><div class="ana" id="anaBody">' + anaHtml + '</div>' +
          '<p class="foot">由「何解」导出 · ' + new Date().toLocaleString() + "</p></aside></div>" +
          "<script>" + libJs + "<\/script>" +
          "<script>" + mathJs + "\n" + recJs + "\n" + dataJs + "\n" + runJs + "\n" + uiJs + "\n" + tabsJs + "<\/script></body></html>";
        downloadBlob(html, "geometry_" + tsName() + ".html");
        $("status").textContent = "已导出离线 HTML，双击即可打开，无需联网；把文件拖回本应用可还原成记录";
      })
      .catch(function (e) { $("status").textContent = "导出失败：" + e.message; });
  };

  fetch("/api/status").then(function (r) { return r.json(); }).then(function () { refreshStatus(); }).catch(function () { refreshStatus(); });
  refreshStatus();
  initDropImport();
  // 先从 ~/.hegy/settings.json 读模型配置（换电脑/换位置都能保留），读完再决定是否提示
  initCfg(function () {
    migrateOldHistory(function (n) {
      if (n) $("status").textContent = "已把 " + n + " 条旧记录搬到记录文件夹，位置可在「设置」里看";
      loadHistory();
    });
    // 没有模型就等于不能解题：启动直接把设置弹出来，并把焦点落在服务商上。
    // 桌面窗口放不下手机端那套整屏三步向导，这里用「一屏手风琴 + 顺序提示」代替。
    var c0 = loadCfg();
    var ready0 = !!(c0 && c0.baseUrl && c0.apiKey && c0.model);
    if (!ready0) {
      openModal("model");
      // 空配置先落到第一个真实服务商（与手机端首启向导一致），别让用户对着空下拉发呆
      if (!c0 || !c0.baseUrl) { if (presetSel.options.length > 1) { presetSel.value = "1"; presetSel.onchange(); } }
      var m0 = $("cfgMsg");
      if (m0) { m0.className = "msg"; m0.textContent = "按顺序：服务商 → Key → 模型"; }
      try { $("fPreset").focus(); } catch (e) {}
    }
  });
})();
