// 2D 画布：结构/设计视图共用 —— SVG 主画布（mm 世界坐标）+ 缩放平移 + 全部拖拽交互
import React, { useRef, useEffect, useState } from 'react';
import { store, useStore } from '../state/store.js';
import { asset } from '../asset.js';
import { bboxOf } from '../design/layers.js';
import { bboxOfPts, containerAt, containerOfLayer } from '../design/containers.js';
import { useT } from '../i18n/index.js';

const r1 = v => Math.round(v * 10) / 10;
const RS = 20; // grosor de las reglas (px)
const tickStep = k => [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(v => v * k >= 70) || 1000;
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
    <svg width={w - RS} height={RS} draggable={false} style={{ pointerEvents: 'auto',  position: 'absolute', left: RS, top: 0, cursor: 'ns-resize', userSelect: 'none', background: bg, borderBottom: '1px solid #ded5c4' }} onPointerDown={e => onNew(e, 'h')}>
      {ticks(w, tx).map(t => t.p >= RS && <g key={t.v} style={{ pointerEvents: 'none' }}><line x1={t.p - RS} x2={t.p - RS} y1={t.major ? 8 : 14} y2={RS} stroke={col} strokeWidth={1} />{t.major && <text x={t.p - RS + 3} y={9} fontSize={8.5} fill={col} style={{ fontFamily: "'JetBrains Mono',monospace", userSelect: 'none' }}>{t.v.toFixed(dec)}</text>}</g>)}
      {cur && <line x1={tx + cur[0] * k - RS} x2={tx + cur[0] * k - RS} y1={0} y2={RS} stroke="#C8102E" strokeWidth={1} />}
    </svg>
    <svg width={RS} height={h - RS} draggable={false} style={{ pointerEvents: 'auto',  position: 'absolute', left: 0, top: RS, cursor: 'ew-resize', userSelect: 'none', background: bg, borderRight: '1px solid #ded5c4' }} onPointerDown={e => onNew(e, 'v')}>
      {ticks(h, ty).map(t => t.p >= RS && <g key={t.v} style={{ pointerEvents: 'none' }}><line y1={t.p - RS} y2={t.p - RS} x1={t.major ? 8 : 14} x2={RS} stroke={col} strokeWidth={1} />{t.major && <text transform={'translate(9 ' + (t.p - RS + 3) + ') rotate(-90)'} fontSize={8.5} fill={col} textAnchor="end" style={{ fontFamily: "'JetBrains Mono',monospace", userSelect: 'none' }}>{t.v.toFixed(dec)}</text>}</g>)}
      {cur && <line y1={ty + cur[1] * k - RS} y2={ty + cur[1] * k - RS} x1={0} x2={RS} stroke="#C8102E" strokeWidth={1} />}
    </svg>
    <div style={{ position: 'absolute', left: 0, top: 0, width: RS, height: RS, background: bg, borderRight: '1px solid #ded5c4', borderBottom: '1px solid #ded5c4', fontSize: 8, color: col, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono',monospace" }}>mm</div>
  </>);
}
const fmt1 = v => (Math.round(v * 10) / 10).toString().replace('.', ',');
const toLocal = (fr, p) => {
  const det = fr.ex[0] * fr.ey[1] - fr.ex[1] * fr.ey[0];
  const dx = p[0] - fr.O[0], dy = p[1] - fr.O[1];
  return [(dx * fr.ey[1] - dy * fr.ey[0]) / det, (fr.ex[0] * dy - fr.ex[1] * dx) / det];
};
const toWorld = (fr, x, y) => [fr.O[0] + fr.ex[0] * x + fr.ey[0] * y, fr.O[1] + fr.ex[1] * x + fr.ey[1] * y];

// Red avanzada (estructura):
//  · panelShiftInfo(id) → {dir, shift} | null  — arrastrar la cara seleccionada la desliza por su borde de unión
//  · selFrame {id,O,ex,ey,w,h,snapW} + onPanelResize(id, 'h'|'wl'|'wr', mm) — tiradores en los bordes de corte
//  · extraLines [{id,kind,pts}] + onLineDrag({phase,id,index|'body',pt,start,shift,alt}) + selLineId
//  · edgeTargets [{key,panelId,a,b,len}] + armedShape + onEdgePick(target) + onShapeDrop(shapeId, target|null, pt)
//    — bordes libres donde se pegan formas/solapas (clic en «+», herramienta armada o arrastrar desde la paleta)
export const SHAPE_MIME = 'application/x-catbox-shape';
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
};
export function SheetCanvas({ view, g, children, onImageDrop, highlight, onPanelClick, extraLines, onLineDrag, selLineId, panelShiftInfo, onPanelShift, selFrame, onPanelResize, edgeTargets, armedShape, onEdgePick, onShapeDrop }) {
  const s = useStore();
  const t = useT();
  const elRef = useRef(null);
  const drag = useRef(null);          // {type:'pan'|'move'|'resize'|'rot', ...}
  const userMoved = useRef(false);
  const [snapG, setSnapG] = useState(null);
  const [hud, setHud] = useState('');
  const [rulers, setRulers] = useState(true);
  const [grid, setGrid] = useState(false);
  const [guides, setGuides] = useState([]);   // guías arrastradas desde las reglas: [{axis:'v'|'h', pos mm}]
  const [cur, setCur] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dropPanel, setDropPanel] = useState(null);
  const [hoverEdge, setHoverEdge] = useState(null);   // borde libre bajo el cursor (herramienta armada o arrastre de forma)
  const [shapeDrag, setShapeDrag] = useState(false);
  const k = s.k || 1;
  const nearestEdge = p => {
    let best = null, bd = 14 / (store.get().k || 1);
    for (const tg of (edgeTargets || [])) { const d = segDist(p, tg.a, tg.b); if (d < bd) { bd = d; best = tg; } }
    return best;
  };
  const isShapeDrag = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes(SHAPE_MIME);
  const editOn = s.editMode && view === 'structure';
  const highlighted = highlight ? (g.panels || []).find(p => p.panelId === highlight) : null;
  const hasImageDrag = e => Array.from((e.dataTransfer && e.dataTransfer.items) || []).some(it => it.kind === 'file' && /^image\/(png|jpeg|webp)$/i.test(it.type));

  const mmPt = e => {
    const r = elRef.current.getBoundingClientRect();
    return [(e.clientX - r.left - s.tx) / s.k, (e.clientY - r.top - s.ty) / s.k];
  };
  const fit = () => {
    const el = elRef.current; if (!el) return;
    const r = el.getBoundingClientRect(); if (r.width < 50) return;
    const bb = g.vbb, pad = Math.min(44, Math.max(10, Math.min(r.width, r.height) * 0.06));
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    const k2 = Math.min((r.width - 2 * pad) / w, (r.height - 2 * pad) / h);
    store.set({ k: k2, tx: (r.width - k2 * w) / 2 - k2 * bb[0], ty: (r.height - k2 * h) / 2 - k2 * bb[1] });
  };
  // 挂载 / 几何变化时适配（用户未手动平移过）；fitNonce 强制适配
  useEffect(() => { const raf = requestAnimationFrame(() => { if (!userMoved.current) fit(); }); return () => cancelAnimationFrame(raf); }, [g]);
  useEffect(() => {
    if (s.fitNonce > 0) {
      userMoved.current = false;
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(fit); });
      const timer = setTimeout(fit, 60); // respaldo si la pestaña está en segundo plano
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(timer); };
    }
  }, [s.fitNonce]);
  // 滚轮缩放（非 passive）
  useEffect(() => {
    const el = elRef.current; if (!el) return;
    const onWheel = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const st = store.get();
      const f = Math.exp(-e.deltaY * 0.0016), k2 = Math.min(40, Math.max(0.05, st.k * f)), rf = k2 / st.k;
      store.set({ k: k2, tx: mx - (mx - st.tx) * rf, ty: my - (my - st.ty) * rf });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const el = elRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); if (!userMoved.current) fit(); });
    ro.observe(el); return () => ro.disconnect();
  }, [g]);

  // —— 图层按下（设计视图）：选中 + 开始移动（带吸附） ——
  const onLayerDown = (e, l, b) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (s.sel !== l.id) store.set({ sel: l.id });
    if (l.locked) return;
    try { elRef.current.setPointerCapture(e.pointerId); } catch (_) { /* 浏览器不支持时沿用窗口内拖拽 */ }
    const vT = guides.filter(q => q.axis === 'v').map(q => q.pos), hT = guides.filter(q => q.axis === 'h').map(q => q.pos);
    (g.panels || []).forEach(panel => {
      const pb = bboxOfPts(panel.pts), x0 = pb[0], y0 = pb[1], x1 = pb[2], y1 = pb[3];
      vT.push(x0, (x0 + x1) / 2, x1); hT.push(y0, (y0 + y1) / 2, y1);
      const mg = Math.min(3, (x1 - x0) / 4, (y1 - y0) / 4); // margen de seguridad de 3 mm
      vT.push(x0 + mg, x1 - mg); hT.push(y0 + mg, y1 - mg);
    });
    s.layers.forEach(o => { if (o.id === l.id || !o.visible) return; const ob = bboxOf(o); vT.push(ob[0], ob[0] + ob[2] / 2, ob[0] + ob[2]); hT.push(ob[1], ob[1] + ob[3] / 2, ob[1] + ob[3]); });
    drag.current = { type: 'move', id: l.id, sx: e.clientX, sy: e.clientY, ox: l.x, oy: l.y, snap: { v: vT, h: hT }, bl: b[0] - l.x, bt: b[1] - l.y, bw: b[2], bh: b[3] };
  };
  const onPointerDown = e => {
    if (e.button !== 0) return;
    userMoved.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (view === 'structure' && armedShape && onEdgePick) {
      const tg = nearestEdge(mmPt(e));
      if (tg) { onEdgePick(tg); setHoverEdge(null); return; }
    }
    if (view === 'structure' && onPanelClick) {
      const hit = containerAt(g, mmPt(e));
      if (hit) {
        // La cara ya seleccionada se arrastra directamente (sin tener que acertar el círculo central).
        const info = hit.panelId === highlight && onPanelShift && panelShiftInfo ? panelShiftInfo(hit.panelId) : null;
        onPanelClick(hit.panelId);
        if (info) { drag.current = { type: 'panelShift', id: hit.panelId, start: mmPt(e), shift0: info.shift, dir: info.dir }; return; }
      }
    }
    drag.current = { type: 'pan', x: e.clientX, y: e.clientY, tx: s.tx, ty: s.ty };
  };
  const newGuide = (e, axis) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = mmPt(e);
    setGuides(gs => [...gs, { axis, pos: r1(axis === 'v' ? p[0] : p[1]) }]);
    startDrag(e, { type: 'guide', index: guides.length, axis });
  };
  const onPointerMove = e => {
    if (rulers) setCur(mmPt(e));
    if (armedShape && view === 'structure' && !drag.current) { const tg = nearestEdge(mmPt(e)); if ((tg && tg.key) !== (hoverEdge && hoverEdge.key)) setHoverEdge(tg); }
    const d = drag.current; if (!d) return;
    const kk = store.get().k;
    if (d.type === 'guide') {
      const p = mmPt(e), v = r1(d.axis === 'v' ? p[0] : p[1]);
      setGuides(gs => gs.map((q, i) => i === d.index ? { ...q, pos: v } : q));
      setHud((d.axis === 'v' ? 'X ' : 'Y ') + fmt1(v) + ' mm · ' + t('suelta sobre la regla para quitar'));
      return;
    }
    if (d.type === 'panelShift') {
      const p = mmPt(e);
      let v = d.shift0 + (p[0] - d.start[0]) * d.dir[0] + (p[1] - d.start[1]) * d.dir[1];
      if (!e.altKey) { v = Math.abs(v) < 2 / kk ? 0 : r1(v); } // imán al centro del borde; Alt = libre
      onPanelShift && onPanelShift(d.id, v);
      setHud(t('Desplazamiento') + ' ' + fmt1(v) + ' mm' + (v === 0 ? ' · ' + t('centrada') : ''));
      return;
    }
    if (d.type === 'line') {
      onLineDrag && onLineDrag({ phase: 'move', id: d.lineId, index: d.index, pt: mmPt(e), start: d.start, shift: e.shiftKey, alt: e.altKey, thr: 6 / kk });
      return;
    }
    if (d.type === 'edge' && selFrame) {
      const lp = toLocal(d.fr, mmPt(e));
      let v = d.which === 'h' ? lp[1] : d.which === 'wr' ? lp[0] : d.fr.w - lp[0];
      if (!e.altKey) {
        const tgt = d.which === 'h' ? null : d.fr.snapW;
        v = tgt != null && Math.abs(v - tgt) < 6 / kk ? tgt : r1(v);
      }
      v = Math.max(2, v);
      onPanelResize && onPanelResize(d.id, d.which, v);
      setHud((d.which === 'h' ? t('Profundidad') : t('Ancho')) + ' ' + fmt1(v) + ' mm');
      return;
    }
    if (d.type === 'resize') {
      let dx = (e.clientX - d.sx) / kk, dy = (e.clientY - d.sy) / kk;
      const rr = (d.l0.rot || 0) * Math.PI / 180, co = Math.cos(rr), si = Math.sin(rr);
      const dxL = dx * co + dy * si, dyL = -dx * si + dy * co;
      if (d.cropMode) {
        // 裁剪：源图像素尺度不变，拖边调整显示区域与 crop 矩形
        store.set(st => ({
          layers: st.layers.map(l => {
            if (l.id !== d.id) return l;
            const cr = (d.l0.crop || [0, 0, 1, 1]).slice();
            const sx = d.l0.w / cr[2], sy = d.l0.h / cr[3];
            let x = d.l0.x, y = d.l0.y, w = d.l0.w, h = d.l0.h;
            if (d.mode.includes('e')) { w = Math.max(2, d.l0.w + dxL); cr[2] = w / sx; }
            if (d.mode.includes('w')) { x = d.l0.x + dxL; w = Math.max(2, d.l0.w - dxL); cr[0] += (d.l0.w - w) / sx; }
            if (d.mode.includes('s')) { h = Math.max(1, d.l0.h + dyL); cr[3] = h / sy; }
            if (d.mode.includes('n')) { y = d.l0.y + dyL; h = Math.max(1, d.l0.h - dyL); cr[1] += (d.l0.h - h) / sy; }
            if (d.mode.includes('w')) x = d.l0.x + (d.l0.w - w);
            if (d.mode.includes('n')) y = d.l0.y + (d.l0.h - h);
            cr[0] = Math.min(0.95, Math.max(0, cr[0])); cr[1] = Math.min(0.95, Math.max(0, cr[1]));
            cr[2] = Math.min(1 - cr[0], Math.max(0.05, cr[2])); cr[3] = Math.min(1 - cr[1], Math.max(0.05, cr[3]));
            return { ...l, x, y, w, h, crop: cr, heroPreset: undefined };
          })
        }));
        return;
      }
      store.set(st => ({
        layers: st.layers.map(l => {
          if (l.id !== d.id) return l;
          const b0 = d.b0;
          let x0 = b0[0], y0 = b0[1], x1 = b0[0] + b0[2], y1 = b0[1] + b0[3];
          if (d.mode.includes('e')) x1 += dxL;
          if (d.mode.includes('w')) x0 += dxL;
          if (d.mode.includes('s')) y1 += dyL;
          if (d.mode.includes('n')) y0 += dyL;
          let w = Math.max(0.1, x1 - x0), h = Math.max(0.1, y1 - y0);
          if (!e.shiftKey) {
            const fx = w / b0[2], fy = h / b0[3];
            const f = d.mode === 'n' || d.mode === 's' ? fy : d.mode === 'e' || d.mode === 'w' ? fx
              : Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy;
            w = Math.max(d.isText ? 0.2 : 2, b0[2] * f); h = Math.max(d.isText ? 0.2 : 1, b0[3] * f);
            if (d.mode.includes('w')) x0 = b0[0] + b0[2] - w; else if (d.mode.includes('e')) x0 = b0[0]; else x0 = b0[0] + (b0[2] - w) / 2;
            if (d.mode.includes('n')) y0 = b0[1] + b0[3] - h; else if (d.mode.includes('s')) y0 = b0[1]; else y0 = b0[1] + (b0[3] - h) / 2;
          } else {
            w = Math.max(d.isText ? 0.2 : 2, w); h = Math.max(d.isText ? 0.2 : 1, h);
            if (d.mode.includes('w')) x0 = b0[0] + b0[2] - w;
            if (d.mode.includes('n')) y0 = b0[1] + b0[3] - h;
          }
          if (d.isText) {
            const cx = x0 + w / 2, cy = y0 + h / 2;
            if (!e.shiftKey) {
              const f = w / b0[2], size = Math.min(80, Math.max(1.5, d.l0.size * f));
              return { ...l, x: cx, y: cy + size * 0.345, size, heroPreset: undefined };
            }
            const base = { ...d.l0, scaleX: 1, scaleY: 1 }, ub = bboxOf(base);
            const sx = Math.max(0.05, w / Math.max(0.1, ub[2])), sy = Math.max(0.05, h / Math.max(0.1, ub[3]));
            return { ...l, x: cx, y: cy + d.l0.size * 0.345, scaleX: sx, scaleY: sy, heroPreset: undefined };
          }
          return { ...l, x: x0, y: y0, w, h, heroPreset: undefined };
        })
      }));
      return;
    }
    if (d.type === 'rot') {
      const p = mmPt(e);
      const a = Math.atan2(p[1] - d.cy, p[0] - d.cx);
      let rot = d.r0 + (a - d.a0) * 180 / Math.PI;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      else if (!e.altKey) { const q = Math.round(rot / 90) * 90; if (Math.abs(rot - q) < 4) rot = q; } // imán a 0/90/180/270°
      rot = ((Math.round(rot * 10) / 10) % 360 + 360) % 360;
      store.set(st => ({ layers: st.layers.map(l => l.id === d.id ? { ...l, rot, heroPreset: undefined } : l) }));
      return;
    }
    if (d.type === 'move') {
      let nx = d.ox + (e.clientX - d.sx) / kk, ny = d.oy + (e.clientY - d.sy) / kk;
      let gv = null, gh = null;
      if (d.snap && !e.altKey) {
        const thr = 8 / kk;
        const cands = [nx + d.bl, nx + d.bl + d.bw / 2, nx + d.bl + d.bw];
        let best = thr;
        d.snap.v.forEach(tv => cands.forEach((cd, ci) => { const df = Math.abs(cd - tv); if (df < best) { best = df; nx += tv - cd; gv = tv; } }));
        const candsY = [ny + d.bt, ny + d.bt + d.bh / 2, ny + d.bt + d.bh];
        let bestY = thr;
        d.snap.h.forEach(tv => candsY.forEach((cd, ci) => { const df = Math.abs(cd - tv); if (df < bestY) { bestY = df; ny += tv - cd; gh = tv; } }));
      }
      setSnapG(gv != null || gh != null ? { v: gv, h: gh } : null);
      store.set(st => ({ layers: st.layers.map(l => l.id === d.id ? { ...l, x: nx, y: ny, heroPreset: undefined } : l) }));
      return;
    }
    if (d.type === 'pan') store.set({ tx: d.tx + e.clientX - d.x, ty: d.ty + e.clientY - d.y });
  };
  const onPointerUp = e => {
    const d = drag.current;
    if (d && d.type === 'move' && e) {
      const hit = containerAt(g, mmPt(e));
      if (hit) store.set(st => ({ layers: st.layers.map(l => l.id === d.id && l.panelId !== hit.panelId ? { ...l, panelId: hit.panelId } : l) }));
    }
    if (d && d.type === 'guide' && e) { // soltar sobre la regla = quitar la guía
      const r = elRef.current.getBoundingClientRect();
      if ((d.axis === 'v' && e.clientX - r.left < RS) || (d.axis === 'h' && e.clientY - r.top < RS)) setGuides(gs => gs.filter((_, i) => i !== d.index));
    }
    if (e) try { elRef.current.releasePointerCapture(e.pointerId); } catch (_) { /* 已释放或未捕获 */ }
    drag.current = null; setSnapG(null); setHud('');
  };
  const onDragOver = e => {
    if (view === 'structure' && onShapeDrop && isShapeDrag(e)) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      if (!shapeDrag) setShapeDrag(true);
      const tg = nearestEdge(mmPt(e));
      if ((tg && tg.key) !== (hoverEdge && hoverEdge.key)) setHoverEdge(tg);
      return;
    }
    if (view !== 'design' || !onImageDrop || !hasImageDrag(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    setDropPanel(containerAt(g, mmPt(e)));
  };
  const onDragLeave = e => {
    if (!e.currentTarget.contains(e.relatedTarget)) { setDropPanel(null); setShapeDrag(false); setHoverEdge(null); }
  };
  const onDrop = e => {
    if (view === 'structure' && onShapeDrop && isShapeDrag(e)) {
      e.preventDefault();
      const id = e.dataTransfer.getData(SHAPE_MIME), p = mmPt(e);
      setShapeDrag(false); setHoverEdge(null);
      if (id) onShapeDrop(id, nearestEdge(p), p);
      return;
    }
    if (view !== 'design' || !onImageDrop || !hasImageDrag(e)) return;
    e.preventDefault();
    const panel = containerAt(g, mmPt(e));
    if (!panel) { setDropPanel(null); return; }
    const point = mmPt(e);
    setDropPanel(null);
    onImageDrop(e.dataTransfer.files, point, panel);
  };

  const startDrag = (e, d) => {
    if (e.button !== 0) return;
    e.stopPropagation(); userMoved.current = true;
    try { elRef.current.setPointerCapture(e.pointerId); } catch (_) { /* sin captura: sigue dentro del lienzo */ }
    drag.current = d;
  };
  const updSel = patch => store.set(st => ({ layers: st.layers.map(l => l.id === st.sel ? { ...l, ...patch, heroPreset: undefined } : l) }));
  const sel = s.layers.find(l => l.id === s.sel);
  const selB = sel && sel.visible !== false && view === 'design' ? bboxOf(sel) : null;

  // —— 结构视图：线段类型选择 ——
  const renderLineEditor = () => {
    const els = [];
    g.segs.forEach((sg, si) => {
      const dstr = 'M' + sg.pts.map(p => p[0] + ' ' + p[1]).join('L');
      if (s.selSeg === si) els.push(<path key={'sel' + si} d={dstr} fill="none" stroke="#1c6ee0" strokeWidth={3} style={{ vectorEffect: 'non-scaling-stroke' }} />);
      els.push(<path key={'hit' + si} d={dstr} fill="none" stroke="rgba(0,0,0,0.001)" strokeWidth={9 / k} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); store.set({ selSeg: si }); }} />);
    });
    return <g>{els}</g>;
  };

  // —— 设计视图：图层 ——
  const renderLayer = l => {
    const b = bboxOf(l);
    let fill = l.color || '#211d18', stroke = 'none';
    if (l.finish === 'foil') fill = 'url(#foilG)';
    else if (l.finish === 'silver') fill = 'url(#silvG)';
    else if (l.finish === 'holo') fill = 'url(#holoG)';
    else if (l.finish === 'emboss') { fill = 'rgba(33,29,24,0.12)'; stroke = 'rgba(33,29,24,0.4)'; }
    const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
    const rotTf = 'rotate(' + (l.rot || 0) + ' ' + cx + ' ' + cy + ')';
    const textScaleTf = 'translate(' + cx + ' ' + cy + ') scale(' + (l.scaleX || 1) + ' ' + (l.scaleY || 1) + ') translate(' + (-cx) + ' ' + (-cy) + ')';
    const op = l.opacity == null ? 1 : l.opacity;
    const els = [];
    if (l.kind === 'image') {
      els.push(
        <g key={l.id} transform={rotTf} opacity={op}>
          <g onPointerDown={e => onLayerDown(e, l, b)} style={{ cursor: 'move' }}>
            {l.imgSrc
              ? (l.crop
                ? <svg x={l.x} y={l.y} width={l.w} height={l.h} viewBox={[l.crop[0] * 100, l.crop[1] * 100, l.crop[2] * 100, l.crop[3] * 100].join(' ')} preserveAspectRatio="none">
                  <image href={l.imgSrc[0] === '/' ? asset(l.imgSrc) : l.imgSrc} x={0} y={0} width={100} height={100} preserveAspectRatio="none" />
                </svg>
                : <image href={l.imgSrc[0] === '/' ? asset(l.imgSrc) : l.imgSrc} x={l.x} y={l.y} width={l.w} height={l.h} preserveAspectRatio="none" />)
              : (<>
                <rect x={l.x} y={l.y} width={l.w} height={l.h} fill="#efe9dc" stroke="#b3a88f" strokeWidth={0.4} strokeDasharray="2 1.4" />
                <line x1={l.x} y1={l.y} x2={l.x + l.w} y2={l.y + l.h} stroke="#cfc4ab" strokeWidth={0.3} />
                <line x1={l.x} y1={l.y + l.h} x2={l.x + l.w} y2={l.y} stroke="#cfc4ab" strokeWidth={0.3} />
              </>)}
          </g>
        </g>
      );
    } else if (l.kind === 'shape') {
      els.push(
        <g key={l.id} transform={rotTf} opacity={op}>
          <rect x={l.x} y={l.y} width={l.w} height={l.h} fill={fill} onPointerDown={e => onLayerDown(e, l, b)} style={{ cursor: 'move' }} />
        </g>
      );
    } else {
      els.push(
        <g key={l.id} transform={rotTf} opacity={op}>
          <g transform={textScaleTf}>
            <text x={l.x} y={l.y} fontSize={l.size} textAnchor="middle" fill={fill} stroke={stroke} strokeWidth={0.25}
              onPointerDown={e => onLayerDown(e, l, b)}
              style={{ fontFamily: "'" + (l.font || 'Noto Sans') + "',sans-serif", fontWeight: l.weight, cursor: 'move', userSelect: 'none' }}>{l.content}</text>
          </g>
        </g>
      );
    }
    if (l.finish === 'uv') els.push(<rect key={l.id + 'uv'} x={b[0] - 1} y={b[1] - 1} width={b[2] + 2} height={b[3] + 2} fill="none" stroke="#5a9bc4" strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />);
    if (l.finish === 'gloss') els.push(<rect key={l.id + 'gloss'} x={b[0] - 1} y={b[1] - 1} width={b[2] + 2} height={b[3] + 2} fill="none" stroke="#28a7a1" strokeWidth={1} strokeDasharray="7 2 1 2" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />);
    const panel = containerOfLayer(g, l);
    const clipId = panel ? 'design-panel-' + String(panel.panelId).replace(/[^a-zA-Z0-9_-]/g, '-') : '';
    return <g key={l.id} clipPath={clipId ? 'url(#' + clipId + ')' : undefined}>{els}</g>;
  };

  // —— 设计视图：选中框（8 手柄 + 旋转） ——
  const renderSelOverlay = () => {
    if (!selB || sel.locked) {
      return selB ? <rect x={selB[0]} y={selB[1]} width={selB[2]} height={selB[3]} fill="none" stroke="#9a5b1f" strokeWidth={1.4} strokeDasharray="2 2" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} /> : null;
    }
    const hs = 7 / k, rot = sel.rot || 0;
    const scx = selB[0] + selB[2] / 2, scy = selB[1] + selB[3] / 2;
    const modes = sel.kind === 'text' ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const pos = mo => [mo.includes('w') ? selB[0] : mo.includes('e') ? selB[0] + selB[2] : scx, mo.includes('n') ? selB[1] : mo.includes('s') ? selB[1] + selB[3] : scy];
    const curs = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
    const rp = [scx, selB[1] - 11 / k];
    return (
      <g transform={'rotate(' + rot + ' ' + scx + ' ' + scy + ')'}>
        <rect x={selB[0]} y={selB[1]} width={selB[2]} height={selB[3]} fill="none" stroke="#9a5b1f" strokeWidth={1.4} strokeDasharray="5 3" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />
        {modes.map(mo => {
          const p = pos(mo);
          return <rect key={mo} x={p[0] - hs / 2} y={p[1] - hs / 2} width={hs} height={hs} fill="#fff" stroke="#9a5b1f" strokeWidth={1.2 / k} style={{ cursor: curs[mo] }}
            onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); drag.current = { type: 'resize', id: sel.id, mode: mo, sx: e.clientX, sy: e.clientY, l0: { ...sel }, b0: selB, isText: sel.kind === 'text', cropMode: !!(s.uiCrop && sel.kind === 'image' && sel.imgSrc) }; }} />;
        })}
        <line x1={scx} y1={selB[1]} x2={rp[0]} y2={rp[1]} stroke="#9a5b1f" strokeWidth={1 / k} />
        <circle cx={rp[0]} cy={rp[1]} r={4.5 / k} fill="#9a5b1f" stroke="#fff" strokeWidth={1.2 / k} style={{ cursor: 'crosshair' }}
          onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); const p = mmPt(e); drag.current = { type: 'rot', id: sel.id, cx: scx, cy: scy, a0: Math.atan2(p[1] - scy, p[0] - scx), r0: rot }; }} />
      </g>
    );
  };

  const zoomPct = Math.round(k * 100) + '%';
  return (
    <div ref={elRef} aria-label={view === 'design' ? t('Lienzo de diseño: arrastra imágenes a una cara') : undefined} data-testid={view === 'design' ? 'design-drop-canvas' : undefined}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#e7e0d0', userSelect: 'none', touchAction: 'none' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        {view === 'design' && (
          <defs>
            <linearGradient id="foilG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#E9CB6E" /><stop offset="0.5" stopColor="#B08A1E" /><stop offset="1" stopColor="#E3BE55" />
            </linearGradient>
            <linearGradient id="silvG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#EDEDF2" /><stop offset="0.5" stopColor="#9A9AA4" /><stop offset="1" stopColor="#DCDCE2" />
            </linearGradient>
            <linearGradient id="holoG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f5c6d6" /><stop offset="0.25" stopColor="#c9c3f0" /><stop offset="0.5" stopColor="#b7dcf5" /><stop offset="0.75" stopColor="#c2f0dd" /><stop offset="1" stopColor="#f7ecc8" />
            </linearGradient>
            {(g.panels || []).map(panel => {
              const id = 'design-panel-' + String(panel.panelId).replace(/[^a-zA-Z0-9_-]/g, '-');
              return <clipPath key={panel.panelId} id={id} clipPathUnits="userSpaceOnUse"><polygon points={panel.pts.map(p => p[0] + ',' + p[1]).join(' ')} /></clipPath>;
            })}
          </defs>
        )}
        <g transform={'translate(' + s.tx + ' ' + s.ty + ') scale(' + k + ')'}>
          {view === 'structure' && (<>
            {s.show.bleed && s.bleed > 0 && <path d={g.fillPath} fill="none" stroke="rgba(154,91,31,0.22)" strokeWidth={s.bleed * 2} strokeLinejoin="round" strokeLinecap="round" />}
            <path d={g.fillPath} fill="#fdfcf7" stroke="none" />
            {s.show.safe && <path d={g.safePath} fill="none" stroke="#c9a227" strokeWidth={0.45} strokeDasharray="2.2 1.8" />}
            <path d={g.creasePath} fill="none" stroke="#2E7D46" strokeWidth={1.5} style={{ vectorEffect: 'non-scaling-stroke' }} />
            <path d={g.cutPath} fill="none" stroke="#C8102E" strokeWidth={1.6} style={{ vectorEffect: 'non-scaling-stroke' }} />
            {g.perfPath && <path d={g.perfPath} fill="none" stroke="#C8102E" strokeWidth={1.6} strokeDasharray="5 3" style={{ vectorEffect: 'non-scaling-stroke' }} />}
            {(armedShape || shapeDrag) && (edgeTargets || []).map(tg => (
              <line key={'et' + tg.key} x1={tg.a[0]} y1={tg.a[1]} x2={tg.b[0]} y2={tg.b[1]} stroke="#28a7a1" strokeOpacity={0.55} strokeWidth={4} strokeDasharray="6 4" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />
            ))}
            {hoverEdge && (armedShape || shapeDrag) && (
              <g style={{ pointerEvents: 'none' }}>
                <line x1={hoverEdge.a[0]} y1={hoverEdge.a[1]} x2={hoverEdge.b[0]} y2={hoverEdge.b[1]} stroke="#28a7a1" strokeWidth={7} strokeLinecap="round" style={{ vectorEffect: 'non-scaling-stroke' }} />
                <circle cx={(hoverEdge.a[0] + hoverEdge.b[0]) / 2} cy={(hoverEdge.a[1] + hoverEdge.b[1]) / 2} r={9 / k} fill="#28a7a1" />
                <text x={(hoverEdge.a[0] + hoverEdge.b[0]) / 2} y={(hoverEdge.a[1] + hoverEdge.b[1]) / 2 + 4.5 / k} fontSize={14 / k} textAnchor="middle" fill="#fff" fontWeight={700}>+</text>
              </g>
            )}
            {highlighted && <polygon points={highlighted.pts.map(p => p[0] + ',' + p[1]).join(' ')} fill="rgba(154,91,31,0.16)" stroke="#9a5b1f" strokeWidth={2.4} strokeDasharray="7 3" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />}
            {highlighted && onPanelShift && panelShiftInfo && (() => {
              const info = panelShiftInfo(highlight);
              if (!info) return null;
              const xs = highlighted.pts.map(p => p[0]), ys = highlighted.pts.map(p => p[1]);
              const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
              const horiz = Math.abs(info.dir[0]) >= Math.abs(info.dir[1]);
              return (
                <g>
                  <circle cx={cx} cy={cy} r={9 / k} fill="#fff" stroke="#9a5b1f" strokeWidth={2 / k}
                    style={{ cursor: horiz ? 'ew-resize' : 'ns-resize' }}
                    onPointerDown={e => startDrag(e, { type: 'panelShift', id: highlight, start: mmPt(e), shift0: info.shift, dir: info.dir })} />
                  <text x={cx} y={cy + 3.5 / k} fontSize={11 / k} textAnchor="middle" fill="#9a5b1f" style={{ pointerEvents: 'none', userSelect: 'none' }}>{horiz ? '↔' : '↕'}</text>
                </g>
              );
            })()}
            {selFrame && onPanelResize && highlighted && (() => {
              // Tiradores sobre los bordes de corte de la cara seleccionada: profundidad (borde libre) y ancho (laterales).
              const hs = 8 / k, fr = selFrame;
              const hdl = [
                { which: 'h', p: toWorld(fr, fr.w / 2, fr.h), cur: Math.abs(fr.ey[1]) > Math.abs(fr.ey[0]) ? 'ns-resize' : 'ew-resize' },
                { which: 'wl', p: toWorld(fr, 0, fr.h / 2), cur: Math.abs(fr.ex[0]) > Math.abs(fr.ex[1]) ? 'ew-resize' : 'ns-resize' },
                { which: 'wr', p: toWorld(fr, fr.w, fr.h / 2), cur: Math.abs(fr.ex[0]) > Math.abs(fr.ex[1]) ? 'ew-resize' : 'ns-resize' }
              ];
              return hdl.map(hd => (
                <rect key={hd.which} x={hd.p[0] - hs / 2} y={hd.p[1] - hs / 2} width={hs} height={hs} rx={1.5 / k} fill="#fff" stroke="#C8102E" strokeWidth={1.6 / k}
                  style={{ cursor: hd.cur }} onPointerDown={e => startDrag(e, { type: 'edge', id: fr.id, which: hd.which, fr: { ...fr } })} />
              ));
            })()}
            {highlighted && onEdgePick && !armedShape && !shapeDrag && (() => {
              // «+» en cada borde libre de la cara elegida: pega ahí la forma activa de la paleta.
              const xs = highlighted.pts.map(p => p[0]), ys = highlighted.pts.map(p => p[1]);
              const cx = xs.reduce((a, v) => a + v, 0) / xs.length, cy = ys.reduce((a, v) => a + v, 0) / ys.length;
              return (edgeTargets || []).filter(tg => tg.panelId === highlight).map(tg => {
                const mx = (tg.a[0] + tg.b[0]) / 2, my = (tg.a[1] + tg.b[1]) / 2;
                let nx = tg.b[1] - tg.a[1], ny = tg.a[0] - tg.b[0]; const nl = Math.hypot(nx, ny) || 1;
                nx /= nl; ny /= nl; if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }
                const px = mx + nx * 11 / k, py = my + ny * 11 / k;
                return (
                  <g key={'plus' + tg.key} style={{ cursor: 'copy' }} onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); onEdgePick(tg); }}>
                    <title>{t('Añadir aquí la forma elegida')}</title>
                    <circle cx={px} cy={py} r={8 / k} fill="#fff" stroke="#28a7a1" strokeWidth={2 / k} />
                    <text x={px} y={py + 4 / k} fontSize={13 / k} textAnchor="middle" fill="#28a7a1" fontWeight={700} style={{ pointerEvents: 'none', userSelect: 'none' }}>+</text>
                  </g>
                );
              });
            })()}
            {(extraLines || []).map(l => {
              const col = l.kind === 'crease' ? '#2E7D46' : l.kind === 'slot' ? '#9a5b1f' : '#C8102E';
              const on = selLineId === l.id, ls = e => startDrag(e, { type: 'line', lineId: l.id, index: 'body', start: mmPt(e) });
              return (
                <g key={l.id}>
                  {on && <line x1={l.pts[0][0]} y1={l.pts[0][1]} x2={l.pts[1][0]} y2={l.pts[1][1]} stroke="#1c6ee0" strokeWidth={5} strokeOpacity={0.35} style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />}
                  <line x1={l.pts[0][0]} y1={l.pts[0][1]} x2={l.pts[1][0]} y2={l.pts[1][1]} stroke={col} strokeWidth={1.5} strokeDasharray={l.kind === 'crease' ? '4 2' : l.kind === 'perf' ? '5 3' : undefined} style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />
                  {onLineDrag && <>
                    <line x1={l.pts[0][0]} y1={l.pts[0][1]} x2={l.pts[1][0]} y2={l.pts[1][1]} stroke="rgba(0,0,0,0.001)" strokeWidth={11 / k} style={{ cursor: 'move' }} onPointerDown={e => { onLineDrag({ phase: 'start', id: l.id }); ls(e); }} />
                    {l.pts.map((p, i) => (
                      <circle key={i} cx={p[0]} cy={p[1]} r={(on ? 7 : 5.5) / k} fill="#fff" stroke={col} strokeWidth={1.8 / k} style={{ cursor: 'crosshair' }}
                        onPointerDown={e => { onLineDrag({ phase: 'start', id: l.id }); startDrag(e, { type: 'line', lineId: l.id, index: i, start: mmPt(e) }); }} />
                    ))}
                  </>}
                </g>
              );
            })}
            {s.show.labels && <g>{g.labels.map((p, i) => <text key={i} x={p.x} y={p.y} fontSize={p.fs} textAnchor="middle" style={{ fill: '#a59a85', fontWeight: 500, userSelect: 'none' }}>{p.name}</text>)}</g>}
            {s.show.dims && <g>{g.dims.map((d, i) => (
              <g key={i} transform={d.gtf}>
                <line x1={0} y1={0} x2={d.len} y2={0} stroke="#8a8071" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
                <line x1={0} y1={-2.4} x2={0} y2={2.4} stroke="#8a8071" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
                <line x1={d.len} y1={-2.4} x2={d.len} y2={2.4} stroke="#8a8071" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
                <text x={d.mid} y={-2.2} fontSize={3.4} textAnchor="middle" style={{ fill: '#6d6557', fontFamily: "'JetBrains Mono',monospace", userSelect: 'none' }}>{d.label}</text>
              </g>))}</g>}
            {editOn && renderLineEditor()}
          </>)}
          {view === 'design' && (<>
            <path d={g.fillPath} fill="#fdfcf7" stroke="none" />
            <path d={g.safePath} fill="none" stroke="#ddd0ab" strokeWidth={0.4} strokeDasharray="2.2 1.8" />
            <path d={g.creasePath} fill="none" stroke="#a8c9ae" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
            <path d={g.cutPath} fill="none" stroke="#dfaeb2" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
            {dropPanel && <polygon points={dropPanel.pts.map(p => p[0] + ',' + p[1]).join(' ')} fill="rgba(40,167,161,0.18)" stroke="#28a7a1" strokeWidth={2} style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />}
            {s.layers.filter(l => l.visible).map(renderLayer)}
            {snapG && (
              <g>
                {snapG.v != null && <line x1={snapG.v} y1={g.sbb[1] - 15} x2={snapG.v} y2={g.sbb[3] + 15} stroke="#d6318c" strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: 'non-scaling-stroke' }} />}
                {snapG.h != null && <line x1={g.sbb[0] - 15} y1={snapG.h} x2={g.sbb[2] + 15} y2={snapG.h} stroke="#d6318c" strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: 'non-scaling-stroke' }} />}
              </g>
            )}
            {renderSelOverlay()}
          </>)}
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
      {rulers && size.w > 0 && <Rulers k={k} tx={s.tx} ty={s.ty} w={size.w} h={size.h} cur={cur} onNew={newGuide} />}
      {hud && <div style={{ position: 'absolute', left: '50%', top: 14, transform: 'translateX(-50%)', padding: '5px 11px', borderRadius: 6, background: '#211d18', color: '#fff', fontSize: 12, fontFamily: "'JetBrains Mono',monospace", pointerEvents: 'none' }}>{hud}</div>}
      {dropPanel && <div data-testid="image-drop-hint" style={{ position: 'absolute', left: '50%', top: 18, transform: 'translateX(-50%)', padding: '7px 12px', borderRadius: 6, background: '#211d18', color: '#fff', fontSize: 12, fontWeight: 700, boxShadow: '0 6px 18px rgba(33,29,24,0.22)', pointerEvents: 'none' }}>{t('Suelta la imagen en esta cara')}</div>}
      {rulers && cur && <div style={{ position: 'absolute', left: RS + 8, top: RS + 6, padding: '2px 7px', borderRadius: 4, background: 'rgba(33,29,24,0.72)', color: '#fff', fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", pointerEvents: 'none' }}>X {fmt1(cur[0])} · Y {fmt1(cur[1])} mm</div>}
      <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 10, background: 'rgba(250,247,240,0.92)', border: '1px solid #ded5c4', borderRadius: 6, padding: '6px 12px', fontSize: 11, color: '#5c554a', alignItems: 'center' }}>
        {view === 'structure' ? (<>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 2, background: '#C8102E', display: 'inline-block' }} />{t('Corte')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 2, background: '#2E7D46', display: 'inline-block' }} />{t('Pliegue')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 0, borderTop: '2px dashed #C8102E', display: 'inline-block' }} />{t('Punteado')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 0, borderTop: '2px dashed #c9a227', display: 'inline-block' }} />{t('Zona segura')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 6, background: 'rgba(154,91,31,0.25)', display: 'inline-block' }} />{t('Sangrado')}</span>
        </>) : (<>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 8, background: 'linear-gradient(135deg,#E9CB6E,#B08A1E)', display: 'inline-block', borderRadius: 2 }} />{t('Oro')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 0, borderTop: '2px dashed #5a9bc4', display: 'inline-block' }} />{t('UV local')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 8, background: 'linear-gradient(135deg,#f8ffff,#74d8d1,#fff)', border: '1px solid #28a7a1', display: 'inline-block', borderRadius: 2 }} />{t('Brillo')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 8, background: 'rgba(33,29,24,0.12)', border: '1px solid rgba(33,29,24,0.35)', display: 'inline-block', borderRadius: 2 }} />{t('Relieve')}</span>
        </>)}
      </div>
      <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 4, background: 'rgba(250,247,240,0.92)', border: '1px solid #ded5c4', borderRadius: 6, padding: 4 }}>
        <button onClick={() => store.set(st => ({ k: Math.max(0.05, st.k / 1.25) }))} style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: '#5c554a', borderRadius: 4 }}>−</button>
        <div style={{ minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#5c554a' }}>{zoomPct}</div>
        <button onClick={() => store.set(st => ({ k: Math.min(40, st.k * 1.25) }))} style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: '#5c554a', borderRadius: 4 }}>+</button>
        <button onClick={() => setRulers(v => !v)} title={t('Reglas (arrastra desde una regla para crear una guía)')} style={{ height: 26, padding: '0 6px', border: 'none', cursor: 'pointer', fontSize: 11, borderRadius: 4, background: rulers ? '#9a5b1f' : 'transparent', color: rulers ? '#fff' : '#5c554a' }}>{t('Reglas')}</button>
        <button onClick={() => setGrid(v => !v)} title={t('Cuadrícula')} style={{ height: 26, padding: '0 6px', border: 'none', cursor: 'pointer', fontSize: 11, borderRadius: 4, background: grid ? '#9a5b1f' : 'transparent', color: grid ? '#fff' : '#5c554a' }}>{t('Rejilla')}</button>
        {guides.length > 0 && <button onClick={() => setGuides([])} title={t('Borrar todas las guías')} style={{ height: 26, padding: '0 6px', border: 'none', cursor: 'pointer', fontSize: 11, borderRadius: 4, background: 'transparent', color: '#14a6c8' }}>{t('Guías') + ' ✕'}</button>}
        <button onClick={() => { userMoved.current = false; fit(); }} title={t('Ajustar vista')} style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#5c554a', borderRadius: 4 }}>⤢</button>
      </div>
      {children}
    </div>
  );
}
