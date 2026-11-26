// Right-hand panels of the photo editor: layers, adjustments, filters, history.
import React, { useEffect, useRef, useState } from 'react';
import {
  IconEye, IconEyeOff, IconLock, IconLockOpen, IconPlus, IconCopy, IconTrash, IconLayersSubtract, IconStack2, IconMask, IconAdjustments, IconGripVertical,
  IconFlipHorizontal, IconFlipVertical, IconRotateClockwise, IconChevronDown, IconChevronRight, IconCheck, IconX, IconContrast, IconBrightness, IconChartLine, IconPalette, IconSun, IconColorSwatch, IconBolt, IconDroplet, IconPhoto
} from '@tabler/icons-react';
import { P, MONO, DBtn, TextBtn, DRange, Sel, Num, Chk, Sec, Field } from './editorUi.jsx';
import { BLENDS, BLEND_ES, applyTransform, isAdj } from './doc.js';
import { curveLut, freshAdj } from './fx.js';

export const ADJS = [
  ['bc', 'Brillo / contraste', IconBrightness], ['levels', 'Niveles', IconChartLine], ['curves', 'Curvas', IconChartLine], ['hsl', 'Tono / saturación', IconPalette],
  ['balance', 'Equilibrio de color', IconColorSwatch], ['vibrance', 'Intensidad', IconBolt], ['exposure', 'Exposición', IconSun], ['bw', 'Blanco y negro', IconContrast],
  ['invert', 'Invertir', IconContrast], ['threshold', 'Umbral', IconDroplet], ['posterize', 'Posterizar', IconPhoto]
];
export const adjName = op => (ADJS.find(a => a[0] === op) || [0, op])[1];

// ───────── thumbnails ─────────
const TW = 38, TH = 30;
function Thumb({ doc, l }) {
  const ref = useRef(null), k = Math.min(TW / doc.w, TH / doc.h), w = Math.max(1, Math.round(doc.w * k)), h = Math.max(1, Math.round(doc.h * k));
  useEffect(() => {
    const c = ref.current; if (!c) return; const x = c.getContext('2d'); x.clearRect(0, 0, w, h);
    if (isAdj(l)) return;
    x.save(); x.scale(k, k); applyTransform(x, l); x.drawImage(l.canvas, 0, 0); x.restore();
  }, [l.ver, l.x, l.y, l.rot, l.sx, l.sy, doc.w, doc.h, l.id, w, h]);
  return (
    <div style={{ width: TW, height: TH, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, background: 'repeating-conic-gradient(#5a554c 0% 25%, #3b372f 0% 50%) 0 0 / 8px 8px', border: '1px solid ' + P.line, overflow: 'hidden' }}>
      {isAdj(l) ? <IconAdjustments size={16} color={P.accHi} /> : <canvas ref={ref} width={w} height={h} style={{ width: w, height: h }} />}
    </div>
  );
}
function MaskThumb({ doc, l, on, onClick }) {
  const ref = useRef(null), k = Math.min(TW / doc.w, TH / doc.h), w = Math.max(1, Math.round(doc.w * k)), h = Math.max(1, Math.round(doc.h * k));
  useEffect(() => { const c = ref.current; if (!c) return; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.drawImage(l.mask, 0, 0, w, h); }, [l.mver, doc.w, doc.h, w, h, l.id]);
  return <canvas ref={ref} width={w} height={h} onClick={onClick} style={{ width: w * 0.8, height: h * 0.8, flex: 'none', borderRadius: 3, border: '2px solid ' + (on ? P.accHi : P.line), opacity: l.maskOn === false ? 0.4 : 1, cursor: 'pointer' }} />;
}

