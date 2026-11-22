// Full-screen basic image editor (Canvas 2D): layers, paint/shape/text tools, selections, adjustments, bg removal.
import React, { useEffect, useReducer, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  IconArrowsMove, IconMarquee, IconWand, IconBrush, IconEraser, IconBucketDroplet, IconSquare, IconCircle, IconLine, IconTypography, IconColorPicker,
  IconArrowBackUp, IconArrowForwardUp, IconZoomIn, IconZoomOut, IconFocusCentered, IconPhotoPlus, IconClipboard, IconPlus, IconCopy, IconTrash, IconEye, IconEyeOff,
  IconArrowUp, IconArrowDown, IconLayersSubtract, IconFlipHorizontal, IconFlipVertical, IconRotateClockwise, IconContrast, IconCircleHalf2, IconCrop, IconDeselect, IconBackground, IconCheck, IconX
} from '@tabler/icons-react';
import { useT } from '../i18n/index.js';
import { imageFilesOf, readImageFile } from '../design/images.js';
import { TipProvider, IconBtn, Range } from './ui.jsx';
import { floodMask, removeBackground, clearMask, fillMask, maskBounds, hexToRgba } from './pixels.js';
import { BLENDS, mkCanvas, cloneCanvas, newLayer, newDoc, activeOf, touch, ensureBaked, adjFilter, applyFilter, render, flatten, mergeDown, commit, undo, redo, layerFromImage, hexOf } from './doc.js';
import { ask, askText, notify } from '../ui/dialogs.jsx';

const TOOLS = [
  ['move', 'V', IconArrowsMove, 'Mover / transformar'], ['select', 'M', IconMarquee, 'Selección rectangular'], ['wand', 'W', IconWand, 'Varita mágica'],
  ['brush', 'B', IconBrush, 'Pincel'], ['eraser', 'E', IconEraser, 'Goma'], ['fill', 'G', IconBucketDroplet, 'Bote de pintura'],
  ['rect', 'R', IconSquare, 'Rectángulo'], ['ellipse', 'O', IconCircle, 'Elipse'], ['line', 'L', IconLine, 'Línea'],
  ['text', 'T', IconTypography, 'Texto'], ['eyedrop', 'I', IconColorPicker, 'Cuentagotas']
];
const ZERO = { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0 };
const FONTS = ['Noto Sans', 'Noto Serif', 'JetBrains Mono'];
const lab = { fontSize: 10.5, color: '#8a8071', marginBottom: 3 };
const fld = { width: '100%', boxSizing: 'border-box', padding: '5px 6px', border: '1px solid #d8d0c2', borderRadius: 5, background: '#fff', fontSize: 12, color: '#211d18' };
const Sec = ({ title, children }) => <div style={{ padding: 12, borderBottom: '1px solid #e7e0d4' }}><div style={{ fontSize: 10.5, letterSpacing: '0.16em', color: '#8a8071', fontWeight: 700, marginBottom: 8 }}>{title}</div>{children}</div>;
const isOpaque = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return false; return true; };

// Corner/rotate-handle geometry of a layer in document space.
function geo(l, z) {
  const cw = l.canvas.width, ch = l.canvas.height, c = [l.x + cw / 2, l.y + ch / 2], th = l.rot * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
  const rot = (x, y) => [c[0] + x * co - y * si, c[1] + x * si + y * co];
  const hw = cw * l.sx / 2, hh = ch * l.sy / 2;
  return { c, corners: [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)], rotH: rot(0, -Math.abs(hh) - 26 / z) };
}
function hitLayer(l, p) {
  const cw = l.canvas.width, ch = l.canvas.height, th = -l.rot * Math.PI / 180, dx = p[0] - (l.x + cw / 2), dy = p[1] - (l.y + ch / 2);
  const lx = Math.floor((dx * Math.cos(th) - dy * Math.sin(th)) / l.sx + cw / 2), ly = Math.floor((dx * Math.sin(th) + dy * Math.cos(th)) / l.sy + ch / 2);
  if (lx < 0 || ly < 0 || lx >= cw || ly >= ch) return false;
  return l.canvas.getContext('2d').getImageData(lx, ly, 1, 1).data[3] > 8;
}

