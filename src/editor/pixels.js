// Pure pixel helpers on ImageData-like objects {data, width, height} (RGBA). No DOM.

export const near = (d, i, r, tol) => Math.max(Math.abs(d[i] - r[0]), Math.abs(d[i + 1] - r[1]), Math.abs(d[i + 2] - r[2]), Math.abs(d[i + 3] - r[3])) <= tol;

// Flood from seed pixel indices; a pixel joins when within tol (0..255, per channel) of the reference color.
function grow(img, seeds, ref, tol) {
  const { data: d, width: w, height: h } = img;
  const mask = new Uint8Array(w * h), stack = [];
  for (const s of seeds) if (!mask[s] && near(d, s * 4, ref, tol)) { mask[s] = 1; stack.push(s); }
  while (stack.length) {
    const p = stack.pop(), x = p % w, y = (p - x) / w;
    const go = q => { if (!mask[q] && near(d, q * 4, ref, tol)) { mask[q] = 1; stack.push(q); } };
    if (x > 0) go(p - 1);
    if (x < w - 1) go(p + 1);
    if (y > 0) go(p - w);
    if (y < h - 1) go(p + w);
  }
  return mask;
}

// Contiguous region around (sx,sy) matching the seed color (magic wand / bucket).
export function floodMask(img, sx, sy, tol) {
  const { data: d, width: w, height: h } = img;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return new Uint8Array(w * h);
  const s = sy * w + sx;
  return grow(img, [s], [d[s * 4], d[s * 4 + 1], d[s * 4 + 2], d[s * 4 + 3]], tol);
}

// Box blur of a 0/1 mask (separable, running sums) -> Float32 0..1.
export function blurMask(mask, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const pass = (src, dst, len, lines, at) => {
    for (let l = 0; l < lines; l++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[at(l, Math.min(len - 1, Math.max(0, i)))];
      for (let i = 0; i < len; i++) {
        dst[at(l, i)] = sum / (2 * r + 1);
        sum += src[at(l, Math.min(len - 1, i + r + 1))] - src[at(l, Math.max(0, i - r))];
      }
    }
  };
  pass(mask, tmp, w, h, (l, i) => l * w + i);
  pass(tmp, out, h, w, (l, i) => i * w + l);
  return out;
}

// Remove the background: flood from border pixels close to the average corner color, then feather outward.
// Mutates img.data; returns the number of pixels removed.
export function removeBackground(img, tol, feather = 0) {
  const { data: d, width: w, height: h } = img;
  const cs = [0, w - 1, (h - 1) * w, h * w - 1], ref = [0, 0, 0, 0];
  for (const c of cs) for (let k = 0; k < 4; k++) ref[k] += d[c * 4 + k] / 4;
  const seeds = [];
  for (let x = 0; x < w; x++) seeds.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) seeds.push(y * w, y * w + w - 1);
  const mask = grow(img, seeds, ref, tol);
  const soft = feather > 0 ? blurMask(mask, w, h, Math.round(feather)) : null;
  let n = 0;
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue;
    n++;
    d[p * 4 + 3] = soft ? Math.round(d[p * 4 + 3] * (1 - Math.min(1, soft[p] * 1))) : 0;
  }
  return n;
}

export function clearMask(img, mask) {
  for (let p = 0; p < mask.length; p++) if (mask[p]) img.data[p * 4 + 3] = 0;
}

export function fillMask(img, mask, rgba) {
  for (let p = 0; p < mask.length; p++) if (mask[p]) for (let k = 0; k < 4; k++) img.data[p * 4 + k] = rgba[k];
}

export function maskBounds(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let p = 0; p < mask.length; p++) if (mask[p]) { const x = p % w, y = (p - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

export const hexToRgba = hex => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; };
