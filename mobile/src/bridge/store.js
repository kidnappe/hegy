/* mobile/src/bridge/store.js — 解题记录存储（Capacitor Filesystem）
 *
 * 格式与桌面完全一致（能互导）：
 *   一条记录 = Hegy/records/<id>.json，**两行 JSONL**
 *     第 1 行 meta（列表用，含缩略图）
 *     第 2 行 body（题文/图片/答案/解析/renderCode/render3d…）
 *
 * 但**列表绝不扫目录读首行**（PoC-4：100 条整读 4.99s，只读 index.json 50ms）。
 *   列表只读 Hegy/records/index.json：{ver:1, updatedAt, items:[meta]}
 *   index.json 是派生数据：缺失/损坏时扫目录重建一次并写回（冷启动一次，之后都是 O(1)）。
 *
 * 形态：window.HXStoreFactory(adapter) → { index, record, save, patchMeta, remove, purge, info }
 *       window.HXStoreAdapter = Capacitor Filesystem 实现
 * adapter 是纯字符串/目录操作（便于自检脚本换内存实现），见文件末尾 capAdapter。
 */
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory;
    module.exports.capAdapter = capAdapter;      // 函数声明提升，这里能取到
  } else {
    root.HXStoreFactory = factory;
    root.HXStoreAdapter = capAdapter();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function HXStoreFactory(adapter) {
  var DIR = "Hegy";
  var REC_DIR = "Hegy/records";
  var INDEX_PATH = "Hegy/records/index.json";
  // 前端把 dir 原样显示在「记录保存在：X」里。桌面上是真路径，手机上必须换成一句人话，
  // 否则用户看到 "Hegy" 这种相对目录名完全不知道东西存哪了（而且他也打不开那个目录）。
  var DIR_LABEL = "手机本地（App 私有目录）";
  var REC_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

  function metaOf(rec, thumb) {
    var q = String(rec.question || "");
    var qt = String(rec.questionText || "");
    return {
      id: rec.id, ts: rec.ts || Date.now(),
      question: q.slice(0, 200), qlen: q.length,
      questionText: qt.slice(0, 300),
      grade: rec.grade || "", model: rec.model || "",
      refined: rec.refined || 0, verCount: Array.isArray(rec.versions) ? rec.versions.length : 0,
      promptVer: rec.promptVer || "", promptHash: rec.promptHash || "", promptChannel: rec.promptChannel || "",
      elapsedMs: rec.elapsedMs != null ? rec.elapsedMs : null,
      usage: rec.usage || null, cost: rec.cost || "",
      imgCount: (rec.images || []).length,
      chatCount: Array.isArray(rec.chat) ? rec.chat.length : 0,
      has3d: !!rec.render3d, hasCode: !!rec.renderCode,
      thumb: thumb || null
    };
  }
  // 与桌面 packRecord 同构：id/ts 只在首行 meta 里，body 不重复存。
  function packRecord(rec, thumb) {
    var meta = metaOf(rec, thumb);
    var body = {};
    Object.keys(rec).forEach(function (k) { if (k !== "id" && k !== "ts") body[k] = rec[k]; });
    return JSON.stringify(meta) + "\n" + JSON.stringify(body);
  }
  // 读回整条记录（meta + body 合并成旧结构，前端无需改动）
  function unpackRecord(text) {
    var nl = text.indexOf("\n");
    if (nl < 0) return JSON.parse(text);          // 兼容旧格式：单行纯记录
    var meta = JSON.parse(text.slice(0, nl));
    var body = {};
    try { body = JSON.parse(text.slice(nl + 1)) || {}; } catch (e) { body = {}; }
    return Object.assign({}, body, { id: meta.id, ts: meta.ts });
  }
  function metaLine(text) {
    var nl = text.indexOf("\n");
    try { return JSON.parse(nl < 0 ? text : text.slice(0, nl)); } catch (e) { return null; }
  }
  function isRecordFile(name) {
    return name.slice(-5) === ".json" && name !== "index.json" && name.slice(-10) !== ".meta.json";
  }
  function recPath(id) {
    var s = String(id || "");
    return REC_ID_RE.test(s) ? REC_DIR + "/" + s + ".json" : null;
  }
  function byTsDesc(a, b) { return (b.ts || 0) - (a.ts || 0); }

  // ---------- index.json（列表的唯一数据源） ----------
  // 列表每次只读这一个文件（PoC-4：100 条整读 4.99s → 只读 index 50ms）。
  // 不做常驻内存缓存：index.json 是落盘事实，外部删掉/损坏时下一次读就要能重建。
  var mutateChain = Promise.resolve();

  function scanDir() {
    return Promise.resolve(adapter.list(REC_DIR)).then(function (names) {
      var files = (names || []).filter(isRecordFile);
      return Promise.all(files.map(function (n) {
        return Promise.resolve(adapter.readText(REC_DIR + "/" + n)).then(function (t) {
          if (!t) return null;
          var m = metaLine(t);
          return m && m.id ? m : null;
        }).catch(function () { return null; });
      })).then(function (items) {
        return items.filter(Boolean).sort(byTsDesc);
      });
    });
  }
  function writeIndex(items) {
    var doc = { ver: 1, updatedAt: Date.now(), items: items };
    return Promise.resolve(adapter.writeText(INDEX_PATH, JSON.stringify(doc))).then(function () { return doc; });
  }
  function readIndexFile() {
    return Promise.resolve(adapter.readText(INDEX_PATH)).then(function (txt) {
      if (!txt) return null;
      try {
        var j = JSON.parse(txt);
        return j && Array.isArray(j.items) ? j : null;
      } catch (e) { return null; }
    });
  }
  function loadIndex() {
    return readIndexFile().then(function (doc) {
      // 缺失/损坏：扫目录重建一次并写回（冷启动一次，之后都是 O(1) 读单文件）
      return doc || scanDir().then(function (items) { return writeIndex(items); });
    });
  }
  // 所有「改记录 + 改 index」串行执行，避免并发保存时 read-modify-write 互相覆盖。
  function mutate(fn) {
    var run = mutateChain.then(fn, fn);
    mutateChain = run.then(function () {}, function () {});
    return run;
  }
  function index() {
    return loadIndex().then(function (doc) {
      return { dir: DIR_LABEL, items: doc.items.slice().sort(byTsDesc) };
    });
  }
  function upsert(items, meta) {
    var out = items.filter(function (m) { return m && m.id !== meta.id; });
    out.push(meta);
    out.sort(byTsDesc);
    return out;
  }

  // ---------- 记录读写 ----------
  function record(id) {
    var p = recPath(id);
    if (!p) return Promise.resolve(null);
    return Promise.resolve(adapter.readText(p)).then(function (t) {
      if (!t) return null;
      try { return unpackRecord(t); } catch (e) { return null; }
    }).catch(function () { return null; });
  }
  function save(payload) {
    var rec = payload && payload.record;
    if (!rec || !rec.id) return Promise.resolve({ ok: false, error: "no record" });
    var p = recPath(rec.id);
    if (!p) return Promise.resolve({ ok: false, error: "bad id" });
    var thumb = payload.thumb !== undefined ? payload.thumb : null;
    return mutate(function () {
      return Promise.resolve(adapter.mkdir(REC_DIR)).then(function () {
        return adapter.writeText(p, packRecord(rec, thumb));
      }).then(function () {
        // 顺手清理旧的双文件格式遗留（桌面同口径）
        return Promise.resolve(adapter.remove(REC_DIR + "/" + rec.id + ".meta.json")).catch(function () {});
      }).then(function () {
        return loadIndex();
      }).then(function (doc) {
        return writeIndex(upsert(doc.items, metaOf(rec, thumb)));
      }).then(function () {
        return { ok: true, id: rec.id, dir: DIR_LABEL };
      });
    });
  }
  function patchMeta(payload) {
    var id = payload && payload.id;
    var patch = (payload && payload.meta) || {};
    var p = recPath(id);
    if (!p) return Promise.resolve({ ok: false, error: "bad id" });
    // 必须整读原文件：缩略图只存在首行 meta 里（body 里没有），
    // 不回读旧 meta 就会在「改个标题」时把缩略图弄丢。
    return mutate(function () {
      return Promise.resolve(adapter.readText(p)).then(function (txt) {
        if (!txt) return { ok: false, error: "NOT_FOUND" };
        var oldMeta = metaLine(txt) || {};
        var rec = unpackRecord(txt);
        var thumb = patch.thumb !== undefined ? patch.thumb : oldMeta.thumb;
        var merged = Object.assign({}, rec, patch);
        merged.id = rec.id;
        merged.ts = rec.ts;
        return Promise.resolve(adapter.writeText(p, packRecord(merged, thumb))).then(function () {
          var meta = metaOf(merged, thumb);
          return loadIndex().then(function (doc) { return writeIndex(upsert(doc.items, meta)); }).then(function () {
            return { ok: true, meta: meta };
          });
        });
      });
    });
  }
  function remove(id) {
    var p = recPath(id);
    if (!p) return Promise.resolve({ ok: false, error: "bad id" });
    return mutate(function () {
      return Promise.resolve(adapter.remove(p)).then(function () {
        return Promise.resolve(adapter.remove(REC_DIR + "/" + id + ".meta.json")).catch(function () {});
      }).then(function () {
        return loadIndex();
      }).then(function (doc) {
        return writeIndex(doc.items.filter(function (m) { return m && m.id !== String(id); }));
      }).then(function () { return { ok: true }; });
    });
  }
  function purge() {
    return mutate(function () {
      return Promise.resolve(adapter.list(REC_DIR)).then(function (names) {
        var files = (names || []).filter(isRecordFile);
        return Promise.all(files.map(function (n) {
          return Promise.resolve(adapter.remove(REC_DIR + "/" + n)).catch(function () {});
        })).then(function () {
          return writeIndex([]);
        }).then(function () { return { ok: true, removed: files.length }; });
      });
    });
  }
  function info() {
    var base = (adapter.info && adapter.info()) || {};
    return index().then(function (r) {
      return {
        dir: base.dir || DIR_LABEL,
        recordsDir: base.recordsDir || (DIR_LABEL + " / records"),
        defaultDir: base.defaultDir || DIR_LABEL,
        count: r.items.length,
        settingsFile: base.settingsFile || "Preferences:hegy.settings.v1",
        migrated: 0
      };
    });
  }

  return { index: index, record: record, save: save, patchMeta: patchMeta, remove: remove, purge: purge, info: info, _paths: { dir: DIR, recordsDir: REC_DIR, index: INDEX_PATH } };
});

