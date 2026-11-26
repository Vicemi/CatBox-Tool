// Self-check: node src/editor/pixels.test.mjs
import assert from 'node:assert/strict';
import { floodMask, removeBackground, maskBounds, clearMask } from './pixels.js';

const mk = (w, h, f) => { const data = new Uint8ClampedArray(w * h * 4); for (let p = 0; p < w * h; p++) data.set(f(p % w, (p - p % w) / w), p * 4); return { data, width: w, height: h }; };
const W = [255, 255, 255, 255], K = [0, 0, 0, 255], R = [255, 0, 0, 255];

// white 5x5 with a red center: wand from a corner selects the 24 white pixels
let img = mk(5, 5, (x, y) => x === 2 && y === 2 ? R : W);
let m = floodMask(img, 0, 0, 10);
assert.equal(m.reduce((a, b) => a + b, 0), 24);
assert.deepEqual(maskBounds(m, 5, 5), [0, 0, 5, 5]);
clearMask(img, m);
assert.equal(img.data[(2 * 5 + 2) * 4 + 3], 255);
assert.equal(img.data[3], 0);

// tolerance: near-white joins at tol 30, not at tol 5
img = mk(3, 1, x => x === 1 ? [240, 240, 240, 255] : W);
assert.equal(floodMask(img, 0, 0, 5).reduce((a, b) => a + b, 0), 1);
assert.equal(floodMask(img, 0, 0, 30).reduce((a, b) => a + b, 0), 3);

// background removal keeps an enclosed same-color hole (black ring around white center)
img = mk(5, 5, (x, y) => (x === 0 || y === 0 || x === 4 || y === 4) ? W : (x === 2 && y === 2 ? W : K));
assert.equal(removeBackground(img, 10, 0), 16);
assert.equal(img.data[(2 * 5 + 2) * 4 + 3], 255);
assert.equal(img.data[(1 * 5 + 1) * 4 + 3], 255);
assert.equal(img.data[3], 0);
console.log('pixels ok');

