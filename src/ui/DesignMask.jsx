// Panel «Máscara de capa»: añadir, pintar (pincel ocultar/revelar), invertir, rellenar, desde la forma de la cara, activar, aplicar y eliminar.
import React, { useEffect } from 'react';
import { IconMask, IconBrush, IconEye, IconEyeOff, IconContrast, IconTrash, IconCheck, IconPolygon, IconShape } from '@tabler/icons-react';
import { ST, Block, btnSt } from './widgets.jsx';
import { Tip } from '../editor/ui.jsx';
import { useD, dstore } from '../design/ui.js';
import { addMask, fillMask, invertMask, removeMask, toggleMask, applyMask, faceMask } from '../design/masks.js';

const Lbl = ({ children, right }) => <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}><span>{children}</span><span style={{ fontFamily: "'JetBrains Mono',monospace", color: '#9a5b1f' }}>{right}</span></div>;
const Btn = ({ icon: I, tip, on, danger, children, style, ...p }) => (
  <Tip label={tip}>
    <button type="button" {...p} style={{ ...btnSt, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11.5, padding: '6px 4px', ...(on ? { background: '#9a5b1f', color: '#fff', borderColor: '#9a5b1f' } : {}), ...(danger ? { border: '1px solid #e0b7a8', color: '#c0492b' } : {}), ...(p.disabled ? { opacity: 0.4, cursor: 'default' } : {}), ...style }}>{I && <I size={14} stroke={1.8} />}{children}</button>
  </Tip>
);

export function MaskBlock({ sel, facePts, t }) {
  const d = useD(), br = d.maskBrush, has = !!(sel.mask && sel.mask.url), editing = d.maskEdit === sel.id, active = has && sel.mask.on !== false;
  useEffect(() => () => { if (dstore.get().maskEdit === sel.id) dstore.set({ maskEdit: null }); }, [sel.id]); // al cambiar de capa se sale del pintado
  const setBrush = patch => dstore.set({ maskBrush: { ...br, ...patch } });
  const faceBtns = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      <Btn icon={IconShape} tip={t('Máscara con la forma de la cara y borde suave')} disabled={!facePts} onClick={() => faceMask(sel.id, facePts, 'soft')}>{t('Cara suave')}</Btn>
      <Btn icon={IconPolygon} tip={t('Máscara con la forma de la cara, recortada 3 mm hacia dentro')} disabled={!facePts} onClick={() => faceMask(sel.id, facePts, 'inset')}>{t('Cara con margen')}</Btn>
    </div>
  );
  return (
    <Block>
      <ST>{t('Máscara de capa')}</ST>
      {!has && (<>
        <Btn icon={IconMask} tip={t('Crea una máscara en grises (blanco = visible, negro = oculto) del tamaño de la capa')} data-testid="mask-add" onClick={() => addMask(sel.id)} style={{ width: '100%', marginBottom: 6 }}>{t('Añadir máscara')}</Btn>
        <div style={{ fontSize: 10.5, color: '#8a8071', margin: '8px 0 5px' }}>{t('Máscara desde forma de la cara')}</div>
        {faceBtns}
      </>)}
      {has && (<>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <img alt={t('Máscara de capa')} src={sel.mask.url} data-testid="mask-thumb" style={{ width: 40, height: 40, objectFit: 'contain', border: '1px solid #ded5c4', borderRadius: 4, background: '#888', opacity: active ? 1 : 0.4, flex: 'none' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, flex: 1 }}>
            <Btn icon={active ? IconEye : IconEyeOff} tip={t('Activar o desactivar la máscara sin perderla')} data-testid="mask-toggle" aria-pressed={active} on={active} onClick={() => toggleMask(sel.id)}>{active ? t('Activa') : t('Apagada')}</Btn>
            <Btn icon={IconBrush} tip={t('Pintar la máscara en el lienzo (Alt invierte el pincel)')} data-testid="mask-paint" aria-pressed={editing} on={editing} onClick={() => dstore.set({ maskEdit: editing ? null : sel.id })}>{t('Pintar')}</Btn>
          </div>
        </div>
        {editing && (
          <div style={{ marginBottom: 8, padding: 8, border: '1px solid #e7e0d4', borderRadius: 6, background: '#fff' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
              <Btn tip={t('El pincel oculta (pinta negro)')} data-testid="mask-hide" aria-pressed={br.mode === 'hide'} on={br.mode === 'hide'} onClick={() => setBrush({ mode: 'hide' })}>{t('Ocultar')}</Btn>
              <Btn tip={t('El pincel revela (pinta blanco)')} data-testid="mask-reveal" aria-pressed={br.mode === 'reveal'} on={br.mode === 'reveal'} onClick={() => setBrush({ mode: 'reveal' })}>{t('Revelar')}</Btn>
            </div>
            <Lbl right={br.size + ' mm'}>{t('Tamaño del pincel')}</Lbl>
            <input type="range" aria-label={t('Tamaño del pincel')} min="1" max="60" value={br.size} onChange={e => setBrush({ size: +e.target.value })} style={{ width: '100%', accentColor: '#9a5b1f', margin: '0 0 8px' }} />
            <Lbl right={Math.round(br.hard * 100) + '%'}>{t('Dureza')}</Lbl>
            <input type="range" aria-label={t('Dureza')} min="0" max="100" value={Math.round(br.hard * 100)} onChange={e => setBrush({ hard: +e.target.value / 100 })} style={{ width: '100%', accentColor: '#9a5b1f', margin: 0 }} />
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
          <Btn icon={IconContrast} tip={t('Invierte la máscara: lo oculto se ve y lo visible se oculta')} data-testid="mask-invert" onClick={() => invertMask(sel.id)}>{t('Invertir')}</Btn>
          <Btn tip={t('Rellena toda la máscara de blanco: se ve la capa entera')} data-testid="mask-fill-white" onClick={() => fillMask(sel.id, true)}>{t('Rellenar blanco')}</Btn>
          <Btn tip={t('Rellena toda la máscara de negro: la capa queda oculta')} data-testid="mask-fill-black" onClick={() => fillMask(sel.id, false)}>{t('Rellenar negro')}</Btn>
          <Btn icon={IconCheck} tip={sel.kind === 'image' && sel.img ? t('Aplica la máscara a los píxeles de la imagen y la elimina') : t('Solo disponible en capas de imagen')} data-testid="mask-apply" disabled={!(sel.kind === 'image' && sel.img)} onClick={() => applyMask(sel.id)}>{t('Aplicar')}</Btn>
        </div>
        <Btn icon={IconTrash} danger tip={t('Elimina la máscara (la capa vuelve a verse entera)')} data-testid="mask-remove" onClick={() => { dstore.set({ maskEdit: null }); removeMask(sel.id); }} style={{ width: '100%', marginBottom: 8 }}>{t('Eliminar máscara')}</Btn>
        <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 5 }}>{t('Máscara desde forma de la cara')}</div>
        {faceBtns}
      </>)}
    </Block>
  );
}
