// Autocomprobación: node src/export/nesting.check.mjs
import assert from 'node:assert/strict';
import { nest, uniqueSheets, itemMatrix, polyArea } from './nesting.js';

const overlap = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const valid = (res, o) => res.sheets.forEach(s => {
  s.forEach((p, i) => {
    assert.ok(p.x >= o.margin - 1e-6 && p.y >= o.margin - 1e-6 && p.x + p.w <= o.sheetW - o.margin + 1e-6 && p.y + p.h <= o.sheetH - o.margin + 1e-6, 'dentro del margen');
    for (let j = i + 1; j < s.length; j++) {
      assert.ok(!overlap(p, s[j]), 'sin solapes');
      const gx = Math.max(s[j].x - (p.x + p.w), p.x - (s[j].x + s[j].w)), gy = Math.max(s[j].y - (p.y + p.h), p.y - (s[j].y + s[j].h));
      assert.ok(Math.max(gx, gy) >= o.gap - 1e-6, 'separación mínima');
    }
  });
});

// rejilla simple 3 x 4
let o = { sheetW: 300, sheetH: 200, margin: 0, gap: 0, qty: 0, rotate: true };
let r = nest({ w: 100, h: 50, area: 5000 }, o);
assert.equal(r.perSheet, 12); assert.equal(r.yield, 1); valid(r, o);

// la rotación aporta piezas: 70x30 en 100x100 -> sin rotar 3, rotando más
o = { sheetW: 100, sheetH: 100, margin: 0, gap: 0, qty: 0, rotate: false };
const a = nest({ w: 70, h: 30, area: 2100 }, o);
const b = nest({ w: 70, h: 30, area: 2100 }, { ...o, rotate: true });
assert.equal(a.perSheet, 3); assert.ok(b.perSheet > a.perSheet); valid(b, { ...o, rotate: true });

// margen + gap + cantidad en varias planchas
o = { sheetW: 210, sheetH: 297, margin: 10, gap: 4, qty: 25, rotate: true };
r = nest({ w: 60, h: 80, area: 3000 }, o);
assert.equal(r.count, 25); assert.ok(r.sheets.length >= 2); valid(r, o);
assert.equal(uniqueSheets(r).reduce((n, u) => n + u.items.length * u.repeat, 0), 25);

// no cabe
assert.equal(nest({ w: 500, h: 500, area: 1 }, o).count, 0);

// matriz de 90°: la esquina (0,0) de una pieza 40x20 colocada en (10,10) cae en (10+20, 10)
const m = itemMatrix({ x: 10, y: 10, rot: 90 }, 20);
assert.deepEqual([m[4], m[5]], [30, 10]);
assert.equal(polyArea([[0, 0], [4, 0], [4, 3], [0, 3]]), 12);
console.log('nesting ok');
