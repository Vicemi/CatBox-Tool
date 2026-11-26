// Módulos IA descargables: gestor (diálogo) y panel de tareas sobre una imagen.
import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { IconSparkles, IconX, IconDownload, IconTrash, IconArrowsMaximize, IconEraser, IconWaveSine, IconCircleCheck, IconSettings } from '@tabler/icons-react';
import { useT } from '../i18n/index.js';
import { MODELS, isInstalled, install, uninstall, run, onChange } from '../ai/index.js';
import { C, btnSt } from './widgets.jsx';
import { notifyError } from './dialogs.jsx';

// --- estado compartido (instalado / descargas en curso) entre el diálogo y los paneles ---
const state = { installed: {}, prog: {} };
const subs = new Set();
const push = () => subs.forEach(f => f({}));
async function refresh() {
  for (const m of MODELS) state.installed[m.id] = await isInstalled(m.id).catch(() => false);
  push();
}
onChange(refresh);
function useModules() {
  const [, set] = useState({});
  useEffect(() => { subs.add(set); refresh(); return () => subs.delete(set); }, []);
  return {
    installed: state.installed, prog: state.prog,
    get(id) {
      if (state.prog[id] != null) return;
      state.prog[id] = 0; push();
      return install(id, p => { state.prog[id] = p; push(); }).catch(notifyError).finally(() => { delete state.prog[id]; refresh(); });
    },
    remove: async id => { try { await uninstall(id); } catch (e) { notifyError(e); } }
  };
}

const TASK = { upscale: 'Ampliar', background: 'Quitar fondo', denoise: 'Reducir ruido' };
const fmtMB = mb => (mb >= 10 ? Math.round(mb) : mb) + ' MB';

function Bar({ p }) {
  return <div style={{ height: 4, borderRadius: 3, background: '#e7e0d4', overflow: 'hidden' }}><div style={{ width: Math.round(p * 100) + '%', height: '100%', background: C.brand, transition: 'width .15s' }} /></div>;
}

