// Self-check for the box builder (2D net + 3D fold):
//  · flaps on polygon faces sit on the real side and do not overlap each other;
//  · a flap can be attached to another (mitred) flap and lands on its real outline;
//  · no cut line runs over a crease (hinges are never cut);
//  · after folding in 3D every child stays attached to its parent.
// Run: node scripts/check-builder-flaps.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { startFromShape, attachShape, panelEdgeList, customLayout, mapLocal, normalizeCustom } from '../src/dieline/custom.js';
import { geomOf } from '../src/dieline/geom.js';
import { makePieces, Folder } from '../src/render3d/fold.js';

const T = 0.42;
const state = { L: 90, W: 60, H: 40, tpl: 'custom', bleed: 0, glue: 0, ovr: {}, typeOvr: {}, wrap: {} };
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
const segD = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
};
const onOutline = (p, poly) => poly.some((a, i) => segD(p, a, poly[(i + 1) % poly.length]) < 1e-3);

function fold3D(st) {
  const pieces = makePieces(st.tpl, st.L, st.W, st.H, T, 0, st.custom, st.wrap);
  const folder = new Folder(THREE, [0, 0, 1200, 900], [0.0002, 0.9998]);
  folder._dims = { L: st.L, W: st.W, H: st.H, t: T };
  const root = folder.build(pieces, T, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());
  folder.applyFold(pieces, 100);
  root.updateMatrixWorld(true);
  // Per panel: world vertices and triangles (to measure how far a child is from its parent's surface).
  const verts = new Map();
  root.traverse(o => {
    if (!o.isMesh || !o.userData.panel) return;
    const e = verts.get(o.userData.panel.panelId) || { pts: [], tris: [] }, pos = o.geometry.attributes.position, idx = o.geometry.index;
    const P = i => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    for (let i = 0; i < pos.count; i++) e.pts.push(P(i));
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) { const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2; e.tris.push(new THREE.Triangle(P(a), P(b), P(c))); }
    verts.set(o.userData.panel.panelId, e);
  });
  return verts;
}

for (const base of ['triangle', 'hexagon', 'square', 'trapezoid']) {
  let c = startFromShape(null, state, base);
  const root = c.panels[0];
  const edges = panelEdgeList(root);
  assert.equal(edges.length, { triangle: 3, hexagon: 6, square: 4, trapezoid: 4 }[base], base + ': edge count');
  for (const e of edges) c = attachShape(c, state, root.id, e.id, 'dust');
  // Flap on a flap: the first (mitred) flap offers its real sides; attach a tuck to the outer one.
  const f1 = c.panels[1];
  const outer = panelEdgeList(f1).sort((u, v) => v.len - u.len)[0];
  assert.ok(outer && /^e\d+$/.test(outer.id), base + ': mitred flap exposes real sides');
  c = attachShape(c, state, f1.id, outer.id, 'tuck');
  c = normalizeCustom(c);
  assert.equal(c.panels.length, edges.length + 2, base + ': all flaps attached');

  const st = { ...state, custom: c };
  const lay = customLayout(st, T);
  for (const p of c.panels.slice(1)) {
    const n = lay.byId.get(p.id), par = worldPoly(lay.byId.get(p.parent));
    assert.ok(onOutline(mapLocal(n, 0, 0), par) && onOutline(mapLocal(n, n.w, 0), par), base + ': ' + p.id + ' hinge on the parent outline');
  }
  const flaps = c.panels.slice(1, edges.length + 1).map(p => lay.byId.get(p.id));
  for (let i = 0; i < flaps.length; i++) for (let j = i + 1; j < flaps.length; j++) {
    assert.ok(!overlap(worldPoly(flaps[i]), worldPoly(flaps[j])), base + ': flaps ' + flaps[i].id + '/' + flaps[j].id + ' overlap');
  }
  // 2D: no cut over a crease.
  const g = geomOf(st, T);
  const cuts = g.segs.filter(s => s.t === 'cut'), creases = g.segs.filter(s => s.t === 'crease');
  for (const cr of creases) {
    const m = [(cr.pts[0][0] + cr.pts[1][0]) / 2, (cr.pts[0][1] + cr.pts[1][1]) / 2];
    assert.ok(!cuts.some(cu => cu.pts.some((a, i) => i < cu.pts.length - 1 && segD(m, a, cu.pts[i + 1]) < 1e-3)), base + ': cut over a crease');
  }
  assert.ok(Array.isArray(g.safes.find(s => Array.isArray(s[0]))) || base === 'square', base + ': polygon safe zone');
  // 3D: every child stays attached to its parent after folding.
  const verts = fold3D(st);
  for (const p of c.panels.slice(1)) {
    const a = verts.get(p.id), b = verts.get(p.parent);
    assert.ok(a && b, base + ': ' + p.id + ' meshed');
    let d = Infinity; const q = new THREE.Vector3();
    for (const u of a.pts) for (const tr of b.tris) d = Math.min(d, tr.closestPointToPoint(u, q).distanceTo(u));
    assert.ok(d < 1, base + ': ' + p.id + ' detached in 3D (' + d.toFixed(2) + ' mm)');
  }
  console.log('ok', base, edges.length, 'flaps + flap-on-flap, 2D cuts, 3D attached');
}
