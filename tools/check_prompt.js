#!/usr/bin/env node
/* 提示词静态检查：模块标记、规则登记、预算。
   用法：node tools/check_prompt.js [--json] */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PROMPT = path.join(ROOT, "solver", "prompt.txt");
const REGISTRY = path.join(ROOT, "solver", "prompt-rules.md");
const MODULES = ["core", "shared", "2d", "3d", "rigor"];

function stripMarks(s) {
  return s.replace(/<!--[\s\S]*?-->/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function readExample() {
  const dir = path.join(ROOT, "solver");
  const names = fs.readdirSync(dir).filter((n) => /^example_.*\.js$/.test(n) && !/^example_mock/i.test(n)).sort();
  if (!names.length) return null;
  return { name: names[0], text: fs.readFileSync(path.join(dir, names[0]), "utf8") };
}
function assemble(mods, channel, example) {
  const parts = [mods.core, mods.shared];
  if (channel === "2d" || channel === "auto") parts.push(mods["2d"]);
  if (channel === "3d" || channel === "auto") parts.push(mods["3d"]);
  parts.push(mods.rigor);
  let text = parts.filter(Boolean).join("\n\n");
  if (channel !== "3d" && example) {
    text += "\n\n【示例】（真实解题记录 " + example.name + " 的 renderCode）\n```\n" + example.text + "\n```";
  }
  return text;
}
function parseBudget(text) {
  const m = text.match(/<!--\s*@budget\s+([^>]+?)\s*-->/);
  if (!m) return {};
  const out = {};
  m[1].trim().split(/\s+/).forEach((kv) => {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i)] = Number(kv.slice(i + 1));
  });
  return out;
}
function parseModules(text) {
  const mods = {};
  const seen = [];
  const re = /<!--\s*@module:(\w+)\s*-->([\s\S]*?)<!--\s*@endmodule:\1\s*-->/g;
  let m;
  while ((m = re.exec(text))) {
    if (mods[m[1]] !== undefined) throw new Error("模块重复: " + m[1]);
    mods[m[1]] = stripMarks(m[2]);
    seen.push(m[1]);
  }
  const open = (text.match(/<!--\s*@module:\w+\s*-->/g) || []).length;
  const close = (text.match(/<!--\s*@endmodule:\w+\s*-->/g) || []).length;
  if (open !== close) throw new Error("module/endmodule 数量不一致: " + open + "/" + close);
  if (open !== seen.length) throw new Error("存在嵌套或未闭合的 module 标记");
  return { mods, seen };
}
function parseRuleIDs(text) {
  const body = stripMarks(text);
  return new Set(body.match(/\bR-[A-Z0-9]+-\d{2}\b/g) || []);
}
function parseMarked(text) {
  const out = new Map();
  const moduleRe = /<!--\s*@module:(\w+)\s*-->([\s\S]*?)<!--\s*@endmodule:\1\s*-->/g;
  let m;
  while ((m = moduleRe.exec(text))) {
    const ids = [];
    const rr = /<!--\s*@rules:([^>]+?)\s*-->/g;
    let r;
    while ((r = rr.exec(m[2]))) ids.push(...r[1].trim().split(/\s+/));
    ids.forEach((id) => out.set(id, m[1]));
  }
  return out;
}
function parseRegistry(text) {
  const out = new Map();
  text.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\|\s*(R-[A-Z0-9]+-\d{2})\s*\|\s*([a-z0-9]+)\s*\|/);
    if (m) out.set(m[1], { module: m[2], line: line.trim() });
  });
  return out;
}