export function AIModulesDialog({ open, onClose }) {
  const t = useT();
  const mod = useModules();
  const used = MODELS.filter(m => mod.installed[m.id]).reduce((a, m) => a + m.sizeMB, 0);
  return (
    <Dialog.Root open={!!open} onOpenChange={o => { if (!o && onClose) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(33,29,24,0.45)', zIndex: 1000 }} />
        <Dialog.Content aria-describedby={undefined} style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(620px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', background: '#fdfcf7', borderRadius: 12, border: '1px solid #ded5c4', boxShadow: '0 24px 60px rgba(33,29,24,0.28)', zIndex: 1001, fontFamily: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 10px' }}>
            <IconSparkles size={22} stroke={1.8} color={C.brand} />
            <Dialog.Title style={{ margin: 0, fontSize: 16, color: C.ink, flex: 1 }}>{t('Módulos IA')}</Dialog.Title>
            <Dialog.Close asChild><button aria-label={t('Cerrar')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.dim, display: 'flex' }}><IconX size={18} /></button></Dialog.Close>
          </div>
          <div style={{ padding: '0 20px 8px', fontSize: 12.5, color: C.dim, lineHeight: 1.5 }}>{t('Modelos ligeros que se descargan una vez y funcionan sin conexión en tu equipo. Se guardan en el almacenamiento local de la app.')}</div>
          <div style={{ overflowY: 'auto', padding: '4px 20px', flex: 1 }}>
            {MODELS.map(m => {
              const inst = mod.installed[m.id], p = mod.prog[m.id];
              return (
                <div key={m.id} style={{ padding: '12px 0', borderTop: '1px solid #e7e0d4' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{t(m.name)} {inst && <IconCircleCheck size={14} color="#4a8a5c" style={{ verticalAlign: -2 }} />}</div>
                      <div style={{ fontSize: 12, color: C.dim, margin: '2px 0' }}>{t(m.description)}</div>
                      <div style={{ fontSize: 11, color: C.mut, fontFamily: "'JetBrains Mono',monospace" }}>{t(TASK[m.task] || m.task)} · {fmtMB(m.sizeMB)} · {t('Licencia')}: {m.license}</div>
                    </div>
                    {inst
                      ? <button onClick={() => mod.remove(m.id)} style={{ ...btnSt, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 5 }}><IconTrash size={14} />{t('Eliminar')}</button>
                      : <button disabled={p != null} onClick={() => mod.get(m.id)} style={{ ...btnSt, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: C.brand, color: '#fff', fontWeight: 700, opacity: p != null ? 0.6 : 1 }}><IconDownload size={14} />{p != null ? Math.round(p * 100) + '%' : t('Descargar')}</button>}
                  </div>
                  {p != null && <div style={{ marginTop: 8 }}><Bar p={p} /></div>}
                </div>
              );
            })}
          </div>
          <div style={{ padding: '10px 20px 14px', borderTop: '1px solid #e7e0d4', fontSize: 12, color: C.dim }}>{t('Espacio en disco usado: {n} MB', { n: Math.round(used * 10) / 10 })}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Acciones del panel: un botón por módulo.
const ACTIONS = [
  { id: 'waifu2x-photo-x2', label: 'Ampliar ×2 · foto (waifu2x)', icon: IconArrowsMaximize, out: 'Ampliado ×2 (IA)' },
  { id: 'waifu2x-art-x2', label: 'Ampliar ×2 · ilustración (waifu2x)', icon: IconArrowsMaximize, out: 'Ampliado ×2 (IA)' },
  { id: 'realesr-general-x4v3', label: 'Ampliar ×4 (Real-ESRGAN)', icon: IconArrowsMaximize, out: 'Ampliado ×4 (IA)' },
  { id: 'u2netp', label: 'Quitar fondo (IA)', icon: IconEraser, out: 'Fondo quitado (IA)' },
  { id: 'waifu2x-photo-denoise', label: 'Reducir ruido', icon: IconWaveSine, out: 'Ruido reducido (IA)' }
];

export function AIImagePanel({ getCanvas, applyCanvas }) {
  const t = useT();
  const mod = useModules();
  const [job, setJob] = useState(null); // { id, p }
  const [mgr, setMgr] = useState(false);
  const abort = useRef(null);
  useEffect(() => () => { if (abort.current) abort.current.abort(); }, []);

  const go = async a => {
    const src = getCanvas && getCanvas();
    if (!src) return;
    const ac = new AbortController(); abort.current = ac;
    setJob({ id: a.id, p: 0 });
    try {
      const out = await run(a.id, src, { signal: ac.signal }, p => setJob({ id: a.id, p }));
      applyCanvas(out, t(a.out));
    } catch (e) { if (!(e && e.name === 'AbortError')) notifyError(e); }
    finally { abort.current = null; setJob(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, letterSpacing: '0.18em', color: C.mut, fontWeight: 700, marginBottom: 3 }}>
        <IconSparkles size={13} color={C.brand} /><span style={{ flex: 1 }}>{t('IA')}</span>
        <button onClick={() => setMgr(true)} title={t('Módulos IA')} aria-label={t('Módulos IA')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.dim, display: 'flex', padding: 0 }}><IconSettings size={14} /></button>
      </div>
      {ACTIONS.map(a => {
        const m = MODELS.find(x => x.id === a.id), inst = mod.installed[a.id], dl = mod.prog[a.id], running = job && job.id === a.id, Icon = a.icon;
        if (!m) return null;
        return (
          <div key={a.id}>
            {inst
              ? <button disabled={!!job} onClick={() => go(a)} style={{ ...btnSt, width: '100%', padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', opacity: job && !running ? 0.5 : 1 }}><Icon size={15} style={{ flex: 'none' }} />{t(a.label)}</button>
              : <button disabled={dl != null} onClick={() => mod.get(a.id)} style={{ ...btnSt, width: '100%', padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', color: C.dim, border: '1px dashed #d8d0c2' }}><IconDownload size={15} style={{ flex: 'none' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(a.label)} · {dl != null ? Math.round(dl * 100) + '%' : t('Descargar módulo ({n} MB)', { n: Math.round(m.sizeMB) })}</span></button>}
            {dl != null && <div style={{ marginTop: 4 }}><Bar p={dl} /></div>}
            {running && (
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}><Bar p={job.p} /></div>
                <span style={{ fontSize: 11, color: C.dim, fontFamily: "'JetBrains Mono',monospace" }}>{Math.round(job.p * 100)}%</span>
                <button onClick={() => abort.current && abort.current.abort()} style={{ ...btnSt, padding: '2px 8px', fontSize: 11 }}>{t('Cancelar')}</button>
              </div>
            )}
          </div>
        );
      })}
      <AIModulesDialog open={mgr} onClose={() => setMgr(false)} />
    </div>
  );
}
