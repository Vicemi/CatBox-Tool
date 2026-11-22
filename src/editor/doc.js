// Editor document model: layers are canvases with a transform (x,y,rot,sx,sy around the center).
export const MAX_PX = 4096; // enough for 300 dpi on faces up to ~34 cm
export const BLENDS = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion'];
const HIST_CAP = 30;
let uid = 1;

export const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
export const cloneCanvas = c => { const n = mkCanvas(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; };

export const newLayer = (name, canvas, o = {}) => ({ id: uid++, name, canvas, x: 0, y: 0, rot: 0, sx: 1, sy: 1, opacity: 1, blend: 'source-over', visible: true, dirty: true, snap: null, ...o });
export const newDoc = (w, h) => ({ w, h, layers: [], activeId: null, sel: null, hist: [], hi: -1 });
export const activeOf = doc => doc.layers.find(l => l.id === doc.activeId) || null;
export const touch = l => { l.dirty = true; };
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

// shortcut: ctx.filter is unsupported in Safari, adjustments are then no-ops.
export const adjFilter = a => {
  const f = [a.brightness && `brightness(${100 + a.brightness}%)`, a.contrast && `contrast(${100 + a.contrast}%)`, a.saturation && `saturate(${100 + a.saturation}%)`, a.hue && `hue-rotate(${a.hue}deg)`, a.blur && `blur(${a.blur}px)`].filter(Boolean);
  return f.length ? f.join(' ') : null;
};

export function applyFilter(doc, l, filter) {
  ensureBaked(doc, l);
  const nc = mkCanvas(doc.w, doc.h), ctx = nc.getContext('2d');
  ctx.filter = filter; ctx.drawImage(l.canvas, 0, 0);
  l.canvas = nc; touch(l);
}

export function render(doc, ctx, filter) {
  ctx.clearRect(0, 0, doc.w, doc.h);
  for (const l of doc.layers) {
    if (!l.visible) continue;
    ctx.save();
    ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = l.blend;
    if (filter && l.id === doc.activeId) ctx.filter = filter;
    applyTransform(ctx, l); ctx.drawImage(l.canvas, 0, 0);
    ctx.restore();
  }
}

export function flatten(doc) {
  const c = mkCanvas(doc.w, doc.h); render(doc, c.getContext('2d'), null);
  return c;
}

export function mergeDown(doc) {
  const i = doc.layers.findIndex(l => l.id === doc.activeId); if (i < 1) return;
  const lo = doc.layers[i - 1], up = doc.layers[i];
  const nc = mkCanvas(doc.w, doc.h), ctx = nc.getContext('2d');
  for (const l of [lo, up]) { ctx.save(); ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = l.blend; applyTransform(ctx, l); ctx.drawImage(l.canvas, 0, 0); ctx.restore(); }
  Object.assign(lo, { canvas: nc, x: 0, y: 0, rot: 0, sx: 1, sy: 1, opacity: 1, blend: 'source-over', visible: true }); touch(lo);
  doc.layers.splice(i, 1); doc.activeId = lo.id;
}

// History: snapshots share unchanged layer canvases (copy on write through the dirty flag).
const META = ['id', 'name', 'x', 'y', 'rot', 'sx', 'sy', 'opacity', 'blend', 'visible'];
function snapshot(doc) {
  return {
    w: doc.w, h: doc.h, activeId: doc.activeId,
    layers: doc.layers.map(l => {
      if (l.dirty || !l.snap) { l.snap = cloneCanvas(l.canvas); l.dirty = false; }
      const m = { canvas: l.snap }; for (const k of META) m[k] = l[k]; return m;
    })
  };
}
export function commit(doc) {
  doc.hist.length = doc.hi + 1; doc.hist.push(snapshot(doc));
  if (doc.hist.length > HIST_CAP) doc.hist.shift();
  doc.hi = doc.hist.length - 1;
}
function restore(doc, s) {
  doc.w = s.w; doc.h = s.h; doc.activeId = s.activeId; doc.sel = null;
  doc.layers = s.layers.map(m => ({ ...m, canvas: cloneCanvas(m.canvas), snap: m.canvas, dirty: false }));
}
export function undo(doc) { if (doc.hi > 0) restore(doc, doc.hist[--doc.hi]); }
export function redo(doc) { if (doc.hi < doc.hist.length - 1) restore(doc, doc.hist[++doc.hi]); }

// Layer from an Image/canvas source, contained in the document and centered.
export function layerFromImage(doc, src, name) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const k = Math.min(1, 4096 / Math.max(w, h));
  const c = mkCanvas(w * k, h * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const s = Math.min(1, doc.w / c.width, doc.h / c.height);
  return newLayer(name, c, { sx: s, sy: s, x: (doc.w - c.width) / 2, y: (doc.h - c.height) / 2 });
}

export const hexOf = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
