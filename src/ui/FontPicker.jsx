// Selector de tipografías: buscador con vista previa en la propia fuente. Grupos: recientes, de la app y del sistema.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { IconChevronDown, IconSearch } from '@tabler/icons-react';
import { useT } from '../i18n/index.js';
import { systemFonts, canListSystemFonts, APP_FONTS, recentFonts, pushRecentFont, fontStack } from '../fonts/system.js';
import { inputSt } from './widgets.jsx';

const PAGE = 80; // filas que se pintan de una vez (cada una carga su fuente para la vista previa)

export function FontPicker({ value, onChange, style, sample }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sys, setSys] = useState(null);       // null = sin pedir todavía
  const [limit, setLimit] = useState(PAGE);
  const inputRef = useRef(null);

  // Se piden al abrir (en el navegador el permiso necesita un gesto del usuario).
  useEffect(() => {
    if (!open || (sys && sys.length)) return; // vacía = falló o sin permiso: se reintenta en cada apertura
    let live = true;
    systemFonts().then(list => { if (live) setSys(list); });
    return () => { live = false; };
  }, [open]);
  useEffect(() => { if (open) { setLimit(PAGE); setTimeout(() => inputRef.current && inputRef.current.focus(), 30); } }, [open]);

  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase(), match = f => !ql || f.toLowerCase().includes(ql);
    const recent = recentFonts().filter(match), app = APP_FONTS.filter(match);
    const system = (sys || []).filter(f => match(f) && !APP_FONTS.includes(f));
    return [
      { id: 'recent', name: t('Recientes'), items: q ? [] : recent },
      { id: 'app', name: t('De la app'), items: app },
      { id: 'system', name: t('Instaladas en el sistema'), items: system }
    ].filter(g => g.items.length);
  }, [q, sys, t]);

  const pick = f => { pushRecentFont(f); onChange(f); setOpen(false); setQ(''); };
  let shown = 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={t('Tipografía')} style={{ ...inputSt, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textAlign: 'left', ...style }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: fontStack(value), fontSize: 13 }}>{value || 'Noto Sans'}</span>
          <IconChevronDown size={14} stroke={2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={4} align="start" style={{ width: 300, maxHeight: 420, display: 'flex', flexDirection: 'column', background: '#fdfcf7', border: '1px solid #ded5c4', borderRadius: 8, boxShadow: '0 10px 28px rgba(33,29,24,0.18)', zIndex: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 8, borderBottom: '1px solid #e7e0d4' }}>
            <IconSearch size={14} stroke={2} color="#8a8071" />
            <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE); }} placeholder={t('Buscar tipografía…')} aria-label={t('Buscar tipografía…')}
              style={{ ...inputSt, border: 'none', padding: '4px 2px', background: 'transparent' }} />
          </div>
          <div style={{ overflowY: 'auto', padding: '4px 0' }} onScroll={e => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 60) setLimit(l => l + PAGE); }}>
            {groups.map(g => (
              <div key={g.id}>
                <div style={{ padding: '6px 10px 3px', fontSize: 10, letterSpacing: '0.12em', fontWeight: 700, color: '#8a8071', textTransform: 'uppercase' }}>{g.name} · {g.items.length}</div>
                {g.items.map(f => {
                  if (shown >= limit) return null;
                  shown++;
                  const on = f === value;
                  return (
                    <button key={g.id + f} type="button" onClick={() => pick(f)} title={f}
                      style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', padding: '5px 10px', border: 'none', background: on ? '#f7efe2' : 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ flex: 1, minWidth: 0, fontFamily: fontStack(f), fontSize: 16, color: '#211d18', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sample || f}</span>
                      {sample && <span style={{ fontSize: 10.5, color: '#8a8071', whiteSpace: 'nowrap' }}>{f}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            {open && sys === null && <div style={{ padding: 10, fontSize: 11, color: '#8a8071' }}>{t('Leyendo las fuentes del sistema…')}</div>}
            {sys && !sys.length && <div style={{ padding: 10, fontSize: 11, color: '#a59a85', lineHeight: 1.5 }}>{canListSystemFonts() ? t('No se pudieron leer las fuentes del sistema (permiso denegado). Vuelve a abrir el selector para reintentar.') : t('Este navegador no permite listar las fuentes instaladas; usa la app de escritorio o Chrome/Edge.')}</div>}
            {!groups.length && sys && <div style={{ padding: 10, fontSize: 11, color: '#a59a85' }}>{t('Ninguna tipografía coincide.')}</div>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