// ───────── layers ─────────
export function LayersPanel({ doc, t, api }) {
  const [drag, setDrag] = useState(null), [over, setOver] = useState(null), [ren, setRen] = useState(null), [more, setMore] = useState(false), [adjMenu, setAdjMenu] = useState(false);
  const l = doc.layers.find(x => x.id === doc.activeId) || null, adj = isAdj(l);
  const nf = (v, f) => { const x = parseFloat(v); if (Number.isFinite(x)) f(x); };
  const sh = (l && l.fx && l.fx.shadow) || { on: false, x: 8, y: 8, blur: 12, opacity: 0.6, color: '#000000' };
  const setSh = (p, c) => api.setL({ fx: { ...(l.fx || {}), shadow: { ...sh, ...p } } }, c ? t('Sombra') : null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ padding: '8px 12px 2px', borderBottom: '1px solid ' + P.line }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <Sel label={t('Modo de fusión')} value={l ? l.blend : 'source-over'} onChange={v => api.setL({ blend: v }, t('Modo de fusión'))} style={{ flex: 1, minWidth: 0 }}>
            {BLENDS.map(b => <option key={b} value={b}>{t(BLEND_ES[b])}</option>)}
          </Sel>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: adj ? '1fr' : '1fr 1fr', gap: 12 }}>
          <DRange label={t('Opacidad')} value={l ? Math.round(l.opacity * 100) : 100} min={0} max={100} unit="%" onChange={v => api.setL({ opacity: v / 100 })} onCommit={() => api.commitBump(t('Opacidad'))} />
          {!adj && <DRange label={t('Relleno')} value={l ? Math.round(l.fill * 100) : 100} min={0} max={100} unit="%" onChange={v => api.setL({ fill: v / 100 })} onCommit={() => api.commitBump(t('Relleno'))} />}
        </div>
      </div>
      <div style={{ flex: '1 1 0', overflowY: 'auto', padding: 6, minHeight: 96 }} data-testid="ed-layers">
        {doc.layers.slice().reverse().map(x => {
          const on = x.id === doc.activeId, edM = on && doc.editMask && x.mask;
          return (
            <div key={x.id} data-ed-layer={x.name} draggable={ren !== x.id}
              onDragStart={e => { setDrag(x.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(x.id)); }}
              onDragEnd={() => { setDrag(null); setOver(null); }}
              onDragOver={e => { if (drag == null) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setOver({ id: x.id, above: e.clientY < r.top + r.height / 2 }); }}
              onDrop={e => { e.preventDefault(); if (drag != null && over) api.reorder(drag, x.id, over.above); setDrag(null); setOver(null); }}
              onClick={() => api.select(x.id)}
              onDoubleClick={() => setRen(x.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', marginBottom: 3, borderRadius: 6, cursor: 'pointer', opacity: drag === x.id ? 0.4 : 1, border: '1px solid ' + (on ? P.acc : 'transparent'), background: on ? '#4a3a28' : P.panel2,
                boxShadow: over && over.id === x.id && drag !== x.id ? (over.above ? `0 -2px 0 ${P.accHi}` : `0 2px 0 ${P.accHi}`) : 'none' }}>
              <IconGripVertical size={12} color={P.dim} style={{ flex: 'none', cursor: 'grab' }} />
              <span role="button" aria-label={t('Mostrar / ocultar')} onClick={e => { e.stopPropagation(); api.toggle(x, 'visible'); }} style={{ display: 'flex', flex: 'none', color: x.visible ? P.text : P.dim }}>{x.visible ? <IconEye size={15} /> : <IconEyeOff size={15} />}</span>
              <Thumb doc={doc} l={x} />
              {x.mask && <MaskThumb doc={doc} l={x} on={edM} onClick={e => { e.stopPropagation(); api.select(x.id); api.editMask(!(on && doc.editMask)); }} />}
              {ren === x.id
                ? <input autoFocus defaultValue={x.name} aria-label={t('Nombre de capa')} maxLength={32} onClick={e => e.stopPropagation()} onFocus={e => e.target.select()} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRen(null); }}
                  onBlur={e => { setRen(null); api.rename(x, e.target.value); }} style={{ flex: 1, minWidth: 0, background: P.bg, color: P.text, border: '1px solid ' + P.acc, borderRadius: 4, fontSize: 12, padding: '2px 4px' }} />
                : <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: P.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span>}
              {x.fx && x.fx.shadow && x.fx.shadow.on && <span style={{ fontFamily: MONO, fontSize: 9.5, color: P.accHi, flex: 'none' }}>fx</span>}
              <span role="button" aria-label={t('Bloquear / desbloquear')} onClick={e => { e.stopPropagation(); api.toggle(x, 'locked'); }} style={{ display: 'flex', flex: 'none', color: x.locked ? P.accHi : P.dim }}>{x.locked ? <IconLock size={13} /> : <IconLockOpen size={13} />}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 2, padding: '5px 8px', borderTop: '1px solid ' + P.line, borderBottom: '1px solid ' + P.line, flexWrap: 'wrap', position: 'relative' }}>
        <DBtn icon={IconPlus} label={t('Capa vacía')} onClick={api.newLayer} />
        <DBtn icon={IconAdjustments} label={t('Nueva capa de ajuste')} on={adjMenu} onClick={() => setAdjMenu(v => !v)} />
        <DBtn icon={IconMask} label={l && l.mask ? t('Aplicar máscara') : t('Añadir máscara')} disabled={!l} onClick={() => (l.mask ? api.applyMask() : api.addMask(!!doc.sel))} />
        <DBtn icon={IconCopy} label={t('Duplicar capa') + ' (Ctrl+J)'} disabled={!l} onClick={api.dup} />
        <DBtn icon={IconLayersSubtract} label={t('Combinar con la inferior') + ' (Ctrl+E)'} disabled={!l || doc.layers.indexOf(l) < 1} onClick={api.mergeDown} />
        <DBtn icon={IconStack2} label={t('Combinar visibles') + ' (Ctrl+Shift+E)'} onClick={api.mergeVisible} />
        <div style={{ flex: 1 }} />
        <DBtn icon={IconTrash} label={t('Borrar capa')} danger disabled={!l} onClick={api.del} />
        {adjMenu && (
          <div style={{ position: 'absolute', left: 8, bottom: 38, zIndex: 5, background: P.panel2, border: '1px solid ' + P.line, borderRadius: 8, padding: 4, display: 'grid', gap: 1, boxShadow: '0 6px 20px rgba(0,0,0,.5)', width: 190 }}>
            {ADJS.map(([op, name, I]) => <button key={op} type="button" onClick={() => { setAdjMenu(false); api.newAdj(op); }} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 8px', border: 'none', background: 'transparent', color: P.text, fontSize: 12, cursor: 'pointer', textAlign: 'left', borderRadius: 4 }}><I size={14} color={P.accHi} />{t(name)}</button>)}
          </div>
        )}
      </div>
      {l && (
        <div style={{ padding: '6px 12px 8px', flex: '0 1 auto', minHeight: 0, overflowY: 'auto' }}>
          <button type="button" onClick={() => setMore(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: P.mut, fontSize: 11, cursor: 'pointer', padding: 0 }}>{more ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}{t('Máscara, transformar y efectos')}</button>
          {more && <div style={{ marginTop: 8 }}>
            {l.mask && <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <TextBtn onClick={() => api.toggleMask()}>{l.maskOn === false ? t('Activar máscara') : t('Desactivar máscara')}</TextBtn>
              <TextBtn onClick={() => api.invertLayerMask()}>{t('Invertir máscara')}</TextBtn>
              <TextBtn onClick={() => api.delMask()}>{t('Eliminar máscara')}</TextBtn>
              <TextBtn onClick={() => api.applyMask()}>{t('Aplicar máscara')}</TextBtn>
            </div>}
            {!l.mask && <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <TextBtn onClick={() => api.addMask(false)}>{t('Máscara: mostrar todo')}</TextBtn>
              <TextBtn onClick={() => api.addMask(true)} disabled={!doc.sel}>{t('Máscara desde selección')}</TextBtn>
            </div>}
            {!adj && <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Field label={t('Escala') + ' %'}><Num label={t('Escala')} value={Math.round(Math.abs(l.sx) * 100)} min={1} onChange={v => api.setL({ sx: Math.sign(l.sx) * Math.max(1, v) / 100, sy: Math.sign(l.sy) * Math.max(1, v) / 100 })} onBlur={() => api.commitBump(t('Transformar'))} /></Field>
                <Field label={t('Giro °')}><Num label={t('Giro °')} value={Math.round(l.rot * 10) / 10} onChange={v => api.setL({ rot: ((v % 360) + 360) % 360 })} onBlur={() => api.commitBump(t('Transformar'))} /></Field>
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                <DBtn icon={IconFlipHorizontal} label={t('Voltear horizontal')} onClick={() => api.setL({ sx: -l.sx }, t('Voltear'))} />
                <DBtn icon={IconFlipVertical} label={t('Voltear vertical')} onClick={() => api.setL({ sy: -l.sy }, t('Voltear'))} />
                <DBtn icon={IconRotateClockwise} label={t('Girar 90°')} onClick={() => api.setL({ rot: (l.rot + 90) % 360 }, t('Girar'))} />
              </div>
              <Chk checked={sh.on} onChange={v => setSh({ on: v }, true)}>{t('Sombra paralela')}</Chk>
              {sh.on && <div style={{ marginTop: 6 }}>
                <DRange label={t('Distancia X')} value={sh.x} min={-100} max={100} onChange={v => setSh({ x: v })} onCommit={() => api.commitBump(t('Sombra'))} />
                <DRange label={t('Distancia Y')} value={sh.y} min={-100} max={100} onChange={v => setSh({ y: v })} onCommit={() => api.commitBump(t('Sombra'))} />
                <DRange label={t('Desenfoque')} value={sh.blur} min={0} max={100} onChange={v => setSh({ blur: v })} onCommit={() => api.commitBump(t('Sombra'))} />
                <DRange label={t('Opacidad')} value={Math.round(sh.opacity * 100)} min={0} max={100} unit="%" onChange={v => setSh({ opacity: v / 100 })} onCommit={() => api.commitBump(t('Sombra'))} />
                <Field label={t('Color')}><input type="color" aria-label={t('Color')} value={sh.color} onChange={e => setSh({ color: e.target.value })} onBlur={() => api.commitBump(t('Sombra'))} style={{ width: 40, height: 24, padding: 0, border: '1px solid ' + P.line, background: 'none' }} /></Field>
              </div>}
            </>}
          </div>}
        </div>
      )}
    </div>
  );
}

