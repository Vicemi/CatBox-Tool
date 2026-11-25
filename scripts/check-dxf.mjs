// Self-check DXF: capas y colores, versiones R12 / AutoCAD 2000, punteado partido en trazos y un proyecto real.
// Run: node scripts/check-dxf.mjs
//      node scripts/check-dxf.mjs --out <dir>   (además escribe los DXF de prueba del proyecto demo)
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dxfOf, dashPieces, laserDxfOf, nestedDxfOf } from '../src/export/dxf.js';
import { geomOf } from '../src/dieline/geom.js';
import { normalizeCustom } from '../src/dieline/custom.js';
import { MATS } from '../src/dieline/templates.js';
import { nest, polyArea } from '../src/export/nesting.js';
import { sheetOf } from '../src/units.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Lectores mínimos de DXF (pares código/valor) para comprobar capas, tipos y coordenadas.
function pairsOf(text) {
  const lines = text.split('\r\n'), out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i].trim()), lines[i + 1]]);
  return out;
}
function tableOf(text, kind) {
  const p = pairsOf(text), out = {};
  p.forEach(([c, v], i) => {
    if (c !== 0 || v !== kind) return;
    const rec = {};
    for (let j = i + 1; j < p.length && p[j][0] !== 0; j++) {
      if (p[j][0] === 2) rec.name = p[j][1];
      if (p[j][0] === 62) rec.color = Number(p[j][1]);
      if (p[j][0] === 6) rec.ltype = p[j][1];
      if (p[j][0] === 70) rec.flags = Number(p[j][1]);
    }
    out[rec.name] = rec;
  });
  return out;
}
const layersOf = text => tableOf(text, 'LAYER');
const ltypesOf = text => tableOf(text, 'LTYPE');
const handlesOf = text => pairsOf(text).filter(([c]) => c === 5).map(([, v]) => v);
// Entidades de ENTITIES: POLYLINE (con sus VERTEX), LWPOLYLINE y LINE, con capa, cierre y puntos.
function entsOf(text) {
  const p = pairsOf(text);
  const s0 = p.findIndex(([c, v]) => c === 2 && v === 'ENTITIES');
  const e0 = p.findIndex((x, i) => i > s0 && x[0] === 0 && x[1] === 'ENDSEC');
  const list = [];
  let cur = null, x = 0;
  for (let i = s0 + 1; i < e0; i++) {
    const [c, v] = p[i];
    if (c === 0) { cur = { type: v, layer: '', flag: 0, pts: [] }; list.push(cur); continue; }
    if (c === 8 && cur.layer === '') cur.layer = v;
    if (c === 70 && cur.type !== 'VERTEX') cur.flag = Number(v);
    if (c === 10 || c === 11) x = Number(v);
    if (c === 20 || c === 21) cur.pts.push([x, Number(v)]);
  }
  const out = []; let pl = null;
  for (const e of list) {
    if (e.type === 'POLYLINE') { pl = { type: 'POLYLINE', layer: e.layer, closed: (e.flag & 1) === 1, pts: [] }; out.push(pl); }
    else if (e.type === 'VERTEX') pl.pts.push(e.pts[0]);
    else if (e.type === 'SEQEND') pl = null;
    else out.push({ type: e.type, layer: e.layer, closed: (e.flag & 1) === 1, pts: e.pts });
  }
  return out;
}
const lens = pts => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const plen = ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ---- 1. Punteado: trazos de 3 mm on / 2 mm off que continúan por los vértices ----
const d1 = dashPieces([[0, 0], [10, 0]], 3, 2);
assert.equal(d1.length, 2, 'dash: 10 mm -> dos trazos (0-3, 5-8)');
assert.deepEqual(d1[1][0], [5, 0]);
assert.ok(Math.abs(plen(d1[0]) - 3) < 1e-9, 'dash: trazo de 3 mm');
const d2 = dashPieces([[0, 0], [2, 0], [2, 4]], 3, 2);
assert.equal(d2.length, 3, 'dash: el patrón continúa por el vértice');
assert.deepEqual(d2[1][0], [2, 0], 'dash: el trazo siguiente arranca en el vértice');
assert.ok(Math.abs(d2.reduce((a, q) => a + plen(q), 0) - 4) < 1e-9, 'dash: 4 mm encendidos en 6 mm (3 on / 2 off)');
console.log('ok dash splitting');

