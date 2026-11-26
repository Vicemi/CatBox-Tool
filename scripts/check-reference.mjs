import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dxfToSvg, svgSizeMm } from '../src/dieline/reference.js';
for (const f of fs.readdirSync('F:/EcoDeli Pack/samples_Packaging_v2/_logs/dxf').filter(f => f.endsWith('.dxf'))) {
  const { svg, w, h } = dxfToSvg(fs.readFileSync('F:/EcoDeli Pack/samples_Packaging_v2/_logs/dxf/' + f, 'utf8'));
  assert.ok(w > 10 && h > 10 && svg.includes('#d01c2c'), f);
  console.log(f.slice(0, 40), w.toFixed(1), 'x', h.toFixed(1), 'mm');
}
// A tiny DXF with a circle and a bulged polyline in cm.
const mini = ['0','SECTION','2','HEADER','9','$INSUNITS','70','5','0','ENDSEC','0','SECTION','2','ENTITIES','0','CIRCLE','8','0','10','5','20','5','40','5','0','LWPOLYLINE','8','0','90','2','70','0','10','0','20','0','42','1','10','10','20','0','0','ENDSEC','0','EOF'].join('\n');
const r = dxfToSvg(mini);
assert.ok(Math.abs(r.w - 100) < 0.5, 'cm units → 100 mm wide: ' + r.w);
assert.deepEqual(svgSizeMm('<svg width="210mm" height="297mm" viewBox="0 0 210 297">'), { w: 210, h: 297 });
const px = svgSizeMm('<svg viewBox="0 0 96 48">'); assert.ok(Math.abs(px.w - 25.4) < 1e-9 && Math.abs(px.h - 12.7) < 1e-9);
console.log('ok reference parsing');
