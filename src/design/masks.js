// Máscaras de capa (píxeles, no destructivas): crear, pintar, invertir, rellenar, desde la forma de la cara, aplicar y eliminar.
// La máscara es un PNG en grises (blanco = visible, negro = oculto) del tamaño de la caja de la capa; drawLayer (layers.js) la aplica en 2D, 3D y PDF.
import { store } from '../state/store.js';
import { bboxOf, cacheMask, maskEntry } from './layers.js';

const MAXPX = 768, PPM = 8; // resolución: 8 px/mm con tope de 768 px en el lado largo (PNG compacto)
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const copyOf = c => { const o = mkCanvas(c.width, c.height); o.getContext('2d').drawImage(c, 0, 0); return o; };
export const maskSizeOf = l => { const b = bboxOf(l), k = Math.min(PPM, MAXPX / Math.max(b[2], b[3], 1e-3)); return [Math.max(8, Math.round(b[2] * k)), Math.max(8, Math.round(b[3] * k))]; };
const layerOf = id => store.get().layers.find(l => l.id === id);

// Guarda `grey` como máscara de la capa (copia en la caché para poder seguir pintando sobre el original).
function commit(id, grey) {
  const url = grey.toDataURL('image/png');
  cacheMask(url, copyOf(grey));
  store.set(st => ({ layers: st.layers.map(l => l.id === id ? { ...l, mask: { url, on: true }, heroPreset: undefined } : l) }));
}
const greyOf = (l, fill) => { const [w, h] = maskSizeOf(l), c = mkCanvas(w, h), g = c.getContext('2d'); g.fillStyle = fill; g.fillRect(0, 0, w, h); return c; };
const currentGrey = l => { const e = l.mask && maskEntry(l.mask.url); return e ? copyOf(e.grey) : greyOf(l, '#fff'); };

export const addMask = (id, white = true) => { const l = layerOf(id); if (l) commit(id, greyOf(l, white ? '#fff' : '#000')); };
export const fillMask = (id, white) => { const l = layerOf(id); if (l) commit(id, greyOf(l, white ? '#fff' : '#000')); };
export function invertMask(id) {
  const l = layerOf(id); if (!l || !l.mask) return;
  const c = currentGrey(l), g = c.getContext('2d'); g.globalCompositeOperation = 'difference'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  commit(id, c);
}
export const removeMask = id => store.set(st => ({ layers: st.layers.map(l => l.id === id ? { ...l, mask: undefined } : l) }));
export const toggleMask = id => store.set(st => ({ layers: st.layers.map(l => l.id === id && l.mask ? { ...l, mask: { ...l.mask, on: l.mask.on === false } } : l) }));

// Máscara con la forma de la cara (pts en mm): 'inset' = margen duro de 3 mm hacia dentro; 'soft' = degradado suave hacia el borde.
export function faceMask(id, pts, mode) {
  const l = layerOf(id); if (!l || !pts || pts.length < 3) return;
  const [mw, mh] = maskSizeOf(l), b = bboxOf(l), sx = mw / b[2], sy = mh / b[3], cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
  const base = mkCanvas(mw, mh), g = base.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, mw, mh);
  g.setTransform(sx, 0, 0, sy, 0, 0); g.translate(-b[0], -b[1]); g.translate(cx, cy); // mundo → píxeles de la máscara (deshace giro y volteo de la capa)
  if (l.flipX || l.flipY) g.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
  if (l.rot) g.rotate(-l.rot * Math.PI / 180);
  g.translate(-cx, -cy);
  g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath();
  g.fillStyle = '#fff'; g.fill();
  const inset = mode === 'soft' ? 1.5 : 3;
  g.lineJoin = 'miter'; g.strokeStyle = '#000'; g.lineWidth = inset * 2; g.stroke(); // el trazo negro centrado en el borde come `inset` mm hacia dentro
  let out = base;
  if (mode === 'soft') {
    out = mkCanvas(mw, mh); const og = out.getContext('2d');
    og.fillStyle = '#000'; og.fillRect(0, 0, mw, mh); // opaco: los bordes desenfocados no dejan alfa
    if ('filter' in og) { og.filter = 'blur(' + Math.max(1, 3 * sx) + 'px)'; }
    og.drawImage(base, 0, 0);
  }
  commit(id, out);
}

