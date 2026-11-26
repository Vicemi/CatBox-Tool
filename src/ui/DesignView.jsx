// Diseño: capas (estilo Photoshop), barra de herramientas, lienzo plano y panel de propiedades.
import React, { useState, useEffect } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
  IconTypography, IconPhoto, IconSquare, IconCopy, IconEye, IconEyeOff, IconLock, IconLockOpen, IconTrash, IconArrowBackUp, IconArrowForwardUp, IconPhotoEdit, IconPalette,
  IconLayoutAlignLeft, IconLayoutAlignCenter, IconLayoutAlignRight, IconLayoutAlignTop, IconLayoutAlignMiddle, IconLayoutAlignBottom, IconLayoutDistributeHorizontal, IconLayoutDistributeVertical,
  IconFocusCentered, IconArrowsDiagonalMinimize2, IconArrowsMaximize, IconArrowsHorizontal, IconRotate, IconRotateClockwise, IconItalic, IconAlignLeft, IconAlignCenter, IconAlignRight,
  IconFlipHorizontal, IconFlipVertical, IconLink, IconUnlink, IconGripVertical, IconPolygon, IconShape, IconRulerMeasure, IconScissors,
  IconFolder, IconFolderPlus, IconFolderMinus, IconChevronDown, IconChevronRight
} from '@tabler/icons-react';
import { store, useStore } from '../state/store.js';
import { geomOf, creaseSegsOf } from '../dieline/geom.js';
import { heroPanelOf } from '../dieline/hero.js';
import { bboxOf, warnsOf, dpiOf, FIN, layerNameOf, randomImageName, BLENDS, FONTS, clipMaskOf, sameMask } from '../design/layers.js';
import { bboxOfPts, containerOfLayer, containerById } from '../design/containers.js';
import { polyCentroid, faceSafePoly, faceName, faceShapeLayer, containInPoly, coverPoly } from '../design/faces.js';
import { GradientBlock, ShadowBlock, TextStrokeBlock } from './DesignStyle.jsx';
import { embDirOf } from '../design/emboss.js';
import { uploadImage, imageFilesOf, readImageFile, imageLayerAt } from '../design/images.js';
import { useD, dstore, selIdsOf, setSel } from '../design/ui.js';
import { patchLayers, dupLayers, delLayers, reorder, placeLayer, alignLayers, distributeLayers, flipLayers, alignToEdge, setClipBelow } from '../design/ops.js';
import { groupLayers, ungroupLayers, patchGroup, toggleCollapsed, setGroupVisible, setGroupLocked, setGroupOpacity, selectGroup, groupOfSelection, dropItem } from '../design/groups.js';
import { MaskBlock } from './DesignMask.jsx';
import { LayersPanel } from '../design/LayersPanel.jsx';
import { ImageAIBlock } from '../design/ImageAI.jsx';
import { FontPicker } from './FontPicker.jsx';
import { DesignCanvas } from './DesignCanvas.jsx';
import { DesignToolbar } from './DesignToolbar.jsx';
import { ST, Block, Note, inputSt, selectSt, btnSt, CmField, MmField, ColorRow } from './widgets.jsx';
import { useT } from '../i18n/index.js';
import { TipProvider, Tip, IconBtn } from '../editor/ui.jsx';
import { ImageEditor } from '../editor/ImageEditor.jsx';
import { notify } from './dialogs.jsx';

const MONO = "'JetBrains Mono',monospace";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Button with an optional Tabler icon and a tooltip.
const TBtn = ({ icon: I, tip, children, style, ...p }) => (
  <Tip label={tip}>
    <button type="button" {...p} style={{ ...btnSt, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, ...style }}>{I && <I size={14} stroke={1.8} />}{children}</button>
  </Tip>
);
const Lbl = ({ children, style }) => <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3, ...style }}>{children}</div>;
const shapeKinds = [['rect', 'Rectángulo'], ['ellipse', 'Elipse'], ['triangle', 'Triángulo'], ['polygon', 'Polígono'], ['star', 'Estrella'], ['line', 'Línea']];
const alignDefs = [['l', IconLayoutAlignLeft, 'Izquierda'], ['cx', IconLayoutAlignCenter, 'Centro horizontal'], ['r', IconLayoutAlignRight, 'Derecha'], ['t', IconLayoutAlignTop, 'Arriba'], ['cy', IconLayoutAlignMiddle, 'Centro vertical'], ['b', IconLayoutAlignBottom, 'Abajo']];

