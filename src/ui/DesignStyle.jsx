// Estilos avanzados de capa: degradado, sombra y contorno exterior de texto. Todos se dibujan en drawLayer (2D, 3D y PDF).
import React from 'react';
import { ST, Block, btnSt, MmField } from './widgets.jsx';
import { gradStops } from '../design/layers.js';

const Lbl = ({ children, style }) => <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3, ...style }}>{children}</div>;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MONO = "'JetBrains Mono',monospace";
const Check = ({ on, label, onChange }) => (
  <label style={{ fontSize: 10.5, color: '#8a8071', display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, cursor: 'pointer' }}>
    <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} style={{ accentColor: '#9a5b1f' }} />{label}
  </label>
);
const Slide = ({ label, value, min, max, step = 1, suffix = '', onChange }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><Lbl style={{ marginBottom: 0 }}>{label}</Lbl><span style={{ fontFamily: MONO, fontSize: 11, color: '#9a5b1f' }}>{value}{suffix}</span></div>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#9a5b1f', margin: 0 }} />
  </div>
);

export function GradientBlock({ sel, updAll, t }) {
  const gr = sel.grad, on = !!gr;
  const stops = gradStops(gr, sel.color);
  const css = on ? (gr.type === 'radial' ? 'radial-gradient(circle,' : 'linear-gradient(' + (90 + (gr.angle || 0)) + 'deg,') + stops.map(s => s[1] + ' ' + Math.round(s[0] * 100) + '%').join(',') + ')' : '#fff';
  const setG = p => updAll({ grad: { type: 'linear', angle: 0, ...(gr || {}), stops: stops.map(s => s.slice()), ...p } });
  const setStop = (i, p) => setG({ stops: stops.map((s, j) => j === i ? [p.o == null ? s[0] : clamp(p.o, 0, 1), p.c || s[1]] : s) });
  return (
    <Block>
      <ST>{t('Degradado')}</ST>
      <Check on={on} label={t('Relleno con degradado')} onChange={v => updAll({ grad: v ? { type: 'linear', angle: 0, stops: [[0, sel.color || '#9a5b1f'], [1, '#ffffff']] } : undefined })} />
      {on && (<>
        <div aria-hidden style={{ height: 16, borderRadius: 4, border: '1px solid #d8d0c2', background: css, marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
          {[['linear', t('Lineal')], ['radial', t('Radial')]].map(([v, lb]) => (
            <button key={v} type="button" aria-pressed={(gr.type || 'linear') === v} onClick={() => setG({ type: v })} style={{ ...btnSt, flex: 1, fontSize: 11.5, background: (gr.type || 'linear') === v ? '#9a5b1f' : '#fff', color: (gr.type || 'linear') === v ? '#fff' : '#5c554a' }}>{lb}</button>
          ))}
        </div>
        {gr.type !== 'radial' && <Slide label={t('Ángulo')} value={Math.round(gr.angle || 0)} min={-180} max={180} suffix="°" onChange={v => setG({ angle: v })} />}
        {stops.map((s, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 46px 22px', gap: 6, alignItems: 'center', marginBottom: 5 }}>
            <input aria-label={t('Color de parada') + ' ' + (i + 1)} type="color" value={s[1]} onChange={e => setStop(i, { c: e.target.value })} style={{ width: 28, height: 24, padding: 0 }} />
            <input type="range" aria-label={t('Posición de parada') + ' ' + (i + 1)} min="0" max="100" value={Math.round(s[0] * 100)} onChange={e => setStop(i, { o: parseFloat(e.target.value) / 100 })} style={{ width: '100%', accentColor: '#9a5b1f', margin: 0 }} />
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: '#8a8071' }}>{Math.round(s[0] * 100)}%</span>
            <button type="button" aria-label={t('Quitar parada')} disabled={stops.length <= 2} onClick={() => setG({ stops: stops.filter((_, j) => j !== i) })} style={{ ...btnSt, padding: 0, height: 22, opacity: stops.length <= 2 ? 0.35 : 1 }}>×</button>
          </div>
        ))}
        {stops.length < 5 && <button type="button" onClick={() => { const a = stops[stops.length - 2], b = stops[stops.length - 1]; setG({ stops: stops.slice(0, -1).concat([[(a[0] + b[0]) / 2, b[1]]], [b]) }); }} style={{ ...btnSt, width: '100%', fontSize: 11.5 }}>+ {t('Añadir parada')}</button>}
      </>)}
    </Block>
  );
}

export function ShadowBlock({ sel, updAll, t }) {
  const sh = sel.shadow, on = !!sh;
  const setS = p => updAll({ shadow: { x: 1.2, y: 1.2, blur: 2, color: '#000000', opacity: 0.4, ...(sh || {}), ...p } });
  return (
    <Block>
      <ST>{t('Sombra')}</ST>
      <Check on={on} label={t('Sombra paralela')} onChange={v => updAll({ shadow: v ? { x: 1.2, y: 1.2, blur: 2, color: '#000000', opacity: 0.4 } : undefined })} />
      {on && (<>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
          <MmField label={t('Desp. X')} mm={sh.x || 0} min={-30} max={30} step={0.1} onChange={v => setS({ x: v })} />
          <MmField label={t('Desp. Y')} mm={sh.y || 0} min={-30} max={30} step={0.1} onChange={v => setS({ y: v })} />
          <MmField label={t('Desenfoque')} mm={sh.blur || 0} min={0} max={30} step={0.1} onChange={v => setS({ blur: v })} />
        </div>
        <Slide label={t('Opacidad de la sombra')} value={Math.round((sh.opacity == null ? 0.4 : sh.opacity) * 100)} min={0} max={100} suffix="%" onChange={v => setS({ opacity: v / 100 })} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, color: '#8a8071' }}>
          <span>{t('Color de la sombra')}</span><input aria-label={t('Color de la sombra')} type="color" value={sh.color || '#000000'} onChange={e => setS({ color: e.target.value })} />
        </div>
      </>)}
    </Block>
  );
}

export function TextStrokeBlock({ sel, updAll, t }) {
  const on = sel.tStrokeW > 0;
  return (
    <Block>
      <ST>{t('Contorno del texto')}</ST>
      <Check on={on} label={t('Contorno exterior')} onChange={v => updAll(v ? { tStrokeW: 0.4, tStroke: sel.tStroke || '#ffffff' } : { tStrokeW: 0 })} />
      {on && (<>
        <Slide label={t('Grosor del contorno')} value={Math.round(sel.tStrokeW * 10) / 10} min={0.1} max={4} step={0.1} suffix=" mm" onChange={v => updAll({ tStrokeW: v })} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, color: '#8a8071' }}>
          <span>{t('Color del contorno')}</span><input aria-label={t('Color del contorno')} type="color" value={sel.tStroke || '#ffffff'} onChange={e => updAll({ tStroke: e.target.value })} />
        </div>
      </>)}
    </Block>
  );
}