// ───────── history ─────────
export function HistoryPanel({ doc, t, api }) {
  return (
    <div style={{ padding: 6 }} data-testid="ed-history">
      {doc.hist.map((h, i) => (
        <div key={i} role="button" onClick={() => api.jump(i)} style={{ padding: '5px 8px', marginBottom: 2, borderRadius: 5, fontSize: 12, cursor: 'pointer', color: i > doc.hi ? P.dim : P.text, background: i === doc.hi ? P.acc : P.panel2, display: 'flex', gap: 8 }}>
          <span style={{ fontFamily: MONO, color: i === doc.hi ? '#fff' : P.dim, width: 18, flex: 'none' }}>{i + 1}</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.label ? t(h.label) : t('Estado')}</span>
        </div>
      ))}
    </div>
  );
}

// ───────── adjustments ─────────
function CurveEditor({ params, onChange, onCommit, t }) {
  const ch = params.ch || 'm', pts = params.pts[ch], S = 200, ref = useRef(null), dr = useRef(null);
  const lut = curveLut(pts), col = { m: '#ece5d6', r: '#f06a5a', g: '#6fcf6f', b: '#6aa8ff' }[ch];
  const toP = e => { const r = ref.current.getBoundingClientRect(); return [Math.round(Math.min(255, Math.max(0, (e.clientX - r.left) / r.width * 255))), Math.round(Math.min(255, Math.max(0, 255 - (e.clientY - r.top) / r.height * 255)))]; };
  const set = np => onChange({ ...params, pts: { ...params.pts, [ch]: np } });
  const down = e => {
    const p = toP(e); let i = pts.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 12);
    if (i < 0) { if (pts.length >= 12) return; const np = pts.concat([p]).sort((a, b) => a[0] - b[0]); i = np.indexOf(np.find(q => q === p)); set(np); }
    dr.current = i; e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (dr.current == null) return; const p = toP(e), i = dr.current;
    const lo = i > 0 ? pts[i - 1][0] + 1 : 0, hi = i < pts.length - 1 ? pts[i + 1][0] - 1 : 255, np = pts.slice(); np[i] = [i === 0 ? Math.min(p[0], hi) : i === pts.length - 1 ? Math.max(p[0], lo) : Math.min(hi, Math.max(lo, p[0])), p[1]];
    set(np);
  };
  const up = () => { if (dr.current != null) { dr.current = null; onCommit(); } };
  const dbl = e => { const p = toP(e), i = pts.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 12); if (i > 0 && i < pts.length - 1) { set(pts.filter((_, j) => j !== i)); onCommit(); } };
  const path = Array.from(lut, (v, x) => `${x === 0 ? 'M' : 'L'}${x / 255 * S} ${S - v / 255 * S}`).join('');
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
        <Sel label={t('Canal')} value={ch} onChange={v => onChange({ ...params, ch: v })}><option value="m">RGB</option><option value="r">{t('Rojo')}</option><option value="g">{t('Verde')}</option><option value="b">{t('Azul')}</option></Sel>
        <TextBtn onClick={() => { onChange({ ...params, pts: { ...params.pts, [ch]: [[0, 0], [255, 255]] } }); onCommit(); }}>{t('Restablecer')}</TextBtn>
      </div>
      <svg ref={ref} viewBox={`0 0 ${S} ${S}`} width={S} height={S} style={{ background: P.bg, border: '1px solid ' + P.line, borderRadius: 6, touchAction: 'none', cursor: 'crosshair', display: 'block' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onDoubleClick={dbl} data-testid="curve-editor">
        {[1, 2, 3].map(i => <g key={i}><line x1={i * S / 4} y1="0" x2={i * S / 4} y2={S} stroke={P.line} /><line x1="0" y1={i * S / 4} x2={S} y2={i * S / 4} stroke={P.line} /></g>)}
        <line x1="0" y1={S} x2={S} y2="0" stroke={P.dim} strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={col} strokeWidth="1.6" />
        {pts.map((q, i) => <circle key={i} cx={q[0] / 255 * S} cy={S - q[1] / 255 * S} r="4.5" fill={P.bg} stroke={col} strokeWidth="1.6" />)}
      </svg>
    </div>
  );
}

