// Dark workspace widgets for the photo editor (the shared light ones live in ui.jsx).
import React from 'react';
import * as Slider from '@radix-ui/react-slider';
import { Tip } from './ui.jsx';

export const P = { bg: '#26231f', bar: '#302c27', panel: '#35312b', panel2: '#3e3a33', line: '#4a443b', text: '#ece5d6', mut: '#a39a89', dim: '#7d7466', acc: '#9a5b1f', accHi: '#e0a65e', canvas: '#1d1b18' };
export const MONO = "'JetBrains Mono',monospace";

export function DBtn({ icon: I, label, on, onClick, disabled, size = 28, danger, style, children }) {
  return (
    <Tip label={label}>
      <button type="button" aria-label={label} aria-pressed={on === undefined ? undefined : !!on} disabled={disabled} onClick={onClick}
        style={{ minWidth: size, height: size, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, border: '1px solid ' + (on ? P.acc : 'transparent'), background: on ? P.acc : 'transparent', color: on ? '#fff' : danger ? '#ee8a6e' : P.text, padding: children ? '0 8px' : 0, fontSize: 12, ...style }}>
        {I && <I size={Math.round(size * 0.62)} stroke={1.6} />}{children}
      </button>
    </Tip>
  );
}
export const TextBtn = ({ children, onClick, primary, disabled, style, icon: I, label }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={label}
    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 11px', borderRadius: 6, border: '1px solid ' + (primary ? P.acc : P.line), background: primary ? P.acc : P.panel2, color: primary ? '#fff' : P.text, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontSize: 12, fontWeight: primary ? 600 : 400, ...style }}>
    {I && <I size={14} stroke={1.7} />}{children}
  </button>
);

export function DRange({ label, value, min, max, step = 1, onChange, onCommit, unit = '', width }) {
  return (
    <div style={{ marginBottom: 8, width }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: P.mut, marginBottom: 3 }}>
        <span>{label}</span><span style={{ fontFamily: MONO, color: P.accHi }}>{Math.round(value * 100) / 100}{unit}</span>
      </div>
      <Slider.Root min={min} max={max} step={step} value={[value]} onValueChange={v => onChange(v[0])} onValueCommit={v => onCommit && onCommit(v[0])}
        style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 16, touchAction: 'none', userSelect: 'none' }}>
        <Slider.Track style={{ background: P.line, position: 'relative', flexGrow: 1, height: 3, borderRadius: 9 }}>
          <Slider.Range style={{ position: 'absolute', background: P.acc, height: '100%', borderRadius: 9 }} />
        </Slider.Track>
        <Slider.Thumb aria-label={label} style={{ display: 'block', width: 13, height: 13, background: P.text, border: '2px solid ' + P.acc, borderRadius: 99 }} />
      </Slider.Root>
    </div>
  );
}

export const selSt = { boxSizing: 'border-box', padding: '4px 6px', border: '1px solid ' + P.line, borderRadius: 5, background: P.bg, fontSize: 12, color: P.text, colorScheme: 'dark' };
export const Sel = ({ value, onChange, children, label, style }) => <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} style={{ ...selSt, ...style }}>{children}</select>;
export const Num = ({ value, onChange, min, max, step = 1, label, style, onBlur }) => (
  <input type="number" aria-label={label} value={value} min={min} max={max} step={step} onBlur={onBlur}
    onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} style={{ ...selSt, width: 62, fontFamily: MONO, ...style }} />
);
export const Chk = ({ checked, onChange, children }) => (
  <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12, color: P.text, cursor: 'pointer' }}>
    <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: P.acc }} />{children}
  </label>
);
export const Seg = ({ items, value, onChange }) => (
  <div style={{ display: 'inline-flex', border: '1px solid ' + P.line, borderRadius: 6, overflow: 'hidden' }}>
    {items.map(([v, node, tip]) => (
      <Tip key={v} label={tip}><button type="button" aria-label={tip} aria-pressed={value === v} onClick={() => onChange(v)}
        style={{ minWidth: 28, height: 26, padding: '0 8px', border: 'none', borderRight: '1px solid ' + P.line, background: value === v ? P.acc : P.panel2, color: value === v ? '#fff' : P.text, cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{node}</button></Tip>
    ))}
  </div>
);
export const Field = ({ label, children, style }) => <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: P.mut, ...style }}>{label}{children}</label>;
export const Sec = ({ title, children, right, style }) => (
  <div style={{ padding: '10px 12px', borderBottom: '1px solid ' + P.line, ...style }}>
    {title && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, letterSpacing: '0.14em', color: P.mut, fontWeight: 700, marginBottom: 8 }}><span>{title}</span>{right}</div>}
    {children}
  </div>
);