// ---- 2. DXF sintético: versiones, capas, colores, cierre, Y invertida ----
const square = [[0, 5], [10, 5], [10, 15], [0, 15], [0, 5]];
const open = [[20, 0], [30, 0], [30, 4]];
const perf = [[40, 0], [52, 0]];
const segs = [{ t: 'cut', pts: square }, { t: 'crease', pts: open }, { t: 'perf', pts: perf }];
assert.throws(() => dxfOf(segs, { version: 'R14' }), /no soportada/);

function checkLayers(text) {
  const layers = layersOf(text);
  assert.equal(layers.CORTE.color, 1); assert.equal(layers.CORTE.ltype, 'CONTINUOUS');
  assert.equal(layers.MARCADO.color, 5); assert.equal(layers.MARCADO.ltype, 'CONTINUOUS');
  assert.equal(layers.PUNTEADO.color, 5); assert.equal(layers.PUNTEADO.ltype, 'DASHED');
  const lt = ltypesOf(text);
  assert.ok(lt.CONTINUOUS && lt.DASHED, 'ltypes CONTINUOUS y DASHED');
}

const r12 = dxfOf(segs, { version: 'R12' });
assert.ok(r12.includes('$ACADVER\r\n1\r\nAC1009\r\n'), 'R12 header');
checkLayers(r12);
let ents = entsOf(r12);
const polys12 = ents.filter(e => e.type === 'POLYLINE');
assert.equal(polys12.length, 2);
assert.equal(polys12[0].layer, 'CORTE'); assert.equal(polys12[0].closed, true); assert.equal(polys12[0].pts.length, 4, 'cierre: sin punto repetido');
assert.deepEqual(polys12[0].pts[0], [0, 10], 'Y invertida dentro del alto (15 - 5): coordenadas positivas');
assert.ok(ents.every(e => (e.pts || []).every(p => p[1] >= 0)), 'sin Y negativas');
assert.equal(polys12[1].layer, 'MARCADO'); assert.equal(polys12[1].closed, false);
const lines12 = ents.filter(e => e.type === 'LINE');
assert.equal(lines12.length, 3, 'perf 12 mm -> 3 trazos');
assert.ok(lines12.every(e => e.layer === 'PUNTEADO'));
console.log('ok R12 layers, entities and dashes');

const r20 = dxfOf(segs, { version: 'R2000' });
assert.ok(r20.includes('$ACADVER\r\n1\r\nAC1015\r\n'), 'AC1015 header');
assert.ok(r20.includes('$INSUNITS\r\n70\r\n4\r\n'), 'mm units');
checkLayers(r20);
const hs = handlesOf(r20);
assert.equal(new Set(hs).size, hs.length, 'handles unicos');
ents = entsOf(r20);
const lw = ents.filter(e => e.type === 'LWPOLYLINE');
assert.equal(lw.length, 2);
assert.equal(lw[0].layer, 'CORTE'); assert.equal(lw[0].closed, true); assert.equal(lw[0].pts.length, 4);
assert.equal(lw[1].layer, 'MARCADO'); assert.equal(lw[1].closed, false);
const lines2000 = ents.filter(e => e.type === 'LINE');
assert.equal(lines2000.length, 3); assert.ok(lines2000.every(e => e.layer === 'PUNTEADO'));
console.log('ok AutoCAD 2000 layers, entities and dashes');

