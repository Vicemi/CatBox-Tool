// Estudio de packaging: barra superior, cinco espacios de trabajo y barra de estado.
// Todo el proyecto trabaja en mm internamente; la interfaz muestra cm en las medidas de caja.
import React from 'react';
import { store, useStore } from './state/store.js';
import { geomOf, creaseSegsOf } from './dieline/geom.js';
import { TPLS } from './dieline/templates.js';
import { warnsOf } from './design/layers.js';
import { StructureView } from './ui/StructureView.jsx';
import { DesignerView } from './ui/DesignerView.jsx';
import { DesignView } from './ui/DesignView.jsx';
import { ThreeView } from './ui/ThreeView.jsx';
import { OutputView } from './ui/OutputView.jsx';
import { exportPDF } from './export/pdf.js';
import { asset } from './asset.js';
import { loadPresetBox } from './preset/presetBox.js';
import { chooseProjectFile, downloadProject, projectStateOf } from './projects/projects.js';
import { fmtCm, fmtMm } from './units.js';
import { useT, setLang, LANGS } from './i18n/index.js';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { IconRuler2, IconBox, IconPalette, IconCube, IconPrinter, IconFolderOpen, IconDeviceFloppy, IconRestore, IconFileTypePdf, IconBrandGithub, IconLanguage, IconCircleCheck, IconAlertTriangle, IconSparkles } from '@tabler/icons-react';
import { openExternal } from './platform.js';
import { DialogHost, ask, notifyError } from './ui/dialogs.jsx';
import { AIModulesDialog } from './ui/AIModules.jsx';

const REPO_URL = 'https://github.com/yuyou-dev/OpenBox3D'; // proyecto original en el que se basa CatBox Tool