function main() {
  const raw = fs.readFileSync(PROMPT, "utf8");
  const errors = [];
  const warnings = [];
  const budget = parseBudget(raw);
  let parsed, registryRaw = "";
  try { parsed = parseModules(raw); } catch (e) { errors.push(e.message); parsed = { mods: {}, seen: [] }; }
  try { registryRaw = fs.readFileSync(REGISTRY, "utf8"); } catch (e) { errors.push("缺少规则登记表: solver/prompt-rules.md"); }
  const registry = parseRegistry(registryRaw);
  const marked = parseMarked(raw);
  const ids = parseRuleIDs(raw);

  MODULES.forEach((m) => { if (!parsed.mods[m]) errors.push("缺少模块: " + m); });
  parsed.seen.forEach((m) => { if (!MODULES.includes(m)) errors.push("未知模块: " + m); });

  marked.forEach((mod, id) => {
    if (!MODULES.includes(mod)) errors.push("规则 " + id + " 所在模块未知: " + mod);
    if (!ids.has(id)) errors.push("标记了 " + id + "，正文没有该规则 ID");
    if (!registry.has(id)) errors.push("标记了 " + id + "，登记表没有该规则");
  });
  ids.forEach((id) => {
    if (!marked.has(id)) errors.push("正文规则 " + id + " 没有 @rules 标记");
    if (!registry.has(id)) errors.push("正文规则 " + id + " 没有登记");
  });
  registry.forEach((r, id) => {
    if (!ids.has(id)) errors.push("登记表规则 " + id + " 不在正文里");
    if (marked.has(id) && r.module !== marked.get(id)) errors.push("规则 " + id + " 模块不一致: 正文 " + marked.get(id) + " / 登记表 " + r.module);
  });

  const sizes = {};
  MODULES.forEach((m) => { sizes[m] = Buffer.byteLength(parsed.mods[m] || "", "utf8"); });
  const fileBytes = Buffer.byteLength(raw, "utf8");
  const example = readExample();
  const injected = {
    "2d": Buffer.byteLength(assemble(parsed.mods, "2d", example), "utf8"),
    "3d": Buffer.byteLength(assemble(parsed.mods, "3d", example), "utf8"),
    auto: Buffer.byteLength(assemble(parsed.mods, "auto", example), "utf8")
  };

  if (budget.file && fileBytes > budget.file) errors.push("文件大小 " + fileBytes + " > 预算 " + budget.file);
  MODULES.forEach((m) => {
    if (budget[m] && sizes[m] > budget[m]) errors.push("模块 " + m + " 大小 " + sizes[m] + " > 预算 " + budget[m]);
  });
  ["inject2d", "inject3d", "injectauto"].forEach((k) => {
    const ch = k.slice(6);
    if (budget[k] && injected[ch] > budget[k]) errors.push("注入 " + ch + " 大小 " + injected[ch] + " > 预算 " + budget[k]);
  });
  if (!example) warnings.push("没有找到 example_*.js few-shot 示例");
  if (registry.size === 0) errors.push("登记表里没有解析到任何规则（表格首列需为 R-xxx-00）");

  const result = { ok: errors.length === 0, fileBytes, sizes, injected, ruleCount: ids.size, registryCount: registry.size, errors, warnings };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("prompt.txt  " + fileBytes + " B / 预算 " + (budget.file || "-"));
    console.log("模块       实际      预算");
    MODULES.forEach((m) => console.log("  " + m.padEnd(7) + String(sizes[m]).padStart(6) + "   " + (budget[m] || "-")));
    console.log("注入       实际      预算");
    console.log("  2d     " + String(injected["2d"]).padStart(6) + "   " + (budget.inject2d || "-"));
    console.log("  3d     " + String(injected["3d"]).padStart(6) + "   " + (budget.inject3d || "-"));
    console.log("  auto   " + String(injected.auto).padStart(6) + "   " + (budget.injectauto || "-"));
    console.log("规则 " + ids.size + " 条 / 登记 " + registry.size + " 条" + (example ? " / 示例 " + example.name : ""));
    warnings.forEach((w) => console.log("WARN " + w));
    errors.forEach((e) => console.log("FAIL " + e));
    console.log(errors.length ? "结果：FAIL" : "结果：PASS");
  }
  process.exit(errors.length ? 1 : 0);
}
main();
