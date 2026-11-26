// Full-screen photo editor (Canvas 2D): selections, paint/retouch tools, adjustment layers, filters, masks, history, AI panel.
import React, { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  IconArrowsMove, IconSquareDashed, IconCircleDashed, IconLasso, IconLassoPolygon, IconWand, IconCrop, IconColorPicker, IconBrush, IconPencil, IconEraser, IconBucketDroplet, IconBlendMode,
  IconLayersIntersect, IconBlur, IconTriangle, IconDropletHalf2, IconSun, IconTypography, IconShape, IconHandMove, IconZoomIn, IconZoomOut, IconArrowBackUp, IconArrowForwardUp,
  IconFocusCentered, IconSelectAll, IconDeselect, IconFlipHorizontal, IconFlipVertical, IconRotateClockwise, IconRotate, IconCheck, IconX, IconGridDots, IconSquare, IconCircle, IconLine,
  IconArrowsExchange, IconPhotoPlus, IconClipboard, IconSwitch, IconBold, IconItalic
} from '@tabler/icons-react';
import { useT } from '../i18n/index.js';
import { imageFilesOf, readImageFile } from '../design/images.js';
import { FontPicker } from '../ui/FontPicker.jsx';
import { AIImagePanel } from '../ui/AIModules.jsx';
import { TipProvider } from './ui.jsx';
import { P, MONO, DBtn, TextBtn, DRange, Sel, Num, Chk, Seg, Field } from './editorUi.jsx';
import { LayersPanel, HistoryPanel, AdjustPanel, FilterPanel, adjName } from './panels.jsx';
import { floodMask, removeBackground, maskBounds } from './pixels.js';
import {
  scaleMask, combineMasks, invertMask, featherMask, maskEdges, maskCount, globalMask, fullMask, fillRegion, fillGradient, mixByMask, freshAdj,
  dabBlur, dabSharpen, dabSmudge, dabTone, dabClone, newCarry
} from './fx.js';
import {
  MAX_PX, mkCanvas, cloneCanvas, newLayer, newAdjLayer, newDoc, activeOf, isAdj, touch, touchMask, inval, docVer, ensureBaked, render, flatten, mergeDown, mergeVisible, duplicateLayer, layerViaCopy,
  rotateDoc, flipDoc, cropDoc, resizeDoc, commit, undo, redo, jump, layerFromImage, hexOf, hexToRgba, maskToCanvas, canvasToMask
} from './doc.js';
import { startStroke } from './brush.js';
import { runPixels } from './run.js';
import { ask, notify } from '../ui/dialogs.jsx';

const TOOLS = [
  ['move', 'V', IconArrowsMove, 'Mover / transformar'], ['marquee', 'M', IconSquareDashed, 'Marco de selección'], ['lasso', 'L', IconLasso, 'Lazo'], ['wand', 'W', IconWand, 'Varita mágica'],
  ['crop', 'C', IconCrop, 'Recortar'], ['eyedrop', 'I', IconColorPicker, 'Cuentagotas'], ['brush', 'B', IconBrush, 'Pincel'], ['pencil', 'N', IconPencil, 'Lápiz'],
  ['eraser', 'E', IconEraser, 'Goma'], ['bucket', 'K', IconBucketDroplet, 'Bote de pintura'], ['gradient', 'G', IconBlendMode, 'Degradado'], ['clone', 'S', IconLayersIntersect, 'Tampón de clonar'],
  ['blur', 'R', IconBlur, 'Desenfocar'], ['sharpen', 'Y', IconTriangle, 'Enfocar'], ['smudge', 'F', IconDropletHalf2, 'Dedo (manchar)'], ['dodge', 'O', IconSun, 'Sobreexponer / subexponer'],
  ['text', 'T', IconTypography, 'Texto'], ['shape', 'U', IconShape, 'Formas'], ['hand', 'H', IconHandMove, 'Mano'], ['zoom', 'Z', IconZoomIn, 'Zoom']
];
const PAINT = ['brush', 'pencil', 'eraser'], DAB = ['clone', 'blur', 'sharpen', 'smudge', 'dodge'];
const PAD = 40;
const isOpaque = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return false; return true; };

// Corner/rotate-handle geometry of a layer in document space.
function geo(l, z) {
  const cw = l.canvas.width, ch = l.canvas.height, c = [l.x + cw / 2, l.y + ch / 2], th = l.rot * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
  const rot = (x, y) => [c[0] + x * co - y * si, c[1] + x * si + y * co];
  const hw = cw * l.sx / 2, hh = ch * l.sy / 2;
  return { c, corners: [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)], rotH: rot(0, -Math.abs(hh) - 26 / z) };
}
function hitLayer(l, p) {
  if (isAdj(l)) return false;
  const cw = l.canvas.width, ch = l.canvas.height, th = -l.rot * Math.PI / 180, dx = p[0] - (l.x + cw / 2), dy = p[1] - (l.y + ch / 2);
  const lx = Math.floor((dx * Math.cos(th) - dy * Math.sin(th)) / l.sx + cw / 2), ly = Math.floor((dx * Math.sin(th) + dy * Math.cos(th)) / l.sy + ch / 2);
  if (lx < 0 || ly < 0 || lx >= cw || ly >= ch) return false;
  return l.canvas.getContext('2d').getImageData(lx, ly, 1, 1).data[3] > 8;
}
const lum = hex => { const [r, g, b] = hexToRgba(hex); return Math.round(0.299 * r + 0.587 * g + 0.114 * b); };

