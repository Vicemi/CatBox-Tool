// Editor document model. Layers are canvases with a transform (x,y,rot,sx,sy around the center), optional pixel mask, effects
// and non-destructive adjustment layers (kind 'adjust'). Selection masks are Uint8Array 0..255 of document size.
import { adjustImage, mixByMask, maskFromAlpha } from './fx.js';

export const MAX_PX = 4096; // enough for 300 dpi on faces up to ~34 cm
export const BLENDS = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
export const BLEND_ES = { 'source-over': 'Normal', multiply: 'Multiplicar', screen: 'Trama', overlay: 'Superponer', darken: 'Oscurecer', lighten: 'Aclarar', 'color-dodge': 'Sobreexponer color', 'color-burn': 'Subexponer color', 'hard-light': 'Luz fuerte', 'soft-light': 'Luz suave', difference: 'Diferencia', exclusion: 'Exclusión', hue: 'Tono', saturation: 'Saturación', color: 'Color', luminosity: 'Luminosidad' };
const HIST_CAP = 40;
let uid = 1, gver = 0;

export const inval = () => { gver++; };       // any visual change: the editor re-renders the composite when this moves
export const docVer = () => gver;
export const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
export const cloneCanvas = c => { const n = mkCanvas(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; };

export const newLayer = (name, canvas, o = {}) => ({
  id: uid++, kind: 'pixel', name, canvas, x: 0, y: 0, rot: 0, sx: 1, sy: 1, opacity: 1, fill: 1, blend: 'source-over', visible: true, locked: false,
  mask: null, maskOn: true, fx: null, adj: null, dirty: true, snap: null, mdirty: true, msnap: null, ver: 0, mver: 0, pv: null, mpv: null, ...o
});
export const newAdjLayer = (name, op, params, o = {}) => newLayer(name, mkCanvas(1, 1), { kind: 'adjust', adj: { op, params }, ...o });
export const isAdj = l => !!l && l.kind === 'adjust';
export const newDoc = (w, h) => ({ w, h, layers: [], activeId: null, sel: null, hist: [], hi: -1, editMask: false });
export const activeOf = doc => doc.layers.find(l => l.id === doc.activeId) || null;
export const touch = l => { l.dirty = true; l.ver++; gver++; };
export const touchMask = l => { l.mdirty = true; l.mver++; l._ma = null; gver++; };
const identity = l => !l.x && !l.y && !l.rot && l.sx === 1 && l.sy === 1;

export function applyTransform(ctx, l) {
  const cw = l.canvas.width, ch = l.canvas.height;
  ctx.translate(l.x + cw / 2, l.y + ch / 2); ctx.rotate(l.rot * Math.PI / 180); ctx.scale(l.sx, l.sy); ctx.translate(-cw / 2, -ch / 2);
}

// Rasterize the transform so pixel tools work in document coordinates (layer canvas = document size).
export function ensureBaked(doc, l) {
  if (l.canvas.width === doc.w && l.canvas.height === doc.h && identity(l)) return l.canvas.getContext('2d');
  const nc = mkCanvas(doc.w, doc.h), ctx = nc.getContext('2d');
  ctx.save(); applyTransform(ctx, l); ctx.drawImage(l.canvas, 0, 0); ctx.restore();
  Object.assign(l, { canvas: nc, x: 0, y: 0, rot: 0, sx: 1, sy: 1 }); touch(l);
  return ctx;
}

// ── selection <-> canvas ──
export function maskToCanvas(mask, w, h) {
  const c = mkCanvas(w, h), id = new ImageData(w, h), d = id.data;
  for (let i = 0; i < mask.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = mask[i]; }
  c.getContext('2d').putImageData(id, 0, 0); return c;
}
export const canvasToMask = c => maskFromAlpha(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
// Alpha of a layer mask as a typed array (cached per mask version).
export function maskAlpha(l, w, h) {
  const m = l.mpv || l.mask; if (!m) return null;
  if (!l.mpv && l._ma) return l._ma;
  const a = canvasToMask(m); if (!l.mpv) l._ma = a;
  return a;
}

// ── rendering ──
const pool = [];
const tmpCanvas = (i, w, h) => { let c = pool[i]; if (!c) c = pool[i] = mkCanvas(w, h); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.shadowColor = 'rgba(0,0,0,0)'; x.shadowBlur = 0; x.shadowOffsetX = x.shadowOffsetY = 0; x.clearRect(0, 0, w, h); return c; };
const rgba = (hex, a) => { const n = parseInt(hex.replace('#', ''), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

function drawPixelLayer(ctx, doc, l) {
  const src = l.pv || l.canvas, mk = l.maskOn !== false ? (l.mpv || l.mask) : null, sh = l.fx && l.fx.shadow && l.fx.shadow.on ? l.fx.shadow : null;
  if (!mk && !sh) {
    if (!l.fill) return;
    ctx.save(); ctx.globalAlpha = l.opacity * l.fill; ctx.globalCompositeOperation = l.blend; applyTransform(ctx, l); ctx.drawImage(src, 0, 0); ctx.restore();
    return;
  }
  const t = tmpCanvas(0, doc.w, doc.h), tc = t.getContext('2d');
  tc.save(); applyTransform(tc, { ...l, canvas: src }); tc.drawImage(src, 0, 0); tc.restore();
  if (mk) { tc.globalCompositeOperation = 'destination-in'; tc.drawImage(mk, 0, 0); tc.globalCompositeOperation = 'source-over'; }
  ctx.save(); ctx.globalCompositeOperation = l.blend;
  if (sh) {
    const s = tmpCanvas(1, doc.w, doc.h), sc = s.getContext('2d'), off = doc.w * 2 + 1000;
    sc.shadowColor = rgba(sh.color || '#000000', 1); sc.shadowBlur = sh.blur; sc.shadowOffsetX = sh.x + off; sc.shadowOffsetY = sh.y; sc.drawImage(t, -off, 0);
    ctx.globalAlpha = l.opacity * sh.opacity; ctx.drawImage(s, 0, 0);
  }
  if (l.fill) { ctx.globalAlpha = l.opacity * l.fill; ctx.drawImage(t, 0, 0); }
  ctx.restore();
}
function drawAdjLayer(ctx, doc, l) {
  const { w, h } = doc, orig = ctx.getImageData(0, 0, w, h), res = new ImageData(new Uint8ClampedArray(orig.data), w, h);
  adjustImage(res, l.adj.op, l.adj.params);
  const mk = l.maskOn !== false ? maskAlpha(l, w, h) : null, k = l.opacity;
  if (mk || k < 1) mixByMask(res, orig, mk, k);
  ctx.putImageData(res, 0, 0);
}
export function render(doc, ctx) {
  ctx.clearRect(0, 0, doc.w, doc.h);
  for (const l of doc.layers) {
    if (!l.visible) continue;
    if (l.kind === 'adjust') drawAdjLayer(ctx, doc, l); else drawPixelLayer(ctx, doc, l);
  }
}
export function flatten(doc) { const c = mkCanvas(doc.w, doc.h); render(doc, c.getContext('2d')); return c; }
const renderSome = (doc, layers) => { const c = mkCanvas(doc.w, doc.h); render({ w: doc.w, h: doc.h, layers: layers.map(l => ({ ...l, visible: true })) }, c.getContext('2d')); return c; };

// ── layer operations ──
export function mergeDown(doc) {
  const i = doc.layers.findIndex(l => l.id === doc.activeId); if (i < 1) return false;
  const lo = doc.layers[i - 1], up = doc.layers[i]; if (isAdj(lo)) return false;
  const nc = renderSome(doc, [lo, up]);
  Object.assign(lo, { canvas: nc, x: 0, y: 0, rot: 0, sx: 1, sy: 1, opacity: 1, fill: 1, blend: 'source-over', visible: true, mask: null, fx: null }); touch(lo); touchMask(lo);
  doc.layers.splice(i, 1); doc.activeId = lo.id; return true;
}
export function mergeVisible(doc) {
  const vis = doc.layers.filter(l => l.visible); if (vis.length < 2) return false;
  const nl = newLayer('Combinada', renderSome(doc, vis)), top = doc.layers.indexOf(vis[vis.length - 1]);
  doc.layers = doc.layers.filter(l => !l.visible || l === vis[vis.length - 1]); doc.layers[doc.layers.indexOf(vis[vis.length - 1])] = nl;
  void top; doc.activeId = nl.id; return true;
}
export function stampVisible(doc, name) {
  const nl = newLayer(name, flatten(doc)); doc.layers.push(nl); doc.activeId = nl.id; return nl;
}
export function duplicateLayer(doc, a, name) {
  const nl = newLayer(name, cloneCanvas(a.canvas), { kind: a.kind, adj: a.adj ? JSON.parse(JSON.stringify(a.adj)) : null, x: a.x, y: a.y, rot: a.rot, sx: a.sx, sy: a.sy, opacity: a.opacity, fill: a.fill, blend: a.blend, maskOn: a.maskOn, mask: a.mask ? cloneCanvas(a.mask) : null, fx: a.fx ? JSON.parse(JSON.stringify(a.fx)) : null });
  doc.layers.splice(doc.layers.indexOf(a) + 1, 0, nl); doc.activeId = nl.id; return nl;
}
// New layer from the selected pixels of the active layer (layer via copy).
export function layerViaCopy(doc, a, name) {
  ensureBaked(doc, a);
  const c = cloneCanvas(a.canvas), x = c.getContext('2d');
  if (doc.sel) { x.globalCompositeOperation = 'destination-in'; x.drawImage(maskToCanvas(doc.sel.mask, doc.w, doc.h), 0, 0); }
  const nl = newLayer(name, c); doc.layers.splice(doc.layers.indexOf(a) + 1, 0, nl); doc.activeId = nl.id; return nl;
}

// ── document geometry ──
function remap(c, nw, nh, setup) { const n = mkCanvas(nw, nh), x = n.getContext('2d'); x.save(); setup(x); x.drawImage(c, 0, 0); x.restore(); return n; }
function eachCanvas(doc, fn) {
  for (const l of doc.layers) {
    if (l.kind !== 'adjust') { ensureBaked(doc, l); l.canvas = fn(l.canvas); touch(l); }
    if (l.mask) { l.mask = fn(l.mask); touchMask(l); }
  }
}
export function rotateDoc(doc, deg) { // 90 | 180 | 270 clockwise
  const sw = doc.w, sh = doc.h, swap = deg !== 180, nw = swap ? sh : sw, nh = swap ? sw : sh;
  eachCanvas(doc, c => remap(c, nw, nh, x => { x.translate(nw / 2, nh / 2); x.rotate(deg * Math.PI / 180); x.translate(-sw / 2, -sh / 2); }));
  doc.w = nw; doc.h = nh; doc.sel = null;
}
export function flipDoc(doc, axis) {
  const { w, h } = doc;
  eachCanvas(doc, c => remap(c, w, h, x => { if (axis === 'x') { x.translate(w, 0); x.scale(-1, 1); } else { x.translate(0, h); x.scale(1, -1); } }));
  doc.sel = null;
}
export function cropDoc(doc, x0, y0, w, h) {
  eachCanvas(doc, c => remap(c, w, h, x => x.translate(-x0, -y0)));
  doc.w = w; doc.h = h; doc.sel = null;
}
// Scales every layer to a new document size (used by resize and when an AI result changes the resolution).
export function resizeDoc(doc, nw, nh) {
  const sw = doc.w, sh = doc.h;
  eachCanvas(doc, c => remap(c, nw, nh, x => { x.imageSmoothingQuality = 'high'; x.scale(nw / sw, nh / sh); }));
  doc.w = nw; doc.h = nh; doc.sel = null;
}

// ── history: snapshots share unchanged canvases (copy on write through the dirty flags) ──
const META = ['id', 'kind', 'name', 'x', 'y', 'rot', 'sx', 'sy', 'opacity', 'fill', 'blend', 'visible', 'locked', 'maskOn'];
const jclone = v => (v ? JSON.parse(JSON.stringify(v)) : v);
function snapshot(doc, label) {
  return {
    label, w: doc.w, h: doc.h, activeId: doc.activeId,
    layers: doc.layers.map(l => {
      if (l.dirty || !l.snap) { l.snap = cloneCanvas(l.canvas); l.dirty = false; }
      if (l.mask && (l.mdirty || !l.msnap)) { l.msnap = cloneCanvas(l.mask); l.mdirty = false; }
      const m = { canvas: l.snap, mask: l.mask ? l.msnap : null, adj: jclone(l.adj), fx: jclone(l.fx) }; for (const k of META) m[k] = l[k]; return m;
    })
  };
}
export function commit(doc, label = '') {
  doc.hist.length = doc.hi + 1; doc.hist.push(snapshot(doc, label));
  if (doc.hist.length > HIST_CAP) doc.hist.shift();
  doc.hi = doc.hist.length - 1; inval();
}
function restore(doc, s) {
  doc.w = s.w; doc.h = s.h; doc.activeId = s.activeId; doc.sel = null;
  doc.layers = s.layers.map(m => ({ ...m, canvas: cloneCanvas(m.canvas), snap: m.canvas, dirty: false, mask: m.mask ? cloneCanvas(m.mask) : null, msnap: m.mask, mdirty: false, adj: jclone(m.adj), fx: jclone(m.fx), ver: 0, mver: 0, pv: null, mpv: null }));
  inval();
}
export function undo(doc) { if (doc.hi > 0) restore(doc, doc.hist[--doc.hi]); }
export function redo(doc) { if (doc.hi < doc.hist.length - 1) restore(doc, doc.hist[++doc.hi]); }
export function jump(doc, i) { if (i >= 0 && i < doc.hist.length) { restore(doc, doc.hist[i]); doc.hi = i; } }

// Layer from an Image/canvas source, contained in the document and centered.
export function layerFromImage(doc, src, name) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const k = Math.min(1, 4096 / Math.max(w, h));
  const c = mkCanvas(w * k, h * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const s = Math.min(1, doc.w / c.width, doc.h / c.height);
  return newLayer(name, c, { sx: s, sy: s, x: (doc.w - c.width) / 2, y: (doc.h - c.height) / 2 });
}

export const hexOf = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
export const hexToRgba = (hex, a = 255) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]; };