export function AdjControls({ layer, t, setP, commit }) {
  const op = layer.adj.op, q = { ...freshAdj(op), ...layer.adj.params };
  const S = (label, key, min, max, step = 1, unit = '') => <DRange key={key} label={t(label)} value={q[key]} min={min} max={max} step={step} unit={unit} onChange={v => setP({ [key]: v })} onCommit={commit} />;
  if (op === 'bc') return <>{S('Brillo', 'brightness', -100, 100)}{S('Contraste', 'contrast', -100, 100)}</>;
  if (op === 'levels') return <>{S('Negro de entrada', 'inB', 0, 254)}{S('Gamma', 'gamma', 0.1, 4, 0.01)}{S('Blanco de entrada', 'inW', 1, 255)}{S('Negro de salida', 'outB', 0, 254)}{S('Blanco de salida', 'outW', 1, 255)}</>;
  if (op === 'curves') return <CurveEditor params={q} t={t} onChange={v => setP(v)} onCommit={commit} />;
  if (op === 'hsl') return <>{S('Matiz', 'hue', -180, 180, 1, '°')}{S('Saturación', 'sat', -100, 100)}{S('Luminosidad', 'light', -100, 100)}</>;
  if (op === 'balance') {
    const r = q.range, v = q[r];
    const setC = (i, x) => { const n = v.slice(); n[i] = x; setP({ [r]: n }); };
    return <>
      <Sel label={t('Rango tonal')} value={r} onChange={x => setP({ range: x })} style={{ marginBottom: 8 }}><option value="s">{t('Sombras')}</option><option value="m">{t('Medios tonos')}</option><option value="h">{t('Luces')}</option></Sel>
      {[['Cian · Rojo', 0], ['Magenta · Verde', 1], ['Amarillo · Azul', 2]].map(([lb, i]) => <DRange key={i} label={t(lb)} value={v[i]} min={-100} max={100} onChange={x => setC(i, x)} onCommit={commit} />)}
    </>;
  }
  if (op === 'vibrance') return <>{S('Intensidad', 'vibrance', -100, 100)}{S('Saturación', 'sat', -100, 100, 1)}</>;
  if (op === 'exposure') return <>{S('Exposición', 'ev', -4, 4, 0.05)}{S('Desplazamiento', 'offset', -0.5, 0.5, 0.01)}{S('Gamma', 'gamma', 0.1, 4, 0.01)}</>;
  if (op === 'bw') return <>{S('Rojos', 'r', 0, 200)}{S('Verdes', 'g', 0, 200)}{S('Azules', 'b', 0, 200)}</>;
  if (op === 'threshold') return S('Umbral', 'level', 0, 255);
  if (op === 'posterize') return S('Niveles', 'levels', 2, 32);
  return <div style={{ fontSize: 12, color: P.mut }}>{t('Sin parámetros')}</div>;
}

