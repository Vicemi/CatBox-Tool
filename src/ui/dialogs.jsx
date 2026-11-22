// In-app dialogs replacing window.alert / confirm / prompt (native ones look out of place, mostly in the desktop app).
// Usage: await notify(msg) · if (await ask(msg)) … · const v = await askText(msg, initial)
import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { IconAlertTriangle, IconInfoCircle, IconHelpCircle } from '@tabler/icons-react';
import { useT } from '../i18n/index.js';

let show = null;
const pending = [];
const open = d => new Promise(resolve => { const item = { ...d, resolve }; if (show) show(item); else pending.push(item); });

export const notify = (message, opts = {}) => open({ kind: 'alert', message, ...opts });
export const ask = (message, opts = {}) => open({ kind: 'confirm', message, ...opts });
export const askText = (message, value = '', opts = {}) => open({ kind: 'prompt', message, value, ...opts });
// For catch blocks: shows the error message as an error dialog.
export const notifyError = e => notify(e && e.message ? e.message : String(e), { tone: 'error' });

export function DialogHost() {
  const t = useT();
  const [queue, setQueue] = useState([]);
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    show = item => setQueue(q => q.concat([item]));
    if (pending.length) setQueue(pending.splice(0));
    return () => { show = null; };
  }, []);
  const d = queue[0];
  useEffect(() => { if (d && d.kind === 'prompt') setText(d.value || ''); }, [d]);
  const close = result => { if (!d) return; d.resolve(result); setQueue(q => q.slice(1)); };
  const cancelValue = d && (d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined);
  const okValue = () => (d.kind === 'confirm' ? true : d.kind === 'prompt' ? text : undefined);
  const tone = d && (d.tone || (d.kind === 'confirm' ? 'ask' : 'info'));
  const Icon = tone === 'error' ? IconAlertTriangle : tone === 'ask' ? IconHelpCircle : IconInfoCircle;
  const btn = { padding: '8px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: '1px solid #d8d0c2', background: '#fff', color: '#3d3830' };
  return (
    <Dialog.Root open={!!d} onOpenChange={o => { if (!o) close(cancelValue); }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(33,29,24,0.45)', zIndex: 1000 }} />
        <Dialog.Content onOpenAutoFocus={e => { if (d && d.kind === 'prompt') { e.preventDefault(); setTimeout(() => inputRef.current && inputRef.current.select(), 0); } }}
          style={{ position: 'fixed', left: '50%', top: '42%', transform: 'translate(-50%,-50%)', width: 'min(440px, calc(100vw - 32px))', background: '#fdfcf7', borderRadius: 12, border: '1px solid #ded5c4', boxShadow: '0 24px 60px rgba(33,29,24,0.28)', padding: '20px 22px 18px', zIndex: 1001, fontFamily: 'inherit' }}>
          {d && (<>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <Icon size={24} stroke={1.8} color={tone === 'error' ? '#c0492b' : '#9a5b1f'} style={{ flex: 'none', marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Dialog.Title style={{ margin: '0 0 6px', fontSize: 15, color: '#211d18' }}>{d.title || (tone === 'error' ? t('Algo salió mal') : d.kind === 'confirm' ? t('Confirmar') : 'CatBox Tool')}</Dialog.Title>
                <Dialog.Description style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#5c554a', whiteSpace: 'pre-wrap' }}>{d.message}</Dialog.Description>
                {d.kind === 'prompt' && (
                  <input ref={inputRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') close(text); }}
                    style={{ marginTop: 12, width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #d8d0c2', borderRadius: 6, fontSize: 13 }} />
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              {d.kind !== 'alert' && <button onClick={() => close(cancelValue)} style={btn}>{d.cancelText || t('Cancelar')}</button>}
              <button autoFocus onClick={() => close(okValue())} style={{ ...btn, border: 'none', fontWeight: 700, background: d.danger ? '#c0492b' : '#9a5b1f', color: '#fff' }}>{d.okText || t('Aceptar')}</button>
            </div>
          </>)}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
