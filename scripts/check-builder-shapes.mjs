// Self-check for flap profiles, free-form faces and cut-outs.
// Run: node scripts/check-builder-shapes.mjs
import assert from 'node:assert/strict';
import { startFromShape, attachShape, panelEdgeList, customLayout, mapLocal, normalizeCustom, toFreeForm, editVertex, addNetLine, updateNetPanel, cutoutLocal, customPieces } from '../src/dieline/custom.js';
import { geomOf } from '../src/dieline/geom.js';

const T = 0.42;
const st = { L: 90, W: 60, H: 40, tpl: 'custom', bleed: 0, glue: 0, ovr: {}, typeOvr: {}, wrap: {} };
const geom = c => geomOf({ ...st, custom: c }, T);
const area = P => Math.abs(P.reduce((a, p, i) => { const q = P[(i + 1) % P.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

// 1. Every new flap profile attaches to every side of a triangle and its hinge stays on the side.
for (const shape of ['asym', 'halfdisc', 'quarter', 'round', 'tuck']) {
  let c = startFromShape(null, st, 'triangle');
  for (const e of panelEdgeList(c.panels[0])) c = attachShape(c, st, 'p1', e.id, shape);
  assert.equal(c.panels.length, 4, shape + ': 3 flaps');
  const lay = customLayout({ ...st, custom: c }, T);
  for (const p of c.panels.slice(1)) {
    const n = lay.byId.get(p.id);
    assert.ok(n.shapePts.length >= 3 && area(n.shapePts) > 1, shape + ': real outline');
    assert.ok(n.shapePts.every(q => q[1] >= -1e-6), shape + ': outline stays outside the hinge');
  }
  const g = geom(c);
  assert.ok(g.cutN > 0 && g.creaseN >= 3, shape + ': net has cuts and 3 hinges');
}

// 2. Asymmetric flap: straight on one side, mitred on the other.
{
  let c = startFromShape(null, st, 'square');
  c = attachShape(c, st, 'p1', 'far', 'asym');
  const f = c.panels[1];
  assert.equal(f.miterL || 0, 0); assert.equal(f.miterR, 45);
}

// 3. Rounded free corners on one side only.
{
  let c = startFromShape(null, st, 'square');
  c = attachShape(c, st, 'p1', 'far', 'flap');
  c = updateNetPanel(c, c.panels[1].id, { miterL: 0, miterR: 0, roundL: 6 });
  const n = customLayout({ ...st, custom: c }, T).byId.get(c.panels[1].id);
  const left = n.shapePts.filter(q => q[0] < n.w / 2 && q[1] > 0.01), right = n.shapePts.filter(q => q[0] >= n.w / 2 && q[1] > 0.01);
  assert.ok(left.length > 3 && right.length === 1, 'only the left corner is rounded');
}

// 4. Free-form: convert a triangle to vertices, move the apex, insert and delete a vertex; children follow.
{
  let c = startFromShape(null, st, 'triangle');
  c = attachShape(c, st, 'p1', 'e1', 'dust');
  c = toFreeForm(c, 'p1');
  let p = c.panels[0];
  assert.equal(p.shape, 'poly'); assert.equal(p.pts.length, 3);
  c = editVertex(c, 'p1', 'move', 2, [p.pts[2][0] + 20, p.pts[2][1] + 10]);
  c = editVertex(c, 'p1', 'insert', 0, [50, -10]);
  assert.equal(c.panels[0].pts.length, 4, 'vertex inserted');
  c = editVertex(c, 'p1', 'delete', 1, null);
  assert.equal(c.panels[0].pts.length, 3, 'vertex deleted');
  const lay = customLayout({ ...st, custom: normalizeCustom(c) }, T);
  const kid = lay.byId.get(c.panels[1].id), par = lay.byId.get('p1');
  assert.ok(kid, 'child still placed');
  // The fitted flap follows its side after the base was reshaped (no overhang past the corners).
  const ei = Number(c.panels[1].edge.slice(1)) % par.shapePts.length, a = par.shapePts[ei], b = par.shapePts[(ei + 1) % par.shapePts.length];
  assert.ok(Math.abs(kid.w - Math.hypot(b[0] - a[0], b[1] - a[1])) < 1e-6, 'fitted flap width = side length');
  // A child keeps its hinge vertices fixed.
  let d = attachShape(startFromShape(null, st, 'square'), st, 'p1', 'far', 'flap');
  d = toFreeForm(d, d.panels[1].id);
  const fid = d.panels[1].id, before = JSON.stringify(d.panels[1].pts[0]);
  d = editVertex(d, fid, 'move', 0, [5, 5]);
  assert.equal(JSON.stringify(d.panels[1].pts[0]), before, 'hinge vertex fixed');
}

// 5. Cut-outs: circular hole and rounded slot are closed cut outlines, and become holes in the 3D mesh.
{
  let c = startFromShape(null, st, 'square');
  c = addNetLine(c, 'p1', 'hole');
  c = addNetLine(c, 'p1', 'slot');
  c = normalizeCustom({ ...c, lines: c.lines.map(l => l.kind === 'slot' ? { ...l, w: 4, round: true } : l) });
  const hole = c.lines.find(l => l.kind === 'hole'), slot = c.lines.find(l => l.kind === 'slot');
  const hp = cutoutLocal(hole);
  assert.ok(hp.length >= 24 && Math.abs(Math.hypot(hp[0][0] - hole.x1, hp[0][1] - hole.y1) - hole.w / 2) < 1e-6, 'hole is a circle');
  assert.ok(cutoutLocal(slot).length > 4, 'rounded slot');
  const g = geom(c);
  const closed = g.segs.filter(s => s.t === 'cut' && s.pts.length > 20);
  assert.ok(closed.length >= 2, 'hole and slot cut as closed outlines');
  const pieces = customPieces({ ...st, custom: c });
  const root = (Array.isArray(pieces) ? pieces : pieces.pieces || [])[0];
  const spec = root && (root.root || root);
  assert.ok(JSON.stringify(pieces).includes('"holes"'), '3D spec carries the holes');
}
console.log('ok builder shapes: profiles, asymmetric, rounded, free-form, holes');