export function AdjustPanel({ doc, t, api }) {
  const l = doc.layers.find(x => x.id === doc.activeId), cur = l && isAdj(l) ? l : null;
  return (
    <div>
      <Sec title={t('Capas de ajuste')}>
        <div style={{ fontSize: 11, color: P.mut, marginBottom: 8, lineHeight: 1.5 }}>{t('No destructivas: afectan a todo lo que hay debajo. Si hay una selección, se convierte en máscara.')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          {ADJS.map(([op, name, I]) => <button key={op} type="button" data-adj={op} onClick={() => api.newAdj(op)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid ' + P.line, background: P.panel2, color: P.text, fontSize: 11.5, cursor: 'pointer', textAlign: 'left' }}><I size={14} color={P.accHi} />{t(name)}</button>)}
        </div>
      </Sec>
      {cur && <Sec title={t(adjName(cur.adj.op))} right={<span style={{ display: 'inline-flex', gap: 4 }}><DBtn icon={IconCheck} label={t('Aplicar a la capa inferior')} onClick={api.mergeDown} disabled={doc.layers.indexOf(cur) < 1} /></span>}>
        <AdjControls layer={cur} t={t} setP={api.setAdjParams} commit={() => api.commitBump(t(adjName(cur.adj.op)))} />
      </Sec>}
      {!cur && <div style={{ padding: 14, fontSize: 12, color: P.mut }}>{t('Selecciona una capa de ajuste para editar sus parámetros.')}</div>}
    </div>
  );
}

// ───────── filters ─────────
export const FILTERS = [
  ['blur', 'Desenfoque gaussiano', [['radius', 'Radio', 0.5, 60, 0.5, 4]]],
  ['unsharp', 'Máscara de enfoque', [['amount', 'Cantidad', 10, 500, 5, 150], ['radius', 'Radio', 0.5, 20, 0.5, 2], ['threshold', 'Umbral', 0, 60, 1, 0]]],
  ['noise', 'Añadir ruido', [['amount', 'Cantidad', 1, 100, 1, 20]], [['mono', 'Monocromático', true]]],
  ['median', 'Reducir ruido (mediana)', [['radius', 'Radio', 1, 3, 1, 1]]],
  ['pixelate', 'Pixelar', [['size', 'Tamaño de celda', 2, 80, 1, 10]]],
  ['emboss', 'Relieve', [['angle', 'Ángulo', 0, 360, 5, 135], ['height', 'Altura', 1, 10, 0.5, 3]]],
  ['vignette', 'Viñeta', [['amount', 'Cantidad', -100, 100, 1, -60], ['size', 'Tamaño', 0, 100, 1, 50], ['feather', 'Suavidad', 5, 100, 1, 50]]]
];
export function FilterPanel({ doc, t, api }) {
  const [name, setName] = useState(null), [params, setParams] = useState({}), [busy, setBusy] = useState(false);
  const def = FILTERS.find(f => f[0] === name), l = doc.layers.find(x => x.id === doc.activeId), ok = l && !isAdj(l) && !l.locked;
  const choose = n => { const d = FILTERS.find(f => f[0] === n); const p = {}; d[2].forEach(x => { p[x[0]] = x[5]; }); (d[3] || []).forEach(x => { p[x[0]] = x[2]; }); setName(n); setParams(p); };
  const lid = l ? l.id : null;
  // live preview (debounced); changing layer or leaving the panel cancels it
  useEffect(() => {
    if (!name || !ok) return undefined;
    let dead = false; const h = setTimeout(() => { setBusy(true); api.previewFilter(name, params).finally(() => { if (!dead) setBusy(false); }); }, 90);
    return () => { dead = true; clearTimeout(h); };
  }, [name, JSON.stringify(params), lid]);
  useEffect(() => () => api.cancelFilter(), [lid]);
  const done = () => { api.applyFilter(t(def[1])); setName(null); };
  const cancel = () => { api.cancelFilter(); setName(null); };
  return (
    <div>
      <Sec title={t('Filtros')}>
        {!ok && <div style={{ fontSize: 11.5, color: P.mut, marginBottom: 8 }}>{t('Selecciona una capa de píxeles desbloqueada.')}</div>}
        <div style={{ display: 'grid', gap: 5 }}>
          {FILTERS.map(([n, lb]) => <button key={n} type="button" data-filter={n} disabled={!ok} onClick={() => choose(n)} style={{ padding: '6px 9px', textAlign: 'left', borderRadius: 6, border: '1px solid ' + (name === n ? P.acc : P.line), background: name === n ? '#4a3a28' : P.panel2, color: P.text, fontSize: 12, cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.5 }}>{t(lb)}</button>)}
        </div>
      </Sec>
      {def && ok && <Sec title={t(def[1])}>
        {def[2].map(([k, lb, mn, mx, st]) => <DRange key={k} label={t(lb)} value={params[k] ?? mn} min={mn} max={mx} step={st} onChange={v => setParams(p => ({ ...p, [k]: v }))} />)}
        {(def[3] || []).map(([k, lb]) => <Chk key={k} checked={params[k]} onChange={v => setParams(p => ({ ...p, [k]: v }))}>{t(lb)}</Chk>)}
        {doc.sel && <div style={{ fontSize: 11, color: P.mut, margin: '6px 0' }}>{t('Se aplica solo dentro de la selección.')}</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <TextBtn primary icon={IconCheck} onClick={done} disabled={busy}>{t('Aplicar')}</TextBtn>
          <TextBtn icon={IconX} onClick={cancel}>{t('Cancelar')}</TextBtn>
        </div>
      </Sec>}
    </div>
  );
}
