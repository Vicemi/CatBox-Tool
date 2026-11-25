// Lienzo del diseñador: SVG en mm con zoom/pan/reglas/guías + herramientas tipo Photoshop
// (mover/seleccionar, texto, formas, mano, zoom, cuentagotas), transformación con tiradores, multiselección,
// imanes inteligentes, portapapeles y atajos. Copia ampliada del modo diseño de SheetCanvas.
import React, { useRef, useEffect, useState } from 'react';
import { store, useStore } from '../state/store.js';
import { asset } from '../asset.js';
import { bboxOf, rotBBox, textMetrics, shapePathD, drawLayer } from '../design/layers.js';
import { bboxOfPts, containerAt, containerOfLayer, heroContainerOf, clipPtsOf } from '../design/containers.js';
import { dstore, useD, selIdsOf, setSel, setTool } from '../design/ui.js';
import { moveBy, dupLayers, delLayers, copyLayers, pasteLayers, mapLayers } from '../design/ops.js';
import { useT } from '../i18n/index.js';

const r1 = v => Math.round(v * 10) / 10;
const fmt1 = v => (Math.round(v * 10) / 10).toString().replace('.', ',');
const RS = 20; // grosor de las reglas (px)
const MONO = "'JetBrains Mono',monospace";
const tickStep = k => [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(v => v * k >= 70) || 1000;
const hex2 = v => Math.round(v).toString(16).padStart(2, '0');
const union = bs => bs.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[0] + b[2]), Math.max(a[3], b[1] + b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
const SHAPE_LABELS = { rect: 'Rectángulo', round: 'Rectángulo redondeado', ellipse: 'Elipse', triangle: 'Triángulo', polygon: 'Polígono', star: 'Estrella', line: 'Línea' };

function Rulers({ k, tx, ty, w, h, cur, onNew }) {
  const step = tickStep(k), minor = step / (String(step).startsWith('2') ? 4 : 5), showMinor = minor * k >= 5;
  const dec = step < 1 ? 1 : 0;
  const ticks = (len, off) => {
    const out = [], a = Math.floor((-off / k) / minor) * minor, b = (len - off) / k;
    for (let v = a; v <= b; v += minor) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      if (!major && !showMinor) continue;
      out.push({ v: Math.round(v * 1000) / 1000, major, p: off + v * k });
    }
    return out;
  };
  const col = '#8a8071', bg = 'rgba(250,247,240,0.96)';
  return (<>
    <svg width={w - RS} height={RS} draggable={false} style={{ pointerEvents: 'auto', position: 'absolute', left: RS, top: 0, cursor: 'ns-resize', userSelect: 'none', background: bg, borderBottom: '1px solid #ded5c4' }} onPointerDown={e => onNew(e, 'h')}>
      {ticks(w, tx).map(t => t.p >= RS && <g key={t.v} style={{ pointerEvents: 'none' }}><line x1={t.p - RS} x2={t.p - RS} y1={t.major ? 8 : 14} y2={RS} stroke={col} strokeWidth={1} />{t.major && <text x={t.p - RS + 3} y={9} fontSize={8.5} fill={col} style={{ fontFamily: MONO, userSelect: 'none' }}>{t.v.toFixed(dec)}</text>}</g>)}
      {cur && <line x1={tx + cur[0] * k - RS} x2={tx + cur[0] * k - RS} y1={0} y2={RS} stroke="#C8102E" strokeWidth={1} />}
    </svg>
    <svg width={RS} height={h - RS} draggable={false} style={{ pointerEvents: 'auto', position: 'absolute', left: 0, top: RS, cursor: 'ew-resize', userSelect: 'none', background: bg, borderRight: '1px solid #ded5c4' }} onPointerDown={e => onNew(e, 'v')}>
      {ticks(h, ty).map(t => t.p >= RS && <g key={t.v} style={{ pointerEvents: 'none' }}><line y1={t.p - RS} y2={t.p - RS} x1={t.major ? 8 : 14} x2={RS} stroke={col} strokeWidth={1} />{t.major && <text transform={'translate(9 ' + (t.p - RS + 3) + ') rotate(-90)'} fontSize={8.5} fill={col} textAnchor="end" style={{ fontFamily: MONO, userSelect: 'none' }}>{t.v.toFixed(dec)}</text>}</g>)}
      {cur && <line y1={ty + cur[1] * k - RS} y2={ty + cur[1] * k - RS} x1={0} x2={RS} stroke="#C8102E" strokeWidth={1} />}
    </svg>
    <div style={{ position: 'absolute', left: 0, top: 0, width: RS, height: RS, background: bg, borderRight: '1px solid #ded5c4', borderBottom: '1px solid #ded5c4', fontSize: 8, color: col, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO }}>mm</div>
  </>);
}

// Forma nueva a partir de un arrastre (o de un clic: tamaño por defecto centrado).
function draftOf(d, p, kind, color, shift, alt) {
  const base = kind === 'round' ? { shape: 'rect', radius: 4 } : { shape: kind };
  const o = { kind: 'shape', ...base, color, stroke: '#211d18', strokeW: kind === 'line' ? 0.8 : 0, fillOn: true, finish: 'none', visible: true, panelId: d.panelId, rot: 0 };
  const [sx, sy] = d.start;
  if (kind === 'line') {
    let dx = p[0] - sx, dy = p[1] - sy;
    if (shift) { const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12), len = Math.hypot(dx, dy); dx = Math.cos(a) * len; dy = Math.sin(a) * len; }
    const len = Math.hypot(dx, dy), mx = alt ? sx : sx + dx / 2, my = alt ? sy : sy + dy / 2, L = alt ? len * 2 : len;
    return { ...o, w: Math.max(0.1, L), h: 2, x: mx - L / 2, y: my - 1, rot: ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360 };
  }
  let w = p[0] - sx, h = p[1] - sy;
  if (shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
  if (alt) return { ...o, x: sx - Math.abs(w), y: sy - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 };
  return { ...o, x: Math.min(sx, sx + w), y: Math.min(sy, sy + h), w: Math.abs(w), h: Math.abs(h) };
}