// ---- 3. Proyecto real (demo_nube_tea) con dos líneas de pliegue pasadas a PUNTEADO (typeOvr) ----
const doc = JSON.parse(readFileSync(join(root, 'public/samples/demo_nube_tea.boxproj'), 'utf8'));
const box = doc.box;
const mat = MATS.find(m => m.id === box.matId) || MATS[0];
const base = { ...box, custom: normalizeCustom(box.custom), wrap: box.wrap || { flap: 0, outer: 0, inner: 0, tab: 12, slot: 20, slotW: 1.2, sideTab: 0 }, layers: [] };
const creaseIdx = geomOf(base, mat.t).segs.flatMap((sg, i) => (sg.t === 'crease' ? [i] : [])).slice(0, 2);
const s = { ...base, typeOvr: Object.fromEntries(creaseIdx.map(i => [String(i), 'perf'])) };
const g = geomOf(s, mat.t);
const cutCrease = g.segs.filter(sg => sg.t !== 'perf' && sg.pts.length >= 2).length;
const dashesPerItem = g.segs.filter(sg => sg.t === 'perf').reduce((a, sg) => a + dashPieces(sg.pts).length, 0);
assert.ok(dashesPerItem > 0, 'el proyecto tiene punteado');

// Plancha láser 600 x 400 con margen 5 mm y separación = kerf (mínimo 3 mm), como en la vista de nesting.
const sheet = sheetOf('laser600');
const netW = g.sbb[2] - g.sbb[0], netH = g.sbb[3] - g.sbb[1];
const area = g.fills.reduce((a, p) => a + polyArea(p), 0) || netW * netH;
const nestProject = () => nest({ w: netW, h: netH, area }, { sheetW: sheet.w, sheetH: sheet.h, margin: 5, gap: Math.max(3, base.custom.kerf || 0), qty: 0, rotate: true });

for (const version of ['R12', 'R2000']) {
  const lay = laserDxfOf(s, mat, version);
  assert.ok(lay.name.endsWith(version === 'R12' ? '_r12.dxf' : '_2000.dxf'), lay.name);
  checkLayers(lay.text);
  const e = entsOf(lay.text);
  assert.equal(e.length, cutCrease + dashesPerItem, 'entidades laser');
  assert.equal(e.filter(x => x.type !== 'LINE').length, cutCrease);
  assert.equal(e.filter(x => x.type === 'LINE').length, dashesPerItem);
  assert.ok(e.every(x => ['CORTE', 'MARCADO', 'PUNTEADO'].includes(x.layer)));
  assert.equal(e.filter(x => x.layer === 'PUNTEADO').length, dashesPerItem);
  console.log('ok project laser', version, lay.name);

  const res = nestProject();
  assert.ok(res.count > 0, 'nesting: la red cabe en la plancha');
  const files = nestedDxfOf(s, mat, res, version);
  assert.ok(files.length >= 1);
  for (const f of files) {
    const n = Number(f.name.match(/_(\d+)pzs_/)[1]);
    const en = entsOf(f.text);
    assert.equal(en.filter(x => x.type !== 'LINE').length, n * cutCrease, 'nesting: polilíneas por pieza');
    assert.equal(en.filter(x => x.type === 'LINE').length, n * dashesPerItem, 'nesting: trazos de punteado por pieza');
    checkLayers(f.text);
    assert.ok(f.name.endsWith(version === 'R12' ? '_r12.dxf' : '_2000.dxf'));
  }
  console.log('ok project nested', version, files.length, 'plancha(s)');
}

// ---- 4. Escritura opcional de los DXF de prueba ----
const outIdx = process.argv.indexOf('--out');
if (outIdx > 0) {
  const dir = process.argv[outIdx + 1];
  mkdirSync(dir, { recursive: true });
  for (const version of ['R12', 'R2000']) {
    const lay = laserDxfOf(s, mat, version);
    writeFileSync(join(dir, lay.name), lay.text);
    for (const f of nestedDxfOf(s, mat, nestProject(), version)) writeFileSync(join(dir, f.name), f.text);
  }
  console.log('written to', dir);
}
console.log('all DXF checks passed');
