// Shared small UI: Radix tooltip wrapper, icon button, labelled slider.
import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Slider from '@radix-ui/react-slider';

export const TipProvider = ({ children }) => <Tooltip.Provider delayDuration={250}>{children}</Tooltip.Provider>;

export function Tip({ label, children }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="bottom" sideOffset={6} style={{ background: '#211d18', color: '#fff', fontSize: 11.5, padding: '4px 8px', borderRadius: 5, zIndex: 100000, maxWidth: 260 }}>
          {label}<Tooltip.Arrow style={{ fill: '#211d18' }} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// Square icon button with tooltip; `on` marks the active state.
export function IconBtn({ icon: I, label, on, onClick, disabled, size = 30, danger, style }) {
  return (
    <Tip label={label}>
      <button type="button" aria-label={label} aria-pressed={on === undefined ? undefined : !!on} disabled={disabled} onClick={onClick}
        style={{ width: size, height: size, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, border: '1px solid ' + (on ? '#9a5b1f' : '#d8d0c2'), background: on ? '#9a5b1f' : '#fff', color: on ? '#fff' : danger ? '#c0492b' : '#3d3830', padding: 0, ...style }}>
        <I size={Math.round(size * 0.6)} stroke={1.7} />
      </button>
    </Tip>
  );
}

export function Range({ label, value, min, max, step = 1, onChange, onCommit, unit = '' }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8a8071', marginBottom: 5 }}>
        <span>{label}</span><span style={{ fontFamily: "'JetBrains Mono',monospace", color: '#9a5b1f' }}>{Math.round(value * 100) / 100}{unit}</span>
      </div>
      <Slider.Root min={min} max={max} step={step} value={[value]} onValueChange={v => onChange(v[0])} onValueCommit={v => onCommit && onCommit(v[0])}
        style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 16, touchAction: 'none', userSelect: 'none' }}>
        <Slider.Track style={{ background: '#e2dac9', position: 'relative', flexGrow: 1, height: 3, borderRadius: 9 }}>
          <Slider.Range style={{ position: 'absolute', background: '#9a5b1f', height: '100%', borderRadius: 9 }} />
        </Slider.Track>
        <Slider.Thumb aria-label={label} style={{ display: 'block', width: 13, height: 13, background: '#fff', border: '2px solid #9a5b1f', borderRadius: 99 }} />
      </Slider.Root>
    </div>
  );
}
