/* =========================================================
   何解 · 兼容层
   ---------------------------------------------------------
   作用：把「模型脚本里写的调用」接到我们自己的实现上。

   历史背景：renderCode 由大模型生成，里面固定写这几个全局名——
     GGBBoard.init(...)     建画板
     GGBMath.xxx(...)       几何计算（实现在 geometry.js）
   这两组名字是对外契约，存量记录、用户导出的离线 HTML 都在用，
   因此永不改名；改的只是它们背后指向谁。

   本文件只做映射，不含任何业务逻辑。
   ========================================================= */
(function () {
  "use strict";

  var JXG = window.JXG;
  if (!JXG || !JXG.JSXGraph) {
    // JSXGraph 没加载时不要静默失败，否则页面一片空白还找不到原因
    console.error("[shim] JSXGraph 未加载，请检查 vendor/jsxgraph.js 是否在 shim.js 之前引入");
    return;
  }

  // 建画板：GGBBoard.init('ggb-canvas', {...}) → JSXGraph 实例
  window.GGBBoard = {
    init: function (id, opts) {
      return JXG.JSXGraph.initBoard(id, opts);
    }
  };
  Object.defineProperty(window.GGBBoard, "boards", {
    get: function () { return JXG.boards; }
  });

  // 几何计算：实现在 geometry.js（自研），暴露为 window.HexMath
  window.GGBMath = window.HexMath || {};
})();
