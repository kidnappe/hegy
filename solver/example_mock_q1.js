// 来源：本机真模型生成（deepseek-flash，2026-10-20），题面自拟，非外部素材。
// 题目：直角三角形 ABC，∠C=90°，AC=6、BC=8；P 在 AC 上，AP=x；PQ⊥AB 于 Q。
//       求 △APQ 面积关于 x 的表达式与最大值。
// 答案：S = 6x²/25（0≤x≤6），x=6 时最大 216/25 = 8.64。已数值验算。
// 用途：mock 联调专用（文件名 example_mock* 前缀让 serve.js 跳过它，不参与 few-shot）。

const board = GGBBoard.init('ggb-canvas', {
  boundingbox: [-1.5, 10.3, 9.2, -2.2],
  axis: false,
  keepaspectratio: true,
  showCopyright: false,
  pan: {enabled: true, needShift: true},
  zoom: {wheel: true, needShift: true}
});
window.board = board;

const A = board.create('point', [6, 0], {name: 'A', color: '#000000', size: 3, fixed: true});
const B = board.create('point', [0, 8], {name: 'B', color: '#000000', size: 3, fixed: true});
const C = board.create('point', [0, 0], {name: 'C', color: '#000000', size: 3, fixed: true});

board.create('polygon', [A, B, C], {
  name: 'ABC',
  withLabel: false,
  fillColor: '#1890ff',
  fillOpacity: 0.06,
  borders: {strokeColor: '#000000', strokeWidth: 2}
});

board.create('angle', [A, C, B], {
  name: '',
  radius: 0.65,
  fillColor: '#000000',
  fillOpacity: 0.05,
  strokeColor: '#000000',
  strokeWidth: 1
});

const sliderX = board.create('slider', [[0.8, -1.15], [5.8, -1.15], [0, 3, 6]], {
  name: 'x',
  snapWidth: 0.01,
  baseline: {strokeColor: '#AAAAAA', strokeWidth: 4},
  highline: {strokeColor: '#555555', strokeWidth: 4},
  fillColor: '#333333',
  strokeColor: '#333333',
  size: 6
});

const P = board.create('point', [
  () => 6 - sliderX.Value(),
  () => 0
], {name: 'P', color: '#e91e63', size: 4, fixed: true});

const Q = board.create('point', [
  () => {
    const r = GGBMath.perpFoot(P.X(), P.Y(), A.X(), A.Y(), B.X(), B.Y());
    return r ? r[0] : 0;
  },
  () => {
    const r = GGBMath.perpFoot(P.X(), P.Y(), A.X(), A.Y(), B.X(), B.Y());
    return r ? r[1] : 0;
  }
], {name: 'Q', color: '#7b1fa2', size: 4, fixed: true});

board.create('segment', [A, P], {name: 'AP', strokeColor: '#e91e63', strokeWidth: 3});
board.create('segment', [P, Q], {name: 'PQ', strokeColor: '#7b1fa2', strokeWidth: 2.5});
board.create('segment', [A, Q], {name: 'AQ', strokeColor: '#7b1fa2', strokeWidth: 2, dash: 2});

board.create('polygon', [A, P, Q], {
  name: 'APQ',
  withLabel: false,
  fillColor: '#e91e63',
  fillOpacity: 0.18,
  borders: {strokeColor: '#e91e63', strokeWidth: 1, strokeOpacity: 0.6}
});

board.create('text', [0.2, 9.6, function () {
  return 'AP = x = ' + sliderX.Value().toFixed(2);
}], {fontSize: 15, color: '#e91e63', fixed: true});

board.create('text', [0.2, 9.1, function () {
  return 'PQ = ' + GGBMath.dist(P.X(), P.Y(), Q.X(), Q.Y()).toFixed(2);
}], {fontSize: 15, color: '#7b1fa2', fixed: true});

board.create('text', [0.2, 8.6, function () {
  return 'AQ = ' + GGBMath.dist(A.X(), A.Y(), Q.X(), Q.Y()).toFixed(2);
}], {fontSize: 15, color: '#7b1fa2', fixed: true});

board.create('text', [0.2, 8.1, function () {
  const s = GGBMath.triangleArea(A.X(), A.Y(), P.X(), P.Y(), Q.X(), Q.Y());
  return 'S△APQ = ' + s.toFixed(2) + ' = 6x²/25';
}], {fontSize: 16, color: '#c00', fixed: true});

board.create('text', [0.2, -1.7, '最大值 216/25 = 8.64（x=6 时）'], {fontSize: 14, color: '#c00', fixed: true});

board.update();