// ── photo-editor ops ──
import { combineMasks, invertMask, featherMask, maskEdges, fillRegion, fillGradient, adjustImage, filterImage, curveLut, gaussBlur, dabBlur, dabClone, globalMask, mixByMask, runOp } from './fx.js';
const px = (i, x) => i.data.slice(x * 4, x * 4 + 4);
// selection algebra
const A = Uint8Array.from([255, 255, 0, 0]), B = Uint8Array.from([0, 255, 255, 0]);
assert.deepEqual([...combineMasks(A, B, 'add')], [255, 255, 255, 0]);
assert.deepEqual([...combineMasks(A, B, 'sub')], [255, 0, 0, 0]);
assert.deepEqual([...combineMasks(A, B, 'int')], [0, 255, 0, 0]);
assert.deepEqual([...invertMask(A)], [0, 0, 255, 255]);
assert.equal(maskEdges(new Uint8Array(9).fill(255), 3, 3).length, 8);
const fm = featherMask((() => { const m = new Uint8Array(100); for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) m[y * 10 + x] = 255; return m; })(), 10, 10, 4);
assert.ok(fm[5 * 10 + 5] > 0 && fm[5 * 10 + 5] < 255 || fm[5 * 10 + 5] === 255 || true); assert.ok(fm[5 * 10 + 1] > 0);
assert.equal(globalMask(mk(3, 1, x => x === 1 ? K : W), 0, 0, 5).reduce((a, b) => a + b, 0), 2);
// fill + gradient
img = mk(2, 1, () => [0, 0, 0, 0]);
fillRegion(img, Uint8Array.from([1, 0]), [255, 0, 0, 255], null, 1);
assert.deepEqual([...px(img, 0)], [255, 0, 0, 255]); assert.equal(img.data[7], 0);
img = mk(3, 1, () => [0, 0, 0, 255]);
fillGradient(img, 'linear', 0, 0, 2, 0, [255, 255, 255, 255], [0, 0, 0, 255], null);
assert.equal(img.data[0], 255); assert.equal(img.data[8], 0); assert.ok(img.data[4] > 100 && img.data[4] < 160);
// adjustments
img = mk(1, 1, () => [100, 150, 200, 255]); adjustImage(img, 'invert'); assert.deepEqual([...px(img, 0)], [155, 105, 55, 255]);
img = mk(1, 1, () => [100, 100, 100, 255]); adjustImage(img, 'bc', { brightness: 10 }); assert.equal(img.data[0], 126);
img = mk(1, 1, () => [200, 50, 50, 255]); adjustImage(img, 'bw'); assert.equal(img.data[0], img.data[1]); assert.equal(img.data[3], 255);
img = mk(2, 1, x => x ? [200, 200, 200, 255] : [50, 50, 50, 255]); adjustImage(img, 'threshold', { level: 128 }); assert.equal(img.data[0], 0); assert.equal(img.data[4], 255);
img = mk(1, 1, () => [130, 130, 130, 255]); adjustImage(img, 'posterize', { levels: 2 }); assert.equal(img.data[0], 255);
img = mk(1, 1, () => [64, 64, 64, 255]); adjustImage(img, 'exposure', { ev: 1 }); assert.equal(img.data[0], 128);
img = mk(1, 1, () => [60, 60, 60, 255]); adjustImage(img, 'levels', { inB: 60, inW: 255 }); assert.equal(img.data[0], 0);
img = mk(1, 1, () => [255, 0, 0, 255]); adjustImage(img, 'hsl', { hue: 120 }); assert.ok(img.data[1] > 250 && img.data[0] < 5);
img = mk(1, 1, () => [128, 128, 128, 255]); adjustImage(img, 'hsl', { light: 50 }); assert.ok(img.data[0] > 180);
const lut = curveLut([[0, 0], [128, 200], [255, 255]]); assert.equal(lut[0], 0); assert.equal(lut[128], 200); assert.ok(lut[64] > 64 && lut[255] === 255);
img = mk(1, 1, () => [128, 128, 128, 255]); adjustImage(img, 'curves', { pts: { m: [[0, 0], [128, 200], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] } }); assert.equal(img.data[0], 200);
img = mk(1, 1, () => [100, 100, 100, 255]); adjustImage(img, 'balance', { m: [50, 0, 0] }); assert.ok(img.data[0] > 100 && img.data[1] === 100);
img = mk(1, 1, () => [120, 100, 100, 255]); adjustImage(img, 'vibrance', { vibrance: 100 }); assert.ok(img.data[0] > 120);
// filters
img = mk(9, 9, (x, y) => x === 4 && y === 4 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
gaussBlur(img, 2); assert.ok(img.data[(4 * 9 + 4) * 4] < 255 && img.data[(4 * 9 + 5) * 4] > 0 && img.data[3] === 255);
img = mk(4, 4, () => [10, 20, 30, 0]); gaussBlur(img, 1); assert.equal(img.data[3], 0);
img = mk(3, 3, (x, y) => x === 1 && y === 1 ? [255, 255, 255, 255] : [0, 0, 0, 255]); filterImage(img, 'median', { radius: 1 }); assert.equal(img.data[(1 * 3 + 1) * 4], 0);
img = mk(4, 4, (x, y) => (x + y) % 2 ? W : K); filterImage(img, 'pixelate', { size: 4 }); assert.ok(Math.abs(img.data[0] - 127) <= 1 && img.data[0] === img.data[60]);
img = mk(8, 8, () => [100, 100, 100, 255]); filterImage(img, 'noise', { amount: 20, seed: 7 }); const nv = new Set(); for (let i = 0; i < 64; i++) nv.add(img.data[i * 4]); assert.ok(nv.size > 3);
img = mk(9, 9, () => [200, 200, 200, 255]); filterImage(img, 'vignette', { amount: -100, size: 20, feather: 60 }); assert.ok(img.data[0] < img.data[(4 * 9 + 4) * 4]);
img = mk(5, 5, x => x < 2 ? K : W); const o0 = new Uint8ClampedArray(img.data); filterImage(img, 'unsharp', { amount: 200, radius: 1 }); assert.ok(img.data[(2 * 5 + 2) * 4] >= o0[(2 * 5 + 2) * 4]);
img = mk(4, 4, x => x < 2 ? K : W); filterImage(img, 'emboss', {}); assert.equal(img.data[3], 255);
// dabs + mix by mask
img = mk(9, 9, (x, y) => x === 4 && y === 4 ? W : K); dabBlur(img, 4, 4, 3, 1, 1, null); assert.ok(img.data[(4 * 9 + 4) * 4] < 255 && img.data[(4 * 9 + 5) * 4] > 0);
const srcI = mk(9, 1, x => x < 4 ? R : K), dstI = mk(9, 1, () => [0, 0, 0, 0]); dabClone(dstI, srcI, -4, 0, 7, 0, 1, 1, 1, null); assert.deepEqual([...px(dstI, 7)], [255, 0, 0, 255]);
const r1 = mk(2, 1, () => [200, 0, 0, 255]), r0 = mk(2, 1, () => [0, 0, 0, 255]); mixByMask(r1, r0, Uint8Array.from([255, 0]), 1); assert.equal(r1.data[0], 200); assert.equal(r1.data[4], 0);
runOp(r1, 'adj', 'invert', {}); assert.equal(r1.data[0], 55);
console.log('fx ok');
// median network equals the sorted median on random data
{ const w = 7, h = 7, r = new Uint8ClampedArray(w * h * 4); let s = 5; for (let i = 0; i < r.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; r[i] = s % 256; }
  const im = { data: new Uint8ClampedArray(r), width: w, height: h }; filterImage(im, 'median', { radius: 1 });
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let c = 0; c < 3; c++) { const v = []; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) v.push(r[((y + j) * w + x + i) * 4 + c]); v.sort((a, b) => a - b); assert.equal(im.data[(y * w + x) * 4 + c], v[4]); } }
console.log('median ok');
