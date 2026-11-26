// Pure pixel operations for the photo editor (selection masks, adjustments, filters, retouch dabs). No DOM: runs in a worker or in node tests.
// Images are {data: Uint8ClampedArray RGBA (non-premultiplied), width, height}. Selection masks are Uint8Array 0..255 of width*height.
import { blurMask, near } from './pixels.js';

// ───────── Selection masks ─────────
export const scaleMask = m => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) if (m[i]) o[i] = 255; return o; };
export const fullMask = (w, h) => new Uint8Array(w * h).fill(255);
export const maskFromAlpha = data => { const o = new Uint8Array(data.length >> 2); for (let i = 0; i < o.length; i++) o[i] = data[i * 4 + 3]; return o; };
export const maskCount = m => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i] > 127) n++; return n; };
export function invertMask(m) { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = 255 - m[i]; return o; }
// mode: new | add | sub | int. `a` is the current selection (or null).
export function combineMasks(a, b, mode) {
  if (!a || mode === 'new') return b;
  const o = new Uint8Array(a.length);
  for (let i = 0; i < o.length; i++) o[i] = mode === 'add' ? Math.max(a[i], b[i]) : mode === 'sub' ? Math.round(a[i] * (255 - b[i]) / 255) : Math.min(a[i], b[i]);
  return o;
}
export function featherMask(m, w, h, r) {
  if (r < 1) return m;
  const f = new Float32Array(m.length); for (let i = 0; i < f.length; i++) f[i] = m[i] / 255;
  const k = Math.max(1, Math.round(r / 1.7));
  const g = blurMask(blurMask(f, w, h, k), w, h, k);
  const o = new Uint8Array(m.length); for (let i = 0; i < o.length; i++) o[i] = Math.round(g[i] * 255);
  return o;
}
// Pixels on the boundary of the selected area (inside, with an outside 4-neighbour or at the image border).
export function maskEdges(m, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (m[p] < 128) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || m[p - 1] < 128 || m[p + 1] < 128 || m[p - w] < 128 || m[p + w] < 128) out.push(p);
  }
  return Int32Array.from(out);
}
// Non-contiguous color match: every pixel close to the seed color.
export function globalMask(img, sx, sy, tol) {
  const { data: d, width: w, height: h } = img, o = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return o;
  const s = (sy * w + sx) * 4, r = [d[s], d[s + 1], d[s + 2], d[s + 3]];
  for (let p = 0; p < o.length; p++) if (near(d, p * 4, r, tol)) o[p] = 1;
  return o;
}