export function DesignCanvas({ g, onImageDrop }) {
  const s = useStore();
  const d = useD();
  const t = useT();
  const elRef = useRef(null);
  const drag = useRef(null);
  const userMoved = useRef(false);
  const lastPt = useRef(null);
  const gRef = useRef(g); gRef.current = g;
  const dropRef = useRef(onImageDrop); dropRef.current = onImageDrop;
  const [snapG, setSnapG] = useState(null);
  const [hud, setHud] = useState('');
  const [rulers, setRulers] = useState(true);
  const [grid, setGrid] = useState(false);
  const [guides, setGuides] = useState([]);
  const [cur, setCur] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dropPanel, setDropPanel] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null); // {id, fresh}
  const k = s.k || 1;
  const tool = d.space ? 'hand' : d.tool;
  const ids = selIdsOf(s, d);
  const selLayers = ids.map(id => s.layers.find(l => l.id === id)).filter(l => l && l.visible);
  const single = selLayers.length === 1 ? selLayers[0] : null;
  const hasImageDrag = e => Array.from((e.dataTransfer && e.dataTransfer.items) || []).some(it => it.kind === 'file' && /^image\/(png|jpeg|webp)$/i.test(it.type));

  const mmPt = e => {
    const r = elRef.current.getBoundingClientRect(), st = store.get();
    return [(e.clientX - r.left - st.tx) / st.k, (e.clientY - r.top - st.ty) / st.k];
  };
  const fit = () => {
    const el = elRef.current; if (!el) return;
    const r = el.getBoundingClientRect(); if (r.width < 50) return;
    const bb = g.vbb, pad = Math.min(44, Math.max(10, Math.min(r.width, r.height) * 0.06));
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    const k2 = Math.min((r.width - 2 * pad) / w, (r.height - 2 * pad) / h);
    store.set({ k: k2, tx: (r.width - k2 * w) / 2 - k2 * bb[0], ty: (r.height - k2 * h) / 2 - k2 * bb[1] });
  };
  const zoomAt = (mx, my, f) => {
    const st = store.get(), k2 = Math.min(40, Math.max(0.05, st.k * f)), rf = k2 / st.k;
    store.set({ k: k2, tx: mx - (mx - st.tx) * rf, ty: my - (my - st.ty) * rf });
  };
  useEffect(() => { const raf = requestAnimationFrame(() => { if (!userMoved.current) fit(); }); return () => cancelAnimationFrame(raf); }, [g]);
  useEffect(() => {
    if (s.fitNonce > 0) {
      userMoved.current = false;
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(fit); });
      const timer = setTimeout(fit, 60);
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(timer); };
    }
  }, [s.fitNonce]);
  useEffect(() => {
    const el = elRef.current; if (!el) return;
    const onWheel = e => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const el = elRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); if (!userMoved.current) fit(); });
    ro.observe(el); return () => ro.disconnect();
  }, [g]);

  // —— Atajos de teclado ——
  useEffect(() => {
    const kd = e => {
      const st = store.get();
      if (st.view !== 'design') return;
      if (document.querySelector('[data-image-editor]')) return;
      const tag = (document.activeElement || {}).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const mod = e.metaKey || e.ctrlKey, key = e.key, low = key.length === 1 ? key.toLowerCase() : key;
      const ds = dstore.get(), sids = selIdsOf(st, ds);
      if (key === ' ') { e.preventDefault(); if (!ds.space) dstore.set({ space: true }); return; }
      if (mod) {
        if (low === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); }
        else if (low === 'y') { e.preventDefault(); store.redo(); }
        else if (low === 'a') { e.preventDefault(); setSel(st.layers.filter(l => l.visible && !l.locked).map(l => l.id)); }
        else if (low === 'c' && sids.length) { e.preventDefault(); copyLayers(sids); }
        else if (low === 'x' && sids.length) { e.preventDefault(); copyLayers(sids); delLayers(sids); }
        else if (low === 'v') { if (ds.clip.length) { e.preventDefault(); pasteLayers(); } }
        else if (low === 'd' && sids.length) { e.preventDefault(); dupLayers(sids); }
        return;
      }
      if (e.altKey) return;
      if (low === 'v') setTool('move'); else if (low === 't') setTool('text'); else if (low === 'h') setTool('hand'); else if (low === 'z') setTool('zoom'); else if (low === 'i') setTool('eyedrop');
      else if (low === 'u') { if (e.shiftKey && ds.tool === 'shape') { const o = ['rect', 'round', 'ellipse', 'triangle', 'polygon', 'star', 'line']; dstore.set({ shape: o[(o.indexOf(ds.shape) + 1) % o.length] }); } else setTool('shape'); }
      else if (key === 'Escape') { if (ds.tool !== 'move') setTool('move'); else setSel([]); }
      else if (!sids.length) return;
      else if (key.startsWith('Arrow')) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        moveBy(sids, key === 'ArrowLeft' ? -n : key === 'ArrowRight' ? n : 0, key === 'ArrowUp' ? -n : key === 'ArrowDown' ? n : 0);
      }
      else if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); delLayers(sids); }
      else if (key === 'Enter' && sids.length === 1) { const l = st.layers.find(x => x.id === sids[0]); if (l && l.kind === 'text' && !l.locked) { e.preventDefault(); setEditing({ id: l.id }); } }
      else if (key === '[' || key === ']') { e.preventDefault(); const dd = (key === ']' ? 1 : -1) * (e.shiftKey ? 15 : 1); mapLayers(sids, l => l.locked ? l : { ...l, rot: ((((l.rot || 0) + dd) % 360) + 360) % 360 }); }
    };
    const ku = e => { if (e.key === ' ' && dstore.get().space) dstore.set({ space: false }); };
    const paste = e => {
      if (store.get().view !== 'design') return;
      const tag = (document.activeElement || {}).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault();
      const gg = gRef.current, hero = heroContainerOf(gg), pt = lastPt.current || (hero ? [(bboxOfPts(hero.pts)[0] + bboxOfPts(hero.pts)[2]) / 2, (bboxOfPts(hero.pts)[1] + bboxOfPts(hero.pts)[3]) / 2] : [0, 0]);
      const panel = containerAt(gg, pt) || hero;
      if (panel && dropRef.current) dropRef.current(files, pt, panel);
    };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('paste', paste);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('paste', paste); dstore.set({ space: false }); };
  }, []);

  // —— Imanes: guías manuales, bordes/centros/márgenes de cada cara y bordes/centros de otras capas ——
  const snapTargets = excl => {
    const vT = guides.filter(q => q.axis === 'v').map(q => q.pos), hT = guides.filter(q => q.axis === 'h').map(q => q.pos);
    (g.panels || []).forEach(panel => {
      const pb = bboxOfPts(panel.pts), x0 = pb[0], y0 = pb[1], x1 = pb[2], y1 = pb[3];
      vT.push(x0, (x0 + x1) / 2, x1); hT.push(y0, (y0 + y1) / 2, y1);
      const mg = Math.min(3, (x1 - x0) / 4, (y1 - y0) / 4);
      vT.push(x0 + mg, x1 - mg); hT.push(y0 + mg, y1 - mg);
    });
    s.layers.forEach(o => { if (excl.includes(o.id) || !o.visible) return; const ob = rotBBox(o); vT.push(ob[0], ob[0] + ob[2] / 2, ob[0] + ob[2]); hT.push(ob[1], ob[1] + ob[3] / 2, ob[1] + ob[3]); });
    return { v: vT, h: hT };
  };
  // Mejor ajuste de un conjunto de candidatos a los objetivos: devuelve {off, at} o null.
  const bestSnap = (cands, targets, thr) => {
    let best = thr, res = null;
    targets.forEach(tv => cands.forEach(cd => { const df = Math.abs(cd - tv); if (df < best) { best = df; res = { off: tv - cd, at: tv }; } }));
    return res;
  };

  const startDrag = (e, dd) => {
    if (e.button !== 0) return;
    e.stopPropagation(); userMoved.current = true;
    try { elRef.current.setPointerCapture(e.pointerId); } catch (_) { /* sin captura */ }
    drag.current = dd;
  };

  // —— Capas: pulsar = seleccionar (+Shift/Ctrl alterna) y arrastrar para mover ——
  const onLayerDown = (e, l) => {
    if (e.button !== 0 || tool !== 'move') return;
    e.stopPropagation(); userMoved.current = true;
    let cs = ids;
    if (e.shiftKey || e.ctrlKey || e.metaKey) { cs = ids.includes(l.id) ? ids.filter(x => x !== l.id) : ids.concat([l.id]); setSel(cs); if (!cs.includes(l.id)) return; }
    else if (!ids.includes(l.id)) { cs = [l.id]; setSel(cs); }
    const movers = s.layers.filter(x => cs.includes(x.id) && !x.locked);
    if (!movers.length) return;
    try { elRef.current.setPointerCapture(e.pointerId); } catch (_) { /* sin captura */ }
    const starts = {}; movers.forEach(x => { starts[x.id] = [x.x, x.y]; });
    drag.current = { type: 'move', ids: movers.map(x => x.id), starts, sx: e.clientX, sy: e.clientY, snap: snapTargets(cs), ub: union(movers.map(rotBBox)), moved: false };
  };

  const finishEdit = () => {
    const ed = editing; setEditing(null);
    if (!ed) return;
    const l = store.get().layers.find(x => x.id === ed.id);
    if (l && !String(l.content || '').trim()) delLayers([l.id]);
  };

  // Cuentagotas: renderiza lo visible en una ventana de 3×3 mm y lee el píxel central.
  const pickColor = p => {
    const S = 20, c = document.createElement('canvas'); c.width = c.height = 60;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#fdfcf7'; cx.fillRect(0, 0, 60, 60);
    cx.save(); cx.translate(-(p[0] - 1.5) * S, -(p[1] - 1.5) * S);
    store.get().layers.filter(l => l.visible).forEach(l => drawLayer(cx, l, S, undefined, clipPtsOf(g.panels, l)));
    cx.restore();
    const px = cx.getImageData(30, 30, 1, 1).data, hex = '#' + hex2(px[0]) + hex2(px[1]) + hex2(px[2]);
    dstore.set({ color: hex });
    const tg = selIdsOf(store.get(), dstore.get()).filter(id => { const l = store.get().layers.find(x => x.id === id); return l && (l.kind === 'text' || l.kind === 'shape'); });
    if (tg.length) mapLayers(tg, l => ({ ...l, color: hex }));
    setHud(t('Color') + ' ' + hex);
    setTimeout(() => setHud(''), 1400);
  };

  const onPointerDown = e => {
    userMoved.current = true;
    if (e.button === 1) { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { type: 'pan', x: e.clientX, y: e.clientY, tx: s.tx, ty: s.ty }; return; }
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = mmPt(e), dc = dstore.get();
    if (tool === 'hand') { drag.current = { type: 'pan', x: e.clientX, y: e.clientY, tx: s.tx, ty: s.ty }; return; }
    if (tool === 'zoom') { const r = elRef.current.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.altKey ? 1 / 1.6 : 1.6); return; }
    if (tool === 'eyedrop') { pickColor(p); drag.current = { type: 'none' }; return; }
    if (tool === 'text') {
      const hit = s.layers.slice().reverse().find(l => l.visible && !l.locked && l.kind === 'text' && p[0] >= rotBBox(l)[0] && p[0] <= rotBBox(l)[0] + rotBBox(l)[2] && p[1] >= rotBBox(l)[1] && p[1] <= rotBBox(l)[1] + rotBBox(l)[3]);
      if (hit) { setSel([hit.id]); setTool('move'); drag.current = { type: 'edit', id: hit.id }; return; }
      const panel = containerAt(g, p) || heroContainerOf(g); if (!panel) return;
      const st = store.get(), size = 6;
      const nl = { id: st.seq, kind: 'text', x: p[0], y: p[1] + size * 0.345, content: '', font: 'Noto Sans', size, weight: 400, color: dc.color || '#211d18', finish: 'none', visible: true, panelId: panel.panelId };
      store.set({ layers: st.layers.concat([nl]), seq: st.seq + 1 });
      setSel([nl.id]); setTool('move'); drag.current = { type: 'edit', id: nl.id }; // el editor se abre al soltar: si no, el foco del mousedown lo cierra
      return;
    }
    if (tool === 'shape') {
      const panel = containerAt(g, p) || heroContainerOf(g); if (!panel) return;
      drag.current = { type: 'draw', start: p, panelId: panel.panelId, kind: dc.shape, color: dc.color || (dc.shape === 'line' ? '#211d18' : '#9a5b1f') };
      return;
    }
    // move: pulsar en vacío = marquesina (Shift añade a la selección)
    if (!e.shiftKey) setSel([]);
    drag.current = { type: 'marquee', start: p, base: e.shiftKey ? ids : [] };
  };
  const newGuide = (e, axis) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = mmPt(e);
    setGuides(gs => [...gs, { axis, pos: r1(axis === 'v' ? p[0] : p[1]) }]);
    startDrag(e, { type: 'guide', index: guides.length, axis });
  };

  const onPointerMove = e => {
    if (rulers || tool === 'text' || tool === 'shape') { const p = mmPt(e); setCur(p); lastPt.current = p; } else lastPt.current = mmPt(e);
    const dd = drag.current; if (!dd) return;
    const kk = store.get().k;
    if (dd.type === 'guide') {
      const p = mmPt(e), v = r1(dd.axis === 'v' ? p[0] : p[1]);
      setGuides(gs => gs.map((q, i) => i === dd.index ? { ...q, pos: v } : q));
      setHud((dd.axis === 'v' ? 'X ' : 'Y ') + fmt1(v) + ' mm · ' + t('suelta sobre la regla para quitar'));
      return;
    }
    if (dd.type === 'pan') { store.set({ tx: dd.tx + e.clientX - dd.x, ty: dd.ty + e.clientY - dd.y }); return; }
    if (dd.type === 'marquee') { const p = mmPt(e); setMarquee([dd.start[0], dd.start[1], p[0], p[1]]); return; }
    if (dd.type === 'draw') { setDraft(draftOf(dd, mmPt(e), dd.kind, dd.color, e.shiftKey, e.altKey)); return; }
    if (dd.type === 'rot') {
      const p = mmPt(e), a = Math.atan2(p[1] - dd.cy, p[0] - dd.cx);
      let rot = dd.r0 + (a - dd.a0) * 180 / Math.PI;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      else if (!e.altKey) { const q = Math.round(rot / 90) * 90; if (Math.abs(rot - q) < 4) rot = q; }
      rot = ((Math.round(rot * 10) / 10) % 360 + 360) % 360;
      setHud(fmt1(rot) + '°');
      store.set(st => ({ layers: st.layers.map(l => l.id === dd.id ? { ...l, rot, heroPreset: undefined } : l) }));
      return;
    }
    if (dd.type === 'move') {
      let dx = (e.clientX - dd.sx) / kk, dy = (e.clientY - dd.sy) / kk;
      if (!dd.moved && Math.hypot(e.clientX - dd.sx, e.clientY - dd.sy) < 2) return;
      dd.moved = true;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      let gv = null, gh = null;
      if (!e.altKey) {
        const thr = 6 / kk, ub = dd.ub, nx = ub[0] + dx, ny = ub[1] + dy, w = ub[2] - ub[0], h = ub[3] - ub[1];
        const sv = bestSnap([nx, nx + w / 2, nx + w], dd.snap.v, thr), sh = bestSnap([ny, ny + h / 2, ny + h], dd.snap.h, thr);
        if (sv) { dx += sv.off; gv = sv.at; }
        if (sh) { dy += sh.off; gh = sh.at; }
      }
      setSnapG(gv != null || gh != null ? { v: gv, h: gh } : null);
      setHud('X ' + fmt1(dd.ub[0] + dx) + ' · Y ' + fmt1(dd.ub[1] + dy) + ' mm');
      store.set(st => ({ layers: st.layers.map(l => dd.starts[l.id] ? { ...l, x: dd.starts[l.id][0] + dx, y: dd.starts[l.id][1] + dy, heroPreset: undefined } : l) }));
      return;
    }
    if (dd.type === 'resize') {
      const dx = (e.clientX - dd.sx) / kk, dy = (e.clientY - dd.sy) / kk;
      const rr = (dd.l0.rot || 0) * Math.PI / 180, co = Math.cos(rr), si = Math.sin(rr);
      const dxL = dx * co + dy * si, dyL = -dx * si + dy * co;
      if (dd.cropMode) {
        store.set(st => ({
          layers: st.layers.map(l => {
            if (l.id !== dd.id) return l;
            const cr = (dd.l0.crop || [0, 0, 1, 1]).slice();
            const sx = dd.l0.w / cr[2], sy = dd.l0.h / cr[3];
            let x = dd.l0.x, y = dd.l0.y, w = dd.l0.w, h = dd.l0.h;
            if (dd.mode.includes('e')) { w = Math.max(2, dd.l0.w + dxL); cr[2] = w / sx; }
            if (dd.mode.includes('w')) { x = dd.l0.x + dxL; w = Math.max(2, dd.l0.w - dxL); cr[0] += (dd.l0.w - w) / sx; }
            if (dd.mode.includes('s')) { h = Math.max(1, dd.l0.h + dyL); cr[3] = h / sy; }
            if (dd.mode.includes('n')) { y = dd.l0.y + dyL; h = Math.max(1, dd.l0.h - dyL); cr[1] += (dd.l0.h - h) / sy; }
            if (dd.mode.includes('w')) x = dd.l0.x + (dd.l0.w - w);
            if (dd.mode.includes('n')) y = dd.l0.y + (dd.l0.h - h);
            cr[0] = Math.min(0.95, Math.max(0, cr[0])); cr[1] = Math.min(0.95, Math.max(0, cr[1]));
            cr[2] = Math.min(1 - cr[0], Math.max(0.05, cr[2])); cr[3] = Math.min(1 - cr[1], Math.max(0.05, cr[3]));
            return { ...l, x, y, w, h, crop: cr, heroPreset: undefined };
          })
        }));
        return;
      }
      const b0 = dd.b0, m = dd.mode, isT = dd.isText, minW = isT ? 0.2 : 0.5, minH = isT ? 0.2 : 0.5;
      const hasX = m.includes('e') || m.includes('w'), hasY = m.includes('n') || m.includes('s');
      let gw = hasX ? (m.includes('e') ? dxL : -dxL) : 0, gh = hasY ? (m.includes('s') ? dyL : -dyL) : 0; // crecimiento en cada eje
      const sym = e.altKey ? 2 : 1;
      let w = b0[2] + gw * sym, h = b0[3] + gh * sym;
      if (isT || e.shiftKey) { // proporcional (el texto siempre lo es)
        const fx = w / b0[2], fy = h / b0[3];
        const f = hasX && hasY ? (Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy) : hasX ? fx : fy;
        w = b0[2] * f; h = b0[3] * f;
      }
      w = Math.max(minW, w); h = Math.max(minH, h);
      // Edges respecto al centro antiguo, en el marco local: sin Alt el borde opuesto queda fijo.
      let ex0 = -b0[2] / 2, ex1 = b0[2] / 2, ey0 = -b0[3] / 2, ey1 = b0[3] / 2;
      if (e.altKey) { ex0 = -w / 2; ex1 = w / 2; ey0 = -h / 2; ey1 = h / 2; }
      else {
        if (m.includes('w')) ex0 = ex1 - w; else if (m.includes('e')) ex1 = ex0 + w; else { ex0 = -w / 2; ex1 = w / 2; }
        if (m.includes('n')) ey0 = ey1 - h; else if (m.includes('s')) ey1 = ey0 + h; else { ey0 = -h / 2; ey1 = h / 2; }
      }
      const c0x = b0[0] + b0[2] / 2, c0y = b0[1] + b0[3] / 2;
      if (!rr && !e.shiftKey && !e.altKey && !isT && dd.snap) { // imán de los bordes que se arrastran (solo sin giro)
        const thr = 6 / kk;
        if (m.includes('e')) { const sn = bestSnap([c0x + ex1], dd.snap.v, thr); if (sn) ex1 += sn.off; }
        if (m.includes('w')) { const sn = bestSnap([c0x + ex0], dd.snap.v, thr); if (sn) ex0 += sn.off; }
        if (m.includes('s')) { const sn = bestSnap([c0y + ey1], dd.snap.h, thr); if (sn) ey1 += sn.off; }
        if (m.includes('n')) { const sn = bestSnap([c0y + ey0], dd.snap.h, thr); if (sn) ey0 += sn.off; }
        w = Math.max(minW, ex1 - ex0); h = Math.max(minH, ey1 - ey0);
      }
      const ucx = (ex0 + ex1) / 2, ucy = (ey0 + ey1) / 2; // centro nuevo (local) → mundo
      const ncx = c0x + ucx * co - ucy * si, ncy = c0y + ucx * si + ucy * co;
      setHud(isT ? fmt1(w) + ' mm' : fmt1(w) + ' × ' + fmt1(h) + ' mm');
      store.set(st => ({
        layers: st.layers.map(l => {
          if (l.id !== dd.id) return l;
          if (isT) {
            const size = Math.min(120, Math.max(1.5, dd.l0.size * (w / b0[2])));
            const nl = { ...dd.l0, size, heroPreset: undefined }, bb = bboxOf(nl);
            return { ...nl, x: nl.x + (ncx - (bb[0] + bb[2] / 2)), y: nl.y + (ncy - (bb[1] + bb[3] / 2)) };
          }
          return { ...l, x: ncx - w / 2, y: ncy - h / 2, w, h, heroPreset: undefined };
        })
      }));
    }
  };

  const onPointerUp = e => {
    const dd = drag.current;
    if (dd && dd.type === 'move' && dd.moved) { // soltar una capa con el centro en otra cara = pasa a esa cara
      const gg = gRef.current;
      store.set(st => ({ layers: st.layers.map(l => {
        if (!dd.ids.includes(l.id)) return l;
        const b = bboxOf(l), hit = containerAt(gg, [b[0] + b[2] / 2, b[1] + b[3] / 2]);
        return hit && hit.panelId !== l.panelId ? { ...l, panelId: hit.panelId } : l;
      }) }));
    }
    if (dd && dd.type === 'edit') setEditing({ id: dd.id });
    if (dd && dd.type === 'guide' && e) {
      const r = elRef.current.getBoundingClientRect();
      if ((dd.axis === 'v' && e.clientX - r.left < RS) || (dd.axis === 'h' && e.clientY - r.top < RS)) setGuides(gs => gs.filter((_, i) => i !== dd.index));
    }
    if (dd && dd.type === 'marquee') {
      if (marquee) {
        const x0 = Math.min(marquee[0], marquee[2]), x1 = Math.max(marquee[0], marquee[2]), y0 = Math.min(marquee[1], marquee[3]), y1 = Math.max(marquee[1], marquee[3]);
        const hit = store.get().layers.filter(l => { if (!l.visible || l.locked) return false; const b = rotBBox(l); return b[0] < x1 && b[0] + b[2] > x0 && b[1] < y1 && b[1] + b[3] > y0; }).map(l => l.id);
        setSel(Array.from(new Set(dd.base.concat(hit))));
      }
      setMarquee(null);
    }
    if (dd && dd.type === 'draw') {
      const p = e ? mmPt(e) : dd.start, st = store.get();
      let o = draftOf(dd, p, dd.kind, dd.color, e && e.shiftKey, e && e.altKey);
      if (Math.max(o.w, dd.kind === 'line' ? 0 : o.h) < 1.5) { // clic sin arrastrar: tamaño por defecto, centrado
        const W = dd.kind === 'line' ? 30 : 24, H = dd.kind === 'line' ? 2 : dd.kind === 'rect' || dd.kind === 'round' ? 14 : 24;
        o = { ...o, x: dd.start[0] - W / 2, y: dd.start[1] - H / 2, w: W, h: H, rot: 0 };
      }
      const nl = { ...o, id: st.seq, content: t(SHAPE_LABELS[dd.kind]) };
      store.set({ layers: st.layers.concat([nl]), seq: st.seq + 1 });
      setSel([nl.id]); setTool('move'); setDraft(null);
    }
    if (e) try { elRef.current.releasePointerCapture(e.pointerId); } catch (_) { /* ya liberado */ }
    drag.current = null; setSnapG(null); if (dd && dd.type !== 'none') setHud('');
  };
  const onDragOver = e => {
    if (!onImageDrop || !hasImageDrag(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    setDropPanel(containerAt(g, mmPt(e)));
  };
  const onDragLeave = e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropPanel(null); };
  const onDrop = e => {
    if (!onImageDrop || !hasImageDrag(e)) return;
    e.preventDefault();
    const panel = containerAt(g, mmPt(e)), point = mmPt(e);
    setDropPanel(null);
    if (panel) onImageDrop(e.dataTransfer.files, point, panel);
  };

  // —— Capas en el lienzo ——
  const imgHref = l => l.imgSrc[0] === '/' ? asset(l.imgSrc) : l.imgSrc;
  const renderLayer = (l, isDraft) => {
    const b = bboxOf(l);
    let fill = l.color || '#211d18', stroke = 'none';
    if (l.finish === 'foil') fill = 'url(#foilG)';
    else if (l.finish === 'silver') fill = 'url(#silvG)';
    else if (l.finish === 'holo') fill = 'url(#holoG)';
    else if (l.finish === 'emboss') { fill = 'rgba(33,29,24,0.12)'; stroke = 'rgba(33,29,24,0.4)'; }
    const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
    const tf = (l.rot ? 'rotate(' + l.rot + ' ' + cx + ' ' + cy + ')' : '') + (l.flipX || l.flipY ? ' translate(' + cx + ' ' + cy + ') scale(' + (l.flipX ? -1 : 1) + ' ' + (l.flipY ? -1 : 1) + ') translate(' + (-cx) + ' ' + (-cy) + ')' : '');
    const op = l.opacity == null ? 1 : l.opacity;
    const down = isDraft ? undefined : e => onLayerDown(e, l);
    const curs = tool === 'move' ? (l.locked ? 'default' : 'move') : undefined;
    const els = [];
    if (l.kind === 'image') {
      const crop = l.crop;
      els.push(
        <g key={l.id} onPointerDown={down} style={{ cursor: curs }}>
          {l.imgSrc
            ? (crop
              ? <svg x={l.x} y={l.y} width={l.w} height={l.h} viewBox={[crop[0] * 100, crop[1] * 100, crop[2] * 100, crop[3] * 100].join(' ')} preserveAspectRatio="none"><image href={imgHref(l)} x={0} y={0} width={100} height={100} preserveAspectRatio="none" /></svg>
              : <image href={imgHref(l)} x={l.x} y={l.y} width={l.w} height={l.h} preserveAspectRatio="none" />)
            : (<>
              <rect x={l.x} y={l.y} width={l.w} height={l.h} fill="#efe9dc" stroke="#b3a88f" strokeWidth={0.4} strokeDasharray="2 1.4" />
              <line x1={l.x} y1={l.y} x2={l.x + l.w} y2={l.y + l.h} stroke="#cfc4ab" strokeWidth={0.3} />
              <line x1={l.x} y1={l.y + l.h} x2={l.x + l.w} y2={l.y} stroke="#cfc4ab" strokeWidth={0.3} />
            </>)}
        </g>
      );
    } else if (l.kind === 'shape') {
      const line = l.shape === 'line', sw = line ? (l.strokeW == null ? 0.8 : l.strokeW) : (l.strokeW || 0), dstr = shapePathD(l);
      const sCol = l.finish === 'foil' || l.finish === 'silver' || l.finish === 'holo' ? fill : (line ? l.stroke || l.color : l.stroke) || '#211d18';
      els.push(
        <g key={l.id} onPointerDown={down} style={{ cursor: curs }}>
          <path d={dstr} fill={line || l.fillOn === false ? 'none' : fill} stroke={sw > 0 ? sCol : 'none'} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" pointerEvents={l.fillOn === false && !line ? 'all' : undefined} />
          {line && <path d={dstr} fill="none" stroke="transparent" strokeWidth={Math.max(sw, 6 / k)} />}
        </g>
      );
    } else if (!(editing && editing.id === l.id)) {
      const m = textMetrics(l), sx = l.scaleX || 1, sy = l.scaleY || 1;
      els.push(
        <g key={l.id} onPointerDown={down} onDoubleClick={isDraft || l.locked ? undefined : () => { setSel([l.id]); setEditing({ id: l.id }); }} style={{ cursor: curs }}>
          <g transform={'translate(' + cx + ' ' + cy + ') scale(' + sx + ' ' + sy + ') translate(' + (-cx) + ' ' + (-cy) + ')'}>
            <rect x={l.x - m.w0 / 2} y={m.cy - m.h0 / 2} width={m.w0} height={m.h0} fill="transparent" />
            <text x={m.ax} y={l.y} fontSize={l.size} textAnchor={m.anchor} fill={fill} stroke={stroke} strokeWidth={0.25} letterSpacing={l.letterSpacing || undefined}
              style={{ fontFamily: "'" + (l.font || 'Noto Sans') + "',sans-serif", fontWeight: l.weight, fontStyle: l.italic ? 'italic' : 'normal', userSelect: 'none' }}>
              {m.lines.map((ln, i) => <tspan key={i} x={m.ax} dy={i ? l.size * m.lh : 0}>{ln || '​'}</tspan>)}
            </text>
          </g>
        </g>
      );
    }
    const panel = containerOfLayer(g, l);
    const clipId = panel ? 'design-panel-' + String(panel.panelId).replace(/[^a-zA-Z0-9_-]/g, '-') : '';
    return (
      <g key={isDraft ? 'draft' : l.id} clipPath={clipId ? 'url(#' + clipId + ')' : undefined} style={l.blend && l.blend !== 'normal' ? { mixBlendMode: l.blend } : undefined}>
        <g transform={tf || undefined} opacity={op}>{els}</g>
        {l.finish === 'uv' && <rect x={b[0] - 1} y={b[1] - 1} width={b[2] + 2} height={b[3] + 2} fill="none" stroke="#5a9bc4" strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} transform={tf || undefined} />}
        {l.finish === 'gloss' && <rect x={b[0] - 1} y={b[1] - 1} width={b[2] + 2} height={b[3] + 2} fill="none" stroke="#28a7a1" strokeWidth={1} strokeDasharray="7 2 1 2" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} transform={tf || undefined} />}
      </g>
    );
  };

  // —— Selección: contorno de cada capa; tiradores y giro si hay una sola ——
  const renderSelOverlay = () => {
    if (!selLayers.length || tool === 'hand') return null;
    const outlines = selLayers.map(l => {
      const b = bboxOf(l), cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
      return <rect key={'o' + l.id} x={b[0]} y={b[1]} width={b[2]} height={b[3]} fill="none" stroke="#9a5b1f" strokeWidth={selLayers.length > 1 ? 1 : 1.4} strokeDasharray={l.locked || selLayers.length > 1 ? '2 2' : '5 3'} transform={'rotate(' + (l.rot || 0) + ' ' + cx + ' ' + cy + ')'} style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />;
    });
    if (selLayers.length > 1) {
      const ub = union(selLayers.map(rotBBox));
      return <g>{outlines}<rect x={ub[0]} y={ub[1]} width={ub[2] - ub[0]} height={ub[3] - ub[1]} fill="none" stroke="#9a5b1f" strokeWidth={1.2} style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} /></g>;
    }
    const sel = single;
    if (sel.locked || tool !== 'move' || (editing && editing.id === sel.id)) return <g>{outlines}</g>;
    const selB = bboxOf(sel), hs = 7 / k, rot = sel.rot || 0;
    const scx = selB[0] + selB[2] / 2, scy = selB[1] + selB[3] / 2;
    const modes = sel.kind === 'text' ? ['nw', 'ne', 'sw', 'se'] : sel.shape === 'line' ? ['e', 'w'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const pos = mo => [mo.includes('w') ? selB[0] : mo.includes('e') ? selB[0] + selB[2] : scx, mo.includes('n') ? selB[1] : mo.includes('s') ? selB[1] + selB[3] : scy];
    const curs = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
    const rp = [scx, selB[1] - 14 / k];
    return (
      <g>
        {outlines}
        <g transform={'rotate(' + rot + ' ' + scx + ' ' + scy + ')'}>
          {modes.map(mo => {
            const p = pos(mo);
            return <rect key={mo} x={p[0] - hs / 2} y={p[1] - hs / 2} width={hs} height={hs} fill="#fff" stroke="#9a5b1f" strokeWidth={1.2 / k} style={{ cursor: curs[mo] }}
              onPointerDown={e => startDrag(e, { type: 'resize', id: sel.id, mode: mo, sx: e.clientX, sy: e.clientY, l0: { ...sel }, b0: selB, isText: sel.kind === 'text', cropMode: !!(s.uiCrop && sel.kind === 'image' && sel.imgSrc), snap: snapTargets([sel.id]) })} />;
          })}
          <line x1={scx} y1={selB[1]} x2={rp[0]} y2={rp[1]} stroke="#9a5b1f" strokeWidth={1 / k} />
          <circle cx={rp[0]} cy={rp[1]} r={4.5 / k} fill="#9a5b1f" stroke="#fff" strokeWidth={1.2 / k} style={{ cursor: 'crosshair' }}
            onPointerDown={e => { const p = mmPt(e); startDrag(e, { type: 'rot', id: sel.id, cx: scx, cy: scy, a0: Math.atan2(p[1] - scy, p[0] - scx), r0: rot }); }} />
        </g>
      </g>
    );
  };

  // Editor de texto en el lienzo (textarea superpuesto)
  const editL = editing && s.layers.find(l => l.id === editing.id);
  const renderEditor = () => {
    if (!editL) return null;
    const b = bboxOf(editL), m = textMetrics(editL);
    const sy = editL.scaleY || 1;
    return (
      <textarea autoFocus aria-label={t('Texto')} value={editL.content || ''} spellCheck={false}
        onFocus={e => e.target.select()}
        onChange={e => { const v = e.target.value; store.set(st => ({ layers: st.layers.map(l => l.id === editL.id ? { ...l, content: v, heroPreset: undefined } : l) })); }}
        onBlur={finishEdit}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); } }}
        onPointerDown={e => e.stopPropagation()}
        style={{
          position: 'absolute', left: s.tx + (b[0] - 1) * k, top: s.ty + (m.cy - m.h0 * sy / 2 - 0.5) * k, width: Math.max(60, (b[2] + 2) * k + 20), height: (b[3] + 1) * k, boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
          background: 'rgba(255,255,255,0.65)', border: '1px dashed #9a5b1f', outline: 'none', padding: 0, margin: 0, color: editL.color || '#211d18',
          fontFamily: "'" + (editL.font || 'Noto Sans') + "',sans-serif", fontWeight: editL.weight, fontStyle: editL.italic ? 'italic' : 'normal', fontSize: editL.size * k, lineHeight: (m.lh) , letterSpacing: (editL.letterSpacing || 0) * k,
          textAlign: editL.align || 'center', whiteSpace: 'pre', transform: 'rotate(' + (editL.rot || 0) + 'deg)', transformOrigin: 'center'
        }} />
    );
  };

  const cursor = { move: 'default', text: 'text', shape: 'crosshair', hand: drag.current && drag.current.type === 'pan' ? 'grabbing' : 'grab', zoom: 'zoom-in', eyedrop: 'crosshair' }[tool];
  const zoomPct = Math.round(k * 100) + '%';
  return (
    <div ref={elRef} aria-label={t('Lienzo de diseño: arrastra imágenes a una cara')} data-testid="design-drop-canvas"
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#e7e0d0', userSelect: 'none', touchAction: 'none', cursor, minWidth: 0 }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="foilG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E9CB6E" /><stop offset="0.5" stopColor="#B08A1E" /><stop offset="1" stopColor="#E3BE55" /></linearGradient>
          <linearGradient id="silvG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#EDEDF2" /><stop offset="0.5" stopColor="#9A9AA4" /><stop offset="1" stopColor="#DCDCE2" /></linearGradient>
          <linearGradient id="holoG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f5c6d6" /><stop offset="0.25" stopColor="#c9c3f0" /><stop offset="0.5" stopColor="#b7dcf5" /><stop offset="0.75" stopColor="#c2f0dd" /><stop offset="1" stopColor="#f7ecc8" /></linearGradient>
          {(g.panels || []).map(panel => {
            const id = 'design-panel-' + String(panel.panelId).replace(/[^a-zA-Z0-9_-]/g, '-');
            return <clipPath key={panel.panelId} id={id} clipPathUnits="userSpaceOnUse"><polygon points={panel.pts.map(p => p[0] + ',' + p[1]).join(' ')} /></clipPath>;
          })}
        </defs>
        <g transform={'translate(' + s.tx + ' ' + s.ty + ') scale(' + k + ')'}>
          <path d={g.fillPath} fill="#fdfcf7" stroke="none" />
          <path d={g.safePath} fill="none" stroke="#ddd0ab" strokeWidth={0.4} strokeDasharray="2.2 1.8" />
          <path d={g.creasePath} fill="none" stroke="#a8c9ae" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
          <path d={g.cutPath} fill="none" stroke="#dfaeb2" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
          {dropPanel && <polygon points={dropPanel.pts.map(p => p[0] + ',' + p[1]).join(' ')} fill="rgba(40,167,161,0.18)" stroke="#28a7a1" strokeWidth={2} style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />}
          {s.layers.filter(l => l.visible).map(l => renderLayer(l, false))}
          {draft && renderLayer({ ...draft, id: -1 }, true)}
          {snapG && (
            <g>
              {snapG.v != null && <line x1={snapG.v} y1={g.sbb[1] - 15} x2={snapG.v} y2={g.sbb[3] + 15} stroke="#d6318c" strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />}
              {snapG.h != null && <line x1={g.sbb[0] - 15} y1={snapG.h} x2={g.sbb[2] + 15} y2={snapG.h} stroke="#d6318c" strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />}
            </g>
          )}
          {renderSelOverlay()}
          {marquee && <rect x={Math.min(marquee[0], marquee[2])} y={Math.min(marquee[1], marquee[3])} width={Math.abs(marquee[2] - marquee[0])} height={Math.abs(marquee[3] - marquee[1])} fill="rgba(154,91,31,0.08)" stroke="#9a5b1f" strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />}
          {grid && (() => {
            const st = tickStep(k), x0 = Math.floor((-s.tx / k) / st) * st, x1 = (size.w - s.tx) / k, y0 = Math.floor((-s.ty / k) / st) * st, y1 = (size.h - s.ty) / k, ls = [];
            for (let v = x0; v <= x1; v += st) ls.push(<line key={'gx' + v} x1={v} x2={v} y1={y0} y2={y1} />);
            for (let v = y0; v <= y1; v += st) ls.push(<line key={'gy' + v} x1={x0} x2={x1} y1={v} y2={v} />);
            return <g stroke="rgba(28,110,224,0.22)" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }}>{ls.length < 400 ? ls : null}</g>;
          })()}
          {guides.map((q, i) => (
            <g key={'gd' + i}>
              <line x1={q.axis === 'v' ? q.pos : -9000} x2={q.axis === 'v' ? q.pos : 9000} y1={q.axis === 'h' ? q.pos : -9000} y2={q.axis === 'h' ? q.pos : 9000} stroke="#14a6c8" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />
              <line x1={q.axis === 'v' ? q.pos : -9000} x2={q.axis === 'v' ? q.pos : 9000} y1={q.axis === 'h' ? q.pos : -9000} y2={q.axis === 'h' ? q.pos : 9000} stroke="rgba(0,0,0,0.001)" strokeWidth={8 / k} style={{ cursor: q.axis === 'v' ? 'ew-resize' : 'ns-resize' }} onPointerDown={e => startDrag(e, { type: 'guide', index: i, axis: q.axis })} />
            </g>
          ))}
        </g>
      </svg>
      {renderEditor()}
      {rulers && size.w > 0 && <Rulers k={k} tx={s.tx} ty={s.ty} w={size.w} h={size.h} cur={cur} onNew={newGuide} />}
      {hud && <div style={{ position: 'absolute', left: '50%', top: 28, transform: 'translateX(-50%)', padding: '5px 11px', borderRadius: 6, background: '#211d18', color: '#fff', fontSize: 12, fontFamily: MONO, pointerEvents: 'none' }}>{hud}</div>}
      {dropPanel && <div data-testid="image-drop-hint" style={{ position: 'absolute', left: '50%', top: 18, transform: 'translateX(-50%)', padding: '7px 12px', borderRadius: 6, background: '#211d18', color: '#fff', fontSize: 12, fontWeight: 700, boxShadow: '0 6px 18px rgba(33,29,24,0.22)', pointerEvents: 'none' }}>{t('Suelta la imagen en esta cara')}</div>}
      {rulers && cur && <div style={{ position: 'absolute', left: RS + 8, top: RS + 6, padding: '2px 7px', borderRadius: 4, background: 'rgba(33,29,24,0.72)', color: '#fff', fontSize: 10.5, fontFamily: MONO, pointerEvents: 'none' }}>X {fmt1(cur[0])} · Y {fmt1(cur[1])} mm</div>}
      <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 10, background: 'rgba(250,247,240,0.92)', border: '1px solid #ded5c4', borderRadius: 6, padding: '6px 12px', fontSize: 11, color: '#5c554a', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 8, background: 'linear-gradient(135deg,#E9CB6E,#B08A1E)', display: 'inline-block', borderRadius: 2 }} />{t('Oro')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 0, borderTop: '2px dashed #5a9bc4', display: 'inline-block' }} />{t('UV local')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 8, background: 'linear-gradient(135deg,#f8ffff,#74d8d1,#fff)', border: '1px solid #28a7a1', display: 'inline-block', borderRadius: 2 }} />{t('Brillo')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 8, background: 'rgba(33,29,24,0.12)', border: '1px solid rgba(33,29,24,0.35)', display: 'inline-block', borderRadius: 2 }} />{t('Relieve')}</span>
      </div>
      <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 4, background: 'rgba(250,247,240,0.92)', border: '1px solid #ded5c4', borderRadius: 6, padding: 4 }}>
        <button onClick={() => store.set(st => ({ k: Math.max(0.05, st.k / 1.25) }))} aria-label={t('Alejar')} style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: '#5c554a', borderRadius: 4 }}>−</button>
        <div style={{ minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 11, color: '#5c554a' }}>{zoomPct}</div>
        <button onClick={() => store.set(st => ({ k: Math.min(40, st.k * 1.25) }))} aria-label={t('Acercar')} style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: '#5c554a', borderRadius: 4 }}>+</button>
        <button onClick={() => setRulers(v => !v)} title={t('Reglas (arrastra desde una regla para crear una guía)')} style={{ height: 26, padding: '0 6px', border: 'none', cursor: 'pointer', fontSize: 11, borderRadius: 4, background: rulers ? '#9a5b1f' : 'transparent', color: rulers ? '#fff' : '#5c554a' }}>{t('Reglas')}</button>
        <button onClick={() => setGrid(v => !v)} title={t('Cuadrícula')} style={{ height: 26, padding: '0 6px', border: 'none', cursor: 'pointer', fontSize: 11, borderRadius: 4, background: grid ? '#9a5b1f' : 'transparent', color: grid ? '#fff' : '#5c554a' }}>{t('Rejilla')}</button>
        {guides.length > 0 && <button onClick={() => setGuides([])} title={t('Borrar todas las guías')} style={{ height: 26, padding: '0 6px', border: 'none', cursor: 'pointer', fontSize: 11, borderRadius: 4, background: 'transparent', color: '#14a6c8' }}>{t('Guías') + ' ✕'}</button>}
        <button onClick={() => { userMoved.current = false; fit(); }} title={t('Ajustar vista')} style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#5c554a', borderRadius: 4 }}>⤢</button>
      </div>
    </div>
  );
}