export function App() {
  const s = useStore();
  const t = useT();
  const [aiOpen, setAiOpen] = React.useState(false);
  const m = store.mat();
  const g = geomOf(s, m.t);
  const sw = g.sbb[2] - g.sbb[0], sh = g.sbb[3] - g.sbb[1];
  const tplName = (TPLS.find(x => x.id === s.tpl) || TPLS[0]).name;
  const creaseSegs = creaseSegsOf(g);
  const warnN = s.layers.reduce((a, l) => a + warnsOf(l, creaseSegs, g.sbb).length, 0);
  const okAll = warnN === 0;
  const netMode = s.tpl === 'custom' && s.custom && s.custom.mode === 'net';
  const netPieces = netMode && Array.isArray(s.custom.panels) ? s.custom.panels.filter(p => !p.parent).length : 0;
  const wrapMode = s.tpl === 'wrap';
  const tabs = [
    ['structure', t('Estructura'), IconRuler2],
    ['designer', t('Mi caja'), IconBox],
    ['design', t('Diseño'), IconPalette],
    ['three', '3D', IconCube],
    ['output', t('Salida'), IconPrinter]
  ];
  const hb = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, border: '1px solid #6a6151', cursor: 'pointer', fontSize: 12, background: 'transparent', color: '#e8dfcc', whiteSpace: 'nowrap', textDecoration: 'none' };

  const importProject = async () => {
    try {
      const doc = await chooseProjectFile();
      if (!doc) return;
      store.reset(await projectStateOf(doc, 'design'));
    } catch (e) { notifyError(e); }
  };
  const exportProject = () => {
    const stamp = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    downloadProject(store.get(), { name: tplName + ' ' + fmtCm(s.L) + '×' + fmtCm(s.W) + '×' + fmtCm(s.H) + ' ' + stamp }).catch(notifyError);
  };
  const resetPreset = async () => {
    if (!(await ask(t('¿Restaurar la caja de ejemplo? Se perderán los cambios no guardados.'), { danger: true }))) return;
    store.reset(await loadPresetBox());
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f1e8', fontSize: 13 }}>
      <div style={{ height: 48, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', background: '#211d18', color: '#f5f1e8', whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <img src={asset('/brand/catbox-logo-white.png')} alt="CatBox Tool" style={{ width: 28, height: 28, display: 'block' }} />
          <b style={{ fontFamily: "'Tomcat','Noto Sans',sans-serif", fontSize: 19, fontWeight: 400, letterSpacing: '0.03em' }}>CatBox Tool</b>
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 5 }}>
          {tabs.map(tb => (
            <button key={tb[0]} onClick={() => store.set({ view: tb[0] })}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap', flex: 'none', background: s.view === tb[0] ? '#9a5b1f' : 'transparent', color: s.view === tb[0] ? '#fff' : '#cfc7b8', fontWeight: s.view === tb[0] ? 700 : 400 }}>{React.createElement(tb[2], { size: 16, stroke: 1.8 })}{tb[1]}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div title={(okAll ? t('Validación de estructura correcta') : t('Avisos en capas de diseño: {n}', { n: warnN })) + ' · ' + t('Cortes') + ' ' + g.cutN + ' · ' + t('Pliegues') + ' ' + g.creaseN}
          style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: okAll ? '#8fc79e' : '#f0b070', whiteSpace: 'nowrap', flex: 'none', minWidth: 0, overflow: 'hidden' }}>
          {okAll ? <IconCircleCheck size={16} /> : <IconAlertTriangle size={16} />}
          {okAll ? t('Todo correcto') : t('Avisos') + ' ' + warnN}
        </div>
        <button onClick={importProject} style={hb}><IconFolderOpen size={15} />{t('Importar')}</button>
        <button onClick={exportProject} style={hb}><IconDeviceFloppy size={15} />{t('Guardar')}</button>
        <button onClick={resetPreset} title={t('Volver a la caja de ejemplo incluida')} style={hb}><IconRestore size={15} />{t('Ejemplo')}</button>
        <button onClick={() => setAiOpen(true)} title={t('Módulos IA')} style={hb}><IconSparkles size={15} />{t('Módulos IA')}</button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button aria-label={t('Idioma')} style={hb}><IconLanguage size={15} />{s.lang.toUpperCase()}</button></DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content sideOffset={6} align="end" style={{ background: '#fdfcf7', border: '1px solid #ded5c4', borderRadius: 8, padding: 4, boxShadow: '0 8px 24px rgba(33,29,24,0.18)', zIndex: 50 }}>
              {LANGS.map(([id, name]) => (
                <DropdownMenu.Item key={id} onSelect={() => setLang(id)} style={{ padding: '6px 12px', fontSize: 13, borderRadius: 5, cursor: 'pointer', outline: 'none', fontWeight: s.lang === id ? 700 : 400, color: '#211d18' }}>{name}</DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button onClick={async () => { try { await exportPDF(s, m, s.pdfMode); } catch (e) { notifyError(e); } }} style={{ ...hb, border: 'none', fontWeight: 700, background: '#9a5b1f', color: '#fff', flex: 'none' }}><IconFileTypePdf size={15} />{t('Exportar PDF')}</button>
        <button onClick={() => openExternal(REPO_URL)} title={t('Basado en OpenBox3D')} style={{ ...hb, flex: 'none' }}><IconBrandGithub size={15} /></button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {s.view === 'structure' && <StructureView />}
        {s.view === 'designer' && <DesignerView />}
        {s.view === 'design' && <DesignView />}
        {s.view === 'three' && <ThreeView />}
        {s.view === 'output' && <OutputView />}
      </div>

      <div style={{ height: 26, flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px', background: '#efe9dc', borderTop: '1px solid #ded5c4', fontSize: 11, color: '#6d6557', fontFamily: "'JetBrains Mono',monospace", whiteSpace: 'nowrap', overflow: 'hidden', lineHeight: '26px' }}>
        <span>{tplName} · {m.name} · t={fmtMm(m.t)}</span>
        <span>{t('Desplegado {w} × {h}', { w: fmtCm(sw), h: fmtCm(sh) })}</span>
        <span>{netMode ? t('Red · {n} pieza(s)', { n: netPieces }) : wrapMode ? t('Cara trasera {a} × {b} · fondo {c}', { a: fmtCm(s.L), b: fmtCm(s.H), c: fmtCm(s.W) }) : t('Interior {a} × {b} × {c}', { a: fmtCm(s.L), b: fmtCm(s.W), c: fmtCm(s.H) })}</span>
        <span>{t('Sangrado {v}', { v: fmtMm(s.bleed) })}</span>
        <div style={{ flex: 1 }} />
        <span>{t('Zoom {z}%', { z: Math.round((s.k || 1) * 100) })}</span>
        <span style={{ color: '#9a5b1f', fontWeight: 700 }}>{t('Unidad: cm')}</span>
      </div>
      <DialogHost />
      <AIModulesDialog open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}
