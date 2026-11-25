// Barra de herramientas vertical del diseñador (atajos: V T U I H Z; Espacio = mano temporal).
import React from 'react';
import { IconPointer, IconTypography, IconPhoto, IconHandStop, IconZoomIn, IconColorPicker, IconSquare, IconSquareRounded, IconCircle, IconTriangle, IconPolygon, IconStar, IconMinus } from '@tabler/icons-react';
import { useD, dstore, setTool } from '../design/ui.js';
import { useT } from '../i18n/index.js';
import { Tip } from '../editor/ui.jsx';

const SHAPE_ICONS = { rect: [IconSquare, 'Rectángulo'], round: [IconSquareRounded, 'Rectángulo redondeado'], ellipse: [IconCircle, 'Elipse'], triangle: [IconTriangle, 'Triángulo'], polygon: [IconPolygon, 'Polígono'], star: [IconStar, 'Estrella'], line: [IconMinus, 'Línea'] };

export function DesignToolbar({ onImage }) {
  const d = useD();
  const t = useT();
  const tool = d.space ? 'hand' : d.tool;
  const ShapeIcon = SHAPE_ICONS[d.shape][0];
  const btn = (on, extra) => ({ width: 34, height: 34, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', padding: 0, border: '1px solid ' + (on ? '#9a5b1f' : 'transparent'), background: on ? '#9a5b1f' : 'transparent', color: on ? '#fff' : '#3d3830', ...extra });
  const T = (id, I, label, key, on = tool === id, onClick = () => setTool(id)) => (
    <Tip key={id} label={label + (key ? ' (' + key + ')' : '')}>
      <button type="button" aria-label={label} aria-pressed={on} data-tool={id} onClick={onClick} style={btn(on)}><I size={19} stroke={1.7} /></button>
    </Tip>
  );
  return (
    <div role="toolbar" aria-label={t('Herramientas')} style={{ width: 44, flex: 'none', background: '#faf7f0', borderRight: '1px solid #ded5c4', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 0', position: 'relative', zIndex: 5 }}>
      {T('move', IconPointer, t('Mover / seleccionar'), 'V')}
      {T('text', IconTypography, t('Texto'), 'T')}
      {T('shape', ShapeIcon, t('Formas'), 'U')}
      {tool === 'shape' && (
        <div role="group" aria-label={t('Tipo de forma')} style={{ position: 'absolute', left: 46, top: 86, background: '#faf7f0', border: '1px solid #ded5c4', borderRadius: 8, padding: 4, display: 'grid', gap: 2, boxShadow: '0 6px 18px rgba(33,29,24,0.16)' }}>
          {Object.entries(SHAPE_ICONS).map(([id, [I, label]]) => (
            <Tip key={id} label={t(label)}>
              <button type="button" aria-label={t(label)} data-shape={id} aria-pressed={d.shape === id} onClick={() => dstore.set({ shape: id })} style={btn(d.shape === id, { width: 30, height: 30 })}><I size={17} stroke={1.7} /></button>
            </Tip>
          ))}
        </div>
      )}
      {T('image', IconPhoto, t('Imagen (colocar desde archivo)'), '', false, onImage)}
      <div style={{ width: 24, height: 1, background: '#ded5c4', margin: '4px 0' }} />
      {T('hand', IconHandStop, t('Mano (Espacio)'), 'H')}
      {T('zoom', IconZoomIn, t('Zoom (clic acerca, Alt aleja)'), 'Z')}
      {T('eyedrop', IconColorPicker, t('Cuentagotas'), 'I')}
      <Tip label={t('Color activo (formas y texto nuevos)')}>
        <label style={{ marginTop: 6, width: 28, height: 28, borderRadius: 6, border: '2px solid #fff', boxShadow: '0 0 0 1px #d8d0c2', background: d.color || '#211d18', cursor: 'pointer', overflow: 'hidden', position: 'relative' }}>
          <input type="color" aria-label={t('Color activo (formas y texto nuevos)')} value={d.color || '#211d18'} onChange={e => dstore.set({ color: e.target.value })} style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
        </label>
      </Tip>
    </div>
  );
}
