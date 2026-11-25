// Estructura: biblioteca de cajas, medidas interiores, material, corte y edición de líneas.
import React from 'react';
import { store, useStore } from '../state/store.js';
import { TPLS, MATS } from '../dieline/templates.js';
import { geomOf } from '../dieline/geom.js';
import { customLayout, templateToNet } from '../dieline/custom.js';
import { makePieces } from '../render3d/fold.js';
import { useT } from '../i18n/index.js';
import { preflightOf, LEVEL_DOT } from '../dieline/checks.js';
import { reflowLayersToContainers } from '../design/containers.js';
import { SheetCanvas } from './SheetCanvas.jsx';
import { ST, Block, Toggle, ToggleRow, CmField, MmField, Note, KV, selectSt, btnSt } from './widgets.jsx';
import { fmtCm, fmtMm } from '../units.js';
import { ask } from './dialogs.jsx';

const setNum = (key, min, max) => e => {
  const v = parseFloat(e.target.value);
  if (!isNaN(v)) store.set(st => {
    const next = { ...st, [key]: Math.min(max, Math.max(min, v)) }, mat = store.mat();
    return { [key]: next[key], layers: reflowLayersToContainers(st.layers, geomOf(st, mat.t), geomOf(next, mat.t)) };
  });
};

export function StructureView() {
  const tr = useT(); // `t` es el espesor del material en este archivo
  const s = useStore();
  const m = store.mat();
  const g = geomOf(s, m.t);
  const t = m.t;
  const sw = g.sbb[2] - g.sbb[0], sh = g.sbb[3] - g.sbb[1];
  const tkNow = Math.min(16, s.W * 0.55);
  const lay = s.tpl === 'custom' ? customLayout(s, t) : null;
  const isNet = !!(lay && lay.c.mode === 'net');
  const wrap = s.wrap || { flap: 0, outer: 0, inner: 0, tab: 12, slot: 20, slotW: 1.2, sideTab: 0 };
  const dimLabel = s.tpl === 'wrap'
    ? { L: tr('Ancho frente L'), W: tr('Fondo lateral W'), H: tr('Alto H') }
    : { L: tr('Largo L'), W: tr('Ancho W'), H: tr('Alto H') };
  const setWrap = (key, value) => store.set(st => {
    const next = { ...st, wrap: { ...(st.wrap || {}), [key]: value } };
    return { wrap: next.wrap, layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf(next, m.t)) };
  });
  const applyWrapExample = () => store.set(st => {
    const next = {
      ...st, L: 300, W: 60, H: 130,
      wrap: { ...(st.wrap || {}), flap: 60, outer: 151, inner: 60, tab: 15, slot: 55, slotW: 1.5, sideTab: 30 },
      custom: { ...(st.custom || {}), sheet: 'laser900' }
    };
    return {
      L: next.L, W: next.W, H: next.H, wrap: next.wrap, custom: next.custom,
      layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf(next, m.t))
    };
  });
  // Abre cualquier plantilla de la biblioteca como red editable en «Mi caja» (se puede deshacer).
  const editInBuilder = async () => {
    if (s.tpl !== 'wrap' && !(await ask(tr('¿Abrir «{name}» como red editable en «Mi caja»? La plantilla de la biblioteca dejará de estar activa; la forma se conserva y puedes deshacerlo con Ctrl+Z.', { name: tr((TPLS.find(x => x.id === s.tpl) || TPLS[0]).name) })))) return;
    const nextCustom = templateToNet(s, m.t, makePieces);
    store.set(st => ({
      tpl: 'custom', custom: nextCustom, view: 'designer', ovr: {}, typeOvr: {}, selSeg: null,
      fitNonce: st.fitNonce + 1,
      layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf({ ...st, custom: nextCustom }, m.t))
    }));
  };
  const specTpl = {
    rte: [{ k: tr('Secuencia de paneles'), v: fmtMm(s.W + t) + ' · ' + fmtMm(s.L + t) + ' · ' + fmtMm(s.W + t) + ' · ' + fmtMm(s.L + 2 * t) }, { k: tr('Tapa / lengüeta'), v: fmtMm(s.W + t) + ' / ' + fmtMm(tkNow) }],
    ste: [{ k: tr('Secuencia de paneles'), v: fmtMm(s.W + t) + ' · ' + fmtMm(s.L + t) + ' · ' + fmtMm(s.W + t) + ' · ' + fmtMm(s.L + 2 * t) }, { k: tr('Tapa / lengüeta'), v: fmtMm(s.W + t) + ' / ' + fmtMm(tkNow) }],
    mailer: [{ k: tr('Pared lateral'), v: fmtMm(s.H + t) }, { k: tr('Lengüeta'), v: fmtMm(Math.min(s.H * 0.7, 28)) }],
    lidbase: [{ k: tr('Holgura de tapa'), v: tr('+1,0 mm por lado') }, { k: tr('Alto de tapa'), v: fmtMm(Math.max(14, s.H * 0.45)) }],
    drawer: [{ k: tr('Holgura de funda'), v: '+2~4 × t' }, { k: tr('Fondo de tubo'), v: fmtMm(s.L + 2) }],
    cyl: [{ k: tr('Diámetro D'), v: fmtMm(s.L) }, { k: tr('Segmentos'), v: '24 × ' + fmtMm(Math.PI * s.L / 24) }],
    tri: [{ k: tr('Lado'), v: fmtMm(s.W) }, { k: tr('Di�metro circunscrito'), v: fmtMm(2 * s.W / (2 * Math.sin(Math.PI / 3))) }],
    hex: [{ k: tr('Lado'), v: fmtMm(s.W) }, { k: tr('Diámetro circunscrito'), v: fmtMm(2 * s.W / (2 * Math.sin(Math.PI / 6))) }],
    wrap: [
      { k: tr('Cara trasera'), v: fmtCm(s.L) + ' × ' + fmtCm(s.H) },
      { k: tr('Fondo lateral'), v: fmtCm(s.W) },
      { k: tr('Cara exterior'), v: fmtCm(wrap.outer > 0 ? wrap.outer : s.L / 2 + 1) },
      { k: tr('Cara interior'), v: fmtCm(wrap.inner > 0 ? wrap.inner : s.W) },
      { k: tr('Solapa'), v: fmtCm(wrap.flap > 0 ? wrap.flap : Math.max(20, Math.min(s.H * 0.55, 120))) },
      { k: tr('Ranura'), v: fmtMm(wrap.slot) + ' × ' + fmtMm(wrap.slotW || 0) }
    ],
    custom: lay ? (lay.c.mode === 'net' ? [
      { k: tr('Modo'), v: tr('Red avanzada') },
      { k: tr('Piezas'), v: '' + lay.roots.length },
      { k: tr('Caras'), v: '' + lay.nodes.length },
      { k: tr('Pliegues'), v: '' + g.creaseN }
    ] : [
      { k: tr('Fondo'), v: fmtCm(lay.L) + ' × ' + fmtCm(lay.W) },
      { k: tr('Altura de paredes'), v: fmtCm(lay.maxWall) },
      { k: tr('Pestañas de esquina'), v: lay.c.cornerTabs ? tr('Sí') + ' · ' + fmtMm(lay.c.tabDepth) : tr('No') },
      { k: tr('Tapa'), v: lay.c.build === 'open' ? tr('Abierta') : lay.c.build === 'dust' ? tr('Solo solapas') : lay.c.build === 'tuck' ? tr('Con lengüeta') : tr('Plana') }
    ]) : []
  };
  const specRows = [
    { k: tr('Desplegado'), v: fmtCm(sw) + ' × ' + fmtCm(sh) },
    { k: tr('Con sangrado'), v: fmtCm(sw + 2 * s.bleed) + ' × ' + fmtCm(sh + 2 * s.bleed) },
    { k: tr('Espesor t'), v: fmtMm(t) }
  ].concat(specTpl[s.tpl] || []);
  const pf = preflightOf(s, m, g, lay);
  const compNote = s.tpl === 'wrap'
    ? tr('Actual: cara trasera L×H, fondo lateral W, alas exterior/interior y solapas con pestañas/ranuras.')
    : s.tpl === 'rte' || s.tpl === 'ste'
    ? tr('Actual: W+t · L+t · W+t · L+2t, alto H+t.')
    : s.tpl === 'mailer'
      ? tr('Actual: espesor de canal t={t}, pared H+t, tapa W+3t.', { t: fmtMm(t) })
      : s.tpl === 'cyl'
        ? tr('Actual: diámetro D=L, cuerpo en 24 tramos, tapas de 24 lados.')
        : s.tpl === 'hex'
          ? tr('Actual: lado W, tubo hexagonal, tapas hexagonales.')
          : s.tpl === 'tri'
            ? tr('Actual: lado W, tubo triangular, tapas triangulares.')
            : s.tpl === 'custom'
            ? tr('Tu caja: fondo L×W, paredes con altura propia y compensación automática de espesor.')
            : tr('Actual: tapa/funda con +1 mm de holgura por lado.');
  const editOn = s.editMode;
  const typeOvrCount = Object.keys(s.typeOvr).length;
  const selSegOk = editOn && s.selSeg != null && g.segs[s.selSeg];
  const curSegT = selSegOk ? g.segs[s.selSeg].t : '';

  const chooseTpl = b => store.set(st => {
    const mat = store.mat();
    const cube = Math.abs(st.L - st.W) < 1 && Math.abs(st.W - st.H) < 1;
    const wrapDefaults = b.id === 'wrap' && cube
      ? {
        L: 300, W: 60, H: 130,
        wrap: { flap: 60, outer: 151, inner: 60, tab: 15, slot: 55, slotW: 1.5, sideTab: 30 },
        custom: { ...(st.custom || {}), sheet: 'laser900' }
      }
      : {};
    const next = { ...st, tpl: b.id, ovr: {}, typeOvr: {}, ...wrapDefaults };
    return {
      tpl: b.id, ovr: {}, typeOvr: {}, selSeg: null, fitNonce: st.fitNonce + 1,
      ...wrapDefaults,
      view: b.id === 'custom' ? 'designer' : st.view,
      layers: reflowLayersToContainers(st.layers, geomOf(st, mat.t), geomOf(next, mat.t))
    };
  });

  return (<>
    <div style={{ width: 256, flex: 'none', background: '#faf7f0', borderRight: '1px solid #ded5c4', overflowY: 'auto' }}>
      <Block>
        <ST>{tr('Biblioteca de cajas')}</ST>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
          {TPLS.map(b => (
            <div key={b.id} onClick={() => chooseTpl(b)}
              style={{ cursor: 'pointer', border: '1px solid ' + (s.tpl === b.id ? '#9a5b1f' : '#e2dac9'), background: s.tpl === b.id ? '#f7efe2' : '#fff', borderRadius: 6, padding: '7px 9px' }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, fontWeight: 700, color: s.tpl === b.id ? '#9a5b1f' : '#a59a85' }}>{b.code}</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 1 }}>{tr(b.name)}</div>
              <div style={{ fontSize: 10, color: '#8a8071' }}>{tr(b.sub)}</div>
            </div>
          ))}
        </div>
        <button onClick={() => store.set({ view: 'designer', tpl: 'custom', fitNonce: s.fitNonce + 1 })} style={{ ...btnSt, width: '100%', marginTop: 9, padding: '8px 0', border: '1px solid #9a5b1f', color: '#9a5b1f', fontWeight: 700 }}>{tr('Diseñar mi caja')}</button>
      </Block>
      {s.tpl !== 'custom' && s.tpl !== 'wrap' && (
        <Block>
          <ST>{tr('Editar en Mi caja')}</ST>
          <div style={{ fontSize: 11, color: '#6d6557', lineHeight: 1.65 }}>{tr('Convierte esta plantilla en una red editable: caras, solapas, pestañas y encajes pasan a ser modificables.')}</div>
          <button onClick={editInBuilder} style={{ ...btnSt, width: '100%', marginTop: 9, padding: '8px 0', border: '1px solid #9a5b1f', color: '#9a5b1f', fontWeight: 700 }}>{tr('Editar en Mi caja')}</button>
        </Block>
      )}
      {isNet ? (
        <Block>
          <ST>{tr('Red personalizada')}</ST>
          <div style={{ fontSize: 11, color: '#6d6557', lineHeight: 1.65 }}>
            {tr('{r} pieza(s) · {n} cara(s).', { r: lay.roots.length, n: lay.nodes.length })} {tr('Las medidas se editan cara a cara en el constructor.')}
          </div>
          <button onClick={() => store.set({ view: 'designer' })} style={{ ...btnSt, width: '100%', marginTop: 9, padding: '8px 0', border: '1px solid #9a5b1f', color: '#9a5b1f', fontWeight: 700 }}>{tr('Abrir editor de red')}</button>
        </Block>
      ) : (
        <Block>
          <ST>{tr('Medidas interiores')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
            <CmField label={dimLabel.L} mm={s.L} min={20} max={3000} onChange={v => setNum('L', 20, 3000)({ target: { value: v } })} />
            <CmField label={dimLabel.W} mm={s.W} min={15} max={3000} onChange={v => setNum('W', 15, 3000)({ target: { value: v } })} />
            <CmField label={dimLabel.H} mm={s.H} min={15} max={3000} onChange={v => setNum('H', 15, 3000)({ target: { value: v } })} />
          </div>
          <div style={{ fontSize: 10.5, color: '#a59a85', marginTop: 7, lineHeight: 1.55 }}>{tr('Se guardan en mm y se muestran en cm. El alto H se usa como altura base de las paredes en «Mi caja».')}</div>
        </Block>
      )}
      <Block>
        <ST>{tr('Material')}</ST>
        <select value={s.matId} onChange={e => { const nm = MATS.find(x => x.id === e.target.value); store.set(st => { const om = MATS.find(x => x.id === st.matId) || MATS[0], next = { ...st, matId: nm.id, bleed: nm.bleed }; return { matId: nm.id, bleed: nm.bleed, layers: reflowLayersToContainers(st.layers, geomOf(st, om.t), geomOf(next, nm.t)) }; }); }} style={selectSt}>
          {MATS.map(mm => <option key={mm.id} value={mm.id}>{mm.name}</option>)}
        </select>
        <div style={{ fontSize: 11, color: '#8a8071', marginTop: 7 }}>{tr('Espesor t =')} <b style={{ color: '#9a5b1f', fontFamily: "'JetBrains Mono',monospace" }}>{fmtMm(t)}</b> · {m.note}</div>
      </Block>
      <Block>
        <ST>{tr('Parámetros de corte')}</ST>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
          <MmField label={tr('Sangrado')} mm={s.bleed} min={0} max={20} onChange={v => setNum('bleed', 0, 20)({ target: { value: v } })} />
          <MmField label={tr('Pestaña de cola')} mm={s.glue} min={5} max={60} onChange={v => setNum('glue', 5, 60)({ target: { value: v } })} />
        </div>
        <div style={{ fontSize: 10.5, color: '#a59a85', marginTop: 7, lineHeight: 1.55 }}>{tr('Para láser usa sangrado 0–2 mm. El kerf se ajusta en «Mi caja» y en la exportación SVG.')}</div>
      </Block>
      {s.tpl === 'wrap' && (
        <Block>
          <ST>{tr('Parámetros de envolvente')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            <CmField label={tr('Solapa sup./inf.')} mm={wrap.flap} min={0} max={300} step={0.1} onChange={v => setWrap('flap', v)} />
            <CmField label={tr('Cara exterior')} mm={wrap.outer} min={0} max={800} step={0.1} onChange={v => setWrap('outer', v)} />
            <CmField label={tr('Cara interior')} mm={wrap.inner} min={0} max={800} step={0.1} onChange={v => setWrap('inner', v)} />
            <MmField label={tr('Pestaña lateral')} mm={wrap.sideTab || 0} min={0} max={80} step={0.5} onChange={v => setWrap('sideTab', v)} />
            <MmField label={tr('Pestaña')} mm={wrap.tab} min={3} max={60} step={0.5} onChange={v => setWrap('tab', v)} />
            <MmField label={tr('Largo ranura')} mm={wrap.slot} min={3} max={100} step={0.5} onChange={v => setWrap('slot', v)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 7 }}>
            <MmField label={tr('Ancho ranura')} mm={wrap.slotW} min={0} max={10} step={0.1} onChange={v => setWrap('slotW', v)} />
            <div style={{ fontSize: 10, color: '#a59a85', display: 'flex', alignItems: 'flex-end', paddingBottom: 7 }}>{tr('0 = corte de línea')}</div>
          </div>
          <div style={{ fontSize: 10.5, color: '#a59a85', marginTop: 7, lineHeight: 1.55 }}>{tr('0 = automático. Cara trasera = L × H; fondo lateral = W. Exterior/interior son los anchos de las alas laterales. Las ranuras reciben las pestañas de las solapas.')}</div>
          <button onClick={applyWrapExample} style={{ ...btnSt, width: '100%', marginTop: 9, padding: '8px 0', border: '1px solid #9a5b1f', color: '#9a5b1f', fontWeight: 700 }}>{tr('Aplicar formato del ejemplo (30 × 6 × 13 cm)')}</button>
          <button onClick={() => store.set({ view: 'design' })} style={{ ...btnSt, width: '100%', marginTop: 7, padding: '8px 0', border: '1px solid #2E7D46', color: '#2E7D46', fontWeight: 700 }}>{tr('Poner imágenes en las caras')}</button>
          <button onClick={editInBuilder} style={{ ...btnSt, width: '100%', marginTop: 7, padding: '8px 0', color: '#5c554a' }}>{tr('Editar red y marcar solapas')}</button>
        </Block>
      )}

      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <ST style={{ marginBottom: 0 }}>{tr('Edición de líneas')}</ST>
          <Toggle on={s.editMode} onClick={() => store.set(st => ({ editMode: !st.editMode, selSeg: null }))} />
        </div>
        {editOn && (<>
          <div style={{ fontSize: 11, color: '#8a8071', marginTop: 8, lineHeight: 1.6 }}>{tr('Haz clic en una línea para cambiarla entre corte, pliegue y punteado, o quitarla.')} {tr('Líneas modificadas:')} <b style={{ color: '#9a5b1f' }}>{typeOvrCount}</b>.</div>
          {selSegOk && (
            <div style={{ marginTop: 9, background: '#f0ebe0', border: '1px solid #e2dac9', borderRadius: 6, padding: '9px 11px' }}>
              <div style={{ fontSize: 11, color: '#6d6557', marginBottom: 7 }}>{tr('Línea seleccionada')} · {curSegT === 'cut' ? tr('Corte') : curSegT === 'perf' ? tr('Punteado') : curSegT === 'none' ? tr('Sin línea') : tr('Pliegue')}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => store.set(st => ({ typeOvr: { ...st.typeOvr, [st.selSeg]: 'cut' } }))} style={{ ...btnSt, flex: 1, background: curSegT === 'cut' ? '#C8102E' : '#fff', color: curSegT === 'cut' ? '#fff' : '#5c554a' }}>{tr('Corte')}</button>
                <button onClick={() => store.set(st => ({ typeOvr: { ...st.typeOvr, [st.selSeg]: 'crease' } }))} style={{ ...btnSt, flex: 1, background: curSegT === 'crease' ? '#2E7D46' : '#fff', color: curSegT === 'crease' ? '#fff' : '#5c554a' }}>{tr('Pliegue')}</button>
                <button onClick={() => store.set(st => ({ typeOvr: { ...st.typeOvr, [st.selSeg]: 'perf' } }))} style={{ ...btnSt, flex: 1, background: curSegT === 'perf' ? '#C8102E' : '#fff', color: curSegT === 'perf' ? '#fff' : '#5c554a', borderStyle: 'dashed' }}>{tr('Punteado')}</button>
                <button onClick={() => store.set(st => ({ typeOvr: { ...st.typeOvr, [st.selSeg]: 'none' } }))} title={tr('Quita la línea del troquel (se puede volver a poner eligiéndola de nuevo)')} style={{ ...btnSt, flex: 1, background: curSegT === 'none' ? '#5c554a' : '#fff', color: curSegT === 'none' ? '#fff' : '#5c554a' }}>{tr('Sin línea')}</button>
              </div>
            </div>
          )}
          <button onClick={() => store.set({ typeOvr: {}, selSeg: null })} style={{ ...btnSt, marginTop: 9, width: '100%', padding: '7px 0', color: '#5c554a' }}>{tr('Restablecer líneas')}</button>
        </>)}
      </Block>
      <div style={{ padding: 14 }}>
        <Note><b style={{ color: '#211d18' }}>{tr('Compensación de espesor')}</b><br />{tr('Medida de fabricación = medida interior + n × t.')}<br />{compNote}</Note>
      </div>
    </div>

    <SheetCanvas view="structure" g={g} />

    <div style={{ width: 268, flex: 'none', background: '#faf7f0', borderLeft: '1px solid #ded5c4', overflowY: 'auto' }}>
      <Block><ST>{tr('Medidas de fabricación')}</ST>{specRows.map(r => <KV key={r.k} k={r.k} v={r.v} />)}</Block>
      <Block>
        <ST>{tr('Estadísticas del troquel')}</ST>
        <KV k={tr('Corte')} v={fmtMm(g.cutLen) + ' · ' + tr('{n} tramos', { n: g.cutN })} />
        <KV k={tr('Pliegue')} v={fmtMm(g.creaseLen) + ' · ' + tr('{n} tramos', { n: g.creaseN })} />
        {g.slotN > 0 && <KV k={tr('Encajes')} v={g.slotN + ' · ' + fmtMm(g.slotLen)} />}
      </Block>
      <Block>
        <ST>{tr('Ver')}</ST>
        {[['bleed', tr('Zona de sangrado')], ['safe', tr('Zona segura')], ['dims', tr('Cotas')], ['labels', tr('Nombres de cara')]].map(x => (
          <ToggleRow key={x[0]} label={x[1]} on={s.show[x[0]]} onClick={() => store.set(st => ({ show: { ...st.show, [x[0]]: !st.show[x[0]] } }))} />
        ))}
      </Block>
      <div style={{ padding: 14 }}>
        <ST>{tr('Validación')}</ST>
        {pf.rows.map(c => (
          <div key={c.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', fontSize: 12, color: '#3d3830', lineHeight: 1.45 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: LEVEL_DOT[c.level] || '#3f9e5f', flex: 'none', marginTop: 5 }} />
            <span>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  </>);
}
