// Panel de capas del diseñador (estilo profesional): miniaturas, búsqueda, mezcla/opacidad en línea, grupos, menú contextual y arrastrar para ordenar.
import React, { useEffect, useRef, useState } from 'react';
import {
  IconTypography, IconPhoto, IconSquare, IconCopy, IconEye, IconEyeOff, IconLock, IconLockOpen, IconTrash, IconArrowBackUp, IconArrowForwardUp, IconPhotoEdit, IconPalette, IconScissors,
  IconGripVertical, IconFolder, IconFolderPlus, IconFolderMinus, IconChevronDown, IconChevronRight, IconSearch, IconX, IconDotsVertical, IconMask, IconPencil, IconArrowBarUp, IconArrowBarDown,
  IconArrowUp, IconArrowDown
} from '@tabler/icons-react';
import { store } from '../state/store.js';
import { warnsOf, FIN, layerNameOf, BLENDS, shapePathD } from './layers.js';
import { embDirOf } from './emboss.js';
import { uploadImage } from './images.js';
import { dstore, setSel } from './ui.js';
import { patchLayers, dupLayers, delLayers, reorder, setClipBelow } from './ops.js';
import { groupLayers, ungroupLayers, patchGroup, toggleCollapsed, setGroupVisible, setGroupLocked, selectGroup, dropItem } from './groups.js';
import { addMask, removeMask, toggleMask } from './masks.js';
import { Tip, IconBtn } from '../editor/ui.jsx';
import { ST, Block, Note, inputSt, selectSt, btnSt } from '../ui/widgets.jsx';

const MONO = "'JetBrains Mono',monospace";
const KIND = { text: 'Texto', image: 'Imagen', shape: 'Forma' };
const KEY = { text: 'T', image: 'IM', shape: 'F' };
const hasMask = l => !!(l.mask && l.mask.url);

// Miniatura 30×30 de la capa: imagen real, «Aa» con su tipografía o la silueta de la forma.
function Thumb({ l }) {
  const box = { width: 30, height: 30, flex: 'none', borderRadius: 4, overflow: 'hidden', border: '1px solid #ded5c4', background: 'repeating-conic-gradient(#e8e2d4 0% 25%, #f8f5ee 0% 50%) 0 0 / 8px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (l.kind === 'image') return <div style={box}>{l.imgSrc ? <img alt="" src={l.imgSrc} loading="lazy" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <IconPhoto size={15} color="#8a8071" />}</div>;
  if (l.kind === 'text') return <div style={{ ...box, background: '#fdfcf7', color: l.color || '#211d18', fontFamily: `'${l.font || 'Noto Sans'}'`, fontWeight: l.weight || 400, fontStyle: l.italic ? 'italic' : 'normal', fontSize: 15 }}>Aa</div>;
  const w = 100, h = Math.max(30, Math.min(100, 100 * (l.h || 1) / (l.w || 1))), d = shapePathD({ ...l, x: 0, y: 0, w, h }), line = l.shape === 'line';
  return (
    <div style={{ ...box, background: '#fdfcf7' }}>
      <svg viewBox={`-6 -6 ${w + 12} ${h + 12}`} width="26" height="26" preserveAspectRatio="xMidYMid meet">
        <path d={d} fill={line || l.fillOn === false ? 'none' : l.color || '#9a5b1f'} stroke={l.stroke || (line ? l.color : 'none') || '#211d18'} strokeWidth={line ? 8 : l.stroke ? 5 : 0} />
      </svg>
    </div>
  );
}

const Chip = ({ children, tone, tip }) => <Tip label={tip || ''}><span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, flex: 'none', color: tone || '#8a8071', border: '1px solid ' + (tone ? tone : '#ded5c4'), lineHeight: 1.3 }}>{children}</span></Tip>;
const Act = ({ icon: I, on, tip, onClick, color, ...p }) => <Tip label={tip}><span role="button" aria-label={tip} onClick={e => { e.stopPropagation(); onClick(e); }} {...p} style={{ display: 'flex', flex: 'none', cursor: 'pointer', color: color || (on ? '#9a5b1f' : '#b9ad92'), padding: 1 }}><I size={15} stroke={1.7} /></span></Tip>;