// ───────── Compositing helpers ─────────
// Source-over of (r,g,b 0..255, a 0..1) on a non-premultiplied RGBA pixel.
export function over(d, i, r, g, b, a) {
  if (a <= 0) return;
  const da = d[i + 3] / 255, oa = a + da * (1 - a);
  if (oa <= 0) return;
  d[i] = (r * a + d[i] * da * (1 - a)) / oa; d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa; d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa; d[i + 3] = oa * 255;
}
// Fill a region (0/1 or 0..255) with rgba, limited by an optional selection and opacity 0..1.
export function fillRegion(img, region, rgba, sel, opacity = 1) {
  const d = img.data;
  for (let p = 0; p < region.length; p++) {
    if (!region[p]) continue;
    over(d, p * 4, rgba[0], rgba[1], rgba[2], (region[p] > 1 ? region[p] / 255 : 1) * (sel ? sel[p] / 255 : 1) * opacity * (rgba[3] / 255));
  }
}
// Linear / radial gradient from c0 to c1 ([r,g,b,a 0..255]) along (x0,y0)->(x1,y1).
export function fillGradient(img, kind, x0, y0, x1, y1, c0, c1, sel, opacity = 1) {
  const { data: d, width: w, height: h } = img, dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1, len = Math.sqrt(len2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, s = sel ? sel[p] / 255 : 1; if (!s) continue;
    let t = kind === 'radial' ? Math.hypot(x - x0, y - y0) / len : ((x - x0) * dx + (y - y0) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    over(d, p * 4, c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, (c0[3] + (c1[3] - c0[3]) * t) / 255 * s * opacity);
  }
}
// res = orig + (res - orig) * mask/255 * k, in place on res (applies an effect only where the mask is set).
export function mixByMask(res, orig, mask, k = 1) {
  const a = res.data, b = orig.data;
  for (let p = 0, n = a.length >> 2; p < n; p++) {
    const m = (mask ? mask[p] / 255 : 1) * k; if (m >= 1) continue;
    const i = p * 4; for (let c = 0; c < 4; c++) a[i + c] = b[i + c] + (a[i + c] - b[i + c]) * m;
  }
}

// ───────── Adjustments ─────────
const clamp8 = v => v < 0 ? 0 : v > 255 ? 255 : v;
const mkLut = f => { const l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = f(i); return l; };
function applyLut(d, lr, lg, lb) { for (let i = 0; i < d.length; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]]; } }
// Monotone cubic (Fritsch-Carlson) through points [[x,y]...] (0..255) -> 256-entry lookup table.
export function curveLut(pts) {
  const p = (pts && pts.length >= 2 ? pts : [[0, 0], [255, 255]]).slice().sort((a, b) => a[0] - b[0]), n = p.length;
  const dx = [], m = [], tg = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0] || 1e-6; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  tg[0] = m[0]; tg[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) tg[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { tg[i] = tg[i + 1] = 0; continue; }
    const a = tg[i] / m[i], b = tg[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); tg[i] = k * a * m[i]; tg[i + 1] = k * b * m[i]; }
  }
  return mkLut(x => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0; while (x > p[i + 1][0]) i++;
    const h = dx[i], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return clamp8((2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * tg[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * tg[i + 1]);
  });
}
const toHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const hue2 = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
const fromHsl = (h, s, l) => {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, k = h / 360;
  return [hue2(p, q, k + 1 / 3) * 255, hue2(p, q, k) * 255, hue2(p, q, k - 1 / 3) * 255];
};

const flat = () => [[0, 0], [255, 255]];
export const ADJ_DEFAULTS = {
  bc: { brightness: 0, contrast: 0 },
  levels: { inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 },
  curves: { ch: 'm', pts: { m: flat(), r: flat(), g: flat(), b: flat() } },
  hsl: { hue: 0, sat: 0, light: 0 },
  balance: { s: [0, 0, 0], m: [0, 0, 0], h: [0, 0, 0], range: 'm' },
  vibrance: { vibrance: 0, sat: 0 },
  exposure: { ev: 0, offset: 0, gamma: 1 },
  bw: { r: 30, g: 59, b: 11 },
  invert: {},
  threshold: { level: 128 },
  posterize: { levels: 4 }
};
export const freshAdj = op => JSON.parse(JSON.stringify(ADJ_DEFAULTS[op] || {}));

