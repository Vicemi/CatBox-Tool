// Ayudas conscientes de la forma de la cara: centroide, zona segura, ajuste dentro del contorno real y alineación con un borde.
import { bboxOfPts, pointInPolygon } from './containers.js';

const r2 = v => Math.round(v * 100) / 100;

// Centroide por área (un triángulo queda centrado «a ojo», no en el centro de su caja). Cae a la caja si el área es ~0.
export function polyCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], c = p[0] * q[1] - q[0] * p[1];
    a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-6) { const b = bboxOfPts(pts); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
  return [cx / (3 * a), cy / (3 * a)];
}

// Zona segura de una cara: la del dieline (g.safes, polígono o rectángulo) cuyo centro cae dentro; si no hay, el contorno entero.
export function faceSafePoly(g, panel) {
  for (const sf of g.safes || []) {
    const poly = Array.isArray(sf[0]) ? sf : [[sf[0], sf[1]], [sf[0] + sf[2], sf[1]], [sf[0] + sf[2], sf[1] + sf[3]], [sf[0], sf[1] + sf[3]]];
    if (poly.length > 2 && pointInPolygon(polyCentroid(poly), panel.pts)) return poly;
  }
  return panel.pts;
}

// Nombre legible de una cara: la etiqueta del dieline que cae dentro, o su id.
export function faceName(g, panel) {
  const lb = (g.labels || []).find(l => pointInPolygon([l.x, l.y], panel.pts));
  return (lb && lb.name) || String(panel.panelId); // geomOf guarda el texto de la etiqueta en `name`
}

// Puntos del contorno normalizados a su caja (0..1): la capa «poly» se mueve y escala como cualquier forma.
export function normPoly(pts) {
  const b = bboxOfPts(pts), w = b[2] - b[0] || 1, h = b[3] - b[1] || 1;
  return { box: [b[0], b[1], w, h], poly: pts.map(p => [Math.round((p[0] - b[0]) / w * 1e5) / 1e5, Math.round((p[1] - b[1]) / h * 1e5) / 1e5]) };
}

export function faceShapeLayer(id, panel, pts, color, name) {
  const { box, poly } = normPoly(pts);
  return { id, kind: 'shape', shape: 'poly', poly, name, content: name, x: r2(box[0]), y: r2(box[1]), w: r2(box[2]), h: r2(box[3]), color, stroke: '#211d18', strokeW: 0, fillOn: true, finish: 'none', visible: true, panelId: panel.panelId, rot: 0 };
}

// Esquinas de un rectángulo w×h centrado en (cx,cy) y girado `rot`°, más los puntos medios de sus lados.
const rectPts = (cx, cy, w, h, rot) => {
  const a = rot * Math.PI / 180, co = Math.cos(a), si = Math.sin(a), out = [];
  [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].forEach(([u, v]) => { const x = u * w / 2, y = v * h / 2; out.push([cx + x * co - y * si, cy + x * si + y * co]); });
  return out;
};

// Mayor rectángulo con la proporción dada (w0:h0) y giro `rot` que cabe dentro del polígono; centrado lo más cerca posible del centroide.
export function containInPoly(pts, w0, h0, rot) {
  const b = bboxOfPts(pts), cen = polyCentroid(pts), N = 22;
  const centers = [cen];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) centers.push([b[0] + (b[2] - b[0]) * i / N, b[1] + (b[3] - b[1]) * j / N]);
  const fits = (f, c) => rectPts(c[0], c[1], w0 * f, h0 * f, rot).every(p => pointInPolygon(p, pts));
  const find = f => { let best = null, bd = Infinity; for (const c of centers) { if (!fits(f, c)) continue; const d = Math.hypot(c[0] - cen[0], c[1] - cen[1]); if (d < bd) { bd = d; best = c; } } return best; };
  let lo = 0, hi = Math.max((b[2] - b[0]) / w0, (b[3] - b[1]) / h0) * 1.05, bc = cen;
  for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2, c = find(mid); if (c) { lo = mid; bc = c; } else hi = mid; }
  return { f: lo, cx: bc[0], cy: bc[1] };
}

// Menor escala que cubre todos los vértices del polígono con un rectángulo w0×h0 girado `rot`° y centrado en (cx,cy).
export function coverPoly(pts, w0, h0, rot, cx, cy) {
  const a = -rot * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
  let mu = 0, mv = 0;
  pts.forEach(p => { const dx = p[0] - cx, dy = p[1] - cy; mu = Math.max(mu, Math.abs(dx * co - dy * si)); mv = Math.max(mv, Math.abs(dx * si + dy * co)); });
  return Math.max(2 * mu / w0, 2 * mv / h0);
}

// Giro (°) para que algo quede paralelo al borde de la cara más cercano a `pt`; elige la variante «derecha» (-90..90).
export function edgeRotation(pts, pt) {
  let best = null, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((pt[0] - p[0]) * dx + (pt[1] - p[1]) * dy) / L2)), d = Math.hypot(pt[0] - (p[0] + t * dx), pt[1] - (p[1] + t * dy));
    if (d < bd) { bd = d; best = Math.atan2(dy, dx) * 180 / Math.PI; }
  }
  if (best == null) return 0;
  let a = ((best % 180) + 180) % 180; if (a > 90) a -= 180;
  return r2(((a % 360) + 360) % 360);
}
