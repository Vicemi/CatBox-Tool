// Self-check for the box builder: flaps on polygon faces sit on the real side and do not overlap.
// Run: node scripts/check-builder-flaps.mjs
import assert from 'node:assert/strict';
import { startFromShape, attachShape, panelEdgeList, customLayout, mapLocal, normalizeCustom } from '../src/dieline/custom.js';

const state = { L: 90, W: 60, H: 40, tpl: 'custom' };
const worldPoly = n => n.shapePts.map(p => mapLocal(n, p[0], p[1]));
// Separating-axis test for convex polygons (touching edges do not count as overlap).
const overlap = (A, B) => {
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], nx = b[1] - a[1], ny = a[0] - b[0];
    const pr = Q => Q.map(q => q[0] * nx + q[1] * ny);
    const pa = pr(A), pb = pr(B), l = Math.hypot(nx, ny) || 1;
    if (Math.max(...pa) <= Math.min(...pb) + 1e-6 * l || Math.max(...pb) <= Math.min(...pa) + 1e-6 * l) return false;
  }
  return true;
};

for (const base of ['triangle', 'hexagon', 'square']) {
  let c = startFromShape(null, state, base);
  const root = c.panels[0];
  const edges = panelEdgeList(root);
  assert.equal(edges.length, { triangle: 3, hexagon: 6, square: 4 }[base], base + ': edge count');
  for (const e of edges) c = attachShape(c, state, root.id, e.id, 'dust');
  c = normalizeCustom(c);
  assert.equal(c.panels.length, edges.length + 1, base + ': all flaps attached');
  const lay = customLayout({ ...state, custom: c }, 0.42);
  const rootN = lay.byId.get(root.id), rootPts = worldPoly(rootN);
  const flaps = c.panels.slice(1).map(p => lay.byId.get(p.id));
  for (const f of flaps) {
    // The hinge (local y = 0) must lie on one of the root's sides.
    const h0 = mapLocal(f, 0, 0), h1 = mapLocal(f, f.w, 0);
    const onSide = rootPts.some((a, i) => {
      const b = rootPts[(i + 1) % rootPts.length];
      const d = (p) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
      return d(h0) < 1e-6 && d(h1) < 1e-6;
    });
    assert.ok(onSide, base + ': flap ' + f.id + ' hinge on a real side');
  }
  for (let i = 0; i < flaps.length; i++) for (let j = i + 1; j < flaps.length; j++) {
    assert.ok(!overlap(worldPoly(flaps[i]), worldPoly(flaps[j])), base + ': flaps ' + flaps[i].id + '/' + flaps[j].id + ' overlap');
  }
  console.log('ok', base, edges.length, 'flaps');
}