export function adjustImage(img, op, p = {}) {
  const d = img.data, q = { ...ADJ_DEFAULTS[op], ...p };
  if (op === 'bc') {
    const f = Math.pow((100 + q.contrast) / 100, 2), add = q.brightness * 2.55, l = mkLut(v => (v - 128) * f + 128 + add);
    applyLut(d, l, l, l);
  } else if (op === 'levels') {
    const span = Math.max(1, q.inW - q.inB), g = 1 / Math.max(0.05, q.gamma);
    const l = mkLut(v => q.outB + Math.pow(Math.min(1, Math.max(0, (v - q.inB) / span)), g) * (q.outW - q.outB));
    applyLut(d, l, l, l);
  } else if (op === 'curves') {
    const m = curveLut(q.pts.m), r = curveLut(q.pts.r), g = curveLut(q.pts.g), b = curveLut(q.pts.b);
    applyLut(d, mkLut(v => r[m[v]]), mkLut(v => g[m[v]]), mkLut(v => b[m[v]]));
  } else if (op === 'hsl') {
    if (!q.hue && !q.sat && !q.light) return;
    const sk = 1 + q.sat / 100;
    for (let i = 0; i < d.length; i += 4) {
      let [h, s, l] = toHsl(d[i], d[i + 1], d[i + 2]);
      h = (h + q.hue + 360) % 360; s = Math.min(1, Math.max(0, s * sk));
      l = q.light > 0 ? l + (1 - l) * q.light / 100 : l + l * q.light / 100;
      const c = fromHsl(h, s, l); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
  } else if (op === 'balance') {
    for (let i = 0; i < d.length; i += 4) {
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255, ws = (1 - lum) * (1 - lum), wh = lum * lum, wm = Math.max(0, 1 - ws - wh);
      for (let c = 0; c < 3; c++) d[i + c] = clamp8(d[i + c] + (q.s[c] * ws + q.m[c] * wm + q.h[c] * wh) * 1.28);
    }
  } else if (op === 'vibrance') {
    const v = q.vibrance / 100, sa = q.sat / 100;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
      const k = (v >= 0 ? v * (1 - (mx - mn) / 255) : v) + sa;
      for (let c = 0; c < 3; c++) d[i + c] = clamp8(avg + (d[i + c] - avg) * (1 + k));
    }
  } else if (op === 'exposure') {
    const m = Math.pow(2, q.ev), g = 1 / Math.max(0.05, q.gamma), l = mkLut(v => Math.pow(Math.min(1, Math.max(0, v / 255 * m + q.offset)), g) * 255);
    applyLut(d, l, l, l);
  } else if (op === 'bw') {
    const t = (q.r + q.g + q.b) || 1;
    for (let i = 0; i < d.length; i += 4) { const y = (d[i] * q.r + d[i + 1] * q.g + d[i + 2] * q.b) / t; d[i] = d[i + 1] = d[i + 2] = y; }
  } else if (op === 'invert') {
    for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
  } else if (op === 'threshold') {
    for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] >= q.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = y; }
  } else if (op === 'posterize') {
    const n = Math.max(2, Math.round(q.levels)), l = mkLut(v => Math.round(Math.round(v / 255 * (n - 1)) / (n - 1) * 255));
    applyLut(d, l, l, l);
  }
}

