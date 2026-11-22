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
