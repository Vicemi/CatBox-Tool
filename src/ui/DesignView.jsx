// Diseño: lista de capas, lienzo plano y panel de propiedades (contenido, transformación, acabados, avisos).
import React, { useEffect, useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
  IconTypography, IconPhoto, IconSquare, IconCopy, IconEye, IconEyeOff, IconLock, IconLockOpen, IconTrash, IconArrowBackUp, IconArrowForwardUp, IconPhotoEdit, IconPalette,
  IconLayoutAlignLeft, IconLayoutAlignCenter, IconLayoutAlignRight, IconLayoutAlignTop, IconLayoutAlignMiddle, IconLayoutAlignBottom,
  IconFocusCentered, IconArrowsDiagonalMinimize2, IconArrowsMaximize, IconArrowsHorizontal, IconRotate, IconRotateClockwise, IconBold
} from '@tabler/icons-react';
import { store, useStore } from '../state/store.js';
import { geomOf, creaseSegsOf } from '../dieline/geom.js';
import { heroPanelOf } from '../dieline/hero.js';
import { bboxOf, warnsOf, dpiOf, FIN, layerNameOf, randomImageName } from '../design/layers.js';
import { bboxOfPts, containerOfLayer } from '../design/containers.js';
import { embDirOf } from '../design/emboss.js';
import { uploadImage, imageFilesOf, readImageFile, imageLayerAt } from '../design/images.js';
import { SheetCanvas } from './SheetCanvas.jsx';
import { ST, Block, Note, inputSt, selectSt, btnSt, CmField, MmField } from './widgets.jsx';
import { fmtCm, fmtMm } from '../units.js';
import { useT } from '../i18n/index.js';
import { TipProvider, Tip, IconBtn } from '../editor/ui.jsx';
import { ImageEditor } from '../editor/ImageEditor.jsx';
import { notify } from './dialogs.jsx';

const MONO = "'JetBrains Mono',monospace";
// Button with an optional Tabler icon and a tooltip.
const TBtn = ({ icon: I, tip, children, style, ...p }) => (
  <Tip label={tip}>
    <button type="button" {...p} style={{ ...btnSt, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, ...style }}>{I && <I size={14} stroke={1.8} />}{children}</button>
  </Tip>
);

