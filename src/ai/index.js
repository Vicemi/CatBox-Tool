// Módulos IA descargables: catálogo, instalación (Cache Storage) y ejecución en un Web Worker.
import { MODELS, byId } from './models.js';
import { cacheHas, cachePut, cacheDelete } from './cache.js';
import { t } from '../i18n/index.js';

export { MODELS };
export const MAX_OUT_PIXELS = 64e6; // 8000×8000: tope para no agotar la RAM con el resultado
const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(f => f());

export const isInstalled = id => cacheHas(id, byId(id).sizeBytes);

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function install(id, onProgress, signal) {
  const m = byId(id);
  const res = await fetch(m.url, { signal });
  if (!res.ok) throw new Error(t('No se pudo descargar el módulo (HTTP {n})', { n: res.status }));
  const reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (onProgress) onProgress(Math.min(1, got / m.sizeBytes));
  }
  const blob = new Blob(chunks);
  if (blob.size !== m.sizeBytes) throw new Error(t('Descarga incompleta o dañada ({a} de {b} bytes)', { a: blob.size, b: m.sizeBytes }));
  if (m.sha256 && globalThis.crypto && crypto.subtle) {
    if (hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())) !== m.sha256) throw new Error(t('La suma de comprobación del módulo no coincide'));
  }
  await cachePut(id, blob);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) { /* opcional */ }
  if (onProgress) onProgress(1);
  emit();
}

export async function uninstall(id) { await cacheDelete(id); emit(); }
// --- ejecución: pool de workers (cada uno con su instancia wasm, sin SharedArrayBuffer) ---
let pool = [], idle = 0, chain = Promise.resolve();
const kill = () => { pool.forEach(w => w.terminate()); pool = []; };
const poolSize = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
const getPool = n => { while (pool.length < n) pool.push(new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })); return pool.slice(0, n); };

function toRGBA(src) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  if (!w || !h) throw new Error(t('Imagen vacía'));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0);
  return { w, h, rgba: x.getImageData(0, 0, w, h).data };
}

// opts.signal (AbortSignal) cancela: se terminan los workers al instante.
export function run(id, source, opts = {}, onProgress) {
  const job = chain.then(() => runNow(id, source, opts, onProgress));
  chain = job.catch(() => {});
  return job;
}

const send = (wk, msg, tr, onP) => new Promise((resolve, reject) => {
  wk.onmessage = ev => { const d = ev.data; if (d.type === 'progress') onP(d.p); else if (d.type === 'done') resolve(d); else reject(new Error(d.message)); };
  wk.onerror = ev => reject(new Error(ev.message || 'Worker error'));
  wk.postMessage(msg, tr);
});

async function runNow(id, source, opts, onProgress) {
  const m = byId(id), signal = opts.signal;
  if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!(await isInstalled(id))) throw new Error(t('Módulo no instalado: {n}', { n: m.name }));
  const { w, h, rgba } = toRGBA(source), k = m.scale || 1, P = m.params;
  if (w * h * k * k > MAX_OUT_PIXELS) throw new Error(t('La imagen resultante sería demasiado grande ({w}×{h}). Reduce la imagen o usa un módulo ×2.', { w: w * k, h: h * k }));
  clearTimeout(idle);
  // Bandas horizontales (múltiplos del tamaño de tesela + contexto real arriba/abajo), una por worker.
  const rowsPerTile = P.core || h, tiles = Math.ceil(h / rowsPerTile);
  const n = m.engine === 'u2net' ? 1 : Math.min(poolSize(), tiles);
  const per = Math.ceil(tiles / n) * rowsPerTile, bands = [];
  for (let r0 = 0; r0 < h; r0 += per) bands.push([r0, Math.min(h, r0 + per)]);
  const wks = getPool(bands.length), prog = bands.map(() => 0);
  let abort;
  const aborted = new Promise((_, rej) => { abort = () => { kill(); rej(new DOMException('Aborted', 'AbortError')); }; });
  aborted.catch(() => {});
  if (signal) signal.addEventListener('abort', abort, { once: true });
  const out = new Uint8ClampedArray(w * k * h * k * 4);
  try {
    await Promise.race([aborted, Promise.all(bands.map(async ([r0, r1], i) => {
      const pad = bands.length > 1 ? P.pad : 0, c0 = Math.max(0, r0 - pad), c1 = Math.min(h, r1 + pad);
      const part = bands.length > 1 ? rgba.slice(c0 * w * 4, c1 * w * 4) : rgba;
      const d = await send(wks[i], { modelId: id, w, h: c1 - c0, rgba: part.buffer }, [part.buffer], p => { prog[i] = p; if (onProgress) onProgress(prog.reduce((a, b) => a + b, 0) / prog.length); });
      const src = new Uint8ClampedArray(d.buf), W4 = w * k * 4;
      out.set(src.subarray((r0 - c0) * k * W4, (r0 - c0) * k * W4 + (r1 - r0) * k * W4), r0 * k * W4);
    }))]);
  } catch (e) {
    kill();
    throw e;
  }
  if (signal) signal.removeEventListener('abort', abort);
  idle = setTimeout(kill, 60000); // libera la memoria wasm si no se usa
  const c = document.createElement('canvas'); c.width = w * k; c.height = h * k;
  c.getContext('2d').putImageData(new ImageData(out, w * k, h * k), 0, 0);
  return c;
}