// Aplicar (solo imágenes): hornea la máscara en el alfa de la imagen y quita la máscara. Con recorte, conserva solo la zona visible.
export async function applyMask(id) {
  const l = layerOf(id); if (!l || l.kind !== 'image' || !l.img || !l.mask) return false;
  const e = maskEntry(l.mask.url); if (!e) return false;
  const cr = l.crop || [0, 0, 1, 1], iw = l.img.naturalWidth, ih = l.img.naturalHeight, sw = Math.max(1, Math.round(cr[2] * iw)), sh = Math.max(1, Math.round(cr[3] * ih));
  const c = mkCanvas(sw, sh), g = c.getContext('2d');
  g.drawImage(l.img, cr[0] * iw, cr[1] * ih, cr[2] * iw, cr[3] * ih, 0, 0, sw, sh);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(e.alpha, 0, 0, sw, sh);
  const url = c.toDataURL('image/png'), img = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  if (!img) return false;
  store.set(st => ({ layers: st.layers.map(x => x.id === id ? { ...x, imgSrc: url, img, imgW: sw, imgH: sh, pxw: sw, crop: undefined, mask: undefined, heroPreset: undefined } : x) }));
  return true;
}

// —— Pintado: un único lienzo de trabajo (gris + tinte rojo de vista previa) para la capa en edición ——
export const paint = { id: null, url: null, grey: null, tint: null, last: null, listeners: new Set() };
const ping = () => paint.listeners.forEach(f => f());
function sync(l) {
  if (!l.mask) return false;
  if (paint.id === l.id && paint.url === l.mask.url) return true;
  const e = maskEntry(l.mask.url); if (!e) return false;
  paint.id = l.id; paint.url = l.mask.url; paint.grey = copyOf(e.grey);
  const t = mkCanvas(e.grey.width, e.grey.height), tg = t.getContext('2d'), d = e.grey.getContext('2d').getImageData(0, 0, t.width, t.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) { px[i + 3] = 255 - px[i]; px[i] = 220; px[i + 1] = 40; px[i + 2] = 40; }
  tg.putImageData(d, 0, 0); paint.tint = t;
  return true;
}
export const syncPaint = sync;
// Punto del mundo (mm) → píxel de la máscara, deshaciendo giro y volteo de la capa.
function toPx(l, p, w, h) {
  const b = bboxOf(l), cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2, r = -(l.rot || 0) * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
  let x = p[0] - cx, y = p[1] - cy; [x, y] = [x * co - y * si, x * si + y * co];
  if (l.flipX) x = -x; if (l.flipY) y = -y;
  return [(x + b[2] / 2) / b[2] * w, (y + b[3] / 2) / b[3] * h];
}
function stamp(ctx, x, y, r, hard, rgb, erase) {
  ctx.save(); ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  const gr = ctx.createRadialGradient(x, y, Math.max(0, r * hard - 0.01), x, y, r);
  gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(1, 'rgba(' + rgb + ',' + (hard >= 0.999 ? 1 : 0) + ')');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
// brush = {size (mm), hard (0..1)}; reveal = pintar blanco (true) o negro (false).
export function paintAt(l, p, brush, reveal, first) {
  if (!sync(l)) return;
  const w = paint.grey.width, h = paint.grey.height, q = toPx(l, p, w, h), b = bboxOf(l), r = Math.max(0.6, brush.size / 2 * (w / b[2]));
  const from = first || !paint.last ? q : paint.last, dist = Math.hypot(q[0] - from[0], q[1] - from[1]), step = Math.max(1, r * 0.25), n = Math.max(1, Math.ceil(dist / step));
  const gg = paint.grey.getContext('2d'), tg = paint.tint.getContext('2d');
  for (let i = first ? 0 : 1; i <= n; i++) {
    const x = from[0] + (q[0] - from[0]) * i / n, y = from[1] + (q[1] - from[1]) * i / n;
    stamp(gg, x, y, r, brush.hard, reveal ? '255,255,255' : '0,0,0', false);
    stamp(tg, x, y, r, brush.hard, '220,40,40', reveal);
  }
  paint.last = q; ping();
}
export function paintEnd(id) {
  paint.last = null;
  if (paint.id !== id || !paint.grey) return;
  commit(id, paint.grey); paint.url = store.get().layers.find(x => x.id === id).mask.url; // el lienzo ya contiene el resultado
}
