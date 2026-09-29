// Pure geometry utilities: convex hull, rotating calipers min-area rect, inscribed rect.
// No DOM dependencies so this file can run in browser <script> or Node for testing.

function convexHull(points) {
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const n = pts.length;
  if (n < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function minAreaRect(points) {
  const hull = convexHull(points);
  const n = hull.length;
  if (n === 0) return { angle: 0, width: 0, height: 0, area: 0, center: { x: 0, y: 0 } };
  if (n < 3) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of hull) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return { angle: 0, width: maxX - minX, height: maxY - minY, area: 0, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } };
  }
  let best = null;
  for (let i = 0; i < n; i++) {
    const p1 = hull[i], p2 = hull[(i + 1) % n];
    const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const cosA = Math.cos(-edgeAngle), sinA = Math.sin(-edgeAngle);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of hull) {
      const rx = p.x * cosA - p.y * sinA;
      const ry = p.x * sinA + p.y * cosA;
      if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    }
    const w = maxX - minX, h = maxY - minY, area = w * h;
    if (!best || area < best.area) {
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const cosB = Math.cos(edgeAngle), sinB = Math.sin(edgeAngle);
      const ocx = cx * cosB - cy * sinB;
      const ocy = cx * sinB + cy * cosB;
      best = { angle: edgeAngle, width: w, height: h, area, center: { x: ocx, y: ocy } };
    }
  }
  return best;
}

function normalizeAngleDeg(deg) {
  let a = ((deg % 90) + 90) % 90;
  if (a > 45) a -= 90;
  return a;
}

function rotatedRectWithMaxArea(w, h, angleRad) {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const widthIsLonger = w >= h;
  const sideLong = widthIsLonger ? w : h;
  const sideShort = widthIsLonger ? h : w;
  const sinA = Math.abs(Math.sin(angleRad));
  const cosA = Math.abs(Math.cos(angleRad));
  if (sideShort <= 2 * sinA * cosA * sideLong + 1e-9 || Math.abs(sinA - cosA) < 1e-10) {
    const x = 0.5 * sideShort;
    if (widthIsLonger) return { w: x / sinA, h: x / cosA };
    return { w: x / cosA, h: x / sinA };
  }
  const cos2A = cosA * cosA - sinA * sinA;
  return {
    w: (w * cosA - h * sinA) / cos2A,
    h: (h * cosA - w * sinA) / cos2A,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { convexHull, minAreaRect, normalizeAngleDeg, rotatedRectWithMaxArea };
}
if (typeof window !== 'undefined') {
  window.Geometry = { convexHull, minAreaRect, normalizeAngleDeg, rotatedRectWithMaxArea };
}