// ---------------- Capacitor Filesystem 适配器 ----------------
// 目录：Directory.Data（App 私有目录，卸载即清，不进相册/不受 scoped storage 影响）。
// 只暴露字符串读写与目录列举，自检脚本可以换成内存实现。
function capAdapter() {
  function F() {
    var cap = (typeof window !== "undefined" && window.Capacitor) || null;
    return cap && cap.Plugins && cap.Plugins.Filesystem;
  }
  function need() {
    var p = F();
    if (!p) throw new Error("Capacitor Filesystem 不可用");
    return p;
  }
  return {
    readText: function (p) {
      return need().readFile({ path: p, directory: "DATA", encoding: "utf8" }).then(function (r) {
        return r && r.data != null ? String(r.data) : null;
      }).catch(function () { return null; });
    },
    writeText: function (p, text) {
      return need().writeFile({ path: p, data: String(text), directory: "DATA", encoding: "utf8", recursive: true });
    },
    remove: function (p) {
      return need().deleteFile({ path: p, directory: "DATA" }).catch(function () {});
    },
    list: function (dir) {
      return need().readdir({ path: dir, directory: "DATA" }).then(function (r) {
        return (r && r.files ? r.files : []).map(function (f) { return typeof f === "string" ? f : f.name; });
      }).catch(function () { return []; });
    },
    exists: function (p) {
      return need().stat({ path: p, directory: "DATA" }).then(function () { return true; }).catch(function () { return false; });
    },
    mkdir: function (dir) {
      return need().mkdir({ path: dir, directory: "DATA", recursive: true }).catch(function () {});
    },
    info: function () {
      return { dir: "Hegy", recordsDir: "Hegy/records", defaultDir: "Hegy", settingsFile: "Preferences:hegy.settings.v1" };
    }
  };
}