// ───────── Filters ─────────
const boxesFor = (sigma, n) => {
  const wi = Math.sqrt(12 * sigma * sigma / n + 1); let wl = Math.floor(wi); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)), out = [];
  for (let i = 0; i < n; i++) out.push(((i < m ? wl : wu) - 1) >> 1);
  return out;
};
function boxH(s, o, w, h, r) {
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4; let a = 0, b = 0, c = 0, e = 0;
    for (let i = -r; i <= r; i++) { const p = row + Math.min(w - 1, Math.max(0, i)) * 4; a += s[p]; b += s[p + 1]; c += s[p + 2]; e += s[p + 3]; }
    for (let x = 0; x < w; x++) {
      const p = row + x * 4; o[p] = a / n; o[p + 1] = b / n; o[p + 2] = c / n; o[p + 3] = e / n;
      const u = row + Math.min(w - 1, x + r + 1) * 4, v = row + Math.max(0, x - r) * 4;
      a += s[u] - s[v]; b += s[u + 1] - s[v + 1]; c += s[u + 2] - s[v + 2]; e += s[u + 3] - s[v + 3];
    }
  }
}
function boxV(s, o, w, h, r) {
  const n = 2 * r + 1, st = w * 4;
  for (let x = 0; x < w; x++) {
    const col = x * 4; let a = 0, b = 0, c = 0, e = 0;
    for (let i = -r; i <= r; i++) { const p = col + Math.min(h - 1, Math.max(0, i)) * st; a += s[p]; b += s[p + 1]; c += s[p + 2]; e += s[p + 3]; }
    for (let y = 0; y < h; y++) {
      const p = col + y * st; o[p] = a / n; o[p + 1] = b / n; o[p + 2] = c / n; o[p + 3] = e / n;
      const u = col + Math.min(h - 1, y + r + 1) * st, v = col + Math.max(0, y - r) * st;
      a += s[u] - s[v]; b += s[u + 1] - s[v + 1]; c += s[u + 2] - s[v + 2]; e += s[u + 3] - s[v + 3];
    }
  }
}
// Gaussian blur (3 box passes) on premultiplied alpha, in place.
export function gaussBlur(img, sigma) {
  if (sigma < 0.3) return;
  const { data: d, width: w, height: h } = img, n = d.length;
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i += 4) { const k = d[i + 3] / 255; a[i] = d[i] * k; a[i + 1] = d[i + 1] * k; a[i + 2] = d[i + 2] * k; a[i + 3] = d[i + 3]; }
  for (const r of boxesFor(sigma, 3)) { const rr = Math.max(1, r); boxH(a, b, w, h, rr); boxV(b, a, w, h, rr); }
  for (let i = 0; i < n; i += 4) { const al = a[i + 3], k = al > 0 ? 255 / al : 0; d[i] = a[i] * k; d[i + 1] = a[i + 1] * k; d[i + 2] = a[i + 2] * k; d[i + 3] = al; }
}
export function unsharp(img, amount, radius, threshold = 0) {
  const o = new Uint8ClampedArray(img.data), b = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  gaussBlur(b, radius);
  const d = img.data, k = amount / 100;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { const df = o[i + c] - b.data[i + c]; d[i + c] = Math.abs(df) >= threshold ? clamp8(o[i + c] + df * k) : o[i + c]; }
}
const rng = seed => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
export function addNoise(img, amount, mono = true, seed = 12345) {
  const d = img.data, r = rng(seed), a = amount * 2.55;
  for (let i = 0; i < d.length; i += 4) {
    if (mono) { const n = (r() + r() + r() - 1.5) * a; d[i] = clamp8(d[i] + n); d[i + 1] = clamp8(d[i + 1] + n); d[i + 2] = clamp8(d[i + 2] + n); }
    else for (let c = 0; c < 3; c++) d[i + c] = clamp8(d[i + c] + (r() + r() + r() - 1.5) * a);
  }
}
const NET9 = [1, 2, 4, 5, 7, 8, 0, 1, 3, 4, 6, 7, 1, 2, 4, 5, 7, 8, 0, 3, 5, 8, 4, 7, 3, 6, 1, 4, 2, 5, 4, 7, 4, 2, 6, 4, 4, 2]; // pairs (Paeth median-of-9 network)
export function median(img, radius) {
  const { data: d, width: w, height: h } = img, src = new Uint8ClampedArray(d), r = Math.max(1, Math.min(3, Math.round(radius)));
  if (r === 1) {
    const p = new Uint8Array(9);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1) * w, y1 = y * w, y2 = Math.min(h - 1, y + 1) * w;
      for (let x = 0; x < w; x++) {
        const xa = Math.max(0, x - 1), xc = Math.min(w - 1, x + 1);
        for (let c = 0; c < 3; c++) {
          p[0] = src[(y0 + xa) * 4 + c]; p[1] = src[(y0 + x) * 4 + c]; p[2] = src[(y0 + xc) * 4 + c]; p[3] = src[(y1 + xa) * 4 + c]; p[4] = src[(y1 + x) * 4 + c]; p[5] = src[(y1 + xc) * 4 + c]; p[6] = src[(y2 + xa) * 4 + c]; p[7] = src[(y2 + x) * 4 + c]; p[8] = src[(y2 + xc) * 4 + c];
          for (let k = 0; k < NET9.length; k += 2) { const i = NET9[k], j = NET9[k + 1]; if (p[i] > p[j]) { const t = p[i]; p[i] = p[j]; p[j] = t; } }
          d[(y1 + x) * 4 + c] = p[4];
        }
      }
    }
    return;
  }
  const win = new Uint8Array((2 * r + 1) * (2 * r + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let n = 0;
    for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r); j++) for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) {
      const v = src[(j * w + i) * 4 + c]; let k = n++; while (k > 0 && win[k - 1] > v) { win[k] = win[k - 1]; k--; } win[k] = v;
    }
    d[(y * w + x) * 4 + c] = win[n >> 1];
  }
}
export function pixelate(img, size) {
  const { data: d, width: w, height: h } = img, s = Math.max(2, Math.round(size));
  for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) {
    let r = 0, g = 0, b = 0, a = 0, n = 0; const ye = Math.min(h, by + s), xe = Math.min(w, bx + s);
    for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n++; }
    r /= n; g /= n; b /= n; a /= n;
    for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
  }
}
export function emboss(img, angle = 135, height = 3) {
  const { data: d, width: w, height: h } = img, src = new Uint8ClampedArray(d), a = angle * Math.PI / 180, ox = Math.round(Math.cos(a)), oy = -Math.round(Math.sin(a));
  const lum = (x, y) => { x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y)); const i = (y * w + x) * 4; return 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = clamp8(128 + (lum(x + ox, y + oy) - lum(x - ox, y - oy)) * height), i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; }
}
// amount -100..100 (negative darkens the edges), size 0..100 (clear center), feather 0..100.
export function vignette(img, amount, size = 50, feather = 50) {
  const { data: d, width: w, height: h } = img, cx = (w - 1) / 2, cy = (h - 1) / 2, rmax = Math.hypot(cx, cy) || 1, k = amount / 100;
  const r0 = size / 100 * 0.9, span = Math.max(0.05, feather / 100);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t = (Math.hypot(x - cx, y - cy) / rmax - r0) / span; t = t < 0 ? 0 : t > 1 ? 1 : t; t = t * t * (3 - 2 * t);
    if (!t) continue;
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) d[i + c] = k < 0 ? d[i + c] * (1 + k * t) : d[i + c] + (255 - d[i + c]) * k * t;
  }
}
export function filterImage(img, name, p = {}) {
  if (name === 'blur') gaussBlur(img, p.radius ?? 4);
  else if (name === 'unsharp') unsharp(img, p.amount ?? 120, p.radius ?? 2, p.threshold ?? 0);
  else if (name === 'noise') addNoise(img, p.amount ?? 20, p.mono !== false, p.seed);
  else if (name === 'median') median(img, p.radius ?? 1);
  else if (name === 'pixelate') pixelate(img, p.size ?? 10);
  else if (name === 'emboss') emboss(img, p.angle ?? 135, p.height ?? 3);
  else if (name === 'vignette') vignette(img, p.amount ?? -60, p.size ?? 50, p.feather ?? 50);
}
// Entry used by the worker and the main thread. kind: 'adj' | 'fx'.
export const runOp = (img, kind, name, params) => (kind === 'adj' ? adjustImage(img, name, params) : filterImage(img, name, params));