export function DesignView() {
  const s = useStore();
  const t = useT();
  const m = store.mat();
  const g = geomOf(s, m.t);
  const hero = heroPanelOf(g);
  const creaseSegs = creaseSegsOf(g);
  const [ed, setEd] = useState(null);
  const upd = patch => store.set(st => ({ layers: st.layers.map(l => l.id === st.sel ? { ...l, ...patch, heroPreset: undefined } : l) }));
  const sel = s.layers.find(l => l.id === s.sel);
  const selWarns = sel ? warnsOf(sel, creaseSegs, g.sbb) : [];
  const [histPastN, histFutureN] = store.histDepth();

  // Teclado: ⌘Z deshacer · ⌘⇧Z/⌃Y rehacer · flechas 1 mm (Shift 5 mm) · Supr borrar · ⌘D duplicar · Esc salir
  useEffect(() => {
    const kd = e => {
      const st = store.get();
      if (st.view !== 'design') return;
      if (document.querySelector('[data-image-editor]')) return; // the image editor owns the keyboard while open
      const tag = (document.activeElement || {}).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); store.redo(); return; }
      if (st.sel == null) return;
      const l = st.layers.find(x => x.id === st.sel); if (!l) return;
      const step = e.shiftKey ? 5 : 1;
      const mv = (dx, dy) => { e.preventDefault(); if (!l.locked) store.set(s2 => ({ layers: s2.layers.map(x => x.id === s2.sel ? { ...x, x: x.x + dx, y: x.y + dy, heroPreset: undefined } : x) })); };
      if (e.key === 'ArrowLeft') mv(-step, 0);
      else if (e.key === 'ArrowRight') mv(step, 0);
      else if (e.key === 'ArrowUp') mv(0, -step);
      else if (e.key === 'ArrowDown') mv(0, step);
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); store.set(s2 => ({ layers: s2.layers.filter(x => x.id !== s2.sel), sel: null })); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); dupLayer(); }
      else if (e.key === 'Escape') store.set({ sel: null });
      else if ((e.key === '[' || e.key === ']') && !l.locked) { e.preventDefault(); const d = (e.key === ']' ? 1 : -1) * (e.shiftKey ? 15 : 1); store.set(s2 => ({ layers: s2.layers.map(x => x.id === s2.sel ? { ...x, rot: ((((x.rot || 0) + d) % 360) + 360) % 360, heroPreset: undefined } : x) })); }
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, []);

  const dupLayerById = id => store.set(st => {
    const l = st.layers.find(x => x.id === id); if (!l) return null;
    const nl = { ...l, id: st.seq, x: l.x + 2, y: l.y + 2, locked: false, heroPreset: undefined };
    return { layers: st.layers.concat([nl]), seq: st.seq + 1, sel: nl.id };
  });
  const dupLayer = () => dupLayerById(store.get().sel);
  const addL = mk => store.set(st => {
    const nl = mk(st.seq, hero);
    const bound = nl.panelId == null && hero ? { ...nl, panelId: hero.panelId } : nl;
    return { layers: st.layers.concat([bound]), seq: st.seq + 1, sel: bound.id };
  });
  const moveL = d => store.set(st => {
    const i = st.layers.findIndex(l => l.id === st.sel); if (i < 0) return null;
    const j = i + d; if (j < 0 || j >= st.layers.length) return null;
    const ls = st.layers.slice(); const it = ls.splice(i, 1)[0]; ls.splice(j, 0, it);
    return { layers: ls };
  });
  const alignSel = ty => {
    if (!sel || sel.locked) return;
    const b = bboxOf(sel);
    const panel = containerOfLayer(g, sel);
    let pb = panel ? bboxOfPts(panel.pts) : null;
    if (!pb) pb = [g.sbb[0], g.sbb[1], g.sbb[2], g.sbb[3]];
    const m2 = 3;
    let tx = null, ty2 = null;
    if (ty === 'l') tx = pb[0] + m2; else if (ty === 'cx') tx = (pb[0] + pb[2]) / 2 - b[2] / 2; else if (ty === 'r') tx = pb[2] - m2 - b[2];
    if (ty === 't') ty2 = pb[1] + m2; else if (ty === 'cy') ty2 = (pb[1] + pb[3]) / 2 - b[3] / 2; else if (ty === 'b') ty2 = pb[3] - m2 - b[3];
    upd({ ...(tx != null ? { x: sel.x + (tx - b[0]) } : {}), ...(ty2 != null ? { y: sel.y + (ty2 - b[1]) } : {}) });
  };
  // Colocar la capa respecto a toda su cara: centrar / contener / cubrir / estirar (respeta el giro actual).
  const fitSel = mode => {
    if (!sel || sel.locked) return;
    const panel = containerOfLayer(g, sel); if (!panel) return;
    const pb = bboxOfPts(panel.pts), pw = pb[2] - pb[0], ph = pb[3] - pb[1];
    const cx = (pb[0] + pb[2]) / 2, cy = (pb[1] + pb[3]) / 2;
    if (mode === 'center' || sel.kind === 'text') {
      const b = bboxOf(sel);
      upd({ x: sel.x + (cx - (b[0] + b[2] / 2)), y: sel.y + (cy - (b[1] + b[3] / 2)) });
      return;
    }
    const th = (sel.rot || 0) * Math.PI / 180, co = Math.abs(Math.cos(th)), si = Math.abs(Math.sin(th));
    const bw = sel.w * co + sel.h * si, bh = sel.w * si + sel.h * co;
    let w, h;
    const quarter = Math.abs(co * si) < 1e-6;
    if (mode === 'stretch' && quarter) { [w, h] = co > 0.5 ? [pw, ph] : [ph, pw]; }
    else {
      const f = mode === 'contain' ? Math.min(pw / bw, ph / bh) : Math.max(pw / bw, ph / bh);
      w = sel.w * f; h = sel.h * f;
    }
    w = Math.round(w * 100) / 100; h = Math.round(h * 100) / 100;
    upd({ w, h, x: Math.round((cx - w / 2) * 100) / 100, y: Math.round((cy - h / 2) * 100) / 100 });
  };
  const rotSel = d => { if (sel && !sel.locked) upd({ rot: ((Math.round(((sel.rot || 0) + d) * 10) / 10) % 360 + 360) % 360 }); };
  const dropImages = async (files, point, panel) => {
    const imageFiles = imageFilesOf(files); if (!imageFiles.length || !panel) return;
    try {
      const assets = await Promise.all(imageFiles.map(readImageFile));
      store.set(st => {
        const added = assets.map((asset, i) => imageLayerAt(st.seq + i, asset, panel, [point[0] + i * 2, point[1] + i * 2]));
        return { layers: st.layers.concat(added), seq: st.seq + added.length, sel: added[added.length - 1].id };
      });
    } catch (_) { notify(t('No se pudo leer la imagen. Usa PNG, JPG o WebP.'), { tone: 'error' }); }
  };

  // Editor de imágenes: editar la capa seleccionada o componer una cara nueva (~300 dpi, lado largo ≤ 4096 px).
  const canEditImg = !!(sel && sel.kind === 'image' && sel.imgSrc);
  const openEdit = () => { if (canEditImg) setEd({ mode: 'edit', src: sel.imgSrc, crop: sel.crop, layerId: sel.id }); };
  const openCompose = () => {
    const face = (sel && containerOfLayer(g, sel)) || hero; if (!face) return;
    const bb = bboxOfPts(face.pts), pw = bb[2] - bb[0], ph = bb[3] - bb[1];
    const k = Math.min(300 / 25.4, 4096 / Math.max(pw, ph));
    setEd({ mode: 'compose', w: Math.max(1, Math.round(pw * k)), h: Math.max(1, Math.round(ph * k)), panelId: face.panelId, bb });
  };
  const applyEditor = r => {
    const e = ed; setEd(null);
    if (e.mode === 'edit') {
      store.set(st => ({
        layers: st.layers.map(l => {
          if (l.id !== e.layerId) return l;
          const k = Math.min(l.w / r.w, l.h / r.h), w = Math.round(r.w * k * 100) / 100, h = Math.round(r.h * k * 100) / 100; // keep the box, contain the new aspect
          return { ...l, imgSrc: r.dataURL, imgW: r.w, imgH: r.h, pxw: r.w, crop: undefined, w, h, x: Math.round((l.x + (l.w - w) / 2) * 100) / 100, y: Math.round((l.y + (l.h - h) / 2) * 100) / 100, heroPreset: undefined };
        })
      }));
    } else {
      store.set(st => {
        const name = randomImageName();
        const nl = { id: st.seq, kind: 'image', name, content: name, x: e.bb[0], y: e.bb[1], w: e.bb[2] - e.bb[0], h: e.bb[3] - e.bb[1], panelId: e.panelId, finish: 'none', visible: true, imgSrc: r.dataURL, imgW: r.w, imgH: r.h, pxw: r.w };
        return { layers: st.layers.concat([nl]), seq: st.seq + 1, sel: nl.id };
      });
    }
  };

  const toggleL = (id, key) => store.set(st => ({ layers: st.layers.map(x => x.id === id ? { ...x, [key]: !x[key] } : x) }));
  const alignDefs = [['l', IconLayoutAlignLeft, 'Izquierda'], ['cx', IconLayoutAlignCenter, 'Centro horizontal'], ['r', IconLayoutAlignRight, 'Derecha'], ['t', IconLayoutAlignTop, 'Arriba'], ['cy', IconLayoutAlignMiddle, 'Centro vertical'], ['b', IconLayoutAlignBottom, 'Abajo']];
  const embDir = sel ? embDirOf(sel, s.embDir) : 'up';
  const tgItem = on => ({ ...btnSt, flex: 1, background: on ? '#9a5b1f' : '#fff', color: on ? '#fff' : '#5c554a' });

  return (<TipProvider>
    <div style={{ width: 256, flex: 'none', background: '#faf7f0', borderRight: '1px solid #ded5c4', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
          <ST style={{ marginBottom: 0 }}>{t('Capas')}</ST>
          <div style={{ display: 'flex', gap: 5 }}>
            <IconBtn icon={IconArrowBackUp} size={26} label={t('Deshacer (⌘Z / Ctrl+Z)')} disabled={!histPastN} onClick={() => store.undo()} />
            <IconBtn icon={IconArrowForwardUp} size={26} label={t('Rehacer (⌘⇧Z / Ctrl+Shift+Z)')} disabled={!histFutureN} onClick={() => store.redo()} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <TBtn icon={IconTypography} tip={t('Añadir una capa de texto')} onClick={() => addL((id, hp) => ({ id, kind: 'text', x: hp.cx, y: hp.cy, content: t('Doble clic para editar'), font: 'Noto Sans', size: 6, weight: 400, color: '#211d18', finish: 'none', visible: true }))} style={{ flex: 1, fontSize: 11.5 }}>{t('Texto')}</TBtn>
          <TBtn icon={IconPhoto} tip={t('Añadir una imagen desde archivo')} onClick={() => uploadImage(addL)} style={{ flex: 1, fontSize: 11.5 }}>{t('Imagen')}</TBtn>
          <TBtn icon={IconSquare} tip={t('Añadir una forma rectangular')} onClick={() => addL((id, hp) => { const w = Math.min(30, hp.safeBox[2] - hp.safeBox[0]), h = Math.min(8, hp.safeBox[3] - hp.safeBox[1]); return { id, kind: 'shape', x: hp.cx - w / 2, y: hp.cy - h / 2, w, h, content: t('Forma'), color: '#9a5b1f', finish: 'none', visible: true }; })} style={{ flex: 1, fontSize: 11.5 }}>{t('Forma')}</TBtn>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
          <TBtn icon={IconPhotoEdit} tip={t('Abrir el editor de imágenes con la capa seleccionada')} disabled={!canEditImg} onClick={openEdit} style={{ fontSize: 11.5, opacity: canEditImg ? 1 : 0.4, cursor: canEditImg ? 'pointer' : 'default' }}>{t('Editar imagen')}</TBtn>
          <TBtn icon={IconPalette} tip={t('Documento en blanco con la proporción de la cara; el resultado se inserta como capa de imagen')} disabled={!hero} onClick={openCompose} style={{ fontSize: 11.5 }}>{t('Componer cara')}</TBtn>
        </div>
        <TBtn icon={IconCopy} tip={t('Duplicar la capa seleccionada (⌘D / Ctrl+D)')} onClick={() => dupLayer()} disabled={!sel} style={{ width: '100%', marginBottom: 10, padding: '6px 0', fontSize: 11.5, opacity: sel ? 1 : 0.4, cursor: sel ? 'pointer' : 'default' }}>{t('Duplicar capa / imagen')}</TBtn>
        <div style={{ display: 'grid', gap: 5 }}>
          {s.layers.slice().reverse().map(l => {
            const warn = warnsOf(l, creaseSegs, g.sbb).length > 0;
            return (
              <div key={l.id} data-layer-id={l.id} onClick={() => store.set({ sel: l.id })}
                title={layerNameOf(l)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, overflow: 'hidden', padding: '7px 9px', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + (s.sel === l.id ? '#9a5b1f' : '#e7e0d4'), background: s.sel === l.id ? '#f7efe2' : '#fff' }}>
                <Tip label={t('Mostrar / ocultar')}><span role="button" aria-label={t('Mostrar / ocultar')} onClick={e => { e.stopPropagation(); toggleL(l.id, 'visible'); }} style={{ display: 'flex', flex: 'none', cursor: 'pointer', color: l.visible ? '#3d3830' : '#cfc4ab' }}>{l.visible ? <IconEye size={15} /> : <IconEyeOff size={15} />}</span></Tip>
                <Tip label={t('Bloquear / desbloquear')}><span role="button" aria-label={t('Bloquear / desbloquear')} onClick={e => { e.stopPropagation(); toggleL(l.id, 'locked'); }} style={{ display: 'flex', flex: 'none', cursor: 'pointer', color: l.locked ? '#9a5b1f' : '#cfc4ab' }}>{l.locked ? <IconLock size={14} /> : <IconLockOpen size={14} />}</span></Tip>
                <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: '#8a8071', border: '1px solid #ded5c4', borderRadius: 3, padding: '1px 4px', flex: 'none' }}>{l.kind === 'text' ? 'T' : l.kind === 'image' ? 'IM' : 'F'}</span>
                <span data-layer-name={layerNameOf(l)} style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#211d18', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{layerNameOf(l)}</span>
                <span style={{ fontSize: 10, color: '#9a5b1f', flex: 'none' }}>{l.finish === 'emboss' ? t('Relieve') + (embDirOf(l, s.embDir) === 'up' ? '↑' : '↓') : (FIN[l.finish] ? t(FIN[l.finish]) : '')}</span>
                <Tip label={t('Duplicar esta capa')}><span role="button" aria-label={t('Duplicar esta capa')} onClick={e => { e.stopPropagation(); dupLayerById(l.id); }} style={{ display: 'flex', color: '#9a5b1f', cursor: 'pointer', flex: 'none' }}><IconCopy size={14} /></span></Tip>
                {warn && <span style={{ width: 7, height: 7, borderRadius: 99, background: '#d05a2a', flex: 'none' }} />}
              </div>
            );
          })}
        </div>
      </Block>
      <div style={{ padding: 14 }}>
        <Note><b style={{ color: '#211d18' }}>{t('Reglas de capa')}</b><br />{t('Arrastra para mover. Si cruza un pliegue, sale de la zona segura o baja de 300 dpi, verás un aviso en el panel derecho. Los acabados crean canales de producción independientes.')}</Note>
      </div>
    </div>

    <SheetCanvas view="design" g={g} onImageDrop={dropImages} />

    <div style={{ width: 272, flex: 'none', background: '#faf7f0', borderLeft: '1px solid #ded5c4', overflowY: 'auto' }}>
      {!sel && <div style={{ padding: '20px 14px', fontSize: 12, color: '#8a8071', lineHeight: 1.7 }}>{t('Ninguna capa seleccionada. Haz clic en un elemento del lienzo o en la lista de capas.')}</div>}
      {sel && (<>
        <Block>
          <ST>{t('Nombre de capa')}</ST>
          <input aria-label={t('Nombre de capa')} maxLength={32} value={typeof sel.name === 'string' ? sel.name : layerNameOf(sel)} onChange={e => upd({ name: e.target.value })} style={{ ...inputSt, fontFamily: 'inherit' }} />
        </Block>
        {sel.kind === 'text' && <Block><ST>{t('Texto')}</ST><input aria-label={t('Texto')} value={sel.content || ''} onChange={e => upd({ content: e.target.value })} style={{ ...inputSt, fontFamily: 'inherit' }} /></Block>}
        <Block>
          <ST>{t('Transformación')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginBottom: 10 }}>
            <CmField label="X" mm={sel.x} step={0.05} onChange={v => upd({ x: v })} />
            <CmField label="Y" mm={sel.y} step={0.05} onChange={v => upd({ y: v })} />
            <div><div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>{t('Giro °')}</div><input type="number" step="1" value={sel.rot || 0} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd({ rot: ((v % 360) + 360) % 360 }); }} style={inputSt} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <div style={{ fontSize: 10.5, color: '#8a8071' }}>{t('Opacidad')}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: '#9a5b1f' }}>{Math.round((sel.opacity == null ? 1 : sel.opacity) * 100)}%</div>
          </div>
          <input type="range" aria-label={t('Opacidad')} min="0" max="100" value={Math.round((sel.opacity == null ? 1 : sel.opacity) * 100)} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd({ opacity: Math.min(1, Math.max(0, v / 100)) }); }} style={{ width: '100%', accentColor: '#9a5b1f', margin: 0 }} />
        </Block>
        <Block>
          <ST>{t('Alinear en la cara')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 5 }}>
            {alignDefs.map(([k, I, lb]) => <IconBtn key={k} icon={I} size={34} label={t(lb)} onClick={() => alignSel(k)} style={{ width: '100%' }} />)}
          </div>
        </Block>
        <Block>
          <ST>{t('Ajustar a la cara')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: sel.kind === 'text' ? '1fr' : '1fr 1fr', gap: 6 }}>
            <TBtn icon={IconFocusCentered} tip={t('Centrar en la cara sin cambiar el tamaño')} onClick={() => fitSel('center')}>{t('Centrar')}</TBtn>
            {sel.kind !== 'text' && <>
              <TBtn icon={IconArrowsDiagonalMinimize2} tip={t('Escala para que quepa entera en la cara, centrada')} onClick={() => fitSel('contain')}>{t('Ajustar (entera)')}</TBtn>
              <TBtn icon={IconArrowsMaximize} tip={t('Escala para cubrir toda la cara, centrada (puede recortarse)')} onClick={() => fitSel('cover')}>{t('Rellenar cara')}</TBtn>
              <TBtn icon={IconArrowsHorizontal} tip={t('Estira al tamaño exacto de la cara (con giro 0/90/180/270°)')} onClick={() => fitSel('stretch')}>{t('Estirar exacto')}</TBtn>
            </>}
          </div>
          <div style={{ fontSize: 10.5, color: '#8a8071', margin: '10px 0 5px' }}>{t('Girar')} · {Math.round((sel.rot || 0) * 10) / 10}°</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 5 }}>
            <TBtn icon={IconRotate} tip={t('Girar 90° a la izquierda')} onClick={() => rotSel(-90)}>90</TBtn>
            <TBtn icon={IconRotateClockwise} tip={t('Girar 90° a la derecha')} onClick={() => rotSel(90)}>90</TBtn>
            <TBtn tip={t('Girar 180°')} onClick={() => rotSel(180)}>180°</TBtn>
            <TBtn tip={t('Quitar el giro')} onClick={() => upd({ rot: 0 })}>0°</TBtn>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5 }}>
            {[[-15, '−15°'], [-1, '−1°'], [1, '+1°'], [15, '+15°']].map(([d, lb]) => <button key={lb} type="button" onClick={() => rotSel(d)} style={btnSt}>{lb}</button>)}
          </div>
        </Block>
        {sel.kind === 'text' && (
          <Block>
            <ST>{t('Tipografía')}</ST>
            <select aria-label={t('Tipografía')} value={sel.font} onChange={e => upd({ font: e.target.value })} style={{ ...selectSt, marginBottom: 8 }}>
              <option value="Noto Sans">Noto Sans</option>
              <option value="Noto Serif">Noto Serif</option>
              <option value="JetBrains Mono">JetBrains Mono</option>
            </select>
            <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
              <div style={{ flex: 1 }}><MmField label={t('Tamaño')} mm={sel.size} min={1.5} max={60} step={0.5} onChange={v => upd({ size: v })} /></div>
              <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-end' }}><button type="button" onClick={() => upd({ weight: sel.weight === 700 ? 400 : 700 })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 5, border: '1px solid #d8d0c2', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: sel.weight === 700 ? '#211d18' : '#fff', color: sel.weight === 700 ? '#fff' : '#3d3830', whiteSpace: 'nowrap' }}><IconBold size={14} />{t('Negrita')}</button></div>
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              {['#211d18', '#9a5b1f', '#C9A227', '#4a5d4e', '#fdfcf7'].map(c => (
                <div key={c} onClick={() => upd({ color: c })} style={{ width: 24, height: 24, borderRadius: 5, background: c, cursor: 'pointer', border: '2px solid ' + (sel.color === c ? '#9a5b1f' : '#ded5c4'), boxSizing: 'border-box' }} />
              ))}
            </div>
          </Block>
        )}
        {sel.kind !== 'text' && (
          <Block>
            <ST>{t('Tamaño · cm')}</ST>
            <div style={{ display: 'flex', gap: 7 }}>
              <div style={{ flex: 1 }}><CmField label={t('Ancho')} mm={sel.w} min={2} step={0.05} onChange={v => upd({ w: Math.max(2, v) })} /></div>
              <div style={{ flex: 1 }}><CmField label={t('Alto')} mm={sel.h} min={1} step={0.05} onChange={v => upd({ h: Math.max(1, v) })} /></div>
              {sel.kind === 'image' && !sel.imgSrc && (
                <div style={{ flex: 1.2 }}><div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>{t('Origen px')}</div><input type="number" step="100" value={sel.pxw} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd({ pxw: Math.max(50, v) }); }} style={inputSt} /></div>
              )}
            </div>
            {sel.kind === 'image' && sel.imgSrc && (
              <div style={{ marginTop: 8, fontSize: 10.5, color: dpiOf(sel) >= 300 ? '#8a8071' : '#c0492b', fontFamily: MONO, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{sel.imgW}×{sel.imgH} px · {dpiOf(sel)} dpi{dpiOf(sel) < 300 ? ' · ' + t('insuficiente') : ''}</span>
                <span onClick={() => uploadImage(addL, sel.id)} style={{ color: '#9a5b1f', cursor: 'pointer', textDecoration: 'underline' }}>{t('Cambiar')}</span>
                <span onClick={() => store.set(st => ({ uiCrop: !st.uiCrop }))} style={{ color: s.uiCrop ? '#fff' : '#9a5b1f', background: s.uiCrop ? '#9a5b1f' : 'transparent', borderRadius: 3, padding: '1px 5px', cursor: 'pointer', textDecoration: s.uiCrop ? 'none' : 'underline' }}>{s.uiCrop ? t('Recortando ✓') : t('Recortar')}</span>
                <span onClick={openEdit} style={{ color: '#9a5b1f', cursor: 'pointer', textDecoration: 'underline' }}>{t('Editar imagen')}</span>
              </div>
            )}
          </Block>
        )}
        <Block>
          <ST>{t('Acabado')}</ST>
          <select aria-label={t('Acabado de capa')} value={sel.finish} onChange={e => { const finish = e.target.value; upd({ finish }); if (finish === 'gloss') store.set(st => ({ fx: { ...st.fx, gloss: true } })); if (finish === 'holo' && !store.get().iridescence3d) store.set({ iridescence3d: 0.85 }); }} style={selectSt}>
            <option value="none">{t('Ninguno (cuatricromía)')}</option>
            <option value="foil">{t('Estampado oro · canal R')}</option>
            <option value="silver">{t('Estampado plata · canal R')}</option>
            <option value="uv">{t('UV local · canal G')}</option>
            <option value="gloss">{t('Brillo · canal especular')}</option>
            <option value="emboss">{t('Relieve · canal B')}</option>
            <option value="holo">{t('Holográfico · canal iridiscente')}</option>
          </select>
          {sel.finish === 'emboss' && (
            <ToggleGroup.Root type="single" value={embDir} onValueChange={v => v && upd({ embDir: v })} aria-label={t('Dirección del relieve')} style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <ToggleGroup.Item value="up" style={tgItem(embDir === 'up')}>{t('Relieve ↑')}</ToggleGroup.Item>
              <ToggleGroup.Item value="down" style={tgItem(embDir === 'down')}>{t('Hundido ↓')}</ToggleGroup.Item>
            </ToggleGroup.Root>
          )}
        </Block>
        <Block>
          <ST>{t('Orden')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
            <button type="button" onClick={() => store.set(st => { const i = st.layers.findIndex(l => l.id === st.sel); if (i < 0) return null; const ls = st.layers.slice(); ls.push(ls.splice(i, 1)[0]); return { layers: ls }; })} style={{ ...btnSt, fontSize: 11.5 }}>{t('Frente')}</button>
            <button type="button" onClick={() => moveL(1)} style={{ ...btnSt, fontSize: 11.5 }}>{t('Subir')}</button>
            <button type="button" onClick={() => moveL(-1)} style={{ ...btnSt, fontSize: 11.5 }}>{t('Bajar')}</button>
            <button type="button" onClick={() => store.set(st => { const i = st.layers.findIndex(l => l.id === st.sel); if (i < 0) return null; const ls = st.layers.slice(); ls.unshift(ls.splice(i, 1)[0]); return { layers: ls }; })} style={{ ...btnSt, fontSize: 11.5 }}>{t('Fondo')}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <TBtn icon={IconCopy} tip={t('Duplicar la capa seleccionada (⌘D / Ctrl+D)')} onClick={dupLayer} style={{ padding: '7px 0' }}>{t('Duplicar')}</TBtn>
            <TBtn icon={sel.locked ? IconLock : IconLockOpen} tip={t('Bloquear / desbloquear')} onClick={() => upd({ locked: !sel.locked })} style={{ padding: '7px 0', background: sel.locked ? '#211d18' : '#fff', color: sel.locked ? '#fff' : '#3d3830' }}>{sel.locked ? t('Bloqueada') : t('Bloquear')}</TBtn>
            <TBtn icon={IconTrash} tip={t('Borrar capa (Supr)')} onClick={() => store.set(st => ({ layers: st.layers.filter(x => x.id !== st.sel), sel: null }))} style={{ padding: '7px 0', border: '1px solid #e0b7a8', color: '#c0492b' }}>{t('Borrar')}</TBtn>
          </div>
          <div style={{ marginTop: 10, fontSize: 10.5, lineHeight: 1.6, color: '#a59a85' }}>{t('Flechas 1 mm (Shift 5 mm) · [ ] giran 1° (Shift 15°) · imán a bordes, márgenes y centros · escala proporcional (Shift libre) · giro Shift 15° · ⌘Z / ⌘⇧Z.')}</div>
        </Block>
        {selWarns.length > 0 && (
          <div style={{ padding: 14 }}>
            <ST style={{ color: '#c0492b' }}>{t('Avisos')}</ST>
            {selWarns.map(wn => (
              <div key={wn} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', fontSize: 12, color: '#3d3830', lineHeight: 1.5 }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: '#d05a2a', flex: 'none', transform: 'translateY(-1px)' }} />{wn.startsWith('Resolución insuficiente') ? t('Resolución insuficiente: {n} dpi < 300 dpi', { n: dpiOf(sel) }) : t(wn)}
              </div>
            ))}
          </div>
        )}
      </>)}
    </div>
    {ed && <ImageEditor init={ed} onApply={applyEditor} onClose={() => setEd(null)} />}
  </TipProvider>);
}
