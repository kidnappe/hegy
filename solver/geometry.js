/* =========================================================
   何解 · 几何计算函数库（自研）
   ---------------------------------------------------------
   给模型 renderCode 用的「计算器」：只算数字，不画图形。
   画图由 JSXGraph 负责，本文件不依赖任何第三方库。

   对外接口名与参数顺序（= 历史 renderCode 的调用约定，不可更改）：
     2D（26 个）dist midpoint lerp rotate perpFoot reflect reflectPoint
               triangleArea lineIntersect circleCenter angleDeg signedAngleDeg
               vectorAngle magnitude normalize dot perpDir bisectorDir
               bisectorPoint arcPoint divideExternally internalDivide
               polygonArea polygonIntersect circleLineIntersect tangentLength
     3D（7 个） dist3 midpoint3 lerp3 boxVertices cubeVertices cubeFaces spherePoint

   约定：
   - 角度一律用「度」；三角函数内部转弧度。角度返回值也是度。
   - 无解 / 平行 / 退化时，按历史行为返回 null 或 []，不抛异常。
   - 点用扁平参数传递（x1,y1,x2,y2...），不用对象。
   ========================================================= */
(function (root) {
  "use strict";

  var EPS = 1e-10;
  var DEG = Math.PI / 180;   // 度 → 弧度
  var RAD = 180 / Math.PI;   // 弧度 → 度

  var M = {};

  /* ---------------- 基础：距离 / 中点 / 插值 ---------------- */

  M.dist = function (x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  };

  M.midpoint = function (x1, y1, x2, y2) {
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  };

  // t=0 得起点，t=1 得终点，t=0.5 即中点
  M.lerp = function (x1, y1, x2, y2, t) {
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  };

  /* ---------------- 旋转 / 垂足 / 对称 ---------------- */

  // 绕 (ax,ay) 逆时针旋转 ang 度
  M.rotate = function (x, y, ax, ay, ang) {
    var r = ang * DEG, c = Math.cos(r), s = Math.sin(r);
    var dx = x - ax, dy = y - ay;
    return [ax + dx * c - dy * s, ay + dx * s + dy * c];
  };

  // 点 P 在直线 AB 上的垂足；A、B 重合时退回 A
  M.perpFoot = function (px, py, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay;
    var len2 = vx * vx + vy * vy;
    if (len2 < EPS) return [ax, ay];
    var t = ((px - ax) * vx + (py - ay) * vy) / len2;
    return [ax + t * vx, ay + t * vy];
  };

  // 点 P 关于直线 AB 的对称点
  M.reflect = function (px, py, ax, ay, bx, by) {
    var f = M.perpFoot(px, py, ax, ay, bx, by);
    return [2 * f[0] - px, 2 * f[1] - py];
  };

  // 点 P 关于点 Q 的中心对称
  M.reflectPoint = function (px, py, qx, qy) {
    return [2 * qx - px, 2 * qy - py];
  };

  /* ---------------- 三角形 / 直线求交 ---------------- */

  M.triangleArea = function (x1, y1, x2, y2, x3, y3) {
    return Math.abs((x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)) / 2;
  };

  // 两直线交点；平行 / 共线时返回 null
  M.lineIntersect = function (x1, y1, x2, y2, x3, y3, x4, y4) {
    var dx1 = x2 - x1, dy1 = y2 - y1;
    var dx2 = x4 - x3, dy2 = y4 - y3;
    var den = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(den) < EPS) return null;
    var t = ((x3 - x1) * dy2 - (y3 - y1) * dx2) / den;
    return [x1 + t * dx1, y1 + t * dy1];
  };

  // 三点外心（两条中垂线求交）；三点共线时返回 null
  M.circleCenter = function (x1, y1, x2, y2, x3, y3) {
    var m1x = (x1 + x2) / 2, m1y = (y1 + y2) / 2;
    var m2x = (x2 + x3) / 2, m2y = (y2 + y3) / 2;
    return M.lineIntersect(
      m1x, m1y, m1x - (y2 - y1), m1y + (x2 - x1),
      m2x, m2y, m2x - (y3 - y2), m2y + (x3 - x2)
    );
  };

  /* ---------------- 角度 ---------------- */

  // 以 (x2,y2) 为顶点，射线 2→1 与 2→3 的夹角，返回 0~180
  M.angleDeg = function (x1, y1, x2, y2, x3, y3) {
    var ax = x1 - x2, ay = y1 - y2;
    var bx = x3 - x2, by = y3 - y2;
    var la = Math.sqrt(ax * ax + ay * ay);
    var lb = Math.sqrt(bx * bx + by * by);
    if (la < EPS || lb < EPS) return 0;
    var cosv = (ax * bx + ay * by) / (la * lb);
    return Math.acos(Math.max(-1, Math.min(1, cosv))) * RAD;
  };

  // 同一顶点的有向角，返回 -180~180（逆时针为正）
  M.signedAngleDeg = function (x1, y1, x2, y2, x3, y3) {
    var ax = x1 - x2, ay = y1 - y2;
    var bx = x3 - x2, by = y3 - y2;
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * RAD;
  };

  // 向量 (x1,y1)→(x2,y2) 的方位角，返回 -180~180
  M.vectorAngle = function (x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1) * RAD;
  };

  /* ---------------- 向量工具 ---------------- */

  M.magnitude = function (x, y) {
    return Math.sqrt(x * x + y * y);
  };

  // 单位化；零向量返回 [0,0]
  M.normalize = function (x, y) {
    var len = Math.sqrt(x * x + y * y);
    if (len < EPS) return [0, 0];
    return [x / len, y / len];
  };

  M.dot = function (x1, y1, x2, y2) {
    return x1 * x2 + y1 * y2;
  };

  // 垂直方向（逆时针转 90°）
  M.perpDir = function (x, y) {
    return [-y, x];
  };

  /* ---------------- 角平分 ---------------- */

  // ∠B-A-C 的角平分线方向单位向量（A 为顶点，参数顺序 B, A, C）
  M.bisectorDir = function (bx, by, ax, ay, cx, cy) {
    var u = M.normalize(bx - ax, by - ay);
    var v = M.normalize(cx - ax, cy - ay);
    return M.normalize(u[0] + v[0], u[1] + v[1]);
  };

  // 角平分线上、距顶点 A 为 len 的点
  M.bisectorPoint = function (bx, by, ax, ay, cx, cy, len) {
    var d = M.bisectorDir(bx, by, ax, ay, cx, cy);
    return [ax + d[0] * len, ay + d[1] * len];
  };

  /* ---------------- 圆 / 弧 ---------------- */

  // 圆弧上按角度插值的点：从 startDeg 到 endDeg，t∈[0,1]
  M.arcPoint = function (cx, cy, r, startDeg, endDeg, t) {
    var a = (startDeg + t * (endDeg - startDeg)) * DEG;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  // 从点 P 到以 Q 为圆心、半径 r 的圆的切线长；点在圆内返回 0
  M.tangentLength = function (px, py, r, qx, qy) {
    var d2 = (qx - px) * (qx - px) + (qy - py) * (qy - py) - r * r;
    return d2 > 0 ? Math.sqrt(d2) : 0;
  };

  // 圆与直线的交点；无交点返回 []
  M.circleLineIntersect = function (cx, cy, r, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var fx = x1 - cx, fy = y1 - cy;
    var a = dx * dx + dy * dy;
    if (a < EPS) return [];
    var b = 2 * (fx * dx + fy * dy);
    var c = fx * fx + fy * fy - r * r;
    var disc = b * b - 4 * a * c;
    if (disc < -EPS) return [];
    if (disc < EPS) {
      var t0 = -b / (2 * a);
      return [[x1 + t0 * dx, y1 + t0 * dy]];
    }
    var sq = Math.sqrt(disc);
    var t1 = (-b - sq) / (2 * a);
    var t2 = (-b + sq) / (2 * a);
    return [
      [x1 + t1 * dx, y1 + t1 * dy],
      [x1 + t2 * dx, y1 + t2 * dy]
    ];
  };

  /* ---------------- 分点 / 多边形 ---------------- */

  // 外分点：PA:PB = m:n 的外分点
  M.divideExternally = function (ax, ay, bx, by, m, n) {
    var den = m - n;
    if (Math.abs(den) < EPS) return null;
    return [(m * bx - n * ax) / den, (m * by - n * ay) / den];
  };

  // 内分点：PA:PB = m:n 的内分点；m+n=0 时退回中点
  M.internalDivide = function (ax, ay, bx, by, m, n) {
    var den = m + n;
    if (Math.abs(den) < EPS) return [(ax + bx) / 2, (ay + by) / 2];
    return [(m * bx + n * ax) / den, (m * by + n * ay) / den];
  };

  // 多边形面积（鞋带公式）；少于 3 点返回 0
  M.polygonArea = function (points) {
    if (!points || points.length < 3) return 0;
    var s = 0, n = points.length;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      s += points[i][0] * points[j][1] - points[j][0] * points[i][1];
    }
    return Math.abs(s) / 2;
  };

  // 两个多边形的交（Sutherland–Hodgman 裁剪）
  M.polygonIntersect = function (subject, clip) {
    function inside(p, a, b) {
      return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    }
    function cross(p, q, a, b) {
      var a1 = q[1] - p[1], b1 = p[0] - q[0];
      var c1 = a1 * p[0] + b1 * p[1];
      var a2 = b[1] - a[1], b2 = a[0] - b[0];
      var c2 = a2 * a[0] + b2 * a[1];
      var den = a1 * b2 - a2 * b1;
      if (Math.abs(den) < EPS) return p;
      return [(c1 * b2 - c2 * b1) / den, (a1 * c2 - a2 * c1) / den];
    }
    var out = subject.slice();
    for (var i = 0; i < clip.length && out.length > 0; i++) {
      var input = out.slice();
      out = [];
      var a = clip[i], b = clip[(i + 1) % clip.length];
      var prev = input[input.length - 1];
      for (var k = 0; k < input.length; k++) {
        var cur = input[k];
        if (inside(cur, a, b)) {
          if (!inside(prev, a, b)) out.push(cross(prev, cur, a, b));
          out.push(cur);
        } else if (inside(prev, a, b)) {
          out.push(cross(prev, cur, a, b));
        }
        prev = cur;
      }
    }
    return out;
  };

  /* ---------------- 3D ---------------- */

  M.dist3 = function (x1, y1, z1, x2, y2, z2) {
    var dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  M.midpoint3 = function (x1, y1, z1, x2, y2, z2) {
    return [(x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2];
  };

  M.lerp3 = function (x1, y1, z1, x2, y2, z2, t) {
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1), z1 + t * (z2 - z1)];
  };

  // 长方体的 8 个顶点（中心 c，半边长 dx,dy,dz）
  M.boxVertices = function (cx, cy, cz, dx, dy, dz) {
    return [
      [cx - dx, cy - dy, cz - dz], [cx + dx, cy - dy, cz - dz],
      [cx + dx, cy + dy, cz - dz], [cx - dx, cy + dy, cz - dz],
      [cx - dx, cy - dy, cz + dz], [cx + dx, cy - dy, cz + dz],
      [cx + dx, cy + dy, cz + dz], [cx - dx, cy + dy, cz + dz]
    ];
  };

  M.cubeVertices = function (cx, cy, cz, size) {
    return M.boxVertices(cx, cy, cz, size, size, size);
  };

  M.cubeFaces = function () {
    return [
      [0, 1, 2, 3], [4, 5, 6, 7],
      [0, 1, 5, 4], [1, 2, 6, 5],
      [2, 3, 7, 6], [3, 0, 4, 7]
    ];
  };

  // 球面上一点：theta 为方位角、phi 为极角（弧度）
  M.spherePoint = function (cx, cy, cz, r, theta, phi) {
    return [
      cx + r * Math.cos(theta) * Math.sin(phi),
      cy + r * Math.sin(theta) * Math.sin(phi),
      cz + r * Math.cos(phi)
    ];
  };

  /* ---------------- 挂在 window ---------------- */
  // 正式名 HexMath。历史 renderCode 里写的是 GGBMath —— 那是给模型的对外契约，
  // 由 shim.js 负责把 GGBMath 指向本对象。
  function warnMissing(target) {
    return new Proxy(target, {
      get: function (t, k) {
        if (typeof k === "string" && !(k in t)) {
          if (root.console && console.warn) {
            console.warn("[geometry] 未定义的方法: " + k + "（可用方法见 solver/geometry.js 顶部清单）");
          }
        }
        return t[k];
      }
    });
  }
  root.HexMath = typeof Proxy === "function" ? warnMissing(M) : M;
})(typeof window !== "undefined" ? window : this);
