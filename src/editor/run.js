// Runs an adjustment/filter on an ImageData copy in a worker (falls back to the main thread). Returns a Promise<ImageData>.
import { runOp } from './fx.js';
let worker = null, seq = 0, broken = false;
const pending = new Map();
function getWorker() {
  if (broken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p.resolve(e.data.buf); } };
    worker.onerror = () => { broken = true; worker = null; pending.forEach(p => p.reject(new Error('worker'))); pending.clear(); };
  } catch (_) { broken = true; }
  return worker;
}
export function runPixels(imageData, kind, name, params) {
  const w = getWorker(), { width, height } = imageData;
  const sync = () => { const img = { data: new Uint8ClampedArray(imageData.data), width, height }; runOp(img, kind, name, params); return new ImageData(img.data, width, height); };
  if (!w) return Promise.resolve(sync());
  const id = ++seq, copy = new Uint8ClampedArray(imageData.data);
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, kind, name, params, buf: copy.buffer, w: width, h: height }, [copy.buffer]); })
    .then(buf => new ImageData(new Uint8ClampedArray(buf), width, height))
    .catch(() => sync());
}