// ───────── Retouch dabs on a layer ImageData ─────────
const fall = (dist, r, hard) => { if (dist >= r) return 0; const u = dist / r; return u <= hard ? 1 : 1 - (u - hard) / (1 - hard + 1e-6); };
function eachPx(img, cx, cy, r, hard, sel, fn) {
  const { width: w, height: h } = img, x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let f = fall(Math.hypot(x - cx, y - cy), r, hard); if (f <= 0) continue;
    if (sel) f *= sel[y * w + x] / 255;
    if (f > 0) fn(x, y, f, (y * w + x) * 4);
  }
}
const avg3 = (d, w, h, x, y, c) => { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += d[(Math.min(h - 1, Math.max(0, y + j)) * w + Math.min(w - 1, Math.max(0, x + i))) * 4 + c]; return s / 9; };
export function dabBlur(img, cx, cy, r, hard, strength, sel) {
  const d = img.data, w = img.width, h = img.height, upd = [];
  eachPx(img, cx, cy, r, hard, sel, (x, y, f, i) => upd.push(i, f * strength, avg3(d, w, h, x, y, 0), avg3(d, w, h, x, y, 1), avg3(d, w, h, x, y, 2), avg3(d, w, h, x, y, 3)));
  for (let u = 0; u < upd.length; u += 6) { const i = upd[u], k = upd[u + 1]; for (let c = 0; c < 4; c++) d[i + c] += (upd[u + 2 + c] - d[i + c]) * k; }
}
export function dabSharpen(img, cx, cy, r, hard, strength, sel) {
  const d = img.data, w = img.width, h = img.height, upd = [];
  eachPx(img, cx, cy, r, hard, sel, (x, y, f, i) => upd.push(i, f * strength * 1.5, avg3(d, w, h, x, y, 0), avg3(d, w, h, x, y, 1), avg3(d, w, h, x, y, 2)));
  for (let u = 0; u < upd.length; u += 5) { const i = upd[u], k = upd[u + 1]; for (let c = 0; c < 3; c++) d[i + c] = clamp8(d[i + c] + (d[i + c] - upd[u + 2 + c]) * k); }
}
// Smudge drags a carried patch (Float32 RGBA, side 2r+1) along the stroke.
export const newCarry = (img, cx, cy, r) => {
  const side = Math.ceil(r) * 2 + 1, v = new Float32Array(side * side * 4), rad = side >> 1;
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    const x = Math.round(cx) - rad + i, y = Math.round(cy) - rad + j; if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const s = (y * img.width + x) * 4; for (let c = 0; c < 4; c++) v[(j * side + i) * 4 + c] = img.data[s + c];
  }
  return { side, v };
};
export function dabSmudge(img, carry, cx, cy, r, hard, strength, sel) {
  const d = img.data, side = carry.side, rad = side >> 1;
  eachPx(img, cx, cy, r, hard, sel, (x, y, f, i) => {
    const px = Math.round(x - cx) + rad, py = Math.round(y - cy) + rad; if (px < 0 || py < 0 || px >= side || py >= side) return;
    const t = (py * side + px) * 4, k = f * strength;
    for (let c = 0; c < 4; c++) d[i + c] += (carry.v[t + c] - d[i + c]) * k;
  });
  const keep = 1 - Math.min(0.95, strength * 0.9);
  for (let j = 0; j < side; j++) for (let i2 = 0; i2 < side; i2++) {
    const x = Math.round(cx) - rad + i2, y = Math.round(cy) - rad + j; if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const t = (j * side + i2) * 4, s = (y * img.width + x) * 4; for (let c = 0; c < 4; c++) carry.v[t + c] = carry.v[t + c] * keep + d[s + c] * (1 - keep);
  }
}
export function dabTone(img, cx, cy, r, hard, strength, mode, sel) {
  const d = img.data;
  eachPx(img, cx, cy, r, hard, sel, (x, y, f, i) => {
    const k = f * strength * 0.5;
    for (let c = 0; c < 3; c++) d[i + c] = mode === 'dodge' ? d[i + c] + (255 - d[i + c]) * k : d[i + c] * (1 - k);
  });
}
// Copies the snapshot `src` shifted by (ox,oy) into the dab.
export function dabClone(img, src, ox, oy, cx, cy, r, hard, strength, sel) {
  const d = img.data, w = img.width, h = img.height;
  eachPx(img, cx, cy, r, hard, sel, (x, y, f, i) => {
    const sx = Math.round(x + ox), sy = Math.round(y + oy); if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    const s = (sy * w + sx) * 4;
    over(d, i, src.data[s], src.data[s + 1], src.data[s + 2], src.data[s + 3] / 255 * f * strength);
  });
}