export function DesignView() {
  const s = useStore();
  const d = useD();
  const t = useT();
  const m = store.mat();
  const g = geomOf(s, m.t);
  const hero = heroPanelOf(g);
  const creaseSegs = creaseSegsOf(g);
  const [ed, setEd] = useState(null);
  const [rel, setRel] = useState('sel');           // alinear respecto a: selección | cara (con varias capas)
  const [lockRatio, setLockRatio] = useState(true);
  const [renaming, setRenaming] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);          // {id, above}
  const ids = selIdsOf(s, d);
  const sel = ids.length ? s.layers.find(l => l.id === s.sel) : null;
  const multi = ids.length > 1;
  const upd = patch => sel && patchLayers([sel.id], patch);   // solo la capa primaria (transformación numérica)
  const updAll = patch => patchLayers(ids, patch);            // estilo: todas las seleccionadas
  const selWarns = sel ? warnsOf(sel, creaseSegs, g.sbb) : [];
  const [histPastN, histFutureN] = store.histDepth();

  // La máscara guardada en una capa recortada sigue a su capa base cuando esta se mueve o cambia.
  useEffect(() => {
    const bad = s.layers.filter(l => { if (!l.clipBase) return false; const b = s.layers.find(x => x.id === l.clipBase); return b && !sameMask(l.clipMask, clipMaskOf(b)); });
    if (bad.length) store.set(st => ({ layers: st.layers.map(l => { const b = l.clipBase && st.layers.find(x => x.id === l.clipBase); return b && !sameMask(l.clipMask, clipMaskOf(b)) ? { ...l, clipMask: clipMaskOf(b) } : l; }) }));
  }, [s.layers]);
  const addL = mk => store.set(st => {
    const nl = mk(st.seq, hero);
    const bound = nl.panelId == null && hero ? { ...nl, panelId: hero.panelId } : nl;
    return { layers: st.layers.concat([bound]), seq: st.seq + 1 };
  }) || setSel([store.get().seq - 1]);

  // Cara activa: la de la capa seleccionada, la elegida con un clic en el lienzo o la principal.
  const faceP = (sel && containerOfLayer(g, sel)) || containerById(g, d.face) || (hero && containerById(g, hero.panelId));
  const addFaceShape = inset => {
    if (!faceP) return;
    const pts = inset ? faceSafePoly(g, faceP) : faceP.pts, name = t(inset ? 'Forma con margen' : 'Forma de la cara');
    store.set(st => ({ layers: st.layers.concat([faceShapeLayer(st.seq, faceP, pts, d.color || '#9a5b1f', name)]), seq: st.seq + 1 }));
    setSel([store.get().seq - 1]);
  };
  // Colocar la capa respecto a su cara real (no a su caja): centrar en el centroide, contener dentro del contorno, cubrir todos los vértices o estirar.
  const fitSel = mode => {
    if (!sel || sel.locked) return;
    const panel = containerOfLayer(g, sel); if (!panel) return;
    const pb = bboxOfPts(panel.pts), pw = pb[2] - pb[0], ph = pb[3] - pb[1], rd = v => Math.round(v * 100) / 100;
    const cen = polyCentroid(panel.pts), bcx = (pb[0] + pb[2]) / 2, bcy = (pb[1] + pb[3]) / 2;
    if (mode === 'center' || sel.kind === 'text') {
      const b = bboxOf(sel);
      upd({ x: sel.x + (cen[0] - (b[0] + b[2] / 2)), y: sel.y + (cen[1] - (b[1] + b[3] / 2)) });
      return;
    }
    const rot = sel.rot || 0, th = rot * Math.PI / 180, co = Math.abs(Math.cos(th)), si = Math.abs(Math.sin(th));
    if (mode === 'cover' && sel.kind === 'shape') { upd({ x: rd(pb[0]), y: rd(pb[1]), w: rd(pw), h: rd(ph), rot: 0 }); return; } // color liso: cubre exactamente la caja de la cara
    let w, h, cx = bcx, cy = bcy;
    if (mode === 'stretch') {
      const quarter = Math.abs(co * si) < 1e-6;
      if (quarter) [w, h] = co > 0.5 ? [pw, ph] : [ph, pw]; else { const f = Math.max(pw / (sel.w * co + sel.h * si), ph / (sel.w * si + sel.h * co)); w = sel.w * f; h = sel.h * f; }
    } else if (mode === 'contain') {
      const r = containInPoly(panel.pts, sel.w, sel.h, rot); w = sel.w * r.f; h = sel.h * r.f; cx = r.cx; cy = r.cy;
    } else { const f = coverPoly(panel.pts, sel.w, sel.h, rot, bcx, bcy); w = sel.w * f; h = sel.h * f; }
    w = rd(w); h = rd(h);
    upd({ w, h, x: rd(cx - w / 2), y: rd(cy - h / 2) });
  };
  const rotSel = dg => { if (sel && !sel.locked) upd({ rot: ((Math.round(((sel.rot || 0) + dg) * 10) / 10) % 360 + 360) % 360 }); };
  // X/Y/An/Al numéricos sobre la caja visible (texto: An/Al escalan el cuerpo de forma proporcional).
  const bb = sel ? bboxOf(sel) : null;
  const setPos = (ax, v) => upd(ax === 0 ? { x: sel.x + (v - bb[0]) } : { y: sel.y + (v - bb[1]) });
  const setDim = (ax, v) => {
    if (sel.kind === 'text') {
      const nl = { ...sel, size: clamp(sel.size * v / bb[ax === 0 ? 2 : 3], 1.5, 120) }, nb = bboxOf(nl);
      upd({ size: nl.size, x: sel.x + (bb[0] - nb[0]), y: sel.y + (bb[1] - nb[1]) });
      return;
    }
    const w = ax === 0 ? v : lockRatio ? v * sel.w / sel.h : sel.w, h = ax === 1 ? v : lockRatio ? v * sel.h / sel.w : sel.h;
    upd({ w: Math.max(0.5, w), h: Math.max(0.5, h) });
  };
  const dropImages = async (files, point, panel) => {
    const imageFiles = imageFilesOf(files); if (!imageFiles.length || !panel) return;
    try {
      const assets = await Promise.all(imageFiles.map(readImageFile));
      store.set(st => {
        const added = assets.map((asset, i) => imageLayerAt(st.seq + i, asset, panel, [point[0] + i * 2, point[1] + i * 2]));
        return { layers: st.layers.concat(added), seq: st.seq + added.length };
      });
      setSel([store.get().seq - 1]);
    } catch (_) { notify(t('No se pudo leer la imagen. Usa PNG, JPG o WebP.'), { tone: 'error' }); }
  };

  // Editor de imágenes: editar la capa seleccionada o componer una cara nueva (~300 dpi, lado largo ≤ 4096 px).
  const canEditImg = !!(sel && !multi && sel.kind === 'image' && sel.imgSrc);
  const openEdit = () => { if (canEditImg) setEd({ mode: 'edit', src: sel.imgSrc, crop: sel.crop, layerId: sel.id }); };
  const openCompose = () => {
    const face = (sel && containerOfLayer(g, sel)) || hero; if (!face) return;
    const b = bboxOfPts(face.pts), pw = b[2] - b[0], ph = b[3] - b[1];
    const k = Math.min(300 / 25.4, 4096 / Math.max(pw, ph));
    setEd({ mode: 'compose', w: Math.max(1, Math.round(pw * k)), h: Math.max(1, Math.round(ph * k)), panelId: face.panelId, bb: b });
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
        return { layers: st.layers.concat([nl]), seq: st.seq + 1 };
      });
      setSel([store.get().seq - 1]);
    }
  };

  const toggleL = (id, key) => store.set(st => ({ layers: st.layers.map(x => x.id === id ? { ...x, [key]: !x[key] } : x) }));
  const embDir = sel ? embDirOf(sel, s.embDir) : 'up';
  const tgItem = on => ({ ...btnSt, flex: 1, background: on ? '#9a5b1f' : '#fff', color: on ? '#fff' : '#5c554a' });
  const seg = (items, value, onChange, label) => (
    <ToggleGroup.Root type="single" value={String(value)} onValueChange={v => v && onChange(v)} aria-label={label} style={{ display: 'flex', gap: 4 }}>
      {items.map(([v, node, tip]) => <Tip key={v} label={tip}><ToggleGroup.Item value={String(v)} aria-label={tip} style={{ ...tgItem(String(value) === String(v)), padding: '6px 0', display: 'inline-flex', justifyContent: 'center' }}>{node}</ToggleGroup.Item></Tip>)}
    </ToggleGroup.Root>
  );
  const loadFont = f => { try { document.fonts.load('400 20px "' + f + '"').then(() => store.set({})); } catch (_) { /* sin FontFaceSet */ } };
  const colorOf = l => l.color || '#211d18';

  const groups = s.groups || [], activeG = groupOfSelection(s, ids);

  return (<TipProvider>
    <LayersPanel s={s} d={d} t={t} ids={ids} sel={sel} g={g} hero={hero} creaseSegs={creaseSegs} addL={addL} canEditImg={canEditImg} openEdit={openEdit} openCompose={openCompose} histPastN={histPastN} histFutureN={histFutureN} updAll={updAll} />

    <DesignToolbar onImage={() => uploadImage(addL)} />
    <DesignCanvas g={g} onImageDrop={dropImages} />

    <div style={{ width: 280, flex: 'none', background: '#faf7f0', borderLeft: '1px solid #ded5c4', overflowY: 'auto' }}>
      <Block>
          <ST>{t('Cara activa')}</ST>
          <select aria-label={t('Cara activa')} value={faceP ? String(faceP.panelId) : ''} onChange={e => dstore.set({ face: (g.panels || []).find(p => String(p.panelId) === e.target.value)?.panelId ?? null })} style={{ ...selectSt, marginBottom: 8 }}>
            {(g.panels || []).filter(p => p.surface === 'outside').map(p => <option key={p.panelId} value={String(p.panelId)}>{faceName(g, p)}</option>)}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <TBtn icon={IconPolygon} tip={t('Crea una forma con el contorno exacto de la cara (triángulo, hexágono…) como fondo de color')} disabled={!faceP} onClick={() => addFaceShape(false)} style={{ fontSize: 11.5, padding: '6px 4px' }}>{t('Forma de la cara')}</TBtn>
            <TBtn icon={IconShape} tip={t('Igual, pero recortada 3 mm hacia dentro (zona segura)')} disabled={!faceP} onClick={() => addFaceShape(true)} style={{ fontSize: 11.5, padding: '6px 4px' }}>{t('Con margen 3 mm')}</TBtn>
          </div>
        </Block>
        {!sel && <div style={{ padding: '20px 14px', fontSize: 12, color: '#8a8071', lineHeight: 1.7 }}>{t('Ninguna capa seleccionada. Haz clic en un elemento del lienzo o en la lista de capas.')}</div>}
      {sel && (<>
        {multi && <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#9a5b1f', borderBottom: '1px solid #e7e0d4' }}>{t('{n} capas seleccionadas', { n: ids.length })}</div>}
        {activeG && (
          <Block>
            <ST>{t('Grupo')}</ST>
            <input aria-label={t('Nombre del grupo')} maxLength={32} value={activeG.name} onChange={e => patchGroup(activeG.id, { name: e.target.value })} style={{ ...inputSt, fontFamily: 'inherit', marginBottom: 8 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <Lbl style={{ marginBottom: 0 }}>{t('Opacidad del grupo')}</Lbl>
              <div style={{ fontFamily: MONO, fontSize: 11, color: '#9a5b1f' }}>{Math.round(activeG.opacity * 100)}%</div>
            </div>
            <input type="range" aria-label={t('Opacidad del grupo')} data-testid="group-opacity" min="0" max="100" value={Math.round(activeG.opacity * 100)} onChange={e => setGroupOpacity(activeG.id, clamp(parseFloat(e.target.value) / 100, 0, 1))} style={{ width: '100%', accentColor: '#9a5b1f', margin: '0 0 8px' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <TBtn icon={activeG.visible ? IconEye : IconEyeOff} tip={t('Mostrar / ocultar')} onClick={() => setGroupVisible(activeG.id, !activeG.visible)} style={{ padding: '6px 0' }} />
              <TBtn icon={activeG.locked ? IconLock : IconLockOpen} tip={t('Bloquear / desbloquear')} onClick={() => setGroupLocked(activeG.id, !activeG.locked)} style={{ padding: '6px 0' }} />
              <TBtn icon={IconFolderMinus} tip={t('Desagrupar (Ctrl+Mayús+G)')} onClick={() => ungroupLayers(ids)} style={{ padding: '6px 0' }} />
            </div>
          </Block>
        )}
        <Block>
          <ST>{t('Nombre de capa')}</ST>
          <input aria-label={t('Nombre de capa')} maxLength={32} value={typeof sel.name === 'string' ? sel.name : layerNameOf(sel)} onChange={e => upd({ name: e.target.value })} style={{ ...inputSt, fontFamily: 'inherit' }} />
        </Block>
        {sel.kind === 'text' && !multi && <Block><ST>{t('Texto')}</ST><textarea aria-label={t('Texto')} rows={2} value={sel.content || ''} onChange={e => upd({ content: e.target.value })} style={{ ...inputSt, fontFamily: 'inherit', resize: 'vertical' }} /></Block>}
        <Block>
          <ST>{t('Transformación')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 7 }}>
            <CmField label="X" mm={Math.round(bb[0] * 100) / 100} step={0.05} onChange={v => setPos(0, v)} />
            <CmField label="Y" mm={Math.round(bb[1] * 100) / 100} step={0.05} onChange={v => setPos(1, v)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 22px 1fr', gap: 4, marginBottom: 7, alignItems: 'end' }}>
            <CmField label={t('An')} mm={Math.round(bb[2] * 100) / 100} min={0.5} step={0.05} onChange={v => setDim(0, v)} />
            <Tip label={t('Mantener proporción')}><button type="button" aria-label={t('Mantener proporción')} aria-pressed={lockRatio} onClick={() => setLockRatio(v => !v)} style={{ height: 28, border: 'none', background: 'transparent', cursor: 'pointer', color: lockRatio ? '#9a5b1f' : '#b3a88f', padding: 0 }}>{lockRatio ? <IconLink size={15} /> : <IconUnlink size={15} />}</button></Tip>
            <CmField label={t('Al')} mm={Math.round(bb[3] * 100) / 100} min={0.5} step={0.05} onChange={v => setDim(1, v)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6, alignItems: 'end', marginBottom: 10 }}>
            <div><Lbl>{t('Giro °')}</Lbl><input type="number" step="1" aria-label={t('Giro °')} value={Math.round((sel.rot || 0) * 10) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd({ rot: ((v % 360) + 360) % 360 }); }} style={inputSt} /></div>
            <IconBtn icon={IconFlipHorizontal} size={30} label={t('Voltear horizontal')} on={!!sel.flipX} onClick={() => flipLayers(ids, 'x')} />
            <IconBtn icon={IconFlipVertical} size={30} label={t('Voltear vertical')} on={!!sel.flipY} onClick={() => flipLayers(ids, 'y')} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <Lbl style={{ marginBottom: 0 }}>{t('Opacidad')}</Lbl>
            <div style={{ fontFamily: MONO, fontSize: 11, color: '#9a5b1f' }}>{Math.round((sel.opacity == null ? 1 : sel.opacity) * 100)}%</div>
          </div>
          <input type="range" aria-label={t('Opacidad')} min="0" max="100" value={Math.round((sel.opacity == null ? 1 : sel.opacity) * 100)} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updAll({ opacity: clamp(v / 100, 0, 1) }); }} style={{ width: '100%', accentColor: '#9a5b1f', margin: '0 0 10px' }} />
          <Lbl>{t('Modo de fusión')}</Lbl>
          <select aria-label={t('Modo de fusión')} value={sel.blend || 'normal'} onChange={e => updAll({ blend: e.target.value })} style={selectSt}>
            {BLENDS.map(([v, lb]) => <option key={v} value={v}>{t(lb)}</option>)}
          </select>
        </Block>
        <Block>
          <ST>{multi ? t('Alinear y distribuir') : t('Alinear en la cara')}</ST>
          {multi && <div style={{ marginBottom: 8 }}>{seg([['sel', t('Selección'), t('Respecto a la selección')], ['face', t('Cara'), t('Respecto a su cara')]], rel, setRel, t('Alinear respecto a'))}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 5 }}>
            {alignDefs.map(([k, I, lb]) => <IconBtn key={k} icon={I} size={34} label={t(lb)} onClick={() => alignLayers(ids, k, multi ? rel : 'face', g)} style={{ width: '100%' }} />)}
          </div>
          {ids.length >= 3 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 6 }}>
              <TBtn icon={IconLayoutDistributeHorizontal} tip={t('Distribuir con huecos iguales en horizontal')} onClick={() => distributeLayers(ids, 'x', g)}>{t('Horizontal')}</TBtn>
              <TBtn icon={IconLayoutDistributeVertical} tip={t('Distribuir con huecos iguales en vertical')} onClick={() => distributeLayers(ids, 'y', g)}>{t('Vertical')}</TBtn>
            </div>
          )}
        </Block>
        {!multi && (
          <Block>
            <ST>{t('Ajustar a la cara')}</ST>
            <div style={{ display: 'grid', gridTemplateColumns: sel.kind === 'text' ? '1fr' : '1fr 1fr', gap: 6 }}>
              <TBtn icon={IconFocusCentered} tip={t('Centrar en el centroide de la cara sin cambiar el tamaño')} onClick={() => fitSel('center')}>{t('Centrar')}</TBtn>
              {sel.kind !== 'text' && <>
                <TBtn icon={IconArrowsDiagonalMinimize2} tip={t('Escala para que quepa entera dentro del contorno real de la cara')} onClick={() => fitSel('contain')}>{t('Ajustar (entera)')}</TBtn>
                <TBtn icon={IconArrowsMaximize} tip={t('Cubre toda la cara (imagen o color); lo que sobresale del contorno se recorta')} onClick={() => fitSel('cover')}>{t('Rellenar cara')}</TBtn>
                <TBtn icon={IconArrowsHorizontal} tip={t('Estira al tamaño exacto de la cara (con giro 0/90/180/270°)')} onClick={() => fitSel('stretch')}>{t('Estirar exacto')}</TBtn>
              </>}
            </div>
            <TBtn icon={IconRulerMeasure} tip={t('Gira la capa para que quede paralela al borde más cercano de su cara')} onClick={() => alignToEdge(ids, g)} style={{ width: '100%', marginTop: 6 }}>{t('Alinear con el borde')}</TBtn>
            <div style={{ fontSize: 10.5, color: '#8a8071', margin: '10px 0 5px' }}>{t('Girar')} · {Math.round((sel.rot || 0) * 10) / 10}°</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 5 }}>
              <TBtn icon={IconRotate} tip={t('Girar 90° a la izquierda')} onClick={() => rotSel(-90)}>90</TBtn>
              <TBtn icon={IconRotateClockwise} tip={t('Girar 90° a la derecha')} onClick={() => rotSel(90)}>90</TBtn>
              <TBtn tip={t('Girar 180°')} onClick={() => rotSel(180)}>180°</TBtn>
              <TBtn tip={t('Quitar el giro')} onClick={() => upd({ rot: 0 })}>0°</TBtn>
            </div>
          </Block>
        )}
        {sel.kind === 'text' && (
          <Block>
            <ST>{t('Tipografía')}</ST>
            <FontPicker value={sel.font || 'Noto Sans'} onChange={f => { loadFont(f); updAll({ font: f }); }} style={{ marginBottom: 8 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
              <MmField label={t('Tamaño')} mm={Math.round(sel.size * 100) / 100} min={1.5} max={120} step={0.5} onChange={v => updAll({ size: v })} />
              <div><Lbl>{t('Grosor')}</Lbl>
                <select aria-label={t('Grosor')} value={sel.weight || 400} onChange={e => updAll({ weight: +e.target.value })} style={selectSt}>
                  {[[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']].map(([v, lb]) => <option key={v} value={v}>{lb} {v}</option>)}
                </select></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
              <MmField label={t('Espaciado')} mm={sel.letterSpacing || 0} min={-5} max={30} step={0.1} onChange={v => updAll({ letterSpacing: v })} />
              <div><Lbl>{t('Interlineado')}</Lbl><input type="number" aria-label={t('Interlineado')} min="0.6" max="4" step="0.05" value={sel.lineHeight == null ? 1.15 : sel.lineHeight} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updAll({ lineHeight: clamp(v, 0.6, 4) }); }} style={inputSt} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.7fr', gap: 7, marginBottom: 8 }}>
              <IconBtn icon={IconItalic} size={30} label={t('Cursiva')} on={!!sel.italic} onClick={() => updAll({ italic: !sel.italic })} style={{ width: '100%' }} />
              {seg([['left', <IconAlignLeft size={15} />, t('Alinear texto a la izquierda')], ['center', <IconAlignCenter size={15} />, t('Centrar texto')], ['right', <IconAlignRight size={15} />, t('Alinear texto a la derecha')]], sel.align || 'center', v => updAll({ align: v }), t('Alineación del texto'))}
            </div>
            <ColorRow label={t('Color')} value={colorOf(sel)} onChange={v => updAll({ color: v })} />
            <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
              {['#211d18', '#9a5b1f', '#C9A227', '#4a5d4e', '#fdfcf7'].map(c => (
                <div key={c} onClick={() => updAll({ color: c })} style={{ width: 24, height: 24, borderRadius: 5, background: c, cursor: 'pointer', border: '2px solid ' + (sel.color === c ? '#9a5b1f' : '#ded5c4'), boxSizing: 'border-box' }} />
              ))}
            </div>
          </Block>
        )}
        {sel.kind === 'text' && <GradientBlock sel={sel} updAll={updAll} t={t} />}
        {sel.kind === 'text' && <TextStrokeBlock sel={sel} updAll={updAll} t={t} />}
        {sel.kind === 'shape' && (
          <Block>
            <ST>{t('Forma')}</ST>
            <select aria-label={t('Tipo de forma')} value={sel.shape || 'rect'} onChange={e => updAll({ shape: e.target.value, ...(e.target.value === 'line' && sel.strokeW == null ? { strokeW: 0.8 } : {}) })} style={{ ...selectSt, marginBottom: 8 }}>
              {shapeKinds.map(([v, lb]) => <option key={v} value={v}>{t(lb)}</option>)}
              {sel.shape === 'poly' && <option value="poly">{t('Contorno de cara')}</option>}
            </select>
            {sel.shape !== 'line' && (<>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 10.5, color: '#8a8071', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={sel.fillOn !== false} onChange={e => updAll({ fillOn: e.target.checked })} style={{ accentColor: '#9a5b1f' }} />{t('Relleno')}</label>
                <input aria-label={t('Color de relleno')} type="color" value={colorOf(sel)} onChange={e => updAll({ color: e.target.value })} />
              </div>
            </>)}
            <ColorRow label={sel.shape === 'line' ? t('Color de línea') : t('Color de trazo')} value={(sel.shape === 'line' ? sel.stroke || sel.color : sel.stroke) || '#211d18'} onChange={v => updAll({ stroke: v })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 8 }}>
              <MmField label={t('Grosor de trazo')} mm={sel.strokeW == null ? (sel.shape === 'line' ? 0.8 : 0) : sel.strokeW} min={0} max={30} step={0.1} onChange={v => updAll({ strokeW: v })} />
              {(sel.shape || 'rect') === 'rect' && <MmField label={t('Radio de esquina')} mm={sel.radius || 0} min={0} max={200} step={0.5} onChange={v => updAll({ radius: v })} />}
              {(sel.shape === 'polygon' || sel.shape === 'star') && <div><Lbl>{sel.shape === 'star' ? t('Puntas') : t('Lados')}</Lbl><input type="number" aria-label={t('Lados')} min="3" max="24" step="1" value={sel.sides || (sel.shape === 'star' ? 5 : 6)} onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) updAll({ sides: clamp(v, 3, 24) }); }} style={inputSt} /></div>}
            </div>
            {sel.shape === 'star' && <div style={{ marginTop: 8 }}><Lbl>{t('Profundidad de las puntas')}</Lbl><input type="range" aria-label={t('Profundidad de las puntas')} min="10" max="90" value={Math.round((sel.innerR == null ? 0.45 : sel.innerR) * 100)} onChange={e => updAll({ innerR: parseFloat(e.target.value) / 100 })} style={{ width: '100%', accentColor: '#9a5b1f', margin: 0 }} /></div>}
          </Block>
        )}
        {sel.kind === 'shape' && sel.shape !== 'line' && <GradientBlock sel={sel} updAll={updAll} t={t} />}
        {sel.kind === 'image' && (
          <Block>
            {sel.imgSrc && (
              <div style={{ fontSize: 10.5, color: dpiOf(sel) >= 300 ? '#8a8071' : '#c0492b', fontFamily: MONO, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{sel.imgW}×{sel.imgH} px · {dpiOf(sel)} dpi{dpiOf(sel) < 300 ? ' · ' + t('insuficiente') : ''}</span>
                <span onClick={() => uploadImage(addL, sel.id)} style={{ color: '#9a5b1f', cursor: 'pointer', textDecoration: 'underline' }}>{t('Cambiar')}</span>
                <span onClick={() => store.set(st => ({ uiCrop: !st.uiCrop }))} style={{ color: s.uiCrop ? '#fff' : '#9a5b1f', background: s.uiCrop ? '#9a5b1f' : 'transparent', borderRadius: 3, padding: '1px 5px', cursor: 'pointer', textDecoration: s.uiCrop ? 'none' : 'underline' }}>{s.uiCrop ? t('Recortando ✓') : t('Recortar')}</span>
                <span onClick={openEdit} style={{ color: '#9a5b1f', cursor: 'pointer', textDecoration: 'underline' }}>{t('Editar imagen')}</span>
              </div>
            )}
            {!sel.imgSrc && <div><Lbl>{t('Origen px')}</Lbl><input type="number" step="100" value={sel.pxw} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd({ pxw: Math.max(50, v) }); }} style={inputSt} /></div>}
          </Block>
        )}
        {sel.kind === 'image' && sel.imgSrc && !multi && <Block><ST>{t('Mejorar con IA')}</ST><ImageAIBlock sel={sel} /></Block>}
        {!multi && <MaskBlock sel={sel} facePts={faceP ? faceP.pts : null} t={t} />}
        {!(sel.kind === 'shape' && sel.shape === 'line') && <ShadowBlock sel={sel} updAll={updAll} t={t} />}
        <Block>
          <ST>{t('Acabado')}</ST>
          <select aria-label={t('Acabado de capa')} value={sel.finish || 'none'} onChange={e => { const finish = e.target.value; updAll({ finish }); if (finish === 'gloss') store.set(st => ({ fx: { ...st.fx, gloss: true } })); if (finish === 'holo' && !store.get().iridescence3d) store.set({ iridescence3d: 0.85 }); }} style={selectSt}>
            <option value="none">{t('Ninguno (cuatricromía)')}</option>
            <option value="foil">{t('Estampado oro · canal R')}</option>
            <option value="silver">{t('Estampado plata · canal R')}</option>
            <option value="uv">{t('UV local · canal G')}</option>
            <option value="gloss">{t('Brillo · canal especular')}</option>
            <option value="emboss">{t('Relieve · canal B')}</option>
            <option value="holo">{t('Holográfico · canal iridiscente')}</option>
          </select>
          {sel.finish === 'emboss' && (
            <ToggleGroup.Root type="single" value={embDir} onValueChange={v => v && updAll({ embDir: v })} aria-label={t('Dirección del relieve')} style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <ToggleGroup.Item value="up" style={tgItem(embDir === 'up')}>{t('Relieve ↑')}</ToggleGroup.Item>
              <ToggleGroup.Item value="down" style={tgItem(embDir === 'down')}>{t('Hundido ↓')}</ToggleGroup.Item>
            </ToggleGroup.Root>
          )}
        </Block>
        <Block>
          <ST>{t('Orden')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
            <button type="button" onClick={() => reorder(ids, 'front')} style={{ ...btnSt, fontSize: 11.5 }}>{t('Frente')}</button>
            <button type="button" onClick={() => reorder(ids, 'up')} style={{ ...btnSt, fontSize: 11.5 }}>{t('Subir')}</button>
            <button type="button" onClick={() => reorder(ids, 'down')} style={{ ...btnSt, fontSize: 11.5 }}>{t('Bajar')}</button>
            <button type="button" onClick={() => reorder(ids, 'back')} style={{ ...btnSt, fontSize: 11.5 }}>{t('Fondo')}</button>
          </div>
          {!multi && <TBtn icon={IconScissors} tip={sel.clipMask ? t('Quita la máscara de recorte de esta capa') : t('Recorta esta capa con la forma de la capa inmediatamente inferior de la misma cara')} onClick={() => setClipBelow(sel.id, g, !sel.clipMask)} style={{ width: '100%', marginBottom: 8, background: sel.clipMask ? '#9a5b1f' : '#fff', color: sel.clipMask ? '#fff' : '#3d3830' }}>{sel.clipMask ? t('Liberar máscara de recorte') : t('Recortar con la capa de abajo')}</TBtn>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <TBtn icon={IconCopy} tip={t('Duplicar la capa seleccionada (⌘D / Ctrl+D)')} onClick={() => dupLayers(ids)} style={{ padding: '7px 0' }}>{t('Duplicar')}</TBtn>
            <TBtn icon={sel.locked ? IconLock : IconLockOpen} tip={t('Bloquear / desbloquear')} onClick={() => updAll({ locked: !sel.locked })} style={{ padding: '7px 0', background: sel.locked ? '#211d18' : '#fff', color: sel.locked ? '#fff' : '#3d3830' }}>{sel.locked ? t('Bloqueada') : t('Bloquear')}</TBtn>
            <TBtn icon={IconTrash} tip={t('Borrar capa (Supr)')} onClick={() => delLayers(ids)} style={{ padding: '7px 0', border: '1px solid #e0b7a8', color: '#c0492b' }}>{t('Borrar')}</TBtn>
          </div>
          <div style={{ marginTop: 10, fontSize: 10.5, lineHeight: 1.6, color: '#a59a85' }}>{t('V mover · T texto · U formas · I cuentagotas · H mano (Espacio) · Z zoom · flechas 1 mm (Shift 10 mm) · [ ] giran 1° (Shift 15°) · Shift mantiene proporción, Alt desde el centro · ⌘C/⌘V/⌘D · ⌘Z / ⌘⇧Z.')}</div>
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
