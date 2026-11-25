// Salida: material y plancha, nesting con vista previa, archivos de producción y control (resumen / preflight / acabados).
import React, { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Select from '@radix-ui/react-select';
import { IconChevronDown, IconPackage, IconLayoutGrid, IconChecklist, IconFileTypePdf, IconFileTypeSvg, IconBolt, IconPrinter, IconRotate2, IconAlertTriangle, IconStack2, IconTestPipe, IconDownload } from '@tabler/icons-react';
import { store, useStore } from '../state/store.js';
import { geomOf, creaseSegsOf } from '../dieline/geom.js';
import { TPLS, MATS } from '../dieline/templates.js';
import { warnsOf, FIN_NAMES, layerNameOf, dpiOf } from '../design/layers.js';
import { embDirOf } from '../design/emboss.js';
import { normalizeCustom } from '../dieline/custom.js';
import { exportPDF, exportNestedPDF } from '../export/pdf.js';
import { exportSeparations } from '../export/separations.js';
import { exportLaserSVG, exportKerfTest, laserSvgOf, exportNestedSVG } from '../export/svg.js';
import { exportLaserDXF, exportNestedDXF } from '../export/dxf.js';
import { nest, polyArea, uniqueSheets, itemMatrix } from '../export/nesting.js';
import { ST, btnSt, inputSt, selectSt, MmField, Note } from './widgets.jsx';
import { fmtCm, fmtMm, sheetOf, SHEETS } from '../units.js';
import { useT } from '../i18n/index.js';
import { notifyError } from './dialogs.jsx';

const CSS = `
.ob-item{display:block;padding:6px 8px;border-radius:4px;font-size:12.5px;color:#211d18;cursor:pointer;outline:none}
.ob-item[data-highlighted]{background:#f0ebe0}
.ob-item[data-state=checked]{color:#9a5b1f;font-weight:600}
.ob-lbl{padding:6px 8px 2px;font-size:10px;letter-spacing:.14em;color:#8a8071;font-weight:700}
.ob-tab{display:flex;align-items:center;gap:7px;padding:10px 16px;border:0;border-bottom:2px solid transparent;background:none;font:inherit;font-size:13px;font-weight:600;color:#6d6557;cursor:pointer}
.ob-tab[data-state=active]{color:#9a5b1f;border-bottom-color:#9a5b1f}
.ob-tab:focus-visible,.ob-btn:focus-visible{outline:2px solid #9a5b1f;outline-offset:1px}
`;
const card = { background: '#fdfcf7', border: '1px solid #ded5c4', borderRadius: 10, padding: '16px 18px' };
const mono = { fontFamily: "'JetBrains Mono',monospace" };
const Lbl = ({ children }) => <div style={{ fontSize: 10.5, color: '#8a8071', margin: '9px 0 3px' }}>{children}</div>;
const Row = ({ k, v }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', fontSize: 12.5, borderBottom: '1px dashed #eee7d8' }}>
    <span style={{ color: '#6d6557', whiteSpace: 'nowrap' }}>{k}</span>
    <span style={{ ...mono, color: '#211d18', textAlign: 'right' }}>{v}</span>
  </div>
);

// Selector Radix: groups = [{ label?, items: [[value, text]] }]
function Sel({ value, onChange, groups, label }) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger aria-label={label} style={{ ...selectSt, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: 'pointer', textAlign: 'left' }}>
        <Select.Value /><Select.Icon><IconChevronDown size={14} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content position="popper" sideOffset={4} style={{ zIndex: 2000, background: '#fff', border: '1px solid #d8d0c2', borderRadius: 6, boxShadow: '0 8px 24px rgba(33,29,24,.16)', width: 'var(--radix-select-trigger-width)', maxHeight: 'var(--radix-select-content-available-height)', overflow: 'hidden' }}>
          <Select.Viewport style={{ padding: 4 }}>
            {groups.map((gr, i) => (
              <Select.Group key={i}>
                {gr.label && <Select.Label className="ob-lbl">{gr.label}</Select.Label>}
                {gr.items.map(([v, text]) => <Select.Item key={v} value={v} className="ob-item"><Select.ItemText>{text}</Select.ItemText></Select.Item>)}
              </Select.Group>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

const ExpBtn = ({ icon: Icon, children, onClick, tone = '#9a5b1f', primary, disabled }) => (
  <button className="ob-btn" disabled={disabled} onClick={onClick} style={{ ...btnSt, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '9px 10px', fontSize: 12.5, fontWeight: 700, border: '1px solid ' + tone, color: primary ? '#fff' : tone, background: primary ? tone : '#fff', opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'normal', textAlign: 'center' }}>
    <Icon size={17} stroke={1.8} style={{ flex: 'none' }} />{children}
  </button>
);

export function OutputView() {
  const s = useStore();
  const t = useT();
  const [sheetIdx, setSheetIdx] = useState(0);
  const m = store.mat();
  const g = geomOf(s, m.t);
  const sw = g.sbb[2] - g.sbb[0], sh = g.sbb[3] - g.sbb[1];
  const c = normalizeCustom(s.custom);
  const o = s.output;
  const setO = p => store.set(st => ({ output: { ...st.output, ...p } }));
  const runExport = async fn => { try { await fn(); } catch (e) { notifyError(e); } };

  // ---- nesting ----
  const laserT = o.target === 'laser';
  const pad = laserT ? 0 : s.bleed;
  const gap = Math.max(o.gap, laserT ? c.kerf : 0);
  const base = o.sheet === 'custom' ? { w: o.sheetW, h: o.sheetH } : sheetOf(o.sheet);
  const plan = useMemo(() => {
    const lo = Math.min(base.w, base.h), hi = Math.max(base.w, base.h);
    if (!lo) return null;
    const item = { w: sw + 2 * pad, h: sh + 2 * pad, area: g.fills.reduce((a, p) => a + polyArea(p), 0) || sw * sh };
    const dims = o.orient === 'portrait' ? [[lo, hi]] : o.orient === 'landscape' ? [[hi, lo]] : [[lo, hi], [hi, lo]];
    let best = null;
    dims.forEach(([W, H]) => {
      const res = nest(item, { sheetW: W, sheetH: H, margin: o.margin, gap, qty: o.qty, rotate: o.rotate });
      if (!best || res.yield > best.res.yield) best = { res, W, H };
    });
    return { ...best, item };
  }, [g, sw, sh, pad, gap, base.w, base.h, o.orient, o.margin, o.qty, o.rotate]);
  const uniq = plan ? uniqueSheets(plan.res) : [];
  const cur = uniq[Math.min(sheetIdx, uniq.length - 1)];
  const matSel = MATS.map(x => [x.id, t(x.name) + ' · t=' + fmtMm(x.t)]);
  const sheetGroups = [
    { label: t('Imprenta'), items: SHEETS.filter(x => x.kind === 'print' || x.id === 'a4' || x.id === 'a3').map(x => [x.id, t(x.name)]) },
    { label: t('Cama láser'), items: SHEETS.filter(x => x.kind === 'laser').map(x => [x.id, t(x.name)]) },
    { items: [['custom', t('Personalizada…')]] }
  ];
  const nestInfo = plan && { margin: o.margin, gap, kerf: c.kerf };
  const matLaser = /láser/i.test(m.note);

  // ---- resumen / preflight ----
  const tplName = (TPLS.find(x => x.id === s.tpl) || TPLS[0]).name;
  const typeOvrCount = Object.keys(s.typeOvr).length;
  const creaseSegs = creaseSegsOf(g);
  const missingImages = s.layers.filter(l => l.visible && l.kind === 'image' && !l.img);
  const loadedImages = s.layers.filter(l => l.visible && l.kind === 'image' && l.img);
  const lowDpiImages = loadedImages.filter(l => dpiOf(l) < 300);
  const netMode = s.tpl === 'custom' && c.mode === 'net';
  const wrapMode = s.tpl === 'wrap';
  const laser = laserSvgOf(s, m);
  const sheet = c.sheet === 'custom' ? c.sheetCustom : sheetOf(c.sheet);
  const laserFits = !sheet.w || (laser.pageW <= sheet.w && laser.pageH <= sheet.h) || (laser.pageW <= sheet.h && laser.pageH <= sheet.w);
  const OK = '#3f9e5f', BAD = '#d05a2a';
  const checksArr = [
    { label: t('Página 1:1 en milímetros con TrimBox / BleedBox'), dot: OK },
    { label: t('CutContour / Crease como tintas directas con sobreimpresión'), dot: OK },
    { label: t('Sangrado {a} {op} recomendado {b} ({note})', { a: fmtMm(s.bleed), op: s.bleed >= m.bleed ? '≥' : '<', b: fmtMm(m.bleed), note: t(m.note) }), dot: s.bleed >= m.bleed ? OK : BAD },
    { label: missingImages.length ? t('Hay {n} imágenes sin cargar; la exportación profesional y las separaciones se bloquearán', { n: missingImages.length }) : t('Todas las imágenes están cargadas'), dot: missingImages.length ? BAD : OK },
    { label: lowDpiImages.length ? t('Hay {n} capas de imagen por debajo de 300 dpi', { n: lowDpiImages.length }) : loadedImages.length ? t('Las imágenes cargadas llegan a 300 dpi') : t('No hay imágenes cargadas que revisar'), dot: lowDpiImages.length ? BAD : loadedImages.length ? OK : '#9a8f7e' },
    { label: t('Desplegado {a} × {b} · placa láser {p} · {f}', { a: fmtCm(sw), b: fmtCm(sh), p: sheet.w ? fmtCm(sheet.w) + ' × ' + fmtCm(sheet.h) : t('ajustada'), f: laserFits ? t('cabe') : t('no cabe') }), dot: laserFits ? OK : BAD },
    { label: t('Kerf declarado {k} · aplicar compensación en el software láser', { k: fmtMm(c.kerf, 2) }), dot: c.kerf > 0 ? OK : '#d0a02a' },
    { label: t('Contorno cerrado, autointersecciones y distancia mínima: revisar en el RIP / software láser antes de producir'), dot: '#9a8f7e' }
  ];
  const designWarnRows = s.layers.flatMap(l => warnsOf(l, creaseSegs, g.sbb).map(w => ({ label: t('Capa «{n}»: {w}', { n: layerNameOf(l), w }), dot: BAD })));
  const outChecks = checksArr.concat(designWarnRows);
  const outSummary = [
    { k: t('Caja'), v: tplName },
    netMode
      ? { k: t('Red personalizada'), v: t('{a} pieza(s) · {b} caras', { a: c.panels.filter(p => !p.parent).length, b: c.panels.length }) }
      : wrapMode
        ? { k: t('Envolvente'), v: t('Cara trasera {a} × {b} · fondo {c}', { a: fmtCm(s.L), b: fmtCm(s.H), c: fmtCm(s.W) }) }
        : { k: t('Medida interior'), v: fmtCm(s.L) + ' × ' + fmtCm(s.W) + ' × ' + fmtCm(s.H) },
    netMode
      ? { k: t('Modo'), v: t('Red avanzada') }
      : wrapMode
        ? { k: t('Encajes laterales'), v: g.slotN + ' · ' + fmtMm(g.slotLen) }
        : { k: t('Medida interior mm'), v: s.L + ' × ' + s.W + ' × ' + s.H + ' mm' },
    { k: t('Material'), v: t(m.name) + ' · t=' + fmtMm(m.t) },
    { k: t('Sangrado'), v: fmtMm(s.bleed) },
    { k: t('Desplegado'), v: fmtCm(sw) + ' × ' + fmtCm(sh) },
    { k: t('Líneas'), v: t('{a} corte · {b} pliegue · ajustes {c}', { a: g.cutN, b: g.creaseN, c: typeOvrCount }) },
    ...(g.slotN ? [{ k: t('Encajes para solapa'), v: t('{a} · {b} de corte', { a: g.slotN, b: fmtMm(g.slotLen) }) }] : []),
    { k: t('Capas de diseño'), v: t('{n} capas', { n: s.layers.length }) }
  ];
  const none = '—';
  const outFins = ['foil', 'silver', 'uv', 'gloss', 'holo'].map(f => ({ k: t(FIN_NAMES[f]), v: s.layers.filter(l => l.finish === f).map(layerNameOf).join(', ') || none }))
    .concat(['up', 'down'].map(dir => ({ k: dir === 'up' ? t('Relieve ↑') : t('Hundido ↓'), v: s.layers.filter(l => l.finish === 'emboss' && embDirOf(l, s.embDir) === dir).map(layerNameOf).join(', ') || none })))
    .concat([{ k: t('Cuatricromía'), v: t('{n} capas', { n: s.layers.filter(l => l.finish === 'none').length }) }]);

  const tf = p => 'matrix(' + itemMatrix(p, plan.item.h).join(' ') + ') translate(' + (pad - g.sbb[0]) + ' ' + (pad - g.sbb[1]) + ')';
  const pct = v => (v * 100).toFixed(1).replace('.', ',') + ' %';

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#f0ebe0' }}>
      <style>{CSS}</style>
      <Tabs.Root defaultValue="prod" style={{ maxWidth: 1040, margin: '0 auto', padding: '0 20px 30px' }}>
        <Tabs.List style={{ display: 'flex', gap: 4, borderBottom: '1px solid #ded5c4', margin: '14px 0 16px' }}>
          <Tabs.Trigger value="prod" className="ob-tab"><IconLayoutGrid size={17} />{t('Producción y nesting')}</Tabs.Trigger>
          <Tabs.Trigger value="check" className="ob-tab"><IconChecklist size={17} />{t('Resumen y control')}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="prod">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,330px) minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={card}>
                <ST><IconPackage size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{t('MATERIAL Y DESTINO')}</ST>
                <Lbl>{t('Cartón / papel / tablero')}</Lbl>
                <Sel label={t('Material')} value={s.matId} onChange={v => store.set({ matId: v })} groups={[{ items: matSel }]} />
                <div style={{ fontSize: 11, color: '#6d6557', marginTop: 6, lineHeight: 1.55 }}>
                  {t('Espesor t = {t} · {n}', { t: fmtMm(m.t), n: t(m.note) })}<br />
                  {matLaser ? t('Pensado para corte láser.') : t('Pensado para troquel / plotter de corte; en láser comprueba la potencia.')}
                </div>
                <Lbl>{t('Destino')}</Lbl>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[['laser', IconBolt, t('Láser / corte')], ['print', IconPrinter, t('Imprenta')]].map(([id, Icon, text]) => (
                    <button key={id} className="ob-btn" onClick={() => setO({ target: id, sheet: id === 'laser' ? 'laser600' : 'sra3' })} style={{ ...btnSt, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', fontWeight: 600, border: '1px solid ' + (o.target === id ? '#9a5b1f' : '#d8d0c2'), background: o.target === id ? '#f4e9d9' : '#fff', color: o.target === id ? '#9a5b1f' : '#3d3830' }}>
                      <Icon size={16} />{text}
                    </button>))}
                </div>
              </div>

              <div style={card}>
                <ST><IconStack2 size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{t('PLANCHA Y NESTING')}</ST>
                <Lbl>{t('Formato de plancha')}</Lbl>
                <Sel label={t('Formato de plancha')} value={o.sheet} onChange={v => setO({ sheet: v })} groups={sheetGroups} />
                {o.sheet === 'custom' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 7 }}>
                    <MmField label={t('Ancho')} mm={o.sheetW} min={50} max={5000} step={1} onChange={v => setO({ sheetW: v })} />
                    <MmField label={t('Alto')} mm={o.sheetH} min={50} max={5000} step={1} onChange={v => setO({ sheetH: v })} />
                  </div>)}
                <Lbl>{t('Orientación')}</Lbl>
                <Sel label={t('Orientación')} value={o.orient} onChange={v => setO({ orient: v })} groups={[{ items: [['auto', t('Automática (la que rinde más)')], ['portrait', t('Vertical')], ['landscape', t('Horizontal')]] }]} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 9 }}>
                  <MmField label={t('Margen')} mm={o.margin} min={0} max={100} step={1} onChange={v => setO({ margin: v })} />
                  <MmField label={t('Separación')} mm={o.gap} min={0} max={50} step={0.5} onChange={v => setO({ gap: v })} />
                </div>
                {laserT && c.kerf > o.gap && <div style={{ fontSize: 10.5, color: '#8a8071', marginTop: 5 }}>{t('Se usa el kerf ({k}) como separación mínima.', { k: fmtMm(c.kerf) })}</div>}
                {!laserT && <div style={{ fontSize: 10.5, color: '#8a8071', marginTop: 5 }}>{t('En imprenta cada pieza ocupa red + sangrado ({b}).', { b: fmtMm(s.bleed) })}</div>}
                <div style={{ marginTop: 9 }}>
                  <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>{t('Cantidad (0 = llenar la plancha)')}</div>
                  <input aria-label={t('Cantidad')} type="number" min="0" step="1" value={o.qty} onChange={e => setO({ qty: Math.max(0, Math.floor(+e.target.value || 0)) })} style={inputSt} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 12.5, color: '#3d3830', cursor: 'pointer' }}>
                  <input type="checkbox" checked={o.rotate} onChange={e => setO({ rotate: e.target.checked })} style={{ accentColor: '#9a5b1f' }} />
                  <IconRotate2 size={15} />{t('Permitir girar 90°')}
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
              <div style={card}>
                <ST>{t('VISTA PREVIA DE LA PLANCHA')}</ST>
                {!plan || !plan.res.count ? (
                  <div style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '24px 0', fontSize: 12.5, color: BAD }}>
                    <IconAlertTriangle size={18} />{t('La pieza ({a} × {b}) no cabe en la plancha con ese margen.', { a: plan ? fmtMm(plan.item.w, 1) : '', b: plan ? fmtMm(plan.item.h, 1) : '' })}
                  </div>
                ) : (<>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 12 }}>
                    {[[t('Por plancha'), plan.res.perSheet], [t('Planchas'), plan.res.sheets.length], [t('Piezas'), plan.res.count], [t('Rendimiento'), pct(plan.res.yield)], [t('Plancha'), plan.W + ' × ' + plan.H + ' mm']].map(([k, v]) => (
                      <div key={k} style={{ background: '#f6f1e6', border: '1px solid #e7e0d4', borderRadius: 7, padding: '7px 10px' }}>
                        <div style={{ fontSize: 10.5, color: '#8a8071' }}>{k}</div>
                        <div style={{ ...mono, fontSize: 14, fontWeight: 700, color: '#211d18' }}>{v}</div>
                      </div>))}
                  </div>
                  {uniq.length > 1 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {uniq.map((u, i) => <button key={i} className="ob-btn" onClick={() => setSheetIdx(i)} style={{ ...btnSt, padding: '4px 10px', fontSize: 11.5, border: '1px solid ' + (cur === u ? '#9a5b1f' : '#d8d0c2'), color: cur === u ? '#9a5b1f' : '#3d3830' }}>{t('Plancha {i} · {n} pzs × {r}', { i: i + 1, n: u.items.length, r: u.repeat })}</button>)}
                    </div>)}
                  <svg role="img" aria-label={t('Vista previa de la plancha')} viewBox={'0 0 ' + plan.W + ' ' + plan.H} style={{ width: '100%', maxHeight: 520, background: '#fff', border: '1px solid #ded5c4', borderRadius: 6, display: 'block' }}>
                    <rect x="0" y="0" width={plan.W} height={plan.H} fill="#fff" />
                    <rect x={o.margin} y={o.margin} width={plan.W - 2 * o.margin} height={plan.H - 2 * o.margin} fill="none" stroke="#b8b0a0" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                    {cur.items.map((p, i) => (
                      <g key={i} transform={tf(p)}>
                        <path d={g.fillPath} fill="#f4ecdc" stroke="none" />
                        <path d={g.creasePath} fill="none" stroke="#2a55d0" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                        <path d={g.cutPath} fill="none" stroke="#e02020" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                      </g>))}
                  </svg>
                  <div style={{ fontSize: 10.5, color: '#8a8071', marginTop: 6, lineHeight: 1.6 }}>
                    {t('Rendimiento = superficie real de la red / superficie de plancha. Ocupación de cajas envolventes: {p}.', { p: pct(plan.res.boxFill) })}
                  </div>
                </>)}
              </div>

              <div style={card}>
                <ST>{t('ARCHIVOS DE PRODUCCIÓN')}</ST>
                <Lbl>{t('Plancha con nesting')}</Lbl>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 8 }}>
                  <ExpBtn icon={IconFileTypeSvg} tone="#2E7D46" primary={laserT} disabled={!plan || !plan.res.count} onClick={() => runExport(() => exportNestedSVG(s, m, plan.res, plan.W, plan.H, nestInfo))}>{t('SVG láser con nesting · 1:1 · corte + pliegue')}</ExpBtn>
                  <ExpBtn icon={IconDownload} tone="#2E7D46" disabled={!plan || !plan.res.count} onClick={() => runExport(() => exportNestedDXF(s, m, plan.res, plan.W, plan.H, nestInfo, 'R12'))}>{t('DXF R12 con nesting · 1:1')}</ExpBtn>
                  <ExpBtn icon={IconDownload} tone="#2E7D46" disabled={!plan || !plan.res.count} onClick={() => runExport(() => exportNestedDXF(s, m, plan.res, plan.W, plan.H, nestInfo, 'R2000'))}>{t('DXF AutoCAD 2000 con nesting · 1:1')}</ExpBtn>
                  <ExpBtn icon={IconFileTypePdf} primary={!laserT} disabled={laserT || !plan || !plan.res.count} onClick={() => runExport(() => exportNestedPDF(s, m, s.pdfMode, plan.res, plan.W, plan.H, nestInfo))}>{t('PDF de imprenta con nesting · marcas de corte y registro')}{laserT ? ' ' + t('(destino Imprenta)') : ''}</ExpBtn>
                </div>
                <Lbl>{t('Caja individual')}</Lbl>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8, fontSize: 12, color: '#3d3830', alignItems: 'center' }}>
                  <span style={{ color: '#8a8071', fontSize: 11 }}>{t('PDF de imprenta:')}</span>
                  {[['cmyk', t('Producción · CMYK + tintas')], ['professional', t('Limpio · solo CMYK')], ['rgb', t('Revisión · RGB')]].map(op => (
                    <label key={op[0]} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input type="radio" name="pdfmode" checked={s.pdfMode === op[0]} onChange={() => store.set({ pdfMode: op[0] })} style={{ accentColor: '#9a5b1f' }} />{op[1]}
                    </label>))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 8 }}>
                  <ExpBtn icon={IconFileTypeSvg} tone="#2E7D46" onClick={() => runExport(() => exportLaserSVG(s, m))}>{t('Exportar SVG para láser · 1:1 · corte + pliegue')}</ExpBtn>
                  <ExpBtn icon={IconDownload} tone="#2E7D46" onClick={() => runExport(() => exportLaserDXF(s, m, 'R12'))}>{t('Exportar DXF R12 para láser · 1:1')}</ExpBtn>
                  <ExpBtn icon={IconDownload} tone="#2E7D46" onClick={() => runExport(() => exportLaserDXF(s, m, 'R2000'))}>{t('Exportar DXF AutoCAD 2000 para láser · 1:1')}</ExpBtn>
                  <ExpBtn icon={IconFileTypePdf} onClick={() => runExport(() => exportPDF(s, m, s.pdfMode))}>{t('Exportar PDF de imprenta · 1:1 · tintas directas')}</ExpBtn>
                  <ExpBtn icon={IconDownload} onClick={() => runExport(() => exportSeparations(s, m))}>{t('Separaciones de acabado · oro/UV/brillo/relieve')}</ExpBtn>
                  <ExpBtn icon={IconTestPipe} tone="#6d6557" onClick={() => runExport(() => exportKerfTest())}>{t('Descargar calibración de kerf (20 mm)')}</ExpBtn>
                </div>
                <div style={{ marginTop: 12 }}>
                  <Note>
                    <b style={{ color: '#3d3830' }}>{t('SVG láser:')}</b> {t('milímetros reales, grupo CORTE en rojo y grupo PLIEGUE en azul discontinuo. El kerf queda declarado en los metadatos y en el nombre del archivo de calibración; aplícalo en LightBurn/RDWorks.')}<br />
                    <b style={{ color: '#3d3830' }}>{t('PDF limpio:')}</b> {t('solo capas de cuatricromía sobre blanco, sin notas de página. Oro/UV/brillo/relieve/holo se entregan en separaciones aparte. Los PDF CMYK son conversiones directas sin ICC; el color final se valida con la prueba de imprenta.')}<br />
                    <b style={{ color: '#3d3830' }}>{t('Nesting:')}</b> {t('se exporta un archivo (SVG) o una página (PDF) por plancha distinta; las planchas repetidas se indican con ×N. La red se trata como su caja envolvente.')}<br />
                    <b style={{ color: '#3d3830' }}>{t('DXF por capas:')}</b> {t('CORTE en rojo (corte), MARCADO en azul (pliegue) y PUNTEADO en azul discontinuo, con trazos reales de 3 mm / 2 mm. R12 para software antiguo; AutoCAD 2000 como versión moderna.')}
                  </Note>
                </div>
              </div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="check">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 14, alignItems: 'start' }}>
            <div style={card}><ST>{t('Resumen del proyecto')}</ST>{outSummary.map(r => <Row key={r.k} k={r.k} v={r.v} />)}</div>
            <div style={card}>
              <ST>{t('Preflight')}</ST>
              {outChecks.map((cx, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '4px 0', fontSize: 12.5, color: '#3d3830', lineHeight: 1.5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: cx.dot, flex: 'none', transform: 'translateY(-1px)' }} />{cx.label}
                </div>))}
            </div>
            <div style={card}><ST>{t('Acabados por capa')}</ST>{outFins.map(f => <Row key={f.k} k={f.k} v={f.v} />)}</div>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