export function ImageEditor({ init, onApply, onClose }) {
  const t = useT();
  const docRef = useRef(null), mainRef = useRef(null), ovRef = useRef(null), scrollRef = useRef(null), drag = useRef(null), space = useRef(false);
  const [, bump] = useReducer(x => x + 1, 0);
  const [tool, setTool] = useState('move'), [color, setColor] = useState('#211d18'), [size, setSize] = useState(24), [shapeFill, setShapeFill] = useState(true);
  const [tol, setTol] = useState(24), [feather, setFeather] = useState(2), [text, setText] = useState(''), [fontSize, setFontSize] = useState(96), [font, setFont] = useState(FONTS[0]);
  const [zoom, setZoom] = useState(1), [adj, setAdj] = useState(ZERO), [ready, setReady] = useState(false);
  const doc = docRef.current, l = doc && activeOf(doc);

  // Build the document (edit: the image; compose: white background of the face size).
  useEffect(() => {
    const done = d => { commit(d); docRef.current = d; setReady(true); };
    if (init.mode === 'compose') {
      const d = newDoc(init.w, init.h), c = mkCanvas(init.w, init.h), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      const bg = newLayer(t('Fondo'), c); d.layers.push(bg); d.activeId = bg.id; done(d);
      return;
    }
    const im = new Image();
    im.onload = () => {
      const cr = init.crop || [0, 0, 1, 1], sw = im.naturalWidth * cr[2], sh = im.naturalHeight * cr[3], k = Math.min(1, 4096 / Math.max(sw, sh));
      const d = newDoc(Math.round(sw * k), Math.round(sh * k)), c = mkCanvas(d.w, d.h);
      c.getContext('2d').drawImage(im, cr[0] * im.naturalWidth, cr[1] * im.naturalHeight, sw, sh, 0, 0, c.width, c.height);
      const ly = newLayer(t('Imagen'), c); d.layers.push(ly); d.activeId = ly.id; done(d);
    };
    im.src = init.src;
  }, []);

  const fit = () => { const s = scrollRef.current, d = docRef.current; if (s && d && s.clientWidth > 50) setZoom(Math.min(4, (s.clientWidth - 40) / d.w, (s.clientHeight - 40) / d.h)); };
  useEffect(() => { if (ready) requestAnimationFrame(fit); }, [ready]); // wait for the dialog layout

  const draw = () => {
    const d = docRef.current, cv = mainRef.current, ov = ovRef.current; if (!d || !cv) return;
    if (cv.width !== d.w || cv.height !== d.h) { cv.width = ov.width = d.w; cv.height = ov.height = d.h; }
    render(d, cv.getContext('2d'), adjFilter(adj));
    const o = ov.getContext('2d'); o.clearRect(0, 0, d.w, d.h);
    const lw = 1.5 / zoom, s = d.sel;
    if (s && s.kind === 'rect') { o.lineWidth = lw; o.setLineDash([6 / zoom, 6 / zoom]); o.strokeStyle = '#fff'; o.strokeRect(s.x, s.y, s.w, s.h); o.lineDashOffset = 6 / zoom; o.strokeStyle = '#000'; o.strokeRect(s.x, s.y, s.w, s.h); o.setLineDash([]); o.lineDashOffset = 0; }
    if (s && s.kind === 'mask') o.drawImage(s.overlay, 0, 0);
    const a = activeOf(d);
    if (tool === 'move' && a) {
      const g = geo(a, zoom), hs = 8 / zoom;
      o.lineWidth = lw; o.strokeStyle = '#9a5b1f'; o.beginPath(); g.corners.forEach((q, i) => i ? o.lineTo(q[0], q[1]) : o.moveTo(q[0], q[1])); o.closePath(); o.stroke();
      o.beginPath(); o.moveTo((g.corners[0][0] + g.corners[1][0]) / 2, (g.corners[0][1] + g.corners[1][1]) / 2); o.lineTo(g.rotH[0], g.rotH[1]); o.stroke();
      o.fillStyle = '#fff';
      g.corners.forEach(q => { o.fillRect(q[0] - hs / 2, q[1] - hs / 2, hs, hs); o.strokeRect(q[0] - hs / 2, q[1] - hs / 2, hs, hs); });
      o.beginPath(); o.arc(g.rotH[0], g.rotH[1], hs / 2, 0, 7); o.fill(); o.stroke();
    }
  };
  useEffect(draw);

  const act = fn => { fn(docRef.current); commit(docRef.current); bump(); };
  const pt = e => { const r = mainRef.current.getBoundingClientRect(); return [(e.clientX - r.left) * doc.w / r.width, (e.clientY - r.top) * doc.h / r.height]; };

  const addImageFile = async file => {
    try {
      const a = await readImageFile(file);
      act(d => { const nl = layerFromImage(d, a.img, (file.name || t('Imagen')).replace(/\.[^.]+$/, '').slice(0, 24)); d.layers.push(nl); d.activeId = nl.id; });
    } catch (_) { notify(t('No se pudo leer la imagen. Usa PNG, JPG o WebP.'), { tone: 'error' }); }
  };
  const pickFile = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp'; i.multiple = true;
    i.onchange = () => imageFilesOf(i.files).forEach(addImageFile); i.click();
  };
  const pasteClip = async () => {
    try {
      for (const it of await navigator.clipboard.read()) {
        const ty = it.types.find(x => x.startsWith('image/')); if (ty) { addImageFile(new File([await it.getType(ty)], t('Pegado') + '.png', { type: ty })); return; }
      }
    } catch (_) { notify(t('No se pudo leer el portapapeles'), { tone: 'error' }); }
  };
  const newBlank = () => act(d => { const nl = newLayer(t('Capa {n}', { n: d.layers.length + 1 }), mkCanvas(d.w, d.h)); d.layers.push(nl); d.activeId = nl.id; });
  const dupLayer = () => act(d => { const a = activeOf(d); if (!a) return; const nl = newLayer(a.name + ' ' + t('copia'), cloneCanvas(a.canvas), { x: a.x, y: a.y, rot: a.rot, sx: a.sx, sy: a.sy, opacity: a.opacity, blend: a.blend }); d.layers.splice(d.layers.indexOf(a) + 1, 0, nl); d.activeId = nl.id; });
  const delLayer = () => act(d => { const i = d.layers.findIndex(x => x.id === d.activeId); if (i < 0) return; d.layers.splice(i, 1); d.activeId = d.layers.length ? d.layers[Math.max(0, i - 1)].id : null; });
  const moveLayer = k => act(d => { const i = d.layers.findIndex(x => x.id === d.activeId), j = i + k; if (i < 0 || j < 0 || j >= d.layers.length) return; d.layers.splice(j, 0, d.layers.splice(i, 1)[0]); });
  const setL = (patch, c) => { if (!l) return; Object.assign(l, patch); if (c) commit(doc); bump(); };
  const pix = fn => act(d => { const a = activeOf(d); if (!a) return; const ctx = ensureBaked(d, a), id = ctx.getImageData(0, 0, d.w, d.h); fn(id); ctx.putImageData(id, 0, 0); touch(a); });
  const delSel = () => act(d => {
    const a = activeOf(d), s = d.sel; if (!a || !s) return;
    const ctx = ensureBaked(d, a);
    if (s.kind === 'rect') ctx.clearRect(s.x, s.y, s.w, s.h); else { const id = ctx.getImageData(0, 0, d.w, d.h); clearMask(id, s.mask); ctx.putImageData(id, 0, 0); }
    touch(a); d.sel = null;
  });
  const cropToSel = () => act(d => {
    const s = d.sel; if (!s) return;
    const r = s.kind === 'rect' ? [s.x, s.y, s.w, s.h] : s.bounds; if (!r) return;
    const x0 = Math.max(0, Math.round(r[0])), y0 = Math.max(0, Math.round(r[1])), w = Math.min(d.w - x0, Math.round(r[2])), h = Math.min(d.h - y0, Math.round(r[3]));
    if (w < 1 || h < 1) return;
    d.layers.forEach(a => { a.x -= x0; a.y -= y0; });
    d.w = w; d.h = h; d.sel = null;
  });
  const removeBg = () => pix(id => removeBackground(id, tol, feather));
  const applyAdj = () => { const a = activeOf(doc), f = adjFilter(adj); if (a && f) act(d => applyFilter(d, a, f)); setAdj(ZERO); };
  const quick = f => act(d => { const a = activeOf(d); if (a) applyFilter(d, a, f); });
  const doApply = () => {
    const c = flatten(doc), op = isOpaque(c);
    onApply({ dataURL: op ? c.toDataURL('image/jpeg', 0.95) : c.toDataURL('image/png'), w: c.width, h: c.height });
  };
  const cancel = async () => { if (doc && doc.hi > 0 && !(await ask(t('¿Descartar los cambios?'), { danger: true }))) return; onClose(); };

  // --- pointer interaction ---
  const strokeTo = (ctx, a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  const paintStyle = (ctx, erase) => { ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = size; ctx.lineCap = ctx.lineJoin = 'round'; ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; };
  const shapeTo = (ctx, k, a, b) => {
    ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.beginPath();
    if (k === 'line') { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); return; }
    if (k === 'rect') ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); else ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
    if (shapeFill) ctx.fill(); else ctx.stroke();
  };

  const down = async e => {
    if (!doc) return;
    const sc = scrollRef.current;
    if (e.button === 1 || space.current) { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { k: 'pan', x: e.clientX, y: e.clientY, l: sc.scrollLeft, t: sc.scrollTop }; return; }
    if (e.button !== 0) return;
    const p = pt(e), a = activeOf(doc), cap = () => e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'eyedrop') { const x = Math.min(doc.w - 1, Math.max(0, Math.floor(p[0]))), y = Math.min(doc.h - 1, Math.max(0, Math.floor(p[1]))); const d = mainRef.current.getContext('2d').getImageData(x, y, 1, 1).data; setColor(hexOf(d[0], d[1], d[2])); return; }
    if (tool === 'text') {
      if (!text.trim()) return;
      await document.fonts.load(`${fontSize}px "${font}"`).catch(() => {});
      act(d => { const c = mkCanvas(d.w, d.h), x = c.getContext('2d'); x.font = `${fontSize}px "${font}"`; x.fillStyle = color; x.textBaseline = 'top'; x.fillText(text, p[0], p[1]); const nl = newLayer(text.slice(0, 20), c); d.layers.push(nl); d.activeId = nl.id; });
      return;
    }
    if (tool === 'move') {
      if (a) {
        const g = geo(a, zoom), r = 10 / zoom, near = q => Math.hypot(q[0] - p[0], q[1] - p[1]) < r;
        if (near(g.rotH)) { cap(); drag.current = { k: 'rot', l: a, a0: Math.atan2(p[1] - g.c[1], p[0] - g.c[0]), r0: a.rot, c: g.c }; return; }
        if (g.corners.some(near)) { cap(); drag.current = { k: 'scale', l: a, d0: Math.hypot(p[0] - g.c[0], p[1] - g.c[1]), sx: a.sx, sy: a.sy, c: g.c }; return; }
      }
      const hit = doc.layers.slice().reverse().find(x => x.visible && hitLayer(x, p)) || a;
      if (!hit) return;
      doc.activeId = hit.id; bump(); cap();
      drag.current = { k: 'move', l: hit, p, x: hit.x, y: hit.y }; return;
    }
    if (tool === 'select') { cap(); drag.current = { k: 'sel', p }; return; }
    if (!a || !a.visible) return;
    if (tool === 'wand') {
      const ctx = ensureBaked(doc, a), id = ctx.getImageData(0, 0, doc.w, doc.h), mask = floodMask(id, Math.floor(p[0]), Math.floor(p[1]), tol);
      const ov = mkCanvas(doc.w, doc.h), oc = ov.getContext('2d'), oi = oc.createImageData(doc.w, doc.h);
      for (let i = 0; i < mask.length; i++) if (mask[i]) { oi.data[i * 4] = 154; oi.data[i * 4 + 1] = 91; oi.data[i * 4 + 2] = 31; oi.data[i * 4 + 3] = 120; }
      oc.putImageData(oi, 0, 0);
      doc.sel = { kind: 'mask', mask, overlay: ov, bounds: maskBounds(mask, doc.w, doc.h) }; bump(); return;
    }
    if (tool === 'fill') { pix(id => fillMask(id, floodMask(id, Math.floor(p[0]), Math.floor(p[1]), tol), hexToRgba(color))); return; }
    cap();
    const ctx = ensureBaked(doc, a); ctx.save();
    if (tool === 'brush' || tool === 'eraser') {
      if (doc.sel && doc.sel.kind === 'rect') { ctx.beginPath(); ctx.rect(doc.sel.x, doc.sel.y, doc.sel.w, doc.sel.h); ctx.clip(); }
      paintStyle(ctx, tool === 'eraser'); strokeTo(ctx, p, [p[0] + 0.01, p[1]]);
      drag.current = { k: 'brush', ctx, last: p, l: a };
    } else drag.current = { k: 'shape', ctx, p, base: cloneCanvas(a.canvas), l: a };
    touch(a); draw();
  };
  const move = e => {
    const d = drag.current; if (!d || !doc) return;
    if (d.k === 'pan') { const sc = scrollRef.current; sc.scrollLeft = d.l - (e.clientX - d.x); sc.scrollTop = d.t - (e.clientY - d.y); return; }
    const p = pt(e);
    if (d.k === 'move') { d.l.x = d.x + p[0] - d.p[0]; d.l.y = d.y + p[1] - d.p[1]; }
    else if (d.k === 'scale') { const k = Math.max(0.02, Math.hypot(p[0] - d.c[0], p[1] - d.c[1]) / d.d0); d.l.sx = d.sx * k; d.l.sy = d.sy * k; }
    else if (d.k === 'rot') { let r = d.r0 + (Math.atan2(p[1] - d.c[1], p[0] - d.c[0]) - d.a0) * 180 / Math.PI; if (e.shiftKey) r = Math.round(r / 15) * 15; d.l.rot = ((r % 360) + 360) % 360; }
    else if (d.k === 'sel') doc.sel = { kind: 'rect', x: Math.min(p[0], d.p[0]), y: Math.min(p[1], d.p[1]), w: Math.abs(p[0] - d.p[0]), h: Math.abs(p[1] - d.p[1]) };
    else if (d.k === 'brush') { strokeTo(d.ctx, d.last, p); d.last = p; touch(d.l); }
    else if (d.k === 'shape') { d.ctx.save(); d.ctx.setTransform(1, 0, 0, 1, 0, 0); d.ctx.clearRect(0, 0, doc.w, doc.h); d.ctx.drawImage(d.base, 0, 0); shapeTo(d.ctx, tool, d.p, p); d.ctx.restore(); touch(d.l); }
    draw();
  };
  const up = () => {
    const d = drag.current; drag.current = null; if (!d || d.k === 'pan') return;
    if (d.k === 'brush' || d.k === 'shape') d.ctx.restore();
    if (d.k === 'sel') { if (!doc.sel || doc.sel.w < 2 || doc.sel.h < 2) doc.sel = null; bump(); return; }
    if (d.k === 'move' && d.l.x === d.x && d.l.y === d.y) return;
    commit(doc); bump();
  };

  // --- keyboard / paste / wheel ---
  const kd = useRef(null);
  kd.current = e => {
    if (!doc) return;
    const tg = (e.target || {}).tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (k === ' ') { e.preventDefault(); space.current = e.type === 'keydown'; return; }
    if (e.type !== 'keydown') return;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(doc); else undo(doc); bump(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(doc); bump(); return; }
    if (mod && k === 'd') { e.preventDefault(); doc.sel = null; bump(); return; }
    if (mod) return;
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); delSel(); return; }
    if (k === 'escape') { doc.sel = null; bump(); return; }
    if (k === '[') { setSize(s => Math.max(1, s - (s > 20 ? 5 : 1))); return; }
    if (k === ']') { setSize(s => s + (s >= 20 ? 5 : 1)); return; }
    const tl = TOOLS.find(x => x[1].toLowerCase() === k); if (tl) setTool(tl[0]);
  };
  const addRef = useRef(null); addRef.current = addImageFile;
  useEffect(() => {
    const f = e => kd.current(e), ps = e => { const fs = imageFilesOf((e.clipboardData || {}).files); if (fs.length) { e.preventDefault(); fs.forEach(addRef.current); } };
    window.addEventListener('keydown', f); window.addEventListener('keyup', f); window.addEventListener('paste', ps);
    return () => { window.removeEventListener('keydown', f); window.removeEventListener('keyup', f); window.removeEventListener('paste', ps); };
  }, []);
  useEffect(() => {
    const s = scrollRef.current; if (!s) return;
    const w = e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setZoom(z => Math.min(8, Math.max(0.05, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))); };
    s.addEventListener('wheel', w, { passive: false }); return () => s.removeEventListener('wheel', w);
  }, [ready]);

  const zm = f => setZoom(v => Math.min(8, Math.max(0.05, v * f)));
  const showSize = ['brush', 'eraser', 'rect', 'ellipse', 'line'].includes(tool);
  const adjOn = !!adjFilter(adj);
  const nf = (v, f) => { const x = parseFloat(v); if (Number.isFinite(x)) f(x); };
  const commitBump = () => { commit(doc); bump(); };
  const adjSet = k => v => setAdj(a => ({ ...a, [k]: v }));

  return (
    <Dialog.Root open onOpenChange={o => { if (!o) cancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(33,29,24,.6)', zIndex: 9000 }} />
        <Dialog.Content data-image-editor aria-describedby={undefined} onEscapeKeyDown={e => e.preventDefault()} onInteractOutside={e => e.preventDefault()}
          style={{ position: 'fixed', inset: 0, zIndex: 9001, display: 'flex', flexDirection: 'column', background: '#e9e3d6', color: '#211d18', fontFamily: 'inherit', outline: 'none' }}>
          <TipProvider>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#faf7f0', borderBottom: '1px solid #ded5c4' }}>
              <Dialog.Title style={{ fontSize: 13.5, fontWeight: 700, margin: 0, marginRight: 10 }}>{init.mode === 'compose' ? t('Componer cara') : t('Editar imagen')}{doc ? <span style={{ fontWeight: 400, color: '#8a8071', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, marginLeft: 8 }}>{doc.w}×{doc.h} px</span> : null}</Dialog.Title>
              <IconBtn icon={IconArrowBackUp} label={t('Deshacer') + ' (Ctrl+Z)'} disabled={!doc || doc.hi < 1} onClick={() => { undo(doc); bump(); }} />
              <IconBtn icon={IconArrowForwardUp} label={t('Rehacer') + ' (Ctrl+Y)'} disabled={!doc || doc.hi >= doc.hist.length - 1} onClick={() => { redo(doc); bump(); }} />
              <div style={{ width: 1, height: 20, background: '#ded5c4', margin: '0 4px' }} />
              <IconBtn icon={IconZoomOut} label={t('Alejar')} onClick={() => zm(1 / 1.25)} />
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, width: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
              <IconBtn icon={IconZoomIn} label={t('Acercar')} onClick={() => zm(1.25)} />
              <IconBtn icon={IconFocusCentered} label={t('Ajustar a la ventana')} onClick={fit} />
              <span style={{ fontSize: 10.5, color: '#a59a85', marginLeft: 6 }}>{t('Ctrl + rueda: zoom · Espacio + arrastrar: mover vista')}</span>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={cancel} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, border: '1px solid #d8d0c2', background: '#fff', cursor: 'pointer', fontSize: 12.5 }}><IconX size={15} />{t('Cancelar')}</button>
              <button type="button" onClick={doApply} disabled={!doc} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, border: '1px solid #9a5b1f', background: '#9a5b1f', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}><IconCheck size={15} />{init.mode === 'compose' ? t('Insertar en la cara') : t('Aplicar a la capa')}</button>
            </div>

            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              <div style={{ width: 84, flex: 'none', background: '#faf7f0', borderRight: '1px solid #ded5c4', padding: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, alignContent: 'start' }}>
                {TOOLS.map(([id, key, I, lb]) => <IconBtn key={id} icon={I} on={tool === id} label={`${t(lb)} (${key})`} onClick={() => setTool(id)} size={32} />)}
                <input type="color" aria-label={t('Color')} value={color} onChange={e => setColor(e.target.value)} style={{ gridColumn: '1 / 3', width: '100%', height: 30, padding: 0, border: '1px solid #d8d0c2', borderRadius: 6, background: '#fff', cursor: 'pointer' }} />
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 48, padding: '4px 12px', background: '#f3eee3', borderBottom: '1px solid #ded5c4', fontSize: 12 }}>
                  {showSize && <div style={{ width: 170 }}><Range label={t('Tamaño')} value={size} min={1} max={400} onChange={setSize} unit=" px" /></div>}
                  {(tool === 'rect' || tool === 'ellipse') && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={shapeFill} onChange={e => setShapeFill(e.target.checked)} />{t('Relleno')}</label>}
                  {(tool === 'wand' || tool === 'fill') && <div style={{ width: 170 }}><Range label={t('Tolerancia')} value={tol} min={0} max={255} onChange={setTol} /></div>}
                  {tool === 'text' && <>
                    <input aria-label={t('Texto')} placeholder={t('Escribe y haz clic en el lienzo')} value={text} onChange={e => setText(e.target.value)} style={{ ...fld, width: 230 }} />
                    <select aria-label={t('Tipografía')} value={font} onChange={e => setFont(e.target.value)} style={{ ...fld, width: 140 }}>{FONTS.map(f => <option key={f}>{f}</option>)}</select>
                    <div style={{ width: 150 }}><Range label={t('Tamaño')} value={fontSize} min={8} max={600} onChange={setFontSize} unit=" px" /></div>
                  </>}
                  {tool === 'move' && <span style={{ color: '#8a8071' }}>{t('Arrastra la capa; esquinas = escala; punto superior = giro (Shift = 15°)')}</span>}
                  {tool === 'select' && <span style={{ color: '#8a8071' }}>{t('Arrastra un rectángulo; luego borra o recorta el documento')}</span>}
                  {tool === 'eyedrop' && <span style={{ color: '#8a8071' }}>{t('Haz clic para tomar un color')}</span>}
                </div>
                <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', background: '#4a443c' }}>
                  {!ready ? <div style={{ padding: 30, color: '#e9e3d6', fontSize: 13 }}>{t('Cargando…')}</div> : (
                    <div style={{ width: doc.w * zoom, height: doc.h * zoom, margin: 20, position: 'relative', flex: 'none', cursor: space.current ? 'grab' : tool === 'move' ? 'default' : 'crosshair', touchAction: 'none',
                      background: 'repeating-conic-gradient(#d9d4c9 0% 25%, #f4f1ea 0% 50%) 0 0 / 16px 16px', boxShadow: '0 2px 18px rgba(0,0,0,.45)' }}
                      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                      <canvas ref={mainRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: zoom > 3 ? 'pixelated' : 'auto' }} />
                      <canvas ref={ovRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
                    </div>
                  )}
                </div>
              </div>

              <div style={{ width: 288, flex: 'none', background: '#faf7f0', borderLeft: '1px solid #ded5c4', overflowY: 'auto' }}>
                <Sec title={t('Capas')}>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
                    <IconBtn icon={IconPhotoPlus} label={t('Añadir imagen desde archivo')} onClick={pickFile} />
                    <IconBtn icon={IconClipboard} label={t('Pegar imagen del portapapeles (Ctrl+V)')} onClick={pasteClip} />
                    <IconBtn icon={IconPlus} label={t('Capa vacía')} disabled={!doc} onClick={newBlank} />
                    <IconBtn icon={IconCopy} label={t('Duplicar capa')} disabled={!l} onClick={dupLayer} />
                    <IconBtn icon={IconArrowUp} label={t('Subir')} disabled={!l} onClick={() => moveLayer(1)} />
                    <IconBtn icon={IconArrowDown} label={t('Bajar')} disabled={!l} onClick={() => moveLayer(-1)} />
                    <IconBtn icon={IconLayersSubtract} label={t('Combinar con la inferior')} disabled={!l || doc.layers.indexOf(l) < 1} onClick={() => act(mergeDown)} />
                    <IconBtn icon={IconTrash} label={t('Borrar capa')} disabled={!l} danger onClick={delLayer} />
                  </div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    {doc && doc.layers.slice().reverse().map(x => (
                      <div key={x.id} onClick={() => { doc.activeId = x.id; bump(); }} onDoubleClick={async () => { const n = await askText(t('Nombre de capa'), x.name); if (n) { x.name = n.slice(0, 32); commitBump(); } }}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + (x.id === doc.activeId ? '#9a5b1f' : '#e7e0d4'), background: x.id === doc.activeId ? '#f7efe2' : '#fff' }}>
                        <span onClick={e => { e.stopPropagation(); x.visible = !x.visible; commitBump(); }} role="button" aria-label={t('Mostrar / ocultar')} style={{ display: 'flex', color: x.visible ? '#3d3830' : '#cfc4ab' }}>{x.visible ? <IconEye size={16} /> : <IconEyeOff size={16} />}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span>
                      </div>
                    ))}
                  </div>
                </Sec>
                {l && <Sec title={t('Capa activa')}>
                  <Range label={t('Opacidad')} value={Math.round(l.opacity * 100)} min={0} max={100} unit="%" onChange={v => setL({ opacity: v / 100 })} onCommit={commitBump} />
                  <div style={lab}>{t('Modo de fusión')}</div>
                  <select aria-label={t('Modo de fusión')} value={l.blend} onChange={e => setL({ blend: e.target.value }, true)} style={{ ...fld, marginBottom: 9 }}>{BLENDS.map(b => <option key={b} value={b}>{b === 'source-over' ? t('Normal') : b}</option>)}</select>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
                    <div><div style={lab}>{t('Escala')} %</div><input type="number" aria-label={t('Escala')} value={Math.round(Math.abs(l.sx) * 100)} onChange={e => nf(e.target.value, v => setL({ sx: Math.sign(l.sx) * Math.max(1, v) / 100, sy: Math.sign(l.sy) * Math.max(1, v) / 100 }))} onBlur={commitBump} style={fld} /></div>
                    <div><div style={lab}>{t('Giro °')}</div><input type="number" aria-label={t('Giro °')} value={Math.round(l.rot * 10) / 10} onChange={e => nf(e.target.value, v => setL({ rot: ((v % 360) + 360) % 360 }))} onBlur={commitBump} style={fld} /></div>
                  </div>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <IconBtn icon={IconFlipHorizontal} label={t('Voltear horizontal')} onClick={() => setL({ sx: -l.sx }, true)} />
                    <IconBtn icon={IconFlipVertical} label={t('Voltear vertical')} onClick={() => setL({ sy: -l.sy }, true)} />
                    <IconBtn icon={IconRotateClockwise} label={t('Girar 90°')} onClick={() => setL({ rot: (l.rot + 90) % 360 }, true)} />
                  </div>
                </Sec>}
                {l && <Sec title={t('Ajustes')}>
                  <Range label={t('Brillo')} value={adj.brightness} min={-100} max={100} onChange={adjSet('brightness')} />
                  <Range label={t('Contraste')} value={adj.contrast} min={-100} max={100} onChange={adjSet('contrast')} />
                  <Range label={t('Saturación')} value={adj.saturation} min={-100} max={100} onChange={adjSet('saturation')} />
                  <Range label={t('Matiz')} value={adj.hue} min={-180} max={180} unit="°" onChange={adjSet('hue')} />
                  <Range label={t('Desenfoque')} value={adj.blur} min={0} max={40} unit=" px" onChange={adjSet('blur')} />
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <button type="button" onClick={applyAdj} disabled={!adjOn} style={{ flex: 1, padding: '6px 0', borderRadius: 5, border: '1px solid #9a5b1f', background: adjOn ? '#9a5b1f' : '#fff', color: adjOn ? '#fff' : '#9a5b1f', opacity: adjOn ? 1 : 0.4, cursor: adjOn ? 'pointer' : 'default', fontSize: 12 }}>{t('Aplicar')}</button>
                    <button type="button" onClick={() => setAdj(ZERO)} disabled={!adjOn} style={{ flex: 1, padding: '6px 0', borderRadius: 5, border: '1px solid #d8d0c2', background: '#fff', opacity: adjOn ? 1 : 0.4, cursor: adjOn ? 'pointer' : 'default', fontSize: 12 }}>{t('Restablecer')}</button>
                    <IconBtn icon={IconContrast} label={t('Invertir colores')} onClick={() => quick('invert(1)')} />
                    <IconBtn icon={IconCircleHalf2} label={t('Escala de grises')} onClick={() => quick('grayscale(1)')} />
                  </div>
                </Sec>}
                {l && <Sec title={t('Selección y fondo')}>
                  <Range label={t('Tolerancia')} value={tol} min={0} max={255} onChange={setTol} />
                  <Range label={t('Suavizado de borde')} value={feather} min={0} max={20} unit=" px" onChange={setFeather} />
                  <button type="button" onClick={removeBg} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: '7px 0', marginBottom: 7, borderRadius: 5, border: '1px solid #9a5b1f', background: '#fff', color: '#9a5b1f', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}><IconBackground size={16} />{t('Quitar fondo')}</button>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <IconBtn icon={IconTrash} label={t('Borrar selección') + ' (Supr)'} disabled={!doc.sel} danger onClick={delSel} />
                    <IconBtn icon={IconCrop} label={t('Recortar documento a la selección')} disabled={!doc.sel} onClick={cropToSel} />
                    <IconBtn icon={IconDeselect} label={t('Deseleccionar') + ' (Ctrl+D)'} disabled={!doc.sel} onClick={() => { doc.sel = null; bump(); }} />
                  </div>
                </Sec>}
              </div>
            </div>
          </TipProvider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
