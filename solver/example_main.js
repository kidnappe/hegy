const board = GGBBoard.init('ggb-canvas', {
  boundingbox: [-1.2, 5.6, 7.4, -1.6],
  axis: false,
  keepaspectratio: true,
  showCopyright: false,
  pan: {enabled: true, needShift: true},
  zoom: {wheel: true, needShift: true}
});
window.board = board;

// ===== 固定顶点 =====
const A = board.create('point', [0, 0], {name: 'A', color: '#000000', size: 3, fixed: true});
const B = board.create('point', [6, 0], {name: 'B', color: '#000000', size: 3, fixed: true});
const C = board.create('point', [0, 4], {name: 'C', color: '#000000', size: 3, fixed: true});

board.create('polygon', [A, B, C], {
  name: 'ABC',
  withLabel: false,
  fillColor: '#1890ff',
  fillOpacity: 0.05,
  borders: {strokeColor: '#000000', strokeWidth: 2}
});

// 直角标记（∠A = 90°）
board.create('angle', [B, A, C], {
  name: '',
  radius: 0.55,
  fillColor: '#000000',
  fillOpacity: 0.06,
  strokeColor: '#000000',
  strokeWidth: 1
});

// ===== 滑块：控制 P 在 AB 上的位置比例 t ∈ [0,1] =====
const sliderT = board.create('slider', [[4.2, -0.95], [6.6, -0.95], [0, 0.5, 1]], {
  name: 't',
  snapWidth: 0.01,
  baseline: {strokeColor: '#AAAAAA', strokeWidth: 4},
  highline: {strokeColor: '#555555', strokeWidth: 4},
  fillColor: '#333333',
  strokeColor: '#333333',
  size: 6
});

// ===== 动点 P：A 到 B 按比例 t 内分 =====
const P = board.create('point', [
  () => GGBMath.lerp(A.X(), A.Y(), B.X(), B.Y(), sliderT.Value())[0],
  () => GGBMath.lerp(A.X(), A.Y(), B.X(), B.Y(), sliderT.Value())[1]
], {name: 'P', color: '#e91e63', size: 4, fixed: true});

// ===== Q：过 P 作 AB 的垂线，与 BC 的交点 =====
// 垂线方向 = AB 的法向；与 BC 求交
const Q = board.create('point', [
  () => {
    const d = GGBMath.perpDir(B.X() - A.X(), B.Y() - A.Y());
    const r = GGBMath.lineIntersect(P.X(), P.Y(), P.X() + d[0], P.Y() + d[1], B.X(), B.Y(), C.X(), C.Y());
    return r ? r[0] : 0;
  },
  () => {
    const d = GGBMath.perpDir(B.X() - A.X(), B.Y() - A.Y());
    const r = GGBMath.lineIntersect(P.X(), P.Y(), P.X() + d[0], P.Y() + d[1], B.X(), B.Y(), C.X(), C.Y());
    return r ? r[1] : 0;
  }
], {name: 'Q', color: '#7b1fa2', size: 4, fixed: true});

// ===== 线段 =====
board.create('segment', [P, Q], {name: 'PQ', strokeColor: '#7b1fa2', strokeWidth: 2});
board.create('segment', [A, P], {name: 'AP', strokeColor: '#e91e63', strokeWidth: 3});
board.create('segment', [A, Q], {name: 'AQ', strokeColor: '#7b1fa2', strokeWidth: 1.5, dash: 2});

// 动三角形 APQ 的填充
board.create('polygon', [A, P, Q], {
  name: 'APQ',
  withLabel: false,
  fillColor: '#e91e63',
  fillOpacity: 0.18,
  borders: {strokeColor: '#e91e63', strokeWidth: 1, strokeOpacity: 0.5}
});

// ===== 实时测量文字 =====
board.create('text', [0.15, 5.05, function () {
  return 'AP = ' + GGBMath.dist(A.X(), A.Y(), P.X(), P.Y()).toFixed(2);
}], {fontSize: 14, color: '#e91e63', fixed: true});

board.create('text', [0.15, 4.65, function () {
  return 'PQ = ' + GGBMath.dist(P.X(), P.Y(), Q.X(), Q.Y()).toFixed(2);
}], {fontSize: 14, color: '#7b1fa2', fixed: true});

board.create('text', [0.15, 4.25, function () {
  return 'S△APQ = ' + GGBMath.polygonArea([[A.X(), A.Y()], [P.X(), P.Y()], [Q.X(), Q.Y()]]).toFixed(2);
}], {fontSize: 15, color: '#c00', fixed: true});

// 直角标记（PQ ⊥ AB）
board.create('angle', [A, P, Q], {
  name: '',
  radius: 0.32,
  fillColor: '#7b1fa2',
  fillOpacity: 0.08,
  strokeColor: '#7b1fa2',
  strokeWidth: 1
});

board.update();
