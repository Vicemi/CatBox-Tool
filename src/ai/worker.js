// Worker de inferencia: nada de esto corre en el hilo de la interfaz.
import * as ort from 'onnxruntime-web/wasm';
import { byId } from './models.js';
import { cacheGet } from './cache.js';

ort.env.wasm.wasmPaths = { wasm: new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url).href };
ort.env.wasm.numThreads = 1; // shortcut: sin cabeceras COOP/COEP no hay SharedArrayBuffer; subir si la app pasa a estar aislada
ort.env.wasm.proxy = false;

let cur = { id: null, sess: null };
async function session(id) {
  if (cur.id === id) return cur.sess;
  if (cur.sess) { await cur.sess.release(); cur = { id: null, sess: null }; }
  const buf = await cacheGet(id);
  const sess = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  cur = { id, sess };
  return sess;
}

const hasAlpha = (d, n) => { for (let i = 3; i < n * 4; i += 4) if (d[i] !== 255) return true; return false; };

// Alfa: bilineal (los modelos solo ven RGB).
function scaleAlpha(src, w, h, out, W, H) {
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, Math.min(h - 1, (y + 0.5) * h / H - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.max(0, Math.min(w - 1, (x + 0.5) * w / W - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), wx = fx - x0;
      const a = src[(y0 * w + x0) * 4 + 3] * (1 - wx) + src[(y0 * w + x1) * 4 + 3] * wx;
      const b = src[(y1 * w + x0) * 4 + 3] * (1 - wx) + src[(y1 * w + x1) * 4 + 3] * wx;
      out[(y * W + x) * 4 + 3] = a * (1 - wy) + b * wy;
    }
  }
}

// waifu2x y Real-ESRGAN: teselas con solape (contexto `pad` a cada lado) → RAM acotada, progreso por tesela.
async function tiled(sess, rgba, w, h, p, crop, progress) {
  const { scale, pad, core } = p, T = core + 2 * pad, W = w * scale, H = h * scale;
  const out = new Uint8ClampedArray(W * H * 4);
  const nx = Math.ceil(w / core), ny = Math.ceil(h / core), total = nx * ny;
  const inName = sess.inputNames[0], outName = sess.outputNames[0];
  const inp = new Float32Array(3 * T * T), plane = T * T;
  for (let ty = 0, n = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++, n++) {
    const x0 = tx * core, y0 = ty * core;
    for (let yy = 0; yy < T; yy++) {
      const sy = Math.max(0, Math.min(h - 1, y0 - pad + yy));
      for (let xx = 0; xx < T; xx++) {
        const sx = Math.max(0, Math.min(w - 1, x0 - pad + xx)), s = (sy * w + sx) * 4, d = yy * T + xx;
        inp[d] = rgba[s] / 255; inp[plane + d] = rgba[s + 1] / 255; inp[2 * plane + d] = rgba[s + 2] / 255;
      }
    }
    const res = await sess.run({ [inName]: new ort.Tensor('float32', inp, [1, 3, T, T]) });
    const o = res[outName], od = o.data, oh = o.dims[2], ow = o.dims[3], op = oh * ow;
    const off = crop ? pad * scale : 0, cw = Math.min(core, w - x0) * scale, ch = Math.min(core, h - y0) * scale;
    for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
      const s = (yy + off) * ow + xx + off, d = ((y0 * scale + yy) * W + x0 * scale + xx) * 4;
      out[d] = od[s] * 255; out[d + 1] = od[op + s] * 255; out[d + 2] = od[2 * op + s] * 255; out[d + 3] = 255;
    }
    o.dispose();
    progress((n + 1) / total);
  }
  if (hasAlpha(rgba, w * h)) scaleAlpha(rgba, w, h, out, W, H);
  return { w: W, h: H, buf: out.buffer };
}

// U²-Netp: imagen completa a 320×320 → máscara → alfa.
async function u2net(sess, rgba, w, h, p, progress) {
  const S = p.size, oc = new OffscreenCanvas(w, h);
  oc.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  const sc = new OffscreenCanvas(S, S), sx = sc.getContext('2d', { willReadFrequently: true });
  sx.imageSmoothingQuality = 'high'; sx.drawImage(oc, 0, 0, S, S);
  const px = sx.getImageData(0, 0, S, S).data, inp = new Float32Array(3 * S * S), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) inp[c * S * S + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
  progress(0.1);
  const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, S, S]) });
  const o = res[sess.outputNames[0]], d = o.data;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < d.length; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  const mk = new ImageData(S, S), r = mx - mn || 1;
  for (let i = 0; i < S * S; i++) mk.data[i * 4 + 3] = (d[i] - mn) / r * 255;
  o.dispose();
  const mc = new OffscreenCanvas(S, S); mc.getContext('2d').putImageData(mk, 0, 0);
  const fc = new OffscreenCanvas(w, h), fx = fc.getContext('2d', { willReadFrequently: true });
  fx.imageSmoothingQuality = 'high'; fx.drawImage(mc, 0, 0, w, h);
  const m = fx.getImageData(0, 0, w, h).data, out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = rgba[i * 4 + 3] * m[i * 4 + 3] / 255;
  progress(1);
  return { w, h, buf: out.buffer };
}

self.onmessage = async e => {
  const { modelId, w, h } = e.data;
  try {
    const mod = byId(modelId), sess = await session(modelId), rgba = new Uint8ClampedArray(e.data.rgba);
    const progress = p => self.postMessage({ type: 'progress', p });
    const r = mod.engine === 'u2net' ? await u2net(sess, rgba, w, h, mod.params, progress) : await tiled(sess, rgba, w, h, mod.params, mod.engine === 'esrgan', progress);
    self.postMessage({ type: 'done', ...r }, [r.buf]);
  } catch (err) { self.postMessage({ type: 'error', message: String((err && err.message) || err) }); }
};