export function LayersPanel({ s, d, t, ids, sel, g, hero, creaseSegs, addL, canEditImg, openEdit, openCompose, histPastN, histFutureN, updAll }) {
  const [renaming, setRenaming] = useState(null), [dragId, setDragId] = useState(null), [over, setOver] = useState(null);
  const [q, setQ] = useState(''), [ty, setTy] = useState('all'), [menu, setMenu] = useState(null);
  const menuRef = useRef(null);
  const groups = s.groups || [];
  const activeGid = (() => { const gs = new Set(ids.map(id => (s.layers.find(l => l.id === id) || {}).groupId).filter(x => x != null)); return gs.size === 1 ? [...gs][0] : null; })();
  const grouped = ids.some(id => (s.layers.find(l => l.id === id) || {}).groupId != null);
  const filtering = !!q.trim() || ty !== 'all';
  const match = l => (ty === 'all' || l.kind === ty) && (!q.trim() || layerNameOf(l).toLowerCase().includes(q.trim().toLowerCase()) || (l.content || '').toLowerCase().includes(q.trim().toLowerCase()));

  useEffect(() => {
    if (!menu) return undefined;
    const close = e => { if (e.type === 'keydown' && e.key !== 'Escape') return; if (e.type === 'mousedown' && menuRef.current && menuRef.current.contains(e.target)) return; setMenu(null); };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', close); window.addEventListener('blur', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); window.removeEventListener('blur', close); };
  }, [menu]);

  const rowClick = (e, l) => {
    if (e.shiftKey && sel) {
      const order = s.layers.map(x => x.id).reverse(), a = order.indexOf(sel.id), b = order.indexOf(l.id);
      setSel(order.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (e.ctrlKey || e.metaKey) setSel(ids.includes(l.id) ? ids.filter(x => x !== l.id) : ids.concat([l.id]));
    else setSel([l.id]);
  };
  const commitRename = (l, v) => { setRenaming(null); const n = v.trim(); if (n && n !== layerNameOf(l)) patchLayers([l.id], { name: n }); };
  const toggleL = (id, key) => store.set(st => ({ layers: st.layers.map(x => x.id === id ? { ...x, [key]: !x[key] } : x) }));
  const doGroup = () => groupLayers(ids, t('Grupo') + ' ' + (groups.length + 1));

  // Pila visual (arriba = delante): capas sueltas y grupos con sus hijos; el filtro conserva solo lo que coincide.
  const items = [], seenG = new Set();
  s.layers.slice().reverse().forEach(l => {
    const gr = l.groupId != null ? groups.find(x => x.id === l.groupId) : null;
    if (!gr) { if (match(l)) items.push({ l }); return; }
    if (!seenG.has(gr.id)) { seenG.add(gr.id); const kids = s.layers.filter(x => x.groupId === gr.id).reverse().filter(match); if (kids.length || (!filtering)) items.push({ g: gr, kids }); }
  });

  const dragProps = key => ({
    draggable: !filtering && renaming !== key,
    onDragStart: e => { setDragId(key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-layer', String(key)); },
    onDragEnd: () => { setDragId(null); setOver(null); },
    onDragOver: e => { if (dragId == null) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setOver({ key, above: e.clientY < r.top + r.height / 2 }); },
    onDrop: e => { if (dragId == null) return; e.preventDefault(); dropItem(dragId, key, over ? over.above : true); setDragId(null); setOver(null); }
  });
  const dropShadow = key => over && over.key === key && dragId !== key ? (over.above ? '0 -2px 0 #9a5b1f' : '0 2px 0 #9a5b1f') : 'none';
  const nameInput = (aria, def, onDone, max = 32) => (
    <input autoFocus aria-label={aria} defaultValue={def} maxLength={max} onClick={e => e.stopPropagation()} onFocus={e => e.target.select()}
      onBlur={e => onDone(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); else if (e.key === 'Escape') setRenaming(null); }}
      style={{ ...inputSt, flex: 1, minWidth: 0, padding: '2px 5px', fontFamily: 'inherit', fontSize: 12 }} />
  );
  const openMenu = (e, l) => { e.preventDefault(); e.stopPropagation(); if (!ids.includes(l.id)) setSel([l.id]); setMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 340), id: l.id }); };

  const groupHeader = (gr, kids) => {
    const key = 'G:' + gr.id, on = activeGid === gr.id, open = filtering || !gr.collapsed;
    return (
      <div key={key} data-group-id={gr.id} onClick={() => selectGroup(gr.id)} title={gr.name} {...dragProps(key)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', padding: '6px 8px', marginTop: 3, borderRadius: 7, cursor: 'pointer', opacity: dragId === key ? 0.4 : gr.visible ? 1 : 0.55, border: '1px solid ' + (on ? '#9a5b1f' : '#d9cdb6'), background: on ? '#f4e6d0' : '#efe7d8', boxShadow: dropShadow(key) }}>
        <IconGripVertical size={12} style={{ color: '#c5b99d', flex: 'none', cursor: 'grab' }} />
        <Tip label={open ? t('Contraer grupo') : t('Expandir grupo')}><span role="button" aria-label={open ? t('Contraer grupo') : t('Expandir grupo')} data-group-toggle onClick={e => { e.stopPropagation(); toggleCollapsed(gr.id); }} style={{ display: 'flex', flex: 'none', cursor: 'pointer', color: '#5c554a' }}>{open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</span></Tip>
        <Tip label={t('Mostrar / ocultar')}><span role="button" aria-label={t('Mostrar / ocultar')} data-group-eye onClick={e => { e.stopPropagation(); setGroupVisible(gr.id, !gr.visible); }} style={{ display: 'flex', flex: 'none', cursor: 'pointer', color: gr.visible ? '#3d3830' : '#b9ad92' }}>{gr.visible ? <IconEye size={15} /> : <IconEyeOff size={15} />}</span></Tip>
        <div style={{ width: 30, height: 30, flex: 'none', borderRadius: 4, background: '#fdfcf7', border: '1px solid #d9cdb6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconFolder size={17} style={{ color: '#9a5b1f' }} /></div>
        {renaming === key ? nameInput(t('Nombre del grupo'), gr.name, v => { setRenaming(null); const n = v.trim(); if (n && n !== gr.name) patchGroup(gr.id, { name: n }); })
          : <div style={{ flex: 1, minWidth: 0 }}>
            <div data-group-name={gr.name} onDoubleClick={e => { e.stopPropagation(); setRenaming(key); }} style={{ fontSize: 12, fontWeight: 700, color: '#211d18', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{gr.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: '#8a8071' }}>{s.layers.filter(x => x.groupId === gr.id).length} {t('capas')}{gr.opacity < 1 ? ' · ' + Math.round(gr.opacity * 100) + '%' : ''}</div>
          </div>}
        <Tip label={t('Bloquear / desbloquear')}><span role="button" aria-label={t('Bloquear / desbloquear')} data-group-lock onClick={e => { e.stopPropagation(); setGroupLocked(gr.id, !gr.locked); }} style={{ display: 'flex', flex: 'none', cursor: 'pointer', color: gr.locked ? '#9a5b1f' : '#b9ad92' }}>{gr.locked ? <IconLock size={14} /> : <IconLockOpen size={14} />}</span></Tip>
      </div>
    );
  };

  const layerRow = (l, inGroup) => {
    const on = ids.includes(l.id), bd = '1px solid ' + (on ? '#9a5b1f' : '#e7e0d4'), nm = layerNameOf(l), wn = warnsOf(l, creaseSegs, g.sbb).length;
    const op = l.opacity == null ? 1 : l.opacity, bl = l.blend && l.blend !== 'normal' ? (BLENDS.find(b => b[0] === l.blend) || [0, l.blend])[1] : '';
    const sub = [t(KIND[l.kind] || 'Capa'), bl && t(bl), op < 1 ? Math.round(op * 100) + '%' : ''].filter(Boolean).join(' · ');
    return (
      <div key={l.id} data-layer-id={l.id} data-in-group={inGroup ? '1' : undefined} onClick={e => rowClick(e, l)} onContextMenu={e => openMenu(e, l)} title={nm} {...dragProps(l.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', padding: '5px 7px', marginLeft: inGroup ? 14 : 0, borderRadius: 7, cursor: 'pointer', opacity: dragId === l.id ? 0.4 : l.visible ? 1 : 0.55, borderTop: bd, borderRight: bd, borderBottom: bd, borderLeft: inGroup ? '3px solid #d9b98a' : bd, background: on ? '#f7efe2' : '#fff', boxShadow: dropShadow(l.id) }}>
        <IconGripVertical size={12} style={{ color: '#c5b99d', flex: 'none', cursor: 'grab' }} />
        <Act icon={l.visible ? IconEye : IconEyeOff} color={l.visible ? '#3d3830' : '#b9ad92'} tip={t('Mostrar / ocultar')} onClick={() => toggleL(l.id, 'visible')} />
        <Thumb l={l} />
        {hasMask(l) && <Tip label={t('Máscara: clic para pintarla, Mayús+clic para activarla o apagarla')}><img alt={t('Máscara de capa')} src={l.mask.url} data-mask-thumb onClick={e => { e.stopPropagation(); if (e.shiftKey) toggleMask(l.id); else { setSel([l.id]); dstore.set({ maskEdit: d.maskEdit === l.id ? null : l.id }); } }} style={{ width: 24, height: 24, objectFit: 'contain', flex: 'none', border: '2px solid ' + (d.maskEdit === l.id ? '#9a5b1f' : '#ded5c4'), borderRadius: 4, background: '#888', opacity: l.mask.on === false ? 0.35 : 1, cursor: 'pointer' }} /></Tip>}
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming === l.id ? nameInput(t('Nombre de capa'), nm, v => commitRename(l, v))
            : <div data-layer-name={nm} onDoubleClick={e => { e.stopPropagation(); setRenaming(l.id); }} style={{ fontSize: 12, color: '#211d18', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm}</div>}
          <div style={{ fontSize: 9.5, color: '#9a8f7b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
            {l.finish && l.finish !== 'none' && <span style={{ color: '#9a5b1f', flex: 'none' }}>{l.finish === 'emboss' ? t('Relieve') + (embDirOf(l, s.embDir) === 'up' ? '↑' : '↓') : (FIN[l.finish] ? t(FIN[l.finish]) : '')}</span>}
            {l.clipMask && <IconScissors size={10} style={{ flex: 'none', color: '#9a5b1f' }} />}
          </div>
        </div>
        {wn > 0 && <Tip label={t('Avisos')}><span style={{ width: 7, height: 7, borderRadius: 99, background: '#d05a2a', flex: 'none' }} /></Tip>}
        <Act icon={l.locked ? IconLock : IconLockOpen} on={l.locked} tip={t('Bloquear / desbloquear')} onClick={() => toggleL(l.id, 'locked')} />
        <Act icon={IconDotsVertical} tip={t('Más acciones')} data-layer-menu onClick={e => openMenu(e, l)} />
      </div>
    );
  };

  const onMenu = fn => () => { setMenu(null); fn(); };
  const ml = menu && s.layers.find(x => x.id === menu.id);
  const MI = ({ icon: I, label, onClick, danger, disabled, ...p }) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={onMenu(onClick)} {...p} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '6px 10px', border: 'none', background: 'transparent', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontSize: 12, color: danger ? '#c0492b' : '#211d18', textAlign: 'left', borderRadius: 4 }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#f3ece0'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}><I size={14} stroke={1.7} />{label}</button>
  );
  const Sep = () => <div style={{ height: 1, background: '#e7e0d4', margin: '3px 0' }} />;

  return (
    <div style={{ width: 272, flex: 'none', background: '#faf7f0', borderRight: '1px solid #ded5c4', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Block style={{ paddingBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
          <ST style={{ marginBottom: 0 }}>{t('Capas')} <span style={{ fontFamily: MONO, letterSpacing: 0, color: '#a59a85', fontWeight: 400 }}>{s.layers.length}</span></ST>
          <div style={{ display: 'flex', gap: 5 }}>
            <IconBtn icon={IconArrowBackUp} size={26} label={t('Deshacer (⌘Z / Ctrl+Z)')} disabled={!histPastN} onClick={() => store.undo()} />
            <IconBtn icon={IconArrowForwardUp} size={26} label={t('Rehacer (⌘⇧Z / Ctrl+Shift+Z)')} disabled={!histFutureN} onClick={() => store.redo()} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
          <TBtn icon={IconTypography} tip={t('Añadir una capa de texto')} onClick={() => addL((id, hp) => ({ id, kind: 'text', x: hp.cx, y: hp.cy, content: t('Doble clic para editar'), font: 'Noto Sans', size: 6, weight: 400, color: d.color || '#211d18', finish: 'none', visible: true }))}>{t('Texto')}</TBtn>
          <TBtn icon={IconPhoto} tip={t('Añadir una imagen desde archivo')} onClick={() => uploadImage(addL)}>{t('Imagen')}</TBtn>
          <TBtn icon={IconSquare} tip={t('Añadir una forma rectangular')} onClick={() => addL((id, hp) => { const w = Math.min(30, hp.safeBox[2] - hp.safeBox[0]), h = Math.min(8, hp.safeBox[3] - hp.safeBox[1]); return { id, kind: 'shape', x: hp.cx - w / 2, y: hp.cy - h / 2, w, h, content: t('Forma'), color: d.color || '#9a5b1f', finish: 'none', visible: true }; })}>{t('Forma')}</TBtn>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
          <TBtn icon={IconPhotoEdit} tip={t('Abrir el editor de imágenes con la capa seleccionada')} disabled={!canEditImg} onClick={openEdit}>{t('Editar imagen')}</TBtn>
          <TBtn icon={IconPalette} tip={t('Documento en blanco con la proporción de la cara; el resultado se inserta como capa de imagen')} disabled={!hero} onClick={openCompose}>{t('Componer cara')}</TBtn>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 9 }}>
          <TBtn icon={IconCopy} tip={t('Duplicar la capa seleccionada (⌘D / Ctrl+D)')} disabled={!ids.length} onClick={() => dupLayers(ids)}>{t('Duplicar')}</TBtn>
          <TBtn icon={IconFolderPlus} tip={t('Agrupar las capas seleccionadas (Ctrl+G)')} data-testid="group-btn" disabled={!ids.length} onClick={doGroup}>{t('Agrupar')}</TBtn>
          <TBtn icon={IconFolderMinus} tip={t('Desagrupar (Ctrl+Mayús+G)')} data-testid="ungroup-btn" disabled={!grouped} onClick={() => ungroupLayers(ids)}>{t('Desagrupar')}</TBtn>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 7px', border: '1px solid #d8d0c2', borderRadius: 6, background: '#fff', marginBottom: 6 }}>
          <IconSearch size={14} color="#8a8071" />
          <input aria-label={t('Buscar capa')} placeholder={t('Buscar capa…')} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.stopPropagation()} style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', padding: '6px 0', fontSize: 12, background: 'transparent', color: '#211d18' }} />
          {q && <span role="button" aria-label={t('Limpiar')} onClick={() => setQ('')} style={{ display: 'flex', cursor: 'pointer', color: '#8a8071' }}><IconX size={13} /></span>}
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {[['all', t('Todo')], ['text', 'T'], ['image', 'IM'], ['shape', 'F']].map(([v, lb]) => (
            <Tip key={v} label={v === 'all' ? t('Todas las capas') : t(KIND[v])}><button type="button" aria-pressed={ty === v} onClick={() => setTy(v)} style={{ ...btnSt, flex: v === 'all' ? 1.4 : 1, padding: '3px 0', fontSize: 10.5, fontFamily: v === 'all' ? 'inherit' : MONO, fontWeight: 700, background: ty === v ? '#9a5b1f' : '#fff', color: ty === v ? '#fff' : '#5c554a', borderColor: ty === v ? '#9a5b1f' : '#d8d0c2' }}>{lb}</button></Tip>
          ))}
        </div>
        {sel && (
          <div data-testid="inline-blend" style={{ display: 'grid', gridTemplateColumns: '1fr 74px', gap: 8, alignItems: 'end', marginBottom: 9, padding: '7px 8px', border: '1px solid #e7e0d4', borderRadius: 7, background: '#fff' }}>
            <div>
              <div style={{ fontSize: 10, color: '#8a8071', marginBottom: 2 }}>{t('Modo de fusión')}</div>
              <select aria-label={t('Mezcla de la selección')} value={sel.blend || 'normal'} onChange={e => updAll({ blend: e.target.value })} style={{ ...selectSt, padding: '3px 4px', fontSize: 11.5 }}>{BLENDS.map(([v, lb]) => <option key={v} value={v}>{t(lb)}</option>)}</select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#8a8071', marginBottom: 2 }}>{t('Opacidad')} %</div>
              <input type="number" min="0" max="100" aria-label={t('Opacidad de la selección')} value={Math.round((sel.opacity == null ? 1 : sel.opacity) * 100)} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updAll({ opacity: Math.min(1, Math.max(0, v / 100)) }); }} style={{ ...inputSt, padding: '3px 4px', fontSize: 11.5 }} />
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gap: 4 }} data-testid="layer-list" onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}>
          {items.map(it => it.g ? (<React.Fragment key={'G:' + it.g.id}>{groupHeader(it.g, it.kids)}{(filtering || !it.g.collapsed) && it.kids.map(l => layerRow(l, true))}</React.Fragment>) : layerRow(it.l, false))}
          {!items.length && <div style={{ fontSize: 11.5, color: '#8a8071', padding: '10px 2px' }}>{filtering ? t('Ninguna capa coincide.') : t('Sin capas todavía.')}</div>}
        </div>
      </Block>
      <div style={{ padding: 14 }}>
        <Note><b style={{ color: '#211d18' }}>{t('Reglas de capa')}</b><br />{t('Arrastra para mover. Si cruza un pliegue, sale de la zona segura o baja de 300 dpi, verás un aviso en el panel derecho. Los acabados crean canales de producción independientes.')}</Note>
        <div style={{ marginTop: 8, fontSize: 10.5, lineHeight: 1.6, color: '#a59a85' }}>{t('Doble clic en el nombre para renombrar · arrastra una capa para reordenarla · Shift/Ctrl+clic para varias · clic derecho para más acciones.')}</div>
      </div>
      {menu && ml && (
        <div ref={menuRef} role="menu" data-testid="layer-menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999, width: 212, background: '#fdfcf7', border: '1px solid #ded5c4', borderRadius: 8, boxShadow: '0 10px 28px rgba(33,29,24,.22)', padding: 4 }}>
          <MI icon={IconCopy} label={t('Duplicar')} onClick={() => dupLayers(ids)} />
          <MI icon={IconPencil} label={t('Renombrar')} onClick={() => setRenaming(ml.id)} />
          {ml.kind === 'image' && ml.imgSrc && ids.length === 1 && <MI icon={IconPhotoEdit} label={t('Editar imagen')} onClick={openEdit} />}
          <Sep />
          <MI icon={IconArrowBarUp} label={t('Traer al frente')} onClick={() => reorder(ids, 'front')} />
          <MI icon={IconArrowUp} label={t('Subir')} onClick={() => reorder(ids, 'up')} />
          <MI icon={IconArrowDown} label={t('Bajar')} onClick={() => reorder(ids, 'down')} />
          <MI icon={IconArrowBarDown} label={t('Enviar al fondo')} onClick={() => reorder(ids, 'back')} />
          <Sep />
          <MI icon={IconFolderPlus} label={t('Agrupar')} onClick={doGroup} />
          {grouped && <MI icon={IconFolderMinus} label={t('Desagrupar')} onClick={() => ungroupLayers(ids)} />}
          {hasMask(ml) ? <MI icon={IconMask} label={t('Eliminar máscara')} onClick={() => removeMask(ml.id)} /> : <MI icon={IconMask} label={t('Añadir máscara')} disabled={ids.length > 1} onClick={() => addMask(ml.id)} />}
          {ids.length === 1 && <MI icon={IconScissors} label={ml.clipMask ? t('Liberar máscara de recorte') : t('Recortar con la capa de abajo')} onClick={() => setClipBelow(ml.id, g, !ml.clipMask)} />}
          <Sep />
          <MI icon={ml.visible ? IconEyeOff : IconEye} label={ml.visible ? t('Ocultar') : t('Mostrar')} onClick={() => patchLayers(ids, { visible: !ml.visible })} />
          <MI icon={ml.locked ? IconLockOpen : IconLock} label={ml.locked ? t('Desbloquear') : t('Bloquear')} onClick={() => patchLayers(ids, { locked: !ml.locked })} />
          <MI icon={IconTrash} label={t('Borrar')} danger onClick={() => delLayers(ids)} />
        </div>
      )}
    </div>
  );
}

// Botón compacto con icono (misma pieza que el resto del panel).
function TBtn({ icon: I, tip, children, disabled, ...p }) {
  return (
    <Tip label={tip}>
      <button type="button" disabled={disabled} {...p} style={{ ...btnSt, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11.5, padding: '6px 2px', opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer' }}>{I && <I size={14} stroke={1.8} />}{children}</button>
    </Tip>
  );
}