export function ImageEditor({ init, onApply, onClose }) {
  const t = useT();
  const docRef = useRef(null), mainRef = useRef(null), ovRef = useRef(null), scrollRef = useRef(null), statusRef = useRef(null);
  const drag = useRef(null), space = useRef(false), hover = useRef(null), poly = useRef(null), cropRef = useRef(null), cloneRef = useRef({ src: null, off: null, fresh: false });
  const last = useRef({ ver: -1 }), pend = useRef(null), pvRef = useRef(null), flashT = useRef(0), shapeTmp = useRef(null);
  const [, bump] = useReducer(x => x + 1, 0);
  const [tool, setTool] = useState('move'), [ready, setReady] = useState(false), [zoom, setZoom] = useState(1), [grid, setGrid] = useState(false), [tab, setTab] = useState('adjust'), [msg, setMsg] = useState('');
  const [fg, setFg] = useState('#211d18'), [bg, setBg] = useState('#ffffff');
  const [o, setO] = useState({
    size: 28, hard: 70, opacity: 100, flow: 100, selMode: 'new', marq: 'rect', lassoK: 'free', tol: 24, contig: true, sampleAll: false, feather: 0, gradK: 'linear', gradM: 'fgbg',
    shapeK: 'rect', shapeFill: true, shapeStroke: false, strokeW: 6, text: '', font: 'Noto Sans', fsize: 96, bold: false, italic: false, dodge: 'dodge', eyeAll: true
  });
  const set = (k, v) => setO(p => ({ ...p, [k]: v }));
  const doc = docRef.current, l = doc && activeOf(doc);
  const flash = m => { setMsg(m); clearTimeout(flashT.current); flashT.current = setTimeout(() => setMsg(''), 2600); };

  // Build the document (edit: the image; compose: white background of the face size).
  useEffect(() => {
    const done = d => { commit(d, 'Abrir'); docRef.current = d; setReady(true); };
    if (init.mode === 'compose') {
      const d = newDoc(init.w, init.h), c = mkCanvas(init.w, init.h), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      const bgl = newLayer(t('Fondo'), c); d.layers.push(bgl); d.activeId = bgl.id; done(d);
      return;
    }
    const im = new Image();
    im.onload = () => {
      const cr = init.crop || [0, 0, 1, 1], sw = im.naturalWidth * cr[2], sh = im.naturalHeight * cr[3], k = Math.min(1, MAX_PX / Math.max(sw, sh));
      const d = newDoc(Math.round(sw * k), Math.round(sh * k)), c = mkCanvas(d.w, d.h);
      c.getContext('2d').drawImage(im, cr[0] * im.naturalWidth, cr[1] * im.naturalHeight, sw, sh, 0, 0, c.width, c.height);
      const ly = newLayer(t('Imagen'), c); d.layers.push(ly); d.activeId = ly.id; done(d);
    };
    im.src = init.src;
  }, []);

  const fit = () => { const s = scrollRef.current, d = docRef.current; if (s && d && s.clientWidth > 50) { setZoom(Math.min(8, (s.clientWidth - 2 * PAD) / d.w, (s.clientHeight - 2 * PAD) / d.h)); s.scrollLeft = s.scrollTop = 0; } };
  useEffect(() => { if (ready) requestAnimationFrame(fit); }, [ready]);
  useLayoutEffect(() => { const p = pend.current, s = scrollRef.current; if (p && s) { s.scrollLeft = p.dx * zoom + PAD - p.mx; s.scrollTop = p.dy * zoom + PAD - p.my; pend.current = null; } }, [zoom]);

  // ── selection helpers ──
  const selCanvasOf = d => d.sel ? (d.sel.canvas || (d.sel.canvas = maskToCanvas(d.sel.mask, d.w, d.h))) : null;
  const setSelection = (shape, mode) => {
    const d = docRef.current; if (!d) return;
    if (mode === 'sub' && !d.sel) return;
    let m = shape; if (o.feather > 0) m = featherMask(m, d.w, d.h, o.feather);
    const comb = combineMasks(d.sel && d.sel.mask, m, mode);
    d.sel = maskCount(comb) > 0 ? { mask: comb, bounds: maskBounds(comb, d.w, d.h) } : null; inval(); bump();
  };
  const raster = fn => { const d = docRef.current, c = mkCanvas(d.w, d.h), x = c.getContext('2d'); x.fillStyle = '#000'; fn(x); return canvasToMask(c); };
  const selAll = () => { const d = docRef.current; d.sel = { mask: fullMask(d.w, d.h), bounds: [0, 0, d.w, d.h] }; bump(); };
  const selNone = () => { docRef.current.sel = null; bump(); };
  const selInvert = () => { const d = docRef.current; if (!d.sel) return selAll(); const m = invertMask(d.sel.mask); d.sel = maskCount(m) ? { mask: m, bounds: maskBounds(m, d.w, d.h) } : null; bump(); };
  const polyMask = pts => raster(x => { x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); x.closePath(); x.fill(); });

  // ── drawing ──
  const buildOv = (s, z) => {
    const d = docRef.current, c = mkCanvas(d.w, d.h), x = c.getContext('2d'), id = x.createImageData(d.w, d.h), u = new Uint32Array(id.data.buffer);
    const e = s.edges || (s.edges = maskEdges(s.mask, d.w, d.h)), th = Math.max(1, Math.round(1.2 / z)), run = Math.max(2, Math.round(4 / z));
    for (let k = 0; k < e.length; k++) {
      const p = e[k], px = p % d.w, py = (p - px) / d.w, col = (((px / run) | 0) + ((py / run) | 0)) & 1 ? 0xff000000 : 0xffffffff;
      for (let j = 0; j < th; j++) for (let i = 0; i < th; i++) { const X = px + i, Y = py + j; if (X < d.w && Y < d.h) u[Y * d.w + X] = col; }
    }
    x.putImageData(id, 0, 0); s.ov = c; s.ovZ = z;
  };
  const draw = () => {
    const d = docRef.current, cv = mainRef.current, ov = ovRef.current; if (!d || !cv) return;
    const resized = cv.width !== d.w || cv.height !== d.h;
    if (resized) { cv.width = ov.width = d.w; cv.height = ov.height = d.h; }
    if (resized || last.current.ver !== docVer()) { render(d, cv.getContext('2d')); last.current.ver = docVer(); }
    const x = ov.getContext('2d'); x.clearRect(0, 0, d.w, d.h);
    const z = zoom, lw = 1.5 / z, s = d.sel, a = activeOf(d), dr = drag.current;
    if (s) { if (!s.ov || s.ovZ !== z) buildOv(s, z); x.drawImage(s.ov, 0, 0); }
    const dash = () => { x.lineWidth = lw; x.setLineDash([6 / z, 6 / z]); x.strokeStyle = '#fff'; };
    const dashed = path => { dash(); path(); x.stroke(); x.lineDashOffset = 6 / z; x.strokeStyle = '#000'; path(); x.stroke(); x.setLineDash([]); x.lineDashOffset = 0; };
    if (dr && dr.k === 'marq') dashed(() => { x.beginPath(); if (tool === 'marquee' && o.marq === 'ellipse') x.ellipse((dr.p[0] + dr.q[0]) / 2, (dr.p[1] + dr.q[1]) / 2, Math.abs(dr.q[0] - dr.p[0]) / 2, Math.abs(dr.q[1] - dr.p[1]) / 2, 0, 0, 7); else x.rect(Math.min(dr.p[0], dr.q[0]), Math.min(dr.p[1], dr.q[1]), Math.abs(dr.q[0] - dr.p[0]), Math.abs(dr.q[1] - dr.p[1])); });
    if (dr && dr.k === 'lasso') dashed(() => { x.beginPath(); dr.pts.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); });
    if (poly.current) dashed(() => { x.beginPath(); poly.current.pts.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); if (hover.current) x.lineTo(hover.current[0], hover.current[1]); });
    if (dr && dr.k === 'grad') { x.lineWidth = lw; x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(dr.p[0], dr.p[1]); x.lineTo(dr.q[0], dr.q[1]); x.stroke(); x.strokeStyle = '#000'; x.setLineDash([4 / z, 4 / z]); x.stroke(); x.setLineDash([]); }
    const cr = cropRef.current;
    if (tool === 'crop' && cr) {
      x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 0, d.w, cr.y); x.fillRect(0, cr.y + cr.h, d.w, d.h - cr.y - cr.h); x.fillRect(0, cr.y, cr.x, cr.h); x.fillRect(cr.x + cr.w, cr.y, d.w - cr.x - cr.w, cr.h);
      x.lineWidth = lw; x.strokeStyle = '#fff'; x.strokeRect(cr.x, cr.y, cr.w, cr.h);
      x.strokeStyle = 'rgba(255,255,255,.4)'; for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo(cr.x + cr.w * i / 3, cr.y); x.lineTo(cr.x + cr.w * i / 3, cr.y + cr.h); x.moveTo(cr.x, cr.y + cr.h * i / 3); x.lineTo(cr.x + cr.w, cr.y + cr.h * i / 3); x.stroke(); }
      const hs = 9 / z; x.fillStyle = '#fff'; [[cr.x, cr.y], [cr.x + cr.w, cr.y], [cr.x + cr.w, cr.y + cr.h], [cr.x, cr.y + cr.h]].forEach(q => x.fillRect(q[0] - hs / 2, q[1] - hs / 2, hs, hs));
    }
    if (tool === 'move' && a && !isAdj(a)) {
      const g = geo(a, z), hs = 8 / z;
      x.lineWidth = lw; x.strokeStyle = '#e0a65e'; x.beginPath(); g.corners.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); x.closePath(); x.stroke();
      x.beginPath(); x.moveTo((g.corners[0][0] + g.corners[1][0]) / 2, (g.corners[0][1] + g.corners[1][1]) / 2); x.lineTo(g.rotH[0], g.rotH[1]); x.stroke();
      x.fillStyle = '#fff'; g.corners.forEach(q => { x.fillRect(q[0] - hs / 2, q[1] - hs / 2, hs, hs); x.strokeRect(q[0] - hs / 2, q[1] - hs / 2, hs, hs); });
      x.beginPath(); x.arc(g.rotH[0], g.rotH[1], hs / 2, 0, 7); x.fill(); x.stroke();
    }
    const hv = hover.current;
    if (hv && !dr && [...PAINT, ...DAB].includes(tool)) { x.lineWidth = lw; x.strokeStyle = '#000'; x.beginPath(); x.arc(hv[0], hv[1], o.size / 2, 0, 7); x.stroke(); x.strokeStyle = '#fff'; x.lineWidth = lw * 0.6; x.stroke(); }
    if (tool === 'clone' && cloneRef.current.src) { const sp = cloneRef.current.off && hv ? [hv[0] + cloneRef.current.off[0], hv[1] + cloneRef.current.off[1]] : cloneRef.current.src; x.lineWidth = lw; x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(sp[0] - 8 / z, sp[1]); x.lineTo(sp[0] + 8 / z, sp[1]); x.moveTo(sp[0], sp[1] - 8 / z); x.lineTo(sp[0], sp[1] + 8 / z); x.stroke(); }
  };
  useEffect(draw);

  // ── document actions ──
  const act = (fn, label) => { fn(docRef.current); commit(docRef.current, label); bump(); };
  const commitBump = label => { commit(docRef.current, label); bump(); };
  const pt = e => { const r = mainRef.current.getBoundingClientRect(); return [(e.clientX - r.left) * docRef.current.w / r.width, (e.clientY - r.top) * docRef.current.h / r.height]; };
  const pixLayer = () => { const a = activeOf(docRef.current); if (!a) return null; if (isAdj(a)) { flash(t('Las capas de ajuste no se pintan: usa su máscara')); return null; } if (a.locked) { flash(t('La capa está bloqueada')); return null; } return a; };
  const paintTarget = () => {
    const d = docRef.current, a = activeOf(d); if (!a) return null;
    if (a.locked) { flash(t('La capa está bloqueada')); return null; }
    if (d.editMask && a.mask) return { canvas: a.mask, mask: true, a };
    if (isAdj(a)) { flash(t('Las capas de ajuste no se pintan: usa su máscara')); return null; }
    ensureBaked(d, a); return { canvas: a.canvas, mask: false, a };
  };
  const pixApply = (label, fn) => {
    const d = docRef.current, a = pixLayer(); if (!a) return;
    const ctx = ensureBaked(d, a), img = ctx.getImageData(0, 0, d.w, d.h);
    fn(img, d.sel ? d.sel.mask : null); ctx.putImageData(img, 0, 0); touch(a); commitBump(label);
  };
  const compositeImage = () => { const c = mainRef.current; return c.getContext('2d').getImageData(0, 0, c.width, c.height); };

  const addImageFile = async file => {
    try {
      const a = await readImageFile(file);
      act(d => { const nl = layerFromImage(d, a.img, (file.name || t('Imagen')).replace(/\.[^.]+$/, '').slice(0, 24)); d.layers.push(nl); d.activeId = nl.id; }, 'Añadir imagen');
    } catch (_) { notify(t('No se pudo leer la imagen. Usa PNG, JPG o WebP.'), { tone: 'error' }); }
  };
  const pickFile = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp'; i.multiple = true; i.onchange = () => imageFilesOf(i.files).forEach(addImageFile); i.click(); };
  const pasteClip = async () => {
    try { for (const it of await navigator.clipboard.read()) { const ty = it.types.find(x => x.startsWith('image/')); if (ty) { addImageFile(new File([await it.getType(ty)], t('Pegado') + '.png', { type: ty })); return; } } }
    catch (_) { notify(t('No se pudo leer el portapapeles'), { tone: 'error' }); }
  };

  // layer API for the panels
  const api = {
    select: id => { docRef.current.activeId = id; bump(); },
    toggle: (x, k) => { x[k] = !x[k]; inval(); commitBump(k === 'visible' ? 'Visibilidad' : 'Bloqueo'); },
    rename: (x, n) => { n = n.trim().slice(0, 32); if (n && n !== x.name) { x.name = n; commitBump('Renombrar capa'); } },
    reorder: (src, target, above) => act(d => { const s = d.layers.find(x => x.id === src); if (!s || src === target) return; d.layers = d.layers.filter(x => x !== s); const i = d.layers.findIndex(x => x.id === target); d.layers.splice(i + (above ? 1 : 0), 0, s); }, 'Reordenar capas'),
    setL: (patch, label) => { const a = activeOf(docRef.current); if (!a) return; Object.assign(a, patch); inval(); if (label) commitBump(label); else bump(); },
    commitBump,
    newLayer: () => act(d => { const nl = newLayer(t('Capa {n}', { n: d.layers.length + 1 }), mkCanvas(d.w, d.h)); d.layers.splice(d.layers.indexOf(activeOf(d)) + 1 || d.layers.length, 0, nl); d.activeId = nl.id; }, 'Capa nueva'),
    newAdj: op => act(d => {
      const nl = newAdjLayer(t(adjName(op)), op, freshAdj(op));
      if (d.sel) { nl.mask = maskToCanvas(d.sel.mask, d.w, d.h); }
      d.layers.splice(d.layers.indexOf(activeOf(d)) + 1 || d.layers.length, 0, nl); d.activeId = nl.id; setTab('adjust');
    }, 'Capa de ajuste'),
    setAdjParams: patch => { const a = activeOf(docRef.current); if (!a || !isAdj(a)) return; a.adj.params = { ...a.adj.params, ...patch }; inval(); bump(); },
    dup: () => act(d => { const a = activeOf(d); if (a) { if (d.sel && !isAdj(a)) layerViaCopy(d, a, a.name + ' ' + t('copia')); else duplicateLayer(d, a, a.name + ' ' + t('copia')); } }, 'Duplicar capa'),
    del: () => act(d => { const i = d.layers.findIndex(x => x.id === d.activeId); if (i < 0) return; d.layers.splice(i, 1); d.activeId = d.layers.length ? d.layers[Math.max(0, i - 1)].id : null; d.editMask = false; }, 'Borrar capa'),
    mergeDown: () => { const a = activeOf(docRef.current); if (a && docRef.current.layers.indexOf(a) > 0) act(d => { mergeDown(d); }, 'Combinar hacia abajo'); },
    mergeVisible: () => act(d => { mergeVisible(d); }, 'Combinar visibles'),
    addMask: fromSel => act(d => {
      const a = activeOf(d); if (!a || a.mask) return;
      const c = fromSel && d.sel ? maskToCanvas(d.sel.mask, d.w, d.h) : mkCanvas(d.w, d.h);
      if (!(fromSel && d.sel)) { const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); }
      a.mask = c; a.maskOn = true; d.editMask = true; touchMask(a);
    }, 'Añadir máscara'),
    delMask: () => act(d => { const a = activeOf(d); if (a) { a.mask = null; d.editMask = false; touchMask(a); } }, 'Eliminar máscara'),
    applyMask: () => act(d => {
      const a = activeOf(d); if (!a || !a.mask) return;
      if (!isAdj(a)) { ensureBaked(d, a); const x = a.canvas.getContext('2d'); x.globalCompositeOperation = 'destination-in'; x.drawImage(a.mask, 0, 0); x.globalCompositeOperation = 'source-over'; touch(a); }
      a.mask = null; d.editMask = false; touchMask(a);
    }, 'Aplicar máscara'),
    toggleMask: () => { const a = activeOf(docRef.current); if (a) { a.maskOn = a.maskOn === false; inval(); commitBump('Máscara'); } },
    invertLayerMask: () => act(d => { const a = activeOf(d); if (!a || !a.mask) return; const x = a.mask.getContext('2d'), id = x.getImageData(0, 0, d.w, d.h); for (let i = 3; i < id.data.length; i += 4) { id.data[i] = 255 - id.data[i]; id.data[i - 1] = id.data[i - 2] = id.data[i - 3] = 255; } x.putImageData(id, 0, 0); touchMask(a); }, 'Invertir máscara'),
    editMask: v => { docRef.current.editMask = !!v; bump(); },
    jump: i => { jump(docRef.current, i); bump(); },
    // filters: live preview through l.pv (drawn instead of the layer), applied on confirm
    previewFilter: async (name, params) => {
      const d = docRef.current, a = activeOf(d); if (!a || isAdj(a)) return;
      ensureBaked(d, a);
      const st = pvRef.current && pvRef.current.id === a.id && pvRef.current.ver === a.ver ? pvRef.current : (pvRef.current = { id: a.id, ver: a.ver, src: a.canvas.getContext('2d').getImageData(0, 0, d.w, d.h), n: 0 });
      const n = ++st.n, res = await runPixels(st.src, 'fx', name, params);
      if (pvRef.current !== st || n !== st.n) return;
      if (d.sel) mixByMask(res, st.src, d.sel.mask, 1);
      const c = st.out || (st.out = mkCanvas(d.w, d.h)); c.getContext('2d').putImageData(res, 0, 0);
      a.pv = c; inval(); draw();
    },
    cancelFilter: () => { const a = docRef.current && activeOf(docRef.current); if (a && a.pv) { a.pv = null; inval(); } pvRef.current = null; if (docRef.current) draw(); },
    applyFilter: label => {
      const d = docRef.current, a = activeOf(d); if (!a || !a.pv) return;
      const x = a.canvas.getContext('2d'); x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'copy'; x.drawImage(a.pv, 0, 0); x.restore();
      a.pv = null; pvRef.current = null; touch(a); commitBump(label);
    }
  };

  // image / document operations
  const imgOp = (fn, label) => act(d => fn(d), label);
  const delSel = () => { const d = docRef.current; if (!d.sel) return; const tg = paintTarget(); if (!tg) return;
    if (tg.mask) { const x = tg.canvas.getContext('2d'), id = x.getImageData(0, 0, d.w, d.h), m = d.sel.mask; for (let p = 0; p < m.length; p++) id.data[p * 4 + 3] = id.data[p * 4 + 3] * (255 - m[p]) / 255; x.putImageData(id, 0, 0); touchMask(tg.a); commitBump('Borrar selección'); return; }
    pixApply('Borrar selección', (img, sel) => { for (let p = 0; p < sel.length; p++) img.data[p * 4 + 3] = img.data[p * 4 + 3] * (255 - sel[p]) / 255; }); };
  const fillSel = col => { const d = docRef.current; if (!d.sel) return; pixApply('Rellenar selección', (img, sel) => fillRegion(img, sel, hexToRgba(col), null, 1)); };
  const cropToSel = () => { const d = docRef.current, s = d.sel; if (!s || !s.bounds) return; const [bx, by, bw, bh] = s.bounds; act(dd => cropDoc(dd, bx, by, bw, bh), 'Recortar'); requestAnimationFrame(fit); };
  const applyCrop = () => {
    const cr = cropRef.current, d = docRef.current; if (!cr || !d) return;
    const x0 = Math.max(0, Math.round(cr.x)), y0 = Math.max(0, Math.round(cr.y)), w = Math.min(d.w - x0, Math.round(cr.w)), h = Math.min(d.h - y0, Math.round(cr.h));
    if (w < 2 || h < 2) return; cropRef.current = null; act(dd => cropDoc(dd, x0, y0, w, h), 'Recortar'); requestAnimationFrame(fit);
  };
  const removeBg = () => pixApply('Quitar fondo', img => removeBackground(img, o.tol, Math.max(0, o.feather)));

  // AI panel contract: getCanvas() -> pixels of the active layer; applyCanvas(result, label) -> replaces them (document follows the new size).
  const getCanvas = () => { const d = docRef.current, a = activeOf(d); if (a && !isAdj(a)) { ensureBaked(d, a); return cloneCanvas(a.canvas); } return flatten(d); };
  const applyCanvas = (res, label) => {
    const d = docRef.current; if (!d || !res) return;
    const k = Math.min(1, MAX_PX / Math.max(res.width, res.height)); let rc = res;
    if (k < 1) { rc = mkCanvas(res.width * k, res.height * k); rc.getContext('2d').drawImage(res, 0, 0, rc.width, rc.height); }
    act(dd => {
      if (rc.width !== dd.w || rc.height !== dd.h) resizeDoc(dd, rc.width, rc.height);
      let a = activeOf(dd);
      if (!a || isAdj(a)) { a = newLayer(label || 'IA', mkCanvas(dd.w, dd.h)); dd.layers.push(a); dd.activeId = a.id; }
      ensureBaked(dd, a); const x = a.canvas.getContext('2d'); x.clearRect(0, 0, dd.w, dd.h); x.drawImage(rc, 0, 0, dd.w, dd.h); touch(a);
    }, label || 'IA');
    requestAnimationFrame(fit);
  };

  const doApply = () => {
    const d = docRef.current; if (d.sel) { /* selection is not part of the output */ }
    const c = flatten(d), op = isOpaque(c);
    onApply({ dataURL: op ? c.toDataURL('image/jpeg', 0.95) : c.toDataURL('image/png'), w: c.width, h: c.height });
  };
  const cancel = async () => { if (doc && doc.hi > 0 && !(await ask(t('¿Descartar los cambios?'), { danger: true }))) return; onClose(); };

  // ── pointer interaction ──
  const pickColor = (p, toBg) => {
    const d = docRef.current, x = Math.min(d.w - 1, Math.max(0, Math.floor(p[0]))), y = Math.min(d.h - 1, Math.max(0, Math.floor(p[1])));
    const a = activeOf(d); let px;
    if (o.eyeAll || !a || isAdj(a)) px = mainRef.current.getContext('2d').getImageData(x, y, 1, 1).data; else { ensureBaked(d, a); px = a.canvas.getContext('2d').getImageData(x, y, 1, 1).data; }
    (toBg ? setBg : setFg)(hexOf(px[0], px[1], px[2]));
  };
  const modeOf = e => (e.shiftKey && e.altKey ? 'int' : e.shiftKey ? 'add' : e.altKey ? 'sub' : o.selMode);
  const dabTool = (dr, p) => {
    const d = docRef.current, r = o.size / 2, hd = o.hard / 100, str = o.opacity / 100, sel = d.sel ? d.sel.mask : null, w = dr.work;
    const one = (x, y) => {
      if (tool === 'blur') dabBlur(w, x, y, r, hd, str, sel); else if (tool === 'sharpen') dabSharpen(w, x, y, r, hd, str, sel);
      else if (tool === 'smudge') dabSmudge(w, dr.carry, x, y, r, hd, str, sel); else if (tool === 'dodge') dabTone(w, x, y, r, hd, str, o.dodge, sel);
      else dabClone(w, dr.src, dr.off[0], dr.off[1], x, y, r, hd, str, sel);
    };
    const step = Math.max(1.5, o.size * 0.18); let pts = [];
    if (!dr.last) pts = [p]; else { const dx = p[0] - dr.last[0], dy = p[1] - dr.last[1], dist = Math.hypot(dx, dy), n = Math.floor((dist + dr.rem) / step); for (let i = 1; i <= n; i++) { const s = (i * step - dr.rem) / (dist || 1); pts.push([dr.last[0] + dx * s, dr.last[1] + dy * s]); } dr.rem = (dist + dr.rem) - n * step; }
    dr.last = p;
    if (!pts.length) return;
    pts.forEach(q => one(q[0], q[1]));
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(q => q[0])) - r - 2)), y0 = Math.max(0, Math.floor(Math.min(...pts.map(q => q[1])) - r - 2)), x1 = Math.min(d.w, Math.ceil(Math.max(...pts.map(q => q[0])) + r + 2)), y1 = Math.min(d.h, Math.ceil(Math.max(...pts.map(q => q[1])) + r + 2));
    dr.ctx.putImageData(w, 0, 0, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)); touch(dr.a); draw();
  };
  const closePoly = () => { const pl = poly.current; poly.current = null; if (pl && pl.pts.length >= 3) setSelection(polyMask(pl.pts), pl.mode); else draw(); };

  const down = async e => {
    const d = docRef.current; if (!d) return;
    const sc = scrollRef.current, cap = () => e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || space.current || tool === 'hand') { cap(); drag.current = { k: 'pan', x: e.clientX, y: e.clientY, l: sc.scrollLeft, t: sc.scrollTop }; return; }
    if (e.button !== 0) return;
    const p = pt(e), a = activeOf(d);
    if (tool === 'zoom') { zoomAt(e.clientX, e.clientY, e.altKey ? 1 / 1.5 : 1.5); return; }
    if (tool === 'eyedrop' || (e.altKey && ['brush', 'pencil', 'eraser', 'bucket', 'gradient'].includes(tool))) { pickColor(p, e.shiftKey || (tool === 'eyedrop' && e.altKey)); return; }
    if (tool === 'text') {
      if (!o.text.trim()) { flash(t('Escribe el texto en la barra de opciones')); return; }
      const fnt = `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : ''}${o.fsize}px "${o.font}"`;
      await document.fonts.load(fnt).catch(() => {});
      act(dd => {
        const c = mkCanvas(dd.w, dd.h), x = c.getContext('2d'); x.font = fnt; x.fillStyle = fg; x.textBaseline = 'top';
        o.text.split('\n').forEach((ln, i) => x.fillText(ln, p[0], p[1] + i * o.fsize * 1.2));
        const nl = newLayer(o.text.split('\n')[0].slice(0, 20), c); dd.layers.splice(dd.layers.indexOf(activeOf(dd)) + 1 || dd.layers.length, 0, nl); dd.activeId = nl.id;
      }, 'Texto');
      return;
    }
    if (tool === 'move') {
      if (a && !isAdj(a) && !a.locked) {
        const g = geo(a, zoom), r = 10 / zoom, near = q => Math.hypot(q[0] - p[0], q[1] - p[1]) < r;
        if (near(g.rotH)) { cap(); drag.current = { k: 'rot', l: a, a0: Math.atan2(p[1] - g.c[1], p[0] - g.c[0]), r0: a.rot, c: g.c }; return; }
        if (g.corners.some(near)) { cap(); drag.current = { k: 'scale', l: a, d0: Math.hypot(p[0] - g.c[0], p[1] - g.c[1]), sx: a.sx, sy: a.sy, c: g.c }; return; }
      }
      const hit = d.layers.slice().reverse().find(x => x.visible && !x.locked && hitLayer(x, p)) || (a && !isAdj(a) && !a.locked ? a : null);
      if (!hit) { if (a && a.locked) flash(t('La capa está bloqueada')); return; }
      d.activeId = hit.id; bump(); cap(); drag.current = { k: 'move', l: hit, p, x: hit.x, y: hit.y }; return;
    }
    if (tool === 'marquee') { cap(); drag.current = { k: 'marq', p, q: p, mode: modeOf(e) }; return; }
    if (tool === 'lasso') {
      if (o.lassoK === 'poly') {
        if (!poly.current) poly.current = { pts: [p], mode: modeOf(e) };
        else if (poly.current.pts.length >= 3 && Math.hypot(p[0] - poly.current.pts[0][0], p[1] - poly.current.pts[0][1]) < 8 / zoom) { closePoly(); return; }
        else poly.current.pts.push(p);
        draw(); return;
      }
      cap(); drag.current = { k: 'lasso', pts: [p], mode: modeOf(e) }; return;
    }
    if (tool === 'crop') {
      cap(); const cr = cropRef.current, r = 12 / zoom;
      if (cr) {
        const cs = [[cr.x, cr.y], [cr.x + cr.w, cr.y], [cr.x + cr.w, cr.y + cr.h], [cr.x, cr.y + cr.h]], hi = cs.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < r);
        if (hi >= 0) { drag.current = { k: 'cropH', hi, o: { ...cr } }; return; }
        if (p[0] > cr.x && p[0] < cr.x + cr.w && p[1] > cr.y && p[1] < cr.y + cr.h) { drag.current = { k: 'cropM', p, o: { ...cr } }; return; }
      }
      drag.current = { k: 'cropN', p }; return;
    }
    if (tool === 'wand') {
      const lay = a && !isAdj(a) ? (ensureBaked(d, a), a.canvas.getContext('2d').getImageData(0, 0, d.w, d.h)) : compositeImage(), ref = o.sampleAll ? compositeImage() : lay, x = Math.floor(p[0]), y = Math.floor(p[1]);
      setSelection(o.contig ? scaleMask(floodMask(ref, x, y, o.tol)) : scaleMask(globalMask(ref, x, y, o.tol)), modeOf(e)); return;
    }
    if (tool === 'bucket') {
      pixApply('Bote de pintura', (img, sel) => {
        const ref = o.sampleAll ? compositeImage() : img, x = Math.floor(p[0]), y = Math.floor(p[1]);
        fillRegion(img, o.contig ? floodMask(ref, x, y, o.tol) : globalMask(ref, x, y, o.tol), hexToRgba(fg), sel, o.opacity / 100);
      });
      return;
    }
    if (tool === 'gradient') { if (!paintTarget()) return; cap(); drag.current = { k: 'grad', p, q: p }; return; }
    if (tool === 'shape') {
      const lay = pixLayer(); if (!lay) return; cap(); const ctx = ensureBaked(d, lay);
      drag.current = { k: 'shape', ctx, p, base: cloneCanvas(lay.canvas), l: lay }; return;
    }
    if (PAINT.includes(tool)) {
      const tg = paintTarget(); if (!tg) return; cap();
      const s = startStroke({
        target: tg.canvas, w: d.w, h: d.h, size: o.size, hard: o.hard / 100, opacity: o.opacity / 100, flow: o.flow / 100, color: tg.mask ? '#ffffff' : fg, erase: tool === 'eraser', pencil: tool === 'pencil',
        selCanvas: selCanvasOf(d), setPreview: c => { if (tg.mask) tg.a.mpv = c; else tg.a.pv = c; inval(); }, redraw: draw
      });
      s.to(p); drag.current = { k: 'stroke', s, tg }; return;
    }
    if (DAB.includes(tool)) {
      if (tool === 'clone' && e.altKey) { cloneRef.current = { src: p, off: null, fresh: true }; flash(t('Origen de clonado fijado')); draw(); return; }
      const tg = paintTarget(); if (!tg) return; if (tg.mask) { flash(t('Esta herramienta solo actúa sobre píxeles')); return; }
      if (tool === 'clone') { if (!cloneRef.current.src) { flash(t('Alt + clic para fijar el origen')); return; } if (cloneRef.current.fresh || !cloneRef.current.off) { cloneRef.current.off = [cloneRef.current.src[0] - p[0], cloneRef.current.src[1] - p[1]]; cloneRef.current.fresh = false; } }
      cap(); const ctx = tg.canvas.getContext('2d'), work = ctx.getImageData(0, 0, d.w, d.h);
      const dr = { k: 'dab', a: tg.a, ctx, work, last: null, rem: 0, carry: tool === 'smudge' ? newCarry(work, p[0], p[1], o.size / 2) : null, src: tool === 'clone' ? { data: new Uint8ClampedArray(work.data), width: d.w, height: d.h } : null, off: cloneRef.current.off };
      drag.current = dr; dabTool(dr, p); return;
    }
  };
  const move = e => {
    const d = docRef.current; if (!d) return;
    const dr = drag.current, p = pt(e);
    if (statusRef.current) statusRef.current.textContent = `${Math.round(p[0])}, ${Math.round(p[1])} px`;
    if (!dr) { hover.current = p; if ([...PAINT, ...DAB].includes(tool) || poly.current || (tool === 'clone' && cloneRef.current.src)) draw(); return; }
    hover.current = p;
    if (dr.k === 'pan') { const sc = scrollRef.current; sc.scrollLeft = dr.l - (e.clientX - dr.x); sc.scrollTop = dr.t - (e.clientY - dr.y); return; }
    if (dr.k === 'move') { dr.l.x = dr.x + p[0] - dr.p[0]; dr.l.y = dr.y + p[1] - dr.p[1]; touchless(); }
    else if (dr.k === 'scale') { const k = Math.max(0.02, Math.hypot(p[0] - dr.c[0], p[1] - dr.c[1]) / dr.d0); dr.l.sx = dr.sx * k; dr.l.sy = dr.sy * k; touchless(); }
    else if (dr.k === 'rot') { let r = dr.r0 + (Math.atan2(p[1] - dr.c[1], p[0] - dr.c[0]) - dr.a0) * 180 / Math.PI; if (e.shiftKey) r = Math.round(r / 15) * 15; dr.l.rot = ((r % 360) + 360) % 360; touchless(); }
    else if (dr.k === 'marq') dr.q = p;
    else if (dr.k === 'lasso') dr.pts.push(p);
    else if (dr.k === 'grad') dr.q = p;
    else if (dr.k === 'cropN') cropRef.current = { x: Math.min(p[0], dr.p[0]), y: Math.min(p[1], dr.p[1]), w: Math.abs(p[0] - dr.p[0]), h: Math.abs(p[1] - dr.p[1]) };
    else if (dr.k === 'cropM') { const c = dr.o; cropRef.current = { ...c, x: Math.min(d.w - c.w, Math.max(0, c.x + p[0] - dr.p[0])), y: Math.min(d.h - c.h, Math.max(0, c.y + p[1] - dr.p[1])) }; }
    else if (dr.k === 'cropH') { const c = dr.o, ox = dr.hi === 0 || dr.hi === 3 ? c.x + c.w : c.x, oy = dr.hi < 2 ? c.y + c.h : c.y; cropRef.current = { x: Math.min(p[0], ox), y: Math.min(p[1], oy), w: Math.abs(p[0] - ox), h: Math.abs(p[1] - oy) }; }
    else if (dr.k === 'stroke') dr.s.to(p);
    else if (dr.k === 'dab') { dabTool(dr, p); return; }
    else if (dr.k === 'shape') {
      const ctx = dr.ctx, a = dr.p, b = p; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, d.w, d.h); ctx.drawImage(dr.base, 0, 0);
      let tc = ctx, tmpC = null;
      if (d.sel) { tmpC = shapeTmp.current && shapeTmp.current.width === d.w && shapeTmp.current.height === d.h ? shapeTmp.current : (shapeTmp.current = mkCanvas(d.w, d.h)); tc = tmpC.getContext('2d'); tc.setTransform(1, 0, 0, 1, 0, 0); tc.globalCompositeOperation = 'source-over'; tc.clearRect(0, 0, d.w, d.h); }
      tc.globalAlpha = o.opacity / 100; tc.fillStyle = fg; tc.strokeStyle = o.shapeFill ? bg : fg; tc.lineWidth = o.shapeFill ? o.strokeW : Math.max(1, o.strokeW); tc.lineCap = 'round'; tc.beginPath();
      if (o.shapeK === 'line') { tc.strokeStyle = fg; tc.lineWidth = Math.max(1, o.strokeW); tc.moveTo(a[0], a[1]); tc.lineTo(b[0], b[1]); tc.stroke(); }
      else { if (o.shapeK === 'rect') tc.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); else tc.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2); if (o.shapeFill) tc.fill(); if (o.shapeStroke || !o.shapeFill) tc.stroke(); }
      tc.globalAlpha = 1;
      if (tmpC) { tc.globalCompositeOperation = 'destination-in'; tc.drawImage(selCanvasOf(d), 0, 0); tc.globalCompositeOperation = 'source-over'; ctx.drawImage(tmpC, 0, 0); }
      ctx.restore(); touch(dr.l);
    }
    draw();
  };
  const touchless = () => inval();
  const up = () => {
    const d = docRef.current, dr = drag.current; drag.current = null; if (!d || !dr || dr.k === 'pan') return;
    if (dr.k === 'marq') {
      const w = Math.abs(dr.q[0] - dr.p[0]), h = Math.abs(dr.q[1] - dr.p[1]);
      if (w < 2 && h < 2) { if (dr.mode === 'new') selNone(); else draw(); return; }
      const x0 = Math.min(dr.p[0], dr.q[0]), y0 = Math.min(dr.p[1], dr.q[1]);
      setSelection(raster(x => { x.beginPath(); if (o.marq === 'ellipse') x.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, 7); else x.rect(Math.round(x0), Math.round(y0), Math.round(w), Math.round(h)); x.fill(); }), dr.mode); return;
    }
    if (dr.k === 'lasso') { if (dr.pts.length > 2) setSelection(polyMask(dr.pts), dr.mode); else draw(); return; }
    if (dr.k === 'cropN' || dr.k === 'cropM' || dr.k === 'cropH') { const c = cropRef.current; if (c && (c.w < 3 || c.h < 3)) cropRef.current = null; bump(); return; }
    if (dr.k === 'grad') {
      if (Math.hypot(dr.q[0] - dr.p[0], dr.q[1] - dr.p[1]) < 2) { draw(); return; }
      const tg = paintTarget(); if (!tg) return;
      if (tg.mask) {
        const x = tg.canvas.getContext('2d'), id = x.getImageData(0, 0, d.w, d.h), a0 = lum(fg), a1 = lum(bg), dx = dr.q[0] - dr.p[0], dy = dr.q[1] - dr.p[1], l2 = dx * dx + dy * dy, sel = d.sel ? d.sel.mask : null;
        for (let y = 0; y < d.h; y++) for (let xx = 0; xx < d.w; xx++) { const q = y * d.w + xx, s = sel ? sel[q] / 255 : 1; if (!s) continue; let tt = o.gradK === 'radial' ? Math.hypot(xx - dr.p[0], y - dr.p[1]) / Math.sqrt(l2) : ((xx - dr.p[0]) * dx + (y - dr.p[1]) * dy) / l2; tt = Math.min(1, Math.max(0, tt)); const v = a0 + (a1 - a0) * tt; id.data[q * 4 + 3] = id.data[q * 4 + 3] + (v - id.data[q * 4 + 3]) * s; id.data[q * 4] = id.data[q * 4 + 1] = id.data[q * 4 + 2] = 255; }
        x.putImageData(id, 0, 0); touchMask(tg.a); commitBump('Degradado'); return;
      }
      const c0 = hexToRgba(fg), c1 = o.gradM === 'fgbg' ? hexToRgba(bg) : [c0[0], c0[1], c0[2], 0];
      pixApply('Degradado', (img, sel) => fillGradient(img, o.gradK, dr.p[0], dr.p[1], dr.q[0], dr.q[1], c0, c1, sel, o.opacity / 100)); return;
    }
    if (dr.k === 'stroke') { dr.s.end(); if (dr.tg.mask) touchMask(dr.tg.a); else touch(dr.tg.a); commitBump(tool === 'eraser' ? 'Goma' : tool === 'pencil' ? 'Lápiz' : 'Pincel'); return; }
    if (dr.k === 'dab') { commitBump(TOOLS.find(x => x[0] === tool)[3]); return; }
    if (dr.k === 'shape') { commitBump('Forma'); return; }
    if (dr.k === 'move' && dr.l.x === dr.x && dr.l.y === dr.y) return;
    commitBump(dr.k === 'move' ? 'Mover' : dr.k === 'scale' ? 'Escalar' : 'Girar');
  };

  // ── keyboard / paste / wheel ──
  const zoomAt = (cx, cy, f) => {
    const s = scrollRef.current, r = s.getBoundingClientRect(); setZoom(z => {
      const nz = Math.min(16, Math.max(0.03, z * f)), mx = cx - r.left, my = cy - r.top;
      pend.current = { dx: (s.scrollLeft + mx - PAD) / z, dy: (s.scrollTop + my - PAD) / z, mx, my }; return nz;
    });
  };
  const kd = useRef(null);
  kd.current = e => {
    const d = docRef.current; if (!d) return;
    const tg = e.target || {}; if (tg.tagName === 'INPUT' && tg.type !== 'range' && tg.type !== 'checkbox' && tg.type !== 'color' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (k === ' ') { e.preventDefault(); space.current = e.type === 'keydown'; return; }
    if (e.type !== 'keydown') return;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(d); else undo(d); bump(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(d); bump(); return; }
    if (mod && k === 'd') { e.preventDefault(); selNone(); return; }
    if (mod && k === 'a') { e.preventDefault(); selAll(); return; }
    if (mod && k === 'i' && e.shiftKey) { e.preventDefault(); selInvert(); return; }
    if (mod && k === 'j') { e.preventDefault(); api.dup(); return; }
    if (mod && k === 'e') { e.preventDefault(); if (e.shiftKey) api.mergeVisible(); else api.mergeDown(); return; }
    if (mod && k === '0') { e.preventDefault(); fit(); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25); return; }
    if (mod && k === '-') { e.preventDefault(); zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8); return; }
    if (mod) return;
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); if (e.altKey) fillSel(fg); else delSel(); return; }
    if (k === 'enter') { if (poly.current) closePoly(); else if (tool === 'crop') applyCrop(); return; }
    if (k === 'escape') { if (poly.current) { poly.current = null; draw(); } else if (cropRef.current) { cropRef.current = null; bump(); } else selNone(); return; }
    if (k === '[') { set('size', Math.max(1, o.size - (o.size > 20 ? 5 : 1))); return; }
    if (k === ']') { set('size', o.size + (o.size >= 20 ? 5 : 1)); return; }
    if (k === '{') { set('hard', Math.max(0, o.hard - 10)); return; }
    if (k === '}') { set('hard', Math.min(100, o.hard + 10)); return; }
    if (k === 'x') { setFg(bg); setBg(fg); return; }
    if (k === 'd') { setFg('#000000'); setBg('#ffffff'); return; }
    if (/^[0-9]$/.test(k) && PAINT.concat(DAB, ['bucket', 'gradient', 'shape']).includes(tool)) { set('opacity', k === '0' ? 100 : +k * 10); return; }
    if (k.startsWith('arrow') && tool === 'move') { const a = activeOf(d); if (a && !isAdj(a) && !a.locked) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; a.x += k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0; a.y += k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0; touch(a); commitBump('Mover'); } return; }
    const tl = TOOLS.find(x => x[1].toLowerCase() === k); if (tl) { if (tl[0] === 'move' || tl[0] !== tool || true) setTool(tl[0]); }
  };
  const addRef = useRef(null); addRef.current = addImageFile;
  useEffect(() => {
    const f = e => kd.current(e), ps = e => { const fs = imageFilesOf((e.clipboardData || {}).files); if (fs.length) { e.preventDefault(); fs.forEach(addRef.current); } };
    window.addEventListener('keydown', f); window.addEventListener('keyup', f); window.addEventListener('paste', ps);
    return () => { window.removeEventListener('keydown', f); window.removeEventListener('keyup', f); window.removeEventListener('paste', ps); };
  }, []);
  const wheelRef = useRef(null); wheelRef.current = e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); };
  useEffect(() => { const s = scrollRef.current; if (!s) return undefined; const w = e => wheelRef.current(e); s.addEventListener('wheel', w, { passive: false }); return () => s.removeEventListener('wheel', w); }, [ready]);
  useEffect(() => { if (tool !== 'lasso' && poly.current) { poly.current = null; draw(); } if (tool !== 'crop') cropRef.current = null; }, [tool]);

  const showBrush = [...PAINT, ...DAB].includes(tool);
  const hist = doc ? doc.hist : [];
  const canUndo = !!doc && doc.hi > 0, canRedo = !!doc && doc.hi < hist.length - 1;
  const toolDef = TOOLS.find(x => x[0] === tool);
  const cursor = space.current || tool === 'hand' ? 'grab' : tool === 'move' ? 'default' : tool === 'zoom' ? 'zoom-in' : [...PAINT, ...DAB].includes(tool) ? 'none' : 'crosshair';

  return (
    <Dialog.Root open onOpenChange={o2 => { if (!o2) cancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.7)', zIndex: 9000 }} />
        <Dialog.Content data-image-editor aria-describedby={undefined} onEscapeKeyDown={e => e.preventDefault()} onInteractOutside={e => e.preventDefault()}
          style={{ position: 'fixed', inset: 0, zIndex: 9001, display: 'flex', flexDirection: 'column', background: P.bg, color: P.text, fontFamily: 'inherit', outline: 'none', colorScheme: 'dark' }}>
          <TipProvider>
            <style>{'[data-radix-popper-content-wrapper]{z-index:10050 !important}'}</style>
            {/* top bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: P.bar, borderBottom: '1px solid ' + P.line, flexWrap: 'wrap' }}>
              <Dialog.Title style={{ fontSize: 13, fontWeight: 700, margin: 0, marginRight: 10 }}>{init.mode === 'compose' ? t('Componer cara') : t('Editar imagen')}{doc ? <span style={{ fontWeight: 400, color: P.mut, fontFamily: MONO, fontSize: 11, marginLeft: 8 }}>{doc.w}×{doc.h} px</span> : null}</Dialog.Title>
              <DBtn icon={IconArrowBackUp} label={t('Deshacer') + ' (Ctrl+Z)'} disabled={!canUndo} onClick={() => { undo(doc); bump(); }} />
              <DBtn icon={IconArrowForwardUp} label={t('Rehacer') + ' (Ctrl+Shift+Z)'} disabled={!canRedo} onClick={() => { redo(doc); bump(); }} />
              <Div />
              <DBtn icon={IconZoomOut} label={t('Alejar') + ' (Ctrl+-)'} onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8)} />
              <span style={{ fontFamily: MONO, fontSize: 11, width: 46, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
              <DBtn icon={IconZoomIn} label={t('Acercar') + ' (Ctrl++)'} onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25)} />
              <DBtn icon={IconFocusCentered} label={t('Ajustar a la ventana') + ' (Ctrl+0)'} onClick={fit} />
              <DBtn icon={IconGridDots} label={t('Cuadrícula')} on={grid} onClick={() => setGrid(v => !v)} />
              <Div />
              <DBtn icon={IconSelectAll} label={t('Seleccionar todo') + ' (Ctrl+A)'} disabled={!doc} onClick={selAll} />
              <DBtn icon={IconDeselect} label={t('Deseleccionar') + ' (Ctrl+D)'} disabled={!doc || !doc.sel} onClick={selNone} />
              <DBtn icon={IconSwitch} label={t('Invertir selección') + ' (Ctrl+Shift+I)'} disabled={!doc} onClick={selInvert} />
              <DBtn icon={IconCrop} label={t('Recortar documento a la selección')} disabled={!doc || !doc.sel} onClick={cropToSel} />
              <Div />
              <DBtn icon={IconRotate} label={t('Girar lienzo 90° a la izquierda')} disabled={!doc} onClick={() => { imgOp(dd => rotateDoc(dd, 270), 'Girar lienzo'); requestAnimationFrame(fit); }} />
              <DBtn icon={IconRotateClockwise} label={t('Girar lienzo 90° a la derecha')} disabled={!doc} onClick={() => { imgOp(dd => rotateDoc(dd, 90), 'Girar lienzo'); requestAnimationFrame(fit); }} />
              <DBtn icon={IconFlipHorizontal} label={t('Voltear lienzo horizontal')} disabled={!doc} onClick={() => imgOp(dd => flipDoc(dd, 'x'), 'Voltear lienzo')} />
              <DBtn icon={IconFlipVertical} label={t('Voltear lienzo vertical')} disabled={!doc} onClick={() => imgOp(dd => flipDoc(dd, 'y'), 'Voltear lienzo')} />
              <Div />
              <DBtn icon={IconPhotoPlus} label={t('Añadir imagen desde archivo')} onClick={pickFile} />
              <DBtn icon={IconClipboard} label={t('Pegar imagen del portapapeles (Ctrl+V)')} onClick={pasteClip} />
              <div style={{ flex: 1 }} />
              <TextBtn icon={IconX} onClick={cancel}>{t('Cancelar')}</TextBtn>
              <TextBtn icon={IconCheck} primary onClick={doApply} disabled={!doc}>{init.mode === 'compose' ? t('Insertar en la cara') : t('Aplicar a la capa')}</TextBtn>
            </div>

            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* toolbox */}
              <div style={{ width: 78, flex: 'none', background: P.bar, borderRight: '1px solid ' + P.line, padding: 6, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                  {TOOLS.map(([id, key, I, lb]) => <DBtn key={id} icon={I} size={32} on={tool === id} label={`${t(lb)} (${key})`} onClick={() => setTool(id)} style={{ width: '100%' }} />)}
                </div>
                <div style={{ position: 'relative', height: 52, margin: '2px 4px' }}>
                  <label title={t('Color de fondo')} style={{ position: 'absolute', right: 0, bottom: 0, width: 28, height: 28, background: bg, border: '2px solid ' + P.text, borderRadius: 4, cursor: 'pointer' }}>
                    <input type="color" aria-label={t('Color de fondo')} value={bg} onChange={e => setBg(e.target.value)} style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} /></label>
                  <label title={t('Color de primer plano')} style={{ position: 'absolute', left: 0, top: 0, width: 28, height: 28, background: fg, border: '2px solid ' + P.text, borderRadius: 4, cursor: 'pointer', zIndex: 1 }}>
                    <input type="color" aria-label={t('Color de primer plano')} value={fg} onChange={e => setFg(e.target.value)} style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} /></label>
                  <DBtn icon={IconArrowsExchange} size={18} label={t('Intercambiar colores') + ' (X)'} onClick={() => { setFg(bg); setBg(fg); }} style={{ position: 'absolute', right: 0, top: 0 }} />
                </div>
              </div>

              {/* canvas column */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <div data-testid="ed-options" style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 50, padding: '4px 12px', background: P.panel, borderBottom: '1px solid ' + P.line, fontSize: 12, flexWrap: 'wrap' }}>
                  <span style={{ color: P.accHi, fontWeight: 700, minWidth: 90 }}>{t(toolDef[3])}</span>
                  {showBrush && <><DRange label={t('Tamaño')} value={o.size} min={1} max={500} onChange={v => set('size', v)} unit=" px" width={130} />
                    {tool !== 'pencil' && <DRange label={t('Dureza')} value={o.hard} min={0} max={100} onChange={v => set('hard', v)} unit="%" width={110} />}
                    <DRange label={PAINT.includes(tool) ? t('Opacidad') : t('Intensidad')} value={o.opacity} min={1} max={100} onChange={v => set('opacity', v)} unit="%" width={110} />
                    {PAINT.includes(tool) && tool !== 'pencil' && <DRange label={t('Flujo')} value={o.flow} min={1} max={100} onChange={v => set('flow', v)} unit="%" width={100} />}</>}
                  {tool === 'dodge' && <Seg value={o.dodge} onChange={v => set('dodge', v)} items={[['dodge', t('Aclarar'), t('Sobreexponer (aclara)')], ['burn', t('Oscurecer'), t('Subexponer (oscurece)')]]} />}
                  {tool === 'clone' && <span style={{ color: P.mut }}>{t('Alt + clic fija el origen; luego pinta')}</span>}
                  {(tool === 'marquee' || tool === 'lasso' || tool === 'wand') && <>
                    <Seg value={o.selMode} onChange={v => set('selMode', v)} items={[['new', 'N', t('Nueva selección')], ['add', '+', t('Añadir (Mayús)')], ['sub', '−', t('Restar (Alt)')], ['int', '∩', t('Intersección (Mayús+Alt)')]]} />
                    <Field label={t('Suavizado')}><Num label={t('Suavizado de borde')} value={o.feather} min={0} max={200} onChange={v => set('feather', Math.max(0, v))} /></Field></>}
                  {tool === 'marquee' && <Seg value={o.marq} onChange={v => set('marq', v)} items={[['rect', <IconSquareDashed size={15} />, t('Rectangular')], ['ellipse', <IconCircleDashed size={15} />, t('Elíptica')]]} />}
                  {tool === 'lasso' && <Seg value={o.lassoK} onChange={v => set('lassoK', v)} items={[['free', <IconLasso size={15} />, t('Lazo libre')], ['poly', <IconLassoPolygon size={15} />, t('Lazo poligonal (Enter cierra)')]]} />}
                  {(tool === 'wand' || tool === 'bucket') && <><DRange label={t('Tolerancia')} value={o.tol} min={0} max={255} onChange={v => set('tol', v)} width={130} />
                    <Chk checked={o.contig} onChange={v => set('contig', v)}>{t('Contiguo')}</Chk><Chk checked={o.sampleAll} onChange={v => set('sampleAll', v)}>{t('Todas las capas')}</Chk></>}
                  {tool === 'bucket' && <DRange label={t('Opacidad')} value={o.opacity} min={1} max={100} onChange={v => set('opacity', v)} unit="%" width={110} />}
                  {tool === 'wand' && <TextBtn onClick={removeBg} disabled={!l}>{t('Quitar fondo')}</TextBtn>}
                  {tool === 'gradient' && <><Seg value={o.gradK} onChange={v => set('gradK', v)} items={[['linear', t('Lineal'), t('Degradado lineal')], ['radial', t('Radial'), t('Degradado radial')]]} />
                    <Seg value={o.gradM} onChange={v => set('gradM', v)} items={[['fgbg', t('Frente → fondo'), t('Del color frontal al de fondo')], ['fgt', t('Frente → transp.'), t('Del color frontal a transparente')]]} />
                    <DRange label={t('Opacidad')} value={o.opacity} min={1} max={100} onChange={v => set('opacity', v)} unit="%" width={110} /></>}
                  {tool === 'shape' && <><Seg value={o.shapeK} onChange={v => set('shapeK', v)} items={[['rect', <IconSquare size={15} />, t('Rectángulo')], ['ellipse', <IconCircle size={15} />, t('Elipse')], ['line', <IconLine size={15} />, t('Línea')]]} />
                    {o.shapeK !== 'line' && <><Chk checked={o.shapeFill} onChange={v => set('shapeFill', v)}>{t('Relleno')}</Chk><Chk checked={o.shapeStroke} onChange={v => set('shapeStroke', v)}>{t('Trazo (color de fondo)')}</Chk></>}
                    <DRange label={t('Grosor')} value={o.strokeW} min={1} max={100} onChange={v => set('strokeW', v)} unit=" px" width={110} /></>}
                  {tool === 'text' && <>
                    <textarea aria-label={t('Texto')} rows={1} placeholder={t('Escribe y haz clic en el lienzo')} value={o.text} onChange={e => set('text', e.target.value)} style={{ width: 220, resize: 'none', background: P.bg, color: P.text, border: '1px solid ' + P.line, borderRadius: 5, padding: '5px 7px', fontSize: 12, fontFamily: 'inherit' }} />
                    <FontPicker value={o.font} onChange={v => set('font', v)} style={{ width: 170 }} />
                    <DRange label={t('Tamaño')} value={o.fsize} min={8} max={600} onChange={v => set('fsize', v)} unit=" px" width={120} />
                    <DBtn icon={IconBold} label={t('Negrita')} on={o.bold} onClick={() => set('bold', !o.bold)} /><DBtn icon={IconItalic} label={t('Cursiva')} on={o.italic} onClick={() => set('italic', !o.italic)} /></>}
                  {tool === 'eyedrop' && <><Chk checked={o.eyeAll} onChange={v => set('eyeAll', v)}>{t('Muestrear la imagen completa')}</Chk><span style={{ color: P.mut }}>{t('Clic = color frontal · Alt+clic = color de fondo')}</span></>}
                  {tool === 'move' && <span style={{ color: P.mut }}>{t('Arrastra la capa; esquinas = escala; punto superior = giro (Shift = 15°)')}</span>}
                  {tool === 'crop' && <><TextBtn primary icon={IconCheck} onClick={applyCrop} disabled={!cropRef.current}>{t('Aplicar recorte')} (Enter)</TextBtn><span style={{ color: P.mut }}>{t('Arrastra un rectángulo; las esquinas lo redimensionan')}</span></>}
                  {tool === 'zoom' && <span style={{ color: P.mut }}>{t('Clic acerca · Alt+clic aleja · la rueda también hace zoom')}</span>}
                  {tool === 'hand' && <span style={{ color: P.mut }}>{t('Arrastra para mover la vista (Espacio en cualquier herramienta)')}</span>}
                </div>
                <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', background: P.canvas, position: 'relative' }} data-testid="ed-scroll">
                  {!ready ? <div style={{ padding: 30, color: P.text, fontSize: 13 }}>{t('Cargando…')}</div> : (
                    <div style={{ minWidth: '100%', minHeight: '100%', display: 'flex', boxSizing: 'border-box', width: 'max-content' }}>
                      <div style={{ margin: 'auto', padding: PAD, flex: 'none' }}>
                        <div style={{ width: doc.w * zoom, height: doc.h * zoom, position: 'relative', cursor, touchAction: 'none', background: 'repeating-conic-gradient(#cfcac0 0% 25%, #f1eee7 0% 50%) 0 0 / 16px 16px', boxShadow: '0 4px 28px rgba(0,0,0,.6)' }}
                          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => { if (poly.current) closePoly(); }} onPointerLeave={() => { hover.current = null; if (!drag.current) draw(); }}>
                          <canvas ref={mainRef} data-testid="ed-main" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: zoom > 3 ? 'pixelated' : 'auto' }} />
                          <canvas ref={ovRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', imageRendering: 'pixelated' }} />
                          {grid && <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)', backgroundSize: `${Math.max(8, 100 * zoom)}px ${Math.max(8, 100 * zoom)}px, ${Math.max(8, 100 * zoom)}px ${Math.max(8, 100 * zoom)}px`, mixBlendMode: 'difference' }} />}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '3px 12px', background: P.bar, borderTop: '1px solid ' + P.line, fontFamily: MONO, fontSize: 10.5, color: P.mut }}>
                  <span ref={statusRef}>0, 0 px</span>
                  {doc && doc.sel && doc.sel.bounds && <span>{t('Selección')}: {doc.sel.bounds[2]}×{doc.sel.bounds[3]}</span>}
                  {doc && doc.editMask && l && l.mask && <span style={{ color: P.accHi }}>{t('Editando máscara')}</span>}
                  <span style={{ flex: 1 }} /><span data-testid="ed-msg" style={{ color: P.accHi, fontFamily: 'inherit' }}>{msg}</span>
                  <span>{t('Rueda: zoom · Espacio + arrastrar: mover vista')}</span>
                </div>
              </div>

              {/* right column: tabs on top, layers below */}
              <div style={{ width: 310, flex: 'none', background: P.panel, borderLeft: '1px solid ' + P.line, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', borderBottom: '1px solid ' + P.line, background: P.bar }}>
                  {[['adjust', t('Ajustes')], ['filters', t('Filtros')], ['history', t('Historial')], ['ai', t('IA')]].map(([id, lb]) => (
                    <button key={id} type="button" data-tab={id} onClick={() => setTab(id)} style={{ flex: 1, padding: '8px 0', border: 'none', borderBottom: '2px solid ' + (tab === id ? P.accHi : 'transparent'), background: 'transparent', color: tab === id ? P.text : P.mut, fontSize: 12, fontWeight: tab === id ? 700 : 400, cursor: 'pointer' }}>{lb}</button>
                  ))}
                </div>
                <div style={{ flex: '1 1 0', overflowY: 'auto', borderBottom: '1px solid ' + P.line, minHeight: 150 }}>
                  {doc && tab === 'adjust' && <AdjustPanel doc={doc} t={t} api={api} />}
                  {doc && tab === 'filters' && <FilterPanel doc={doc} t={t} api={api} />}
                  {doc && tab === 'history' && <HistoryPanel doc={doc} t={t} api={api} />}
                  {doc && tab === 'ai' && <div style={{ padding: 12 }} data-testid="ed-ai"><AIImagePanel getCanvas={getCanvas} applyCanvas={applyCanvas} /></div>}
                </div>
                {doc && <div style={{ flex: '0 0 min(40%, 340px)', minHeight: 0, display: 'flex', flexDirection: 'column' }}><LayersPanel doc={doc} t={t} api={api} /></div>}
              </div>
            </div>
          </TipProvider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
const Div = () => <div style={{ width: 1, height: 20, background: P.line, margin: '0 4px' }} />;
