// Mi caja: dos modos.
//  · Caja rápida: fondo + 4 paredes + cierre paramétrico.
//  · Red avanzada: cualquier árbol de caras, solapas y piezas independientes.
// Cualquier plantilla de la biblioteca se puede abrir aquí como red avanzada (templateToNet).
import React, { useEffect, useRef, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  IconScissors, IconFold, IconSeparator, IconCopy, IconTrash, IconUnlink, IconFocusCentered, IconStar,
  IconArrowBarUp, IconArrowBarDown, IconArrowBarLeft, IconArrowBarRight, IconLock, IconWand, IconLineDashed, IconPlus
} from '@tabler/icons-react';
import { store, useStore } from '../state/store.js';
import { useT } from '../i18n/index.js';
import { geomOf } from '../dieline/geom.js';
import {
  normalizeCustom, customLayout, applyCustomPreset, CUSTOM_PRESETS,
  WALL_IDS, WALL_NAMES, BUILD_OPTIONS, LID_WALL_OPTIONS,
  toNetCustom, templateToNet, applyNetPreset, NET_PRESETS, EDGE_OPTIONS, LOCK_TYPES,
  addNetPanel, updateNetPanel, deleteNetPanel, duplicateNetPanel, edgeFree, addLock,
  mapLocal, addNetLine, updateNetLine, deleteNetLine, wrapCustom,
  panelEdgeList, BUILDER_SHAPES, attachShape, startFromShape
} from '../dieline/custom.js';
import { SHAPE_OPTIONS, FLAP_SHAPES, shapePath, shapePoints } from '../dieline/shapes.js';
import { preflightOf, LEVEL_DOT } from '../dieline/checks.js';
import { MATS, TPLS } from '../dieline/templates.js';
import { reflowLayersToContainers } from '../design/containers.js';
import { BoxPreview, boxPreviewContextOf } from '../render3d/BoxPreview.jsx';
import { makePieces } from '../render3d/fold.js';
import { exportLaserSVG } from '../export/svg.js';
import { exportPDF } from '../export/pdf.js';
import { SheetCanvas, SHAPE_MIME } from './SheetCanvas.jsx';
import { ST, Block, ToggleRow, CmField, MmField, Note, KV, selectSt, btnSt, inputSt } from './widgets.jsx';
import { fmtCm, fmtMm, SHEETS, sheetOf } from '../units.js';
import { ask, notify, notifyError } from './dialogs.jsx';

const EDGE_ICON = { far: IconArrowBarUp, near: IconArrowBarDown, xmin: IconArrowBarLeft, xmax: IconArrowBarRight };
const lbl = { fontSize: 10.5, color: '#8a8071', marginBottom: 3 };
const hint = { fontSize: 10.5, color: '#a59a85', lineHeight: 1.55 };

// Botón de icono con tooltip (paleta de herramientas de la cara).
function Tool({ icon: I, tip, onClick, disabled, color = '#3d3830', active }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button onClick={onClick} disabled={disabled} aria-label={tip} style={{
          ...btnSt, width: 30, height: 28, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color, opacity: disabled ? 0.35 : 1, background: active ? '#f7efe2' : '#fff', borderColor: active ? '#9a5b1f' : '#d8d0c2'
        }}><I size={16} stroke={1.8} /></button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} style={{ background: '#211d18', color: '#fff', fontSize: 11, padding: '4px 8px', borderRadius: 4, zIndex: 50 }}>{tip}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// Rejilla de siluetas: miniaturas SVG generadas con shapePoints (bisagra abajo, en verde).
function ShapeGrid({ items, value, onPick }) {
  const t = useT();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
      {items.map(o => {
        const on = value === o.id;
        return (
          <button key={o.id} onClick={() => onPick(o.id)} title={t(o.name)} aria-pressed={on} style={{
            ...btnSt, padding: '4px 2px 3px', border: '1px solid ' + (on ? '#9a5b1f' : '#e2dac9'), background: on ? '#f7efe2' : '#fff'
          }}>
            <svg viewBox="-2 -2 48 30" width="100%" height="28" aria-hidden="true">
              <path d={shapePath(o.id === 'wall' ? 'rect' : o.id)} fill={on ? '#ecd9b8' : '#f3eee2'} stroke="#211d18" strokeWidth="1.2" strokeLinejoin="round" />
              <line x1="0" y1="26" x2="44" y2="26" stroke="#2E7D46" strokeWidth="1.4" strokeDasharray="3 2" />
            </svg>
            <div style={{ fontSize: 9.5, color: on ? '#9a5b1f' : '#5c554a', fontWeight: on ? 700 : 400, lineHeight: 1.2, whiteSpace: 'normal' }}>{t(o.name)}</div>
          </button>
        );
      })}
    </div>
  );
}

// Miniatura de una forma de la paleta (cara o solapa), escalada a la casilla.
function paletteThumb(def) {
  const w = 40, h = def.kind === 'flap' ? 18 : def.id === 'triangle' ? 34.6 : def.id === 'rect' ? 26 : def.id === 'trapezoid' ? 20 : 40;
  const pts = shapePoints(def.shape, def.maxW ? 22 : w, h, { hinge: true, n: def.n, corner: def.corner || (def.id === 'trapezoid' ? 8 : undefined), mL: def.kind === 'flap' && !def.maxW ? 45 : 0, mR: def.kind === 'flap' && !def.maxW ? 45 : 0 });
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), y1 = Math.max(...ys), sc = 26 / Math.max(Math.max(...xs) - x0, y1 - Math.min(...ys), 1);
  return 'M' + pts.map(p => ((p[0] - x0) * sc + 2).toFixed(1) + ' ' + ((y1 - p[1]) * sc + 2).toFixed(1)).join('L') + 'Z';
}

// Paleta «Formas y solapas» tipo Photoshop: clic = herramienta activa (luego clic en un borde verde);
// también se arrastra directamente a un borde del plano. Soltar en vacío crea una pieza nueva.
function ShapePalette({ armed, active, onArm }) {
  const t = useT();
  const tile = def => {
    const on = armed === def.id, sel = active === def.id;
    return (
      <button key={def.id} draggable aria-pressed={on} title={t(def.name)}
        onDragStart={e => { e.dataTransfer.setData(SHAPE_MIME, def.id); e.dataTransfer.effectAllowed = 'copy'; }}
        onClick={() => onArm(on ? null : def.id)}
        style={{ ...btnSt, padding: '4px 2px 3px', cursor: 'grab', border: '1px solid ' + (on ? '#28a7a1' : sel ? '#9a5b1f' : '#e2dac9'), background: on ? '#e3f4f2' : sel ? '#f7efe2' : '#fff' }}>
        <svg viewBox="0 0 30 30" width="100%" height="26" aria-hidden="true">
          <path d={paletteThumb(def)} fill={def.kind === 'flap' ? '#efe3cc' : '#f3eee2'} stroke="#211d18" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
        <div style={{ fontSize: 9.5, color: on ? '#1d7a75' : '#5c554a', fontWeight: on || sel ? 700 : 400, lineHeight: 1.2, whiteSpace: 'normal' }}>{t(def.name)}</div>
      </button>
    );
  };
  return (<>
    <div style={lbl}>{t('Caras')}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4, marginBottom: 8 }}>{BUILDER_SHAPES.filter(d => d.kind === 'face').map(tile)}</div>
    <div style={lbl}>{t('Solapas y pestañas')}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>{BUILDER_SHAPES.filter(d => d.kind === 'flap').map(tile)}</div>
  </>);
}

export function DesignerView() {
  const t = useT();
  const s = useStore();
  const m = store.mat();
  const g = geomOf(s, m.t);
  const c = normalizeCustom(s.custom);
  const lay = customLayout(s, m.t);
  const isNet = c.mode === 'net';
  const [histPastN, histFutureN] = store.histDepth();
  const [fold, setFold] = useState(100);
  const [netSel, setNetSel] = useState(null);
  const [addEdge, setAddEdge] = useState('far');
  const [addShape, setAddShape] = useState('wall');
  const [selLine, setSelLine] = useState(null);
  const [armed, setArmed] = useState(null);        // forma de la paleta armada como herramienta (clic en un borde)
  const [palShape, setPalShape] = useState('flap'); // forma que ponen los botones «+»
  const [step, setStep] = useState(1);
  const [lockType, setLockType] = useState('slot');
  const [lockLen, setLockLen] = useState(0);
  const [lockTarget, setLockTarget] = useState('');
  const [declined, setDeclined] = useState(false);
  const askedRef = useRef(false);
  const lineOrig = useRef(null);
  const engRef = useRef(null);
  const previewS = { ...s, fold };
  const preview = boxPreviewContextOf(previewS, m);
  const sw = g.sbb[2] - g.sbb[0], sh = g.sbb[3] - g.sbb[1];

  // Si vienes de la Envolvente, abre su red exacta como caja editable.
  useEffect(() => {
    const st = store.get();
    if (st.tpl !== 'wrap') return;
    const next = toNetCustom(st);
    store.set({
      tpl: 'custom', custom: next, fitNonce: st.fitNonce + 1,
      layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf({ ...st, custom: next }, m.t))
    });
  }, []);

  // Mantén una cara seleccionada válida en el editor de red.
  useEffect(() => {
    const ids = new Set(c.panels.map(p => p.id));
    if (!netSel || !ids.has(netSel)) setNetSel(lay.roots[0] ? lay.roots[0].id : (c.panels[0] ? c.panels[0].id : null));
  }, [s.custom, lay.roots.length]);

  // Handle de depuración: permite inspeccionar el render 3D del constructor.
  useEffect(() => {
    window.__designerEngine = engRef.current;
    return () => { if (window.__designerEngine === engRef.current) window.__designerEngine = null; };
  }, [s.custom]);

  const sheet = c.sheet === 'custom' ? c.sheetCustom : sheetOf(c.sheet);
  const sheetW = sheet.w || 0, sheetH = sheet.h || 0;
  const needW = sw + 2 * c.margin, needH = sh + 2 * c.margin;
  const fits = !sheetW || (needW <= sheetW && needH <= sheetH) || (needW <= sheetH && needH <= sheetW);
  const pf = preflightOf(s, m, g, lay);

  const patchCustom = (fn, extra = {}) => store.set(st => {
    const nextCustom = fn(normalizeCustom(st.custom));
    const oldG = geomOf(st, m.t);
    const provisional = { ...st, custom: nextCustom };
    return { custom: nextCustom, layers: reflowLayersToContainers(st.layers, oldG, geomOf(provisional, m.t)), ...extra };
  });

  const setDim = (key, mm) => store.set(st => {
    const next = { ...st, [key]: Math.min(3000, Math.max(10, mm)) };
    return { [key]: next[key], layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf(next, m.t)) };
  });

  const usePreset = id => store.set(st => {
    const nextCustom = applyCustomPreset(id, st.custom);
    const provisional = { ...st, tpl: 'custom', custom: nextCustom };
    return {
      tpl: 'custom', custom: nextCustom, ovr: {}, typeOvr: {}, selSeg: null, fitNonce: st.fitNonce + 1,
      layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf(provisional, m.t))
    };
  });

  const switchMode = mode => {
    if (mode === c.mode) return;
    if (mode === 'net') {
      const nextCustom = toNetCustom(s);
      store.set(st => ({
        custom: nextCustom, tpl: 'custom', fitNonce: st.fitNonce + 1,
        layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf({ ...st, custom: nextCustom }, m.t))
      }));
      const root = nextCustom.panels.find(p => !p.parent);
      setNetSel(root ? root.id : null);
    } else {
      patchCustom(cc => ({ ...cc, mode: 'box' }), { fitNonce: s.fitNonce + 1 });
    }
  };

  const useNetPreset = id => {
    const nextCustom = applyNetPreset(id, s.custom, s);
    store.set(st => ({
      custom: nextCustom, tpl: 'custom', fitNonce: st.fitNonce + 1,
      layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf({ ...st, custom: nextCustom }, m.t))
    }));
    const root = nextCustom.panels.find(p => !p.parent);
    setNetSel(root ? root.id : null);
  };

  const setWrapParam = (key, value) => store.set({ wrap: { ...(s.wrap || {}), [key]: value } });
  const regenerateWrap = () => {
    const nextCustom = wrapCustom({ ...s, custom: s.custom, wrap: s.wrap });
    store.set(st => ({
      custom: nextCustom, tpl: 'custom', fitNonce: st.fitNonce + 1,
      layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf({ ...st, custom: nextCustom }, m.t))
    }));
  };

  const regenerateNet = async () => {
    if (!(await ask(t('¿Regenerar la red desde los parámetros de caja rápida? Se perderán las caras y solapas añadidas en la red.'), { danger: true }))) return;
    const nextCustom = toNetCustom(s, true);
    store.set(st => ({
      custom: nextCustom, tpl: 'custom', fitNonce: st.fitNonce + 1,
      layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf({ ...st, custom: nextCustom }, m.t))
    }));
    const root = nextCustom.panels.find(p => !p.parent);
    setNetSel(root ? root.id : null);
  };

  // Plantilla de la biblioteca → red editable (mode 'net'); deshacer vuelve a la plantilla.
  const convertTemplate = () => {
    const next = templateToNet(store.get(), m.t, makePieces);
    store.set(st => ({
      tpl: 'custom', custom: next, ovr: {}, typeOvr: {}, selSeg: null, fitNonce: st.fitNonce + 1,
      layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf({ ...st, tpl: 'custom', custom: next }, m.t))
    }));
    const root = next.panels.find(p => !p.parent);
    setNetSel(root ? root.id : null);
  };
  const tplName = t((TPLS.find(x => x.id === s.tpl) || TPLS[0]).name);
  const askConvert = () => ask(t('¿Abrir «{name}» como red editable en «Mi caja»? La plantilla de la biblioteca dejará de estar activa; la forma se conserva y puedes deshacerlo con Ctrl+Z.', { name: tplName }));
  useEffect(() => {
    if (s.tpl === 'custom' || s.tpl === 'wrap') { askedRef.current = false; return; }
    if (askedRef.current) return;
    askedRef.current = true; // evita preguntar dos veces (StrictMode) y tras rechazar
    askConvert().then(ok => { if (ok) convertTemplate(); else setDeclined(true); });
  }, [s.tpl]);

  const setWall = (id, patch) => patchCustom(cc => ({ ...cc, walls: { ...cc.walls, [id]: { ...cc.walls[id], ...patch } } }));
  const setShapeAll = (shape, corner) => patchCustom(cc => {
    const walls = { ...cc.walls };
    for (const id of WALL_IDS) walls[id] = { ...walls[id], shape, corner };
    return { ...cc, walls };
  });
  const wallH = id => c.walls[id].h > 0 ? c.walls[id].h : s.H;

  const setMaterial = id => {
    const nm = MATS.find(x => x.id === id);
    store.set(st => {
      const om = MATS.find(x => x.id === st.matId) || MATS[0];
      const next = { ...st, matId: nm.id, bleed: nm.bleed };
      return { matId: nm.id, bleed: nm.bleed, layers: reflowLayersToContainers(st.layers, geomOf(st, om.t), geomOf(next, nm.t)) };
    });
  };

  // —— Red libre ——
  const netRows = [];
  const walk = (n, depth) => {
    netRows.push({ n, depth });
    for (const ch of (lay.childrenOf[n.id] || [])) walk(ch, depth + 1);
  };
  for (const r of lay.roots) walk(r, 0);
  const netPanel = c.panels.find(p => p.id === netSel) || null;
  const netPanelNode = netSel ? lay.byId.get(netSel) : null;
  const edgeLabel = e => t(e.name, { n: e.nameN }) + ' · ' + fmtMm(e.len);
  const freeEdges = netPanel ? panelEdgeList(netPanel).filter(e => edgeFree(c, netPanel.id, e.id)) : [];
  // Bordes libres de todas las caras, en coordenadas del plano (para «+», herramienta armada y arrastrar).
  const LOCAL_EDGE = { far: (n) => [[0, n.h], [n.w, n.h]], near: (n) => [[0, 0], [n.w, 0]], xmin: (n) => [[0, 0], [0, n.h]], xmax: (n) => [[n.w, 0], [n.w, n.h]] };
  const edgeTargets = isNet ? c.panels.flatMap(p => {
    const node = lay.byId.get(p.id);
    if (!node) return [];
    return panelEdgeList(p).filter(e => edgeFree(c, p.id, e.id)).map(e => {
      const [a, b] = e.a ? [e.a, e.b] : LOCAL_EDGE[e.id](node);
      return { key: p.id + '|' + e.id, panelId: p.id, edge: e.id, len: e.len, a: mapLocal(node, ...a), b: mapLocal(node, ...b) };
    });
  }) : [];
  const attachAt = (tg, shapeId) => {
    const nextCustom = attachShape(c, s, tg.panelId, tg.edge, shapeId);
    if (nextCustom.panels.length === c.panels.length) return;
    patchCustom(() => nextCustom);
    setNetSel(tg.panelId); // la cara madre sigue elegida: así se pueden añadir varias solapas seguidas
  };
  const armShape = id => { setArmed(id); if (id) setPalShape(id); };
  const dropShape = (id, tg, pt) => {
    setPalShape(id);
    if (tg) { attachAt(tg, id); return; }
    // Soltada lejos de un borde: cara nueva como pieza independiente.
    const def = BUILDER_SHAPES.find(x => x.id === id);
    if (!def || def.kind !== 'face') { notify(t('Suelta las solapas sobre un borde libre (se marca en verde).')); return; }
    const piece = startFromShape(c, s, id).panels[0];
    const nextCustom = normalizeCustom({ ...c, panels: [...c.panels, { ...piece, id: 'p' + (Date.now() % 1e7), name: t(def.name), role: 'design' }] });
    patchCustom(() => nextCustom, { fitNonce: s.fitNonce + 1 });
    setNetSel(nextCustom.panels[nextCustom.panels.length - 1].id);
  };
  const newFromScratch = async id => {
    if (c.panels.length > 1 && !(await ask(t('¿Empezar una caja nueva desde cero? Se reemplazan las caras actuales (puedes deshacerlo con Ctrl+Z).')))) return;
    const nextCustom = startFromShape(c, s, id);
    store.set(st => ({
      tpl: 'custom', custom: nextCustom, fitNonce: st.fitNonce + 1,
      layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf({ ...st, tpl: 'custom', custom: nextCustom }, m.t))
    }));
    setNetSel('p1');
    setPalShape('flap');
  };
  // Líneas editables de la cara: las añadidas a mano, más las ranuras y pliegues que ya trae la cara.
  const lineItems = netPanel ? [
    ...(c.lines || []).filter(l => l.panelId === netPanel.id).map(l => ({ key: l.id, src: 'line', kind: l.kind, id: l.id, p: [[l.x1, l.y1], [l.x2, l.y2]] })),
    ...(netPanel.slits || []).map((q, i) => ({ key: 'slit:' + i, src: 'slit', kind: 'slot', i, p: [[q.x1, q.y1], [q.x2, q.y2]] })),
    ...(netPanel.folds || []).map((q, i) => ({ key: 'fold:' + i, src: 'fold', kind: 'crease', i, p: q }))
  ] : [];
  const lineWorld = netPanelNode ? lineItems.map(it => ({ id: it.key, kind: it.kind, pts: [mapLocal(netPanelNode, ...it.p[0]), mapLocal(netPanelNode, ...it.p[1])] })) : [];
  const selItem = lineItems.find(it => it.key === selLine) || null;
  const parentNode = netPanel && netPanel.parent ? lay.byId.get(netPanel.parent) : null;
  // Sentido en que crece `shift` (desplazamiento a lo largo del borde de unión): siempre +x de la madre en bordes far/near, +y en xmin/xmax.
  const shiftInfo = id => {
    const p = c.panels.find(x => x.id === id), par = p && p.parent ? lay.byId.get(p.parent) : null;
    // En los lados de un polígono (eN) el desplazamiento crece a lo largo del eje x propio de la hija.
    return par ? { dir: /^e\d+$/.test(p.edge) ? lay.byId.get(id).ex : p.edge === 'far' || p.edge === 'near' ? par.ex : par.ey, shift: p.shift || 0 } : null;
  };
  const parentPanel = netPanel && netPanel.parent ? c.panels.find(p => p.id === netPanel.parent) : null;
  const parentEdges = parentPanel ? panelEdgeList(parentPanel) : [];
  const selFrame = netPanelNode ? {
    id: netPanelNode.id, O: netPanelNode.O, ex: netPanelNode.ex, ey: netPanelNode.ey, w: netPanelNode.w, h: netPanelNode.h,
    snapW: parentNode ? ((parentEdges.find(e => e.id === netPanel.edge) || {}).len ?? (netPanel.edge === 'far' || netPanel.edge === 'near' ? parentNode.w : parentNode.h)) : null
  } : null;

  useEffect(() => {
    if (freeEdges.length && !freeEdges.some(e => e.id === addEdge)) setAddEdge(freeEdges[0].id);
  }, [netSel, s.custom]);

  const addChild = edgeArg => {
    if (!netPanel) return;
    if (!freeEdges.length) { notify(t('Esta cara ya tiene una unión en todos sus bordes. Elimina una cara o crea otra pieza.')); return; }
    const edge = edgeArg || (freeEdges.some(e => e.id === addEdge) ? addEdge : freeEdges[0].id);
    attachAt({ panelId: netPanel.id, edge }, palShape);
  };
  const addRoot = () => {
    const nextCustom = addNetPanel(c, s, null, 'far', 'rect');
    const added = nextCustom.panels[nextCustom.panels.length - 1];
    patchCustom(() => nextCustom, { fitNonce: s.fitNonce + 1 });
    setNetSel(added ? added.id : netSel);
  };
  const removePanel = id => {
    const nextCustom = deleteNetPanel(c, id);
    patchCustom(() => nextCustom, { fitNonce: s.fitNonce + 1 });
    const root = nextCustom.panels.find(p => !p.parent);
    setNetSel(root ? root.id : null);
  };
  const setPanel = (patch) => { if (netPanel) patchCustom(cc => updateNetPanel(cc, netPanel.id, patch)); };
  const makeIndependent = () => {
    if (!netPanel || !netPanel.parent) return;
    patchCustom(cc => updateNetPanel(cc, netPanel.id, { parent: null }), { fitNonce: s.fitNonce + 1 });
  };
  const duplicatePanel = () => {
    const nextCustom = duplicateNetPanel(c, netPanel.id);
    patchCustom(() => nextCustom, { fitNonce: s.fitNonce + 1 });
    const added = nextCustom.panels[nextCustom.panels.length - 1];
    setNetSel(added ? added.id : netPanel.id);
  };
  const shiftPanel = (id, shift) => patchCustom(cc => updateNetPanel(cc, id, { shift: Math.round(shift * 100) / 100 }));
  const addLine = kind => {
    if (!netPanel) return;
    const next = addNetLine(c, netPanel.id, kind);
    patchCustom(() => next);
    setSelLine(next.lines[next.lines.length - 1].id);
  };
  const otherPanels = netPanel ? c.panels.filter(p => p.id !== netPanel.id) : [];
  const applyLock = () => {
    if (!netPanel) return;
    const target = lockTarget && lockTarget !== netPanel.id && c.panels.some(p => p.id === lockTarget) ? lockTarget : (otherPanels[0] || {}).id;
    patchCustom(() => addLock(c, netPanel.id, lockType, { len: lockLen > 0 ? lockLen : undefined, target, slotW: Math.max(1.2, m.t) }), { fitNonce: s.fitNonce + 1 });
  };

  // Vector/punto del plano ↔ coordenadas locales de la cara seleccionada.
  const localOf = (node, p, vec) => {
    const det = node.ex[0] * node.ey[1] - node.ex[1] * node.ey[0];
    const dx = p[0] - (vec ? 0 : node.O[0]), dy = p[1] - (vec ? 0 : node.O[1]);
    return [(dx * node.ey[1] - dy * node.ey[0]) / det, (node.ex[0] * dy - node.ex[1] * dx) / det];
  };
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r1 = v => Math.round(v * 10) / 10;
  const setItemPts = (key, p0, p1) => {
    const it = lineItems.find(x => x.key === key);
    if (!it || !netPanel) return;
    const [x1, y1, x2, y2] = [p0[0], p0[1], p1[0], p1[1]].map(r1);
    patchCustom(cc => {
      if (it.src === 'line') return updateNetLine(cc, it.id, { x1, y1, x2, y2 });
      const panels = cc.panels.map(p => p.id !== netPanel.id ? p : it.src === 'slit'
        ? { ...p, slits: p.slits.map((q, i) => i === it.i ? { ...q, x1, y1, x2, y2 } : q) }
        : { ...p, folds: p.folds.map((q, i) => i === it.i ? [[x1, y1], [x2, y2]] : q) });
      return normalizeCustom({ ...cc, panels });
    });
  };
  // Mueve la línea entera (dx, dy en coordenadas locales) manteniéndola dentro de la cara.
  const moveItem = (it, o, dx, dy) => {
    const node = netPanelNode;
    const xs = [o[0][0], o[1][0]], ys = [o[0][1], o[1][1]];
    dx = clampN(dx, -Math.min(...xs), node.w - Math.max(...xs));
    dy = clampN(dy, -Math.min(...ys), node.h - Math.max(...ys));
    setItemPts(it.key, [o[0][0] + dx, o[0][1] + dy], [o[1][0] + dx, o[1][1] + dy]);
  };
  const onLineDrag = ev => {
    const it = lineItems.find(x => x.key === ev.id), node = netPanelNode;
    if (!it || !node) return;
    if (ev.phase === 'start') { lineOrig.current = it.p.map(q => q.slice()); setSelLine(ev.id); return; }
    const o = lineOrig.current; if (!o) return;
    const lp = localOf(node, ev.pt);
    if (ev.index === 'body') {
      const ls = localOf(node, ev.start);
      let dx = lp[0] - ls[0], dy = lp[1] - ls[1];
      if (ev.shift) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      moveItem(it, o, dx, dy);
      return;
    }
    let x = clampN(lp[0], 0, node.w), y = clampN(lp[1], 0, node.h);
    const other = o[1 - ev.index];
    if (!ev.alt) { // imán a bordes, centro y al otro extremo; Alt = libre
      const tx = [0, node.w / 2, node.w, other[0]].find(v => Math.abs(x - v) < ev.thr);
      const ty = [0, node.h / 2, node.h, other[1]].find(v => Math.abs(y - v) < ev.thr);
      if (tx != null) x = tx;
      if (ty != null) y = ty;
    }
    if (ev.shift) { if (Math.abs(x - other[0]) >= Math.abs(y - other[1])) y = other[1]; else x = other[0]; }
    setItemPts(ev.id, ...(ev.index === 0 ? [[x, y], other] : [other, [x, y]]));
  };
  // Ajuste fino con flechas / botones: dx, dy en mm sobre el plano (y hacia abajo).
  const nudge = (dx, dy) => {
    if (selItem && netPanelNode) {
      const l = localOf(netPanelNode, [dx, dy], true);
      moveItem(selItem, selItem.p, l[0], l[1]);
    } else if (netPanel) {
      const info = shiftInfo(netPanel.id);
      if (info) shiftPanel(netPanel.id, (netPanel.shift || 0) + dx * info.dir[0] + dy * info.dir[1]);
    }
  };
  const delItem = it => {
    setSelLine(null);
    patchCustom(cc => it.src === 'line' ? deleteNetLine(cc, it.id)
      : normalizeCustom({ ...cc, panels: cc.panels.map(p => p.id !== netPanel.id ? p : it.src === 'slit' ? { ...p, slits: p.slits.filter((_, i) => i !== it.i) } : { ...p, folds: p.folds.filter((_, i) => i !== it.i) }) }));
  };
  const nudgeRef = useRef(null);
  nudgeRef.current = nudge;
  const stepRef = useRef(1);
  stepRef.current = step;
  useEffect(() => setSelLine(null), [netSel]);
  // Flechas: mueven la línea o cara seleccionada (paso elegido; Shift ×10; Ctrl ×0,1). Esc deselecciona la línea.
  useEffect(() => {
    const kd = e => {
      if (store.get().view !== 'designer') return;
      const tag = (document.activeElement || {}).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') { setSelLine(null); setArmed(null); return; }
      if ((e.metaKey || e.ctrlKey) && /^[zZ]$/.test(e.key)) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if ((e.metaKey || e.ctrlKey) && /^[yY]$/.test(e.key)) { e.preventDefault(); store.redo(); return; }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const k = stepRef.current * (e.shiftKey ? 10 : e.ctrlKey || e.metaKey ? 0.1 : 1);
      nudgeRef.current(dir[0] * k, dir[1] * k);
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, []);
  const resizePanel = (id, which, v) => patchCustom(cc => {
    const p = cc.panels.find(x => x.id === id);
    if (!p) return cc;
    v = r1(v);
    if (which === 'h') return updateNetPanel(cc, id, { h: v });
    const patch = { w: v };
    if (p.parent) {
      // Mantiene fijo el lado opuesto: compensa el desplazamiento según cómo reparte el layout el borde.
      const dw = v - p.w, lowMoves = (which === 'wl') === (p.edge === 'far' || p.edge === 'xmin' || /^e\d+$/.test(p.edge));
      const base = p.shift || 0;
      patch.shift = Math.round((p.align === 'start' ? base - (lowMoves ? dw : 0)
        : p.align === 'end' ? base + (lowMoves ? 0 : dw)
          : base + (lowMoves ? -dw / 2 : dw / 2)) * 100) / 100;
    }
    return updateNetPanel(cc, id, patch);
  });

  const changeParentEdge = edge => {
    if (!netPanel || !netPanel.parent) return;
    if (!edgeFree(c, netPanel.parent, edge, netPanel.id)) { notify(t('Ese borde ya está ocupado. Elige otro borde o elimina la cara que lo ocupa.')); return; }
    setPanel({ edge });
  };

  const runExport = async fn => { try { await fn(); } catch (e) { notifyError(e); } };

  const startOwnBox = async () => {
    if (!(await ask(t('¿Crear una caja propia desde cero? La plantilla actual dejará de estar activa.')))) return;
    store.set(st => {
      const next = { ...st, tpl: 'custom' };
      return {
        tpl: 'custom', fitNonce: st.fitNonce + 1,
        layers: reflowLayersToContainers(st.layers, geomOf(st, m.t), geomOf(next, m.t))
      };
    });
  };

  if (s.tpl === 'wrap') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0ebe0', fontSize: 13, color: '#6d6557' }}>
        {t('Abriendo la Envolvente como red editable…')}
      </div>
    );
  }

  // Plantilla de la biblioteca: se abre sola como red editable tras confirmar; si se rechaza, queda esta tarjeta.
  if (s.tpl !== 'custom') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0ebe0', padding: 30 }}>
        <div style={{ maxWidth: 560, background: '#fdfcf7', border: '1px solid #ded5c4', borderRadius: 12, padding: '26px 30px' }}>
          <div style={{ fontSize: 10.5, letterSpacing: '0.18em', color: '#8a8071', fontWeight: 700, marginBottom: 8 }}>{t('CONSTRUCTOR DE CAJAS PROPIAS')}</div>
          <h2 style={{ margin: '0 0 10px', fontSize: 20, color: '#211d18' }}>{t('Estás trabajando con «{name}»', { name: tplName })}</h2>
          <p style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.7, color: '#5c554a' }}>
            {t('Puedes abrir esta plantilla en «Mi caja» como red avanzada: cada cara, solapa y pestaña pasa a ser editable. Las imágenes y textos de cada cara se ponen en «Diseño».')}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={async () => { if (await askConvert()) convertTemplate(); }} style={{ ...btnSt, padding: '9px 16px', border: '1px solid #9a5b1f', background: '#9a5b1f', color: '#fff', fontWeight: 700, fontSize: 13 }}>{t('Editar en Mi caja')}</button>
            <button onClick={() => store.set({ view: 'design' })} style={{ ...btnSt, padding: '9px 16px', fontSize: 13 }}>{t('Ir a Diseño')}</button>
            <button onClick={() => store.set({ view: 'structure' })} style={{ ...btnSt, padding: '9px 16px', fontSize: 13 }}>{t('Volver a Estructura')}</button>
            <button onClick={startOwnBox} style={{ ...btnSt, padding: '9px 16px', fontSize: 13, color: '#8a8071' }}>{t('Crear una caja propia desde cero')}</button>
          </div>
          {declined && <div style={{ marginTop: 14, fontSize: 11, color: '#8a8071', lineHeight: 1.6 }}>{t('No se ha cambiado nada: tu plantilla sigue activa.')}</div>}
        </div>
      </div>
    );
  }

  const modeBtn = (id, label) => (
    <button onClick={() => switchMode(id)} style={{
      ...btnSt, flex: 1, padding: '7px 0',
      background: c.mode === id ? '#211d18' : '#fff',
      color: c.mode === id ? '#fff' : '#5c554a',
      border: '1px solid ' + (c.mode === id ? '#211d18' : '#d8d0c2'),
      fontWeight: c.mode === id ? 700 : 400
    }}>{label}</button>
  );
  const nameOf = (list, id) => t((list.find(o => o.id === id) || {}).name || '');
  const noDelete = !netPanel || (lay.roots.length === 1 && !netPanel.parent);

  return (<>
    <div style={{ width: 286, flex: 'none', background: '#faf7f0', borderRight: '1px solid #ded5c4', overflowY: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', gap: 6, alignItems: 'center', padding: '8px 14px', background: '#faf7f0', borderBottom: '1px solid #e7e0d4' }}>
        <button onClick={() => store.undo()} disabled={!histPastN} title={t('Deshacer (Ctrl+Z)')} style={{ ...btnSt, flex: 1, padding: '5px 0', opacity: histPastN ? 1 : 0.4 }}>{t('↶ Deshacer')}</button>
        <button onClick={() => store.redo()} disabled={!histFutureN} title={t('Rehacer (Ctrl+Shift+Z / Ctrl+Y)')} style={{ ...btnSt, flex: 1, padding: '5px 0', opacity: histFutureN ? 1 : 0.4 }}>{t('↷ Rehacer')}</button>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#a59a85' }}>{histPastN}</span>
      </div>
      <Block>
        <ST>{t('Modo de diseño')}</ST>
        <div style={{ display: 'flex', gap: 6 }}>
          {modeBtn('box', t('Caja rápida'))}
          {modeBtn('net', t('Red avanzada'))}
        </div>
        <div style={{ ...hint, marginTop: 7 }}>
          {isNet
            ? t('Editor libre: añade, quita y mueve caras, solapas y piezas independientes.')
            : t('Caja paramétrica: cuatro paredes, tapa, solapas y pestañas automáticas.')}
        </div>
      </Block>

      <Block>
        <ST>{t('Empezar desde cero')}</ST>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
          {BUILDER_SHAPES.filter(d => d.kind === 'face').map(d => (
            <button key={d.id} onClick={() => newFromScratch(d.id)} title={t('Base: {name}', { name: t(d.name) })} style={{ ...btnSt, padding: '4px 2px 3px' }}>
              <svg viewBox="0 0 30 30" width="100%" height="24" aria-hidden="true"><path d={paletteThumb(d)} fill="#f3eee2" stroke="#211d18" strokeWidth="1.1" strokeLinejoin="round" /></svg>
              <div style={{ fontSize: 9.5, color: '#5c554a', lineHeight: 1.2, whiteSpace: 'normal' }}>{t(d.name)}</div>
            </button>
          ))}
        </div>
        <div style={{ ...hint, marginTop: 7 }}>{t('Elige la forma de la base y después pega caras y solapas en sus bordes.')}</div>
      </Block>

      {isNet && (
        <Block>
          <ST>{t('Formas y solapas')}</ST>
          <ShapePalette armed={armed} active={palShape} onArm={armShape} />
          <div style={{ ...hint, marginTop: 8, lineHeight: 1.6 }}>
            {armed
              ? t('Herramienta activa: haz clic en un borde verde del plano para pegarla. Esc para salir.')
              : t('Arrastra una forma hasta un borde del plano y se pega sola. También puedes elegirla y usar los «+» de la cara seleccionada. Las solapas se recortan en inglete para no pisarse en las esquinas.')}
          </div>
        </Block>
      )}

      {!isNet && (<>
        <Block>
          <ST>{t('Empezar una caja')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {CUSTOM_PRESETS.map(p => (
              <div key={p.id} onClick={() => usePreset(p.id)}
                style={{ cursor: 'pointer', border: '1px solid #e2dac9', background: '#fff', borderRadius: 6, padding: '8px 9px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#3d3830' }}>{t(p.name)}</div>
                <div style={{ fontSize: 10, color: '#8a8071', marginTop: 2 }}>{t(p.sub)}</div>
              </div>
            ))}
          </div>
          <button onClick={() => switchMode('net')} style={{ ...btnSt, width: '100%', marginTop: 9, padding: '8px 0', border: '1px solid #9a5b1f', color: '#9a5b1f', fontWeight: 700 }}>{t('Convertir en red editable')}</button>
        </Block>
        <Block>
          <ST>{t('Medidas interiores · cm')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
            <CmField label={t('Largo L')} mm={s.L} min={20} max={3000} onChange={v => setDim('L', v)} />
            <CmField label={t('Ancho W')} mm={s.W} min={15} max={3000} onChange={v => setDim('W', v)} />
            <CmField label={t('Alto H')} mm={s.H} min={15} max={3000} onChange={v => setDim('H', v)} />
          </div>
          <div style={{ ...hint, marginTop: 7 }}>{t('L y W forman el fondo. H es la altura base de las cuatro paredes.')}</div>
        </Block>
        <Block>
          <ST>{t('Construcción')}</ST>
          <div style={lbl}>{t('Cierre superior')}</div>
          <select value={c.build} onChange={e => patchCustom(cc => ({ ...cc, build: e.target.value }))} style={{ ...selectSt, marginBottom: 8 }}>
            {BUILD_OPTIONS.map(o => <option key={o.id} value={o.id}>{t(o.name)}</option>)}
          </select>
          {c.build !== 'open' && c.build !== 'dust' && (<>
            <div style={lbl}>{t('Cara que lleva la tapa')}</div>
            <select value={c.lidWall} onChange={e => patchCustom(cc => ({ ...cc, lidWall: e.target.value }))} style={{ ...selectSt, marginBottom: 8 }}>
              {LID_WALL_OPTIONS.map(o => <option key={o.id} value={o.id}>{t(o.name)}</option>)}
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
              <MmField label={t('Profundidad tapa')} mm={c.lidDepth} min={0} max={1200} step={1} onChange={v => patchCustom(cc => ({ ...cc, lidDepth: v }))} />
              <div style={{ fontSize: 10, color: '#a59a85', display: 'flex', alignItems: 'flex-end', paddingBottom: 7 }}>{t('0 = automática')}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
              <MmField label={t('Lengüeta')} mm={c.tongue} min={2} max={120} step={0.5} onChange={v => patchCustom(cc => ({ ...cc, tongue: v }))} />
              <MmField label={t('Solapa polvo')} mm={c.dust} min={2} max={120} step={0.5} onChange={v => patchCustom(cc => ({ ...cc, dust: v }))} />
            </div>
            <ToggleRow label={t('Incluir solapas guardapolvo')} on={c.dustOn !== false} onClick={() => patchCustom(cc => ({ ...cc, dustOn: cc.dustOn === false }))} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
              <div>
                <div style={lbl}>{t('Silueta tapa')}</div>
                <select value={c.lidShape} onChange={e => patchCustom(cc => ({ ...cc, lidShape: e.target.value }))} style={selectSt}>
                  {SHAPE_OPTIONS.map(o => <option key={o.id} value={o.id}>{t(o.name)}</option>)}
                </select>
              </div>
              <MmField label={t('Radio/chaflán')} mm={c.lidCorner} min={0} max={200} step={0.5} onChange={v => patchCustom(cc => ({ ...cc, lidCorner: v }))} />
            </div>
          </>)}
          <div style={{ height: 1, background: '#e7e0d4', margin: '10px 0' }} />
          <ToggleRow label={t('Pestañas de esquina')} on={c.cornerTabs} onClick={() => patchCustom(cc => ({ ...cc, cornerTabs: !cc.cornerTabs }))} />
          {c.cornerTabs && <MmField label={t('Profundidad pestaña')} mm={c.tabDepth} min={2} max={120} step={0.5} onChange={v => patchCustom(cc => ({ ...cc, tabDepth: v }))} />}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 8 }}>
            <div>
              <div style={lbl}>{t('Silueta del fondo')}</div>
              <select value={c.baseShape} onChange={e => patchCustom(cc => ({ ...cc, baseShape: e.target.value }))} style={selectSt}>
                {SHAPE_OPTIONS.map(o => <option key={o.id} value={o.id}>{t(o.name)}</option>)}
              </select>
            </div>
            <MmField label={t('Radio/chaflán')} mm={c.baseCorner} min={0} max={200} step={0.5} onChange={v => patchCustom(cc => ({ ...cc, baseCorner: v }))} />
          </div>
        </Block>
      </>)}

      {isNet && (<>
        <Block>
          <ST>{t('Redes de ejemplo')}</ST>
          <div style={{ display: 'grid', gap: 7 }}>
            {NET_PRESETS.map(p => (
              <div key={p.id} onClick={() => useNetPreset(p.id)}
                style={{ cursor: 'pointer', border: '1px solid #e2dac9', background: '#fff', borderRadius: 6, padding: '8px 9px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#3d3830' }}>{t(p.name)}</div>
                <div style={{ fontSize: 10, color: '#8a8071', marginTop: 2 }}>{t(p.sub)}</div>
              </div>
            ))}
          </div>
          <button onClick={addRoot} style={{ ...btnSt, width: '100%', marginTop: 9, padding: '8px 0', border: '1px solid #9a5b1f', color: '#9a5b1f', fontWeight: 700 }}>{t('+ Añadir pieza independiente')}</button>
          <button onClick={() => switchMode('box')} style={{ ...btnSt, width: '100%', marginTop: 7, padding: '7px 0' }}>{t('Volver a caja rápida')}</button>
          <button onClick={regenerateNet} style={{ ...btnSt, width: '100%', marginTop: 7, padding: '7px 0', fontSize: 11, color: '#8a8071' }}>{t('Regenerar desde caja rápida')}</button>
          {lay.roots.length === 2 && (
            <ToggleRow label={t('Montar las 2 piezas en 3D')} on={c.joinPreview} onClick={() => patchCustom(cc => ({ ...cc, joinPreview: !cc.joinPreview }))} />
          )}
          <div style={{ ...hint, marginTop: 9, lineHeight: 1.6 }}>
            {t('En 3D puedes ver las piezas separadas para revisar el corte o montadas: la segunda pieza se coloca encima y pliega sus paredes hacia abajo.')}
          </div>
        </Block>
        {c.wrapStyle && (
          <Block>
            <ST>{t('Medidas de la envolvente · cm')}</ST>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginBottom: 7 }}>
              <CmField label={t('Trasera L')} mm={s.L} min={20} max={3000} onChange={v => store.set({ L: v })} />
              <CmField label={t('Fondo W')} mm={s.W} min={10} max={1000} onChange={v => store.set({ W: v })} />
              <CmField label={t('Alto H')} mm={s.H} min={20} max={3000} onChange={v => store.set({ H: v })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 7 }}>
              <CmField label={t('Cara exterior')} mm={s.wrap?.outer || 0} min={0} max={800} onChange={v => setWrapParam('outer', v)} />
              <CmField label={t('Cara interior')} mm={s.wrap?.inner || 0} min={0} max={800} onChange={v => setWrapParam('inner', v)} />
              <CmField label={t('Solapa')} mm={s.wrap?.flap || 0} min={0} max={300} onChange={v => setWrapParam('flap', v)} />
              <MmField label={t('Pestaña lateral')} mm={s.wrap?.sideTab || 0} min={0} max={80} onChange={v => setWrapParam('sideTab', v)} />
              <MmField label={t('Pestaña frontal')} mm={s.wrap?.tab || 15} min={3} max={60} onChange={v => setWrapParam('tab', v)} />
              <MmField label={t('Ranura')} mm={s.wrap?.slot || 55} min={3} max={120} onChange={v => setWrapParam('slot', v)} />
              <MmField label={t('Ancho ranura')} mm={s.wrap?.slotW || 1.5} min={0} max={10} step={0.1} onChange={v => setWrapParam('slotW', v)} />
            </div>
            <button onClick={regenerateWrap} style={{ ...btnSt, width: '100%', padding: '8px 0', border: '1px solid #9a5b1f', color: '#9a5b1f', fontWeight: 700 }}>{t('Aplicar medidas y regenerar red')}</button>
            <div style={{ ...hint, marginTop: 7 }}>{t('Regenerar sustituye las caras por la red base de la Envolvente. Para retoques finos, edita cada cara en «Red de caras».')}</div>
          </Block>
        )}
        <Block>
          <ST>{t('Reglas de red')}</ST>
          <div style={{ fontSize: 10.5, color: '#6d6557', lineHeight: 1.7 }}>
            {[
              'Cada cara hija se une a un borde libre de su madre.',
              'El borde de bisagra no se corta: se marca como pliegue.',
              'Varias raíces = varias piezas en el mismo archivo.',
              'El ángulo de plegado permite cajas inclinadas o formas raras.',
              'Puedes quitar cualquier solapa o pestaña sin tocar el resto.'
            ].map(k => <div key={k}>• {t(k)}</div>)}
          </div>
        </Block>
      </>)}

      <Block>
        <ST>{t('Material')}</ST>
        <select value={s.matId} onChange={e => setMaterial(e.target.value)} style={selectSt}>
          {MATS.map(mm => <option key={mm.id} value={mm.id}>{mm.name}</option>)}
        </select>
        <div style={{ fontSize: 11, color: '#8a8071', marginTop: 7 }}>{t('Espesor t =')} <b style={{ color: '#9a5b1f', fontFamily: "'JetBrains Mono',monospace" }}>{fmtMm(m.t)}</b> · {m.note}</div>
      </Block>

      <Block>
        <ST>{t('Preparación láser')}</ST>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
          <MmField label={t('Kerf')} mm={c.kerf} min={0} max={1} step={0.01} onChange={v => patchCustom(cc => ({ ...cc, kerf: v }))} />
          <MmField label={t('Margen')} mm={c.margin} min={0} max={100} step={1} onChange={v => patchCustom(cc => ({ ...cc, margin: v }))} />
        </div>
        <div style={lbl}>{t('Placa / cama')}</div>
        <select value={c.sheet} onChange={e => patchCustom(cc => ({ ...cc, sheet: e.target.value }))} style={{ ...selectSt, marginBottom: 8 }}>
          {SHEETS.map(x => <option key={x.id} value={x.id}>{t(x.name)}</option>)}
        </select>
        {c.sheet === 'custom' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
            <CmField label={t('Ancho')} mm={c.sheetCustom.w} min={50} max={5000} step={0.5} onChange={v => patchCustom(cc => ({ ...cc, sheetCustom: { ...cc.sheetCustom, w: v } }))} />
            <CmField label={t('Alto')} mm={c.sheetCustom.h} min={50} max={5000} step={0.5} onChange={v => patchCustom(cc => ({ ...cc, sheetCustom: { ...cc.sheetCustom, h: v } }))} />
          </div>
        )}
        <ToggleRow label={t('Mostrar contorno de placa')} on={c.showPage} onClick={() => patchCustom(cc => ({ ...cc, showPage: !cc.showPage }))} />
        <div style={{ marginTop: 8, fontSize: 10.5, lineHeight: 1.6, color: '#a59a85' }}>{t('El SVG sale a escala 1:1 en mm. El kerf se guarda como dato de máquina para compensarlo en LightBurn / RDWorks.')}</div>
      </Block>
      <div style={{ padding: 14 }}>
        <Note><b style={{ color: '#211d18' }}>{t('Regla de oro')}</b><br />{t('Las medidas que escribes son interiores. La caja compensa el espesor del material en los pliegues y el 3D se arma con esa misma geometría.')}</Note>
      </div>
    </div>

    <SheetCanvas view="structure" g={g}
      highlight={isNet ? netSel : null}
      onPanelClick={isNet ? (panelId) => setNetSel(panelId) : undefined}
      extraLines={isNet ? lineWorld : undefined}
      selLineId={selLine}
      onLineDrag={isNet ? onLineDrag : undefined}
      panelShiftInfo={isNet ? shiftInfo : undefined}
      onPanelShift={isNet ? shiftPanel : undefined}
      selFrame={isNet ? selFrame : undefined}
      onPanelResize={isNet ? resizePanel : undefined}
      edgeTargets={isNet ? edgeTargets : undefined}
      armedShape={isNet ? armed : null}
      onEdgePick={isNet ? (tg => attachAt(tg, armed || palShape)) : undefined}
      onShapeDrop={isNet ? dropShape : undefined} />

    <div style={{ width: 344, flex: 'none', background: '#faf7f0', borderLeft: '1px solid #ded5c4', overflowY: 'auto' }}>
      <Block style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
          <ST style={{ marginBottom: 0 }}>{t('Vista 3D en vivo')}</ST>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#9a5b1f' }}>{Math.round(fold)}%</span>
        </div>
        <div style={{ position: 'relative', height: 280, borderRadius: 8, overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 40%, #efe9db 0%, #ddd4c0 68%, #cfc4ab 100%)', border: '1px solid #ded5c4' }}>
          <BoxPreview s={previewS} m={m} context={preview} engineRef={engRef} onPanelSelect={isNet ? (panelId) => setNetSel(panelId) : undefined} />
        </div>
        <input type="range" min="0" max="100" value={fold} aria-label={t('Plegado 3D')} onChange={e => setFold(+e.target.value)} style={{ width: '100%', accentColor: '#9a5b1f', margin: '9px 0 0' }} />
        <div style={{ display: 'flex', gap: 7, marginTop: 7 }}>
          <button onClick={() => store.set({ view: 'three' })} style={{ ...btnSt, flex: 1, padding: '7px 0' }}>{t('Abrir en 3D')}</button>
          <button onClick={() => setFold(0)} style={{ ...btnSt, flex: 1, padding: '7px 0' }}>{t('Desplegar')}</button>
          <button onClick={() => setFold(100)} style={{ ...btnSt, flex: 1, padding: '7px 0' }}>{t('Montar')}</button>
        </div>
      </Block>

      {!isNet && (
        <Block>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
            <ST style={{ marginBottom: 0 }}>{t('Cara a cara')}</ST>
            <button onClick={() => setShapeAll(c.walls.front.shape, c.walls.front.corner)} title={t('Copiar forma de la cara frontal a las cuatro paredes')} style={{ ...btnSt, padding: '3px 8px', fontSize: 10.5 }}>{t('Copiar forma')}</button>
          </div>
          <div style={{ display: 'grid', gap: 7 }}>
            {WALL_IDS.map(id => {
              const w = c.walls[id];
              const h = wallH(id);
              return (
                <div key={id} style={{ border: '1px solid #e7e0d4', borderRadius: 7, background: '#fff', padding: '8px 9px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <b style={{ fontSize: 12 }}>{t(WALL_NAMES[id])}</b>
                    <button onClick={() => setWall(id, { h: 0 })} title={t('Usar la altura H general')} style={{ border: 'none', background: w.h > 0 ? '#f7efe2' : '#efe9dc', color: w.h > 0 ? '#9a5b1f' : '#8a8071', borderRadius: 4, cursor: 'pointer', fontSize: 10, padding: '2px 6px' }}>{w.h > 0 ? t('Auto H') : t('Auto ✓')}</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.25fr', gap: 7 }}>
                    <CmField label={t('Alto')} mm={h} min={1} max={300} step={0.1} onChange={v => setWall(id, { h: v })} />
                    <div>
                      <div style={lbl}>{t('Silueta')}</div>
                      <select value={w.shape} onChange={e => setWall(id, { shape: e.target.value })} style={selectSt}>
                        {SHAPE_OPTIONS.map(o => <option key={o.id} value={o.id}>{t(o.name)}</option>)}
                      </select>
                    </div>
                  </div>
                  {w.shape !== 'rect' && <div style={{ marginTop: 6 }}><MmField label={t('Radio / chaflán')} mm={w.corner} min={0} max={200} step={0.5} onChange={v => setWall(id, { corner: v })} /></div>}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 9 }}>
            <div style={lbl}>{t('Cara principal (C)')}</div>
            <select value={c.heroWall} onChange={e => patchCustom(cc => ({ ...cc, heroWall: e.target.value }))} style={selectSt}>
              {LID_WALL_OPTIONS.map(o => <option key={o.id} value={o.id}>{t(o.name)}</option>)}
            </select>
          </div>
          <div style={{ ...hint, marginTop: 9, lineHeight: 1.6 }}>{t('Para añadir o quitar solapas concretas, pasa a «Red avanzada». Ahí cada cara y cada pestaña es una pieza editable.')}</div>
        </Block>
      )}

      {isNet && (
        <Block>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
            <ST style={{ marginBottom: 0 }}>{t('Red de caras')}</ST>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: '#8a8071' }}>{t('{r} pieza(s) · {n} cara(s)', { r: lay.roots.length, n: lay.nodes.length })}</span>
          </div>
          <div style={{ display: 'grid', gap: 4, maxHeight: 270, overflowY: 'auto', paddingRight: 2 }}>
            {netRows.map(({ n, depth }) => (
              <div key={n.id} onClick={() => setNetSel(n.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
                  padding: '5px 7px', paddingLeft: 7 + depth * 13, borderRadius: 5, cursor: 'pointer',
                  border: '1px solid ' + (netSel === n.id ? '#9a5b1f' : '#e7e0d4'),
                  background: netSel === n.id ? '#f7efe2' : '#fff'
                }}>
                <span style={{ width: 12, flex: 'none', textAlign: 'center', color: n.role === 'hero' ? '#C9A227' : '#d8d0c2', fontSize: 11 }}>{n.role === 'hero' ? '★' : (n.parent ? '└' : '■')}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(n.name)}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: '#8a8071', flex: 'none' }}>{fmtCm(n.w)}×{fmtCm(n.h)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={addRoot} style={{ ...btnSt, flex: 1, padding: '6px 0', fontSize: 11 }}>{t('+ Pieza')}</button>
            <button onClick={() => netPanel && removePanel(netPanel.id)} disabled={noDelete} style={{ ...btnSt, flex: 1, padding: '6px 0', fontSize: 11, color: '#c0492b', opacity: noDelete ? 0.4 : 1 }}>{t('Eliminar')}</button>
          </div>
        </Block>
      )}

      {isNet && netPanel && (
        <Block>
          <ST>{t('Cara seleccionada')}</ST>
          <Tooltip.Provider delayDuration={200}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginBottom: 9 }}>
              <Tool icon={IconScissors} tip={t('Añadir línea de corte')} onClick={() => addLine('cut')} color="#C8102E" />
              <Tool icon={IconFold} tip={t('Añadir línea de pliegue')} onClick={() => addLine('crease')} color="#2E7D46" />
              <Tool icon={IconLineDashed} tip={t('Añadir línea de punteado (perforación)')} onClick={() => addLine('perf')} color="#C8102E" />
              <Tool icon={IconSeparator} tip={t('Añadir ranura')} onClick={() => addLine('slot')} color="#9a5b1f" />
              <span style={{ width: 1, height: 20, background: '#e7e0d4', margin: '0 2px' }} />
              <Tool icon={IconFocusCentered} tip={selItem ? t('Centrar la línea en la cara') : t('Centrar la cara en su borde')}
                disabled={!selItem && !netPanel.parent}
                onClick={() => {
                  if (selItem) { const [a, b] = selItem.p; moveItem(selItem, selItem.p, netPanel.w / 2 - (a[0] + b[0]) / 2, netPanel.h / 2 - (a[1] + b[1]) / 2); }
                  else setPanel({ shift: 0 });
                }} />
              <Tool icon={IconStar} tip={t('Marcar como cara principal')} onClick={() => setPanel({ role: 'hero' })} active={netPanel.role === 'hero'} color="#C9A227" />
              <Tool icon={IconUnlink} tip={t('Hacer pieza independiente')} onClick={makeIndependent} disabled={!netPanel.parent} />
              <Tool icon={IconCopy} tip={t('Duplicar cara')} onClick={duplicatePanel} />
              <Tool icon={IconTrash} tip={t('Eliminar cara')} onClick={() => removePanel(netPanel.id)} disabled={noDelete} color="#c0492b" />
            </div>
          </Tooltip.Provider>
          <input aria-label={t('Nombre de cara')} value={netPanel.name} onChange={e => setPanel({ name: e.target.value })} style={{ ...inputSt, fontFamily: 'inherit', marginBottom: 8 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
            <CmField label={t('Ancho bisagra')} mm={netPanel.w} min={2} max={3000} step={0.01} onChange={v => setPanel({ w: v })} />
            <CmField label={t('Profundidad')} mm={netPanel.h} min={2} max={3000} step={0.01} onChange={v => setPanel({ h: v })} />
          </div>
          <div style={lbl}>{t('Forma de la cara (selector de lengüetas)')}</div>
          <div style={{ marginBottom: 8 }}>
            <ShapeGrid items={FLAP_SHAPES} value={netPanel.shape} onPick={id => setPanel({ shape: id })} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <MmField label={t('Radio/chaflán')} mm={netPanel.corner} min={0} max={200} step={0.5} onChange={v => setPanel({ corner: v })} />
          </div>
          {netPanel.parent && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
              {[['miterL', t('Inglete izq. °')], ['miterR', t('Inglete der. °')]].map(([key, label]) => (
                <div key={key}>
                  <div style={lbl}>{label}</div>
                  <input type="number" min="0" max="85" step="1" value={Math.round((netPanel[key] || 0) * 10) / 10} aria-label={label}
                    onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setPanel({ [key]: Math.min(85, Math.max(0, v)) }); }} style={inputSt} />
                </div>
              ))}
            </div>
          )}
          {netPanel.parent && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 8 }}>
              <div>
                <div style={lbl}>{t('Borde de unión')}</div>
                <select value={netPanel.edge} onChange={e => changeParentEdge(e.target.value)} style={selectSt}>
                  {parentEdges.map(o => <option key={o.id} value={o.id}>{edgeLabel(o)}</option>)}
                </select>
              </div>
              <div>
                <div style={lbl}>{t('Ángulo de plegado °')}</div>
                <input type="number" min="0" max="360" step="1" value={netPanel.angle} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setPanel({ angle: Math.min(360, Math.max(0, v)) }); }} style={inputSt} />
              </div>
            </div>
          )}
          <div style={{ marginBottom: 8 }}>
            <MmField label={t('Separación de capa (3D)')} mm={netPanel.zOff || 0} min={-5} max={5} step={0.05} onChange={v => setPanel({ zOff: v })} />
            <div style={{ fontSize: 10, color: '#a59a85', marginTop: 3 }}>{t('Si dos caras plegadas parpadean en 3D, sepáralas 0,2–1 mm (negativo = hacia dentro).')}</div>
          </div>
          {netPanel.parent && (
            <div style={{ marginBottom: 8 }}>
              <MmField label={t('Mover en el borde')} mm={netPanel.shift || 0} min={-1000} max={1000} step={0.1} onChange={v => setPanel({ shift: v })} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 4, marginTop: 5 }}>
                {[[-1, '−1'], [-0.1, '−0,1'], [0, t('Centrar')], [0.1, '+0,1'], [1, '+1']].map(([d, lb]) => (
                  <button key={lb} onClick={() => setPanel({ shift: d === 0 ? 0 : Math.round(((netPanel.shift || 0) + d) * 100) / 100 })} style={{ ...btnSt, padding: '4px 0', fontSize: 10.5 }}>{lb}</button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#a59a85', marginTop: 4, lineHeight: 1.5 }}>{t('Arrastra la cara seleccionada en el plano (imán al centro; Alt = libre). Con el cuadrado rojo de cada borde cambias ancho y profundidad.')}</div>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 8 }}>
            {netPanel.parent
              ? t('Unida a: {name} · {edge}', { name: t(parentPanel?.name || netPanel.parent), edge: (() => { const e = parentEdges.find(x => x.id === netPanel.edge); return e ? edgeLabel(e) : nameOf(EDGE_OPTIONS, netPanel.edge); })() })
              : t('Pieza raíz independiente')}
          </div>

          <div style={{ height: 1, background: '#e7e0d4', margin: '10px 0' }} />
          <ST style={{ marginBottom: 6 }}>{t('Líneas de esta cara')}</ST>
          {lineItems.length > 0 && (
            <div style={{ display: 'grid', gap: 4, marginBottom: 7 }}>
              {lineItems.map(it => (
                <div key={it.key} onClick={() => setSelLine(it.key === selLine ? null : it.key)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: selLine === it.key ? '#e8f0fc' : '#fff', border: '1px solid ' + (selLine === it.key ? '#1c6ee0' : '#e7e0d4'), borderRadius: 4, padding: '4px 6px', cursor: 'pointer' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, flex: 'none', background: it.kind === 'crease' ? '#2E7D46' : it.kind === 'slot' ? '#9a5b1f' : '#C8102E', outline: it.kind === 'perf' ? '1px dashed #C8102E' : undefined, outlineOffset: 1 }} />
                  <span style={{ flex: 1, fontSize: 10.5, color: '#5c554a' }}>{it.kind === 'slot' ? t('Ranura') : it.kind === 'crease' ? t('Pliegue') : it.kind === 'perf' ? t('Punteado') : t('Corte')}{it.src === 'line' ? '' : ' ' + t('(de la cara)')}</span>
                  <span onClick={e => { e.stopPropagation(); delItem(it); }} title={t('Eliminar (se puede deshacer con Ctrl+Z)')} style={{ cursor: 'pointer', color: '#c0492b', fontSize: 11 }}>×</span>
                </div>
              ))}
            </div>
          )}
          {selItem && (
            <div style={{ background: '#f0ebe0', border: '1px solid #e2dac9', borderRadius: 6, padding: 8, marginBottom: 7 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                {[['X1', 0, 0], ['Y1', 0, 1], ['X2', 1, 0], ['Y2', 1, 1]].map(([lb, pi, ci]) => (
                  <MmField key={lb} label={lb} mm={selItem.p[pi][ci]} min={0} max={ci ? netPanel.h : netPanel.w} step={0.1}
                    onChange={v => { const q = selItem.p.map(a => a.slice()); q[pi][ci] = v; setItemPts(selItem.key, q[0], q[1]); }} />
                ))}
              </div>
              {(() => {
                const [a, b] = selItem.p, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
                const setLen = v => { // cambia el largo manteniendo el centro y la dirección, dentro de la cara
                  const ux = len > 1e-6 ? (b[0] - a[0]) / len : 1, uy = len > 1e-6 ? (b[1] - a[1]) / len : 0;
                  let h = v / 2;
                  if (Math.abs(ux) > 1e-6) h = Math.min(h, Math.min(cx, netPanel.w - cx) / Math.abs(ux));
                  if (Math.abs(uy) > 1e-6) h = Math.min(h, Math.min(cy, netPanel.h - cy) / Math.abs(uy));
                  setItemPts(selItem.key, [cx - ux * h, cy - uy * h], [cx + ux * h, cy + uy * h]);
                };
                const w0 = selItem.src === 'line' ? (c.lines.find(l => l.id === selItem.id) || {}).w : (netPanel.slits[selItem.i] || {}).w;
                const setW = v => patchCustom(cc => {
                  if (selItem.src === 'line') return updateNetLine(cc, selItem.id, { w: v });
                  return normalizeCustom({ ...cc, panels: cc.panels.map(p => p.id !== netPanel.id ? p : { ...p, slits: p.slits.map((q, i) => i === selItem.i ? { ...q, w: v } : q) }) });
                });
                return (<>
                  <div style={{ display: 'grid', gridTemplateColumns: selItem.kind === 'slot' ? '1fr 1fr' : '1fr', gap: 6, marginBottom: 6 }}>
                    <MmField label={t('Largo')} mm={Math.round(len * 100) / 100} min={0.5} max={Math.hypot(netPanel.w, netPanel.h)} step={0.1} onChange={setLen} />
                    {selItem.kind === 'slot' && <MmField label={t('Ancho ranura')} mm={w0 || 0} min={0} max={20} step={0.1} onChange={setW} />}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 6 }}>
                    <button onClick={() => moveItem(selItem, selItem.p, netPanel.w / 2 - cx, 0)} style={{ ...btnSt, padding: '4px 0', fontSize: 10.5 }}>{t('Centrar ↔ en la cara')}</button>
                    <button onClick={() => moveItem(selItem, selItem.p, 0, netPanel.h / 2 - cy)} style={{ ...btnSt, padding: '4px 0', fontSize: 10.5 }}>{t('Centrar ↕ en la cara')}</button>
                  </div>
                </>);
              })()}
              <div style={lbl}>{t('Mover la línea · paso mm')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4, marginBottom: 5 }}>
                {[0.1, 0.5, 1, 5].map(v => (
                  <button key={v} onClick={() => setStep(v)} style={{ ...btnSt, padding: '3px 0', fontSize: 10.5, background: step === v ? '#211d18' : '#fff', color: step === v ? '#fff' : '#3d3830' }}>{('' + v).replace('.', ',')}</button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
                {[['←', -1, 0], ['→', 1, 0], ['↑', 0, -1], ['↓', 0, 1]].map(([lb, dx, dy]) => (
                  <button key={lb} onClick={() => nudge(dx * step, dy * step)} style={{ ...btnSt, padding: '4px 0' }}>{lb}</button>
                ))}
              </div>
            </div>
          )}
          <div style={{ fontSize: 10, color: '#a59a85', marginBottom: 8, lineHeight: 1.5 }}>{t('Arrastra la línea o sus círculos en el plano (imán a bordes/centro; Shift = recta; Alt = libre). Con una línea elegida, las flechas del teclado la mueven (Shift ×10, Ctrl ×0,1). Las ranuras se exportan como encaje de corte.')}</div>

          <div style={{ height: 1, background: '#e7e0d4', margin: '10px 0' }} />
          <ST style={{ marginBottom: 6 }}><IconLock size={12} stroke={2} style={{ verticalAlign: -1, marginRight: 4 }} />{t('Encajes')}</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 7 }}>
            {LOCK_TYPES.map(o => (
              <button key={o.id} onClick={() => setLockType(o.id)} aria-pressed={lockType === o.id} style={{
                ...btnSt, padding: '5px 4px', fontSize: 10.5, whiteSpace: 'normal',
                border: '1px solid ' + (lockType === o.id ? '#9a5b1f' : '#e2dac9'), background: lockType === o.id ? '#f7efe2' : '#fff',
                color: lockType === o.id ? '#9a5b1f' : '#5c554a', fontWeight: lockType === o.id ? 700 : 400
              }}>{t(o.name)}</button>
            ))}
          </div>
          {lockType !== 'locktab' && lockType !== 'pair' && (
            <div style={{ marginBottom: 7 }}><MmField label={t('Largo de la ranura (0 = automático)')} mm={lockLen} min={0} max={500} step={0.5} onChange={setLockLen} /></div>
          )}
          {lockType === 'tabslot' && (<>
            <div style={lbl}>{t('Cara que recibe la pestaña')}</div>
            <select value={lockTarget} onChange={e => setLockTarget(e.target.value)} style={{ ...selectSt, marginBottom: 7 }}>
              <option value="">{otherPanels.length ? t(otherPanels[0].name) + ' (' + t('por defecto') + ')' : t('No hay otras caras')}</option>
              {otherPanels.slice(1).map(p => <option key={p.id} value={p.id}>{t(p.name)}</option>)}
            </select>
          </>)}
          <button onClick={applyLock} disabled={lockType === 'tabslot' && !otherPanels.length} style={{ ...btnSt, width: '100%', padding: '7px 0', border: '1px solid #9a5b1f', color: '#9a5b1f', fontWeight: 700 }}>{t('Añadir encaje a esta cara')}</button>
          <div style={{ ...hint, marginTop: 6 }}>{t('Las ranuras se añaden como líneas editables; la pestaña de «Pestaña y ranura» sale con el mismo ancho en la otra cara.')}</div>

          <div style={{ height: 1, background: '#e7e0d4', margin: '10px 0' }} />
          <ST style={{ marginBottom: 6 }}>{t('Añadir cara o solapa')}</ST>
          <div style={{ fontSize: 11, color: '#5c554a', marginBottom: 6 }}>
            {t('Forma activa:')} <b style={{ color: '#9a5b1f' }}>{t((BUILDER_SHAPES.find(d => d.id === palShape) || BUILDER_SHAPES[0]).name)}</b>
          </div>
          {freeEdges.length ? (
            <div style={{ display: 'grid', gap: 4 }}>
              {freeEdges.map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #e7e0d4', borderRadius: 5, background: '#fff', padding: '4px 4px 4px 8px' }}>
                  <span style={{ flex: 1, fontSize: 11, color: '#3d3830' }}>{edgeLabel(e)}</span>
                  <button onClick={() => addChild(e.id)} title={t('Añadir la forma activa en este borde')} style={{ ...btnSt, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid #28a7a1', color: '#1d7a75', fontWeight: 700, fontSize: 11 }}><IconPlus size={13} stroke={2.2} />{t('Añadir')}</button>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 11, color: '#a59a85' }}>{t('Todos los bordes de esta cara ya están ocupados.')}</div>}
          <div style={{ ...hint, marginTop: 7 }}>{t('La forma toma el largo del borde. Luego puedes cambiar su ancho, profundidad, silueta y ángulo.')}</div>
        </Block>
      )}

      <Block>
        <ST>{t('Resumen')}</ST>
        <KV k={t('Modo')} v={isNet ? t('Red avanzada') : t('Caja rápida')} />
        {isNet && <KV k={t('Piezas')} v={'' + lay.roots.length} />}
        {isNet && <KV k={t('Caras')} v={'' + lay.nodes.length} />}
        <KV k={t('Desplegado')} v={fmtCm(sw) + ' × ' + fmtCm(sh)} />
        <KV k={t('Con márgenes')} v={fmtCm(needW) + ' × ' + fmtCm(needH)} />
        <KV k={t('Placa')} v={sheetW ? fmtCm(sheetW) + ' × ' + fmtCm(sheetH) : t('Ajustada')} />
        <KV k={t('Cabe en placa')} v={fits ? t('Sí') : t('No · gira o cambia de placa')} />
        <KV k={t('Corte')} v={fmtMm(g.cutLen) + ' · ' + t('{n} tramos', { n: g.cutN })} />
        <KV k={t('Pliegue')} v={fmtMm(g.creaseLen) + ' · ' + t('{n} tramos', { n: g.creaseN })} />
        {g.slotN > 0 && <KV k={t('Encajes')} v={g.slotN + ' · ' + fmtMm(g.slotLen)} />}
        <KV k={t('Preflight')} v={pf.errors ? t('{n} error(es)', { n: pf.errors }) : pf.warnings ? t('{n} aviso(s)', { n: pf.warnings }) : t('Correcto')} />
        <div style={{ marginTop: 8, color: pf.blocking ? '#c0492b' : pf.warnings ? '#b2831f' : '#2E7D46', fontSize: 11.5, fontWeight: 700 }}>
          {pf.blocking ? t('Hay que corregir el modelo') : pf.warnings ? t('Listo, con avisos de preparación') : t('Listo para cortar')}
        </div>
        <div style={{ marginTop: 7, display: 'grid', gap: 4 }}>
          {pf.rows.filter(r => r.level !== 'ok').map(r => (
            <div key={r.label} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 10.5, color: '#6d6557', lineHeight: 1.45 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: LEVEL_DOT[r.level], flex: 'none', marginTop: 4 }} />
              <span style={{ flex: 1 }}>{r.label}</span>
              {r.fix && (
                <button onClick={() => patchCustom(cc => normalizeCustom({ ...cc, ...r.fix() }))} title={t('Corregir automáticamente (se puede deshacer con Ctrl+Z)')}
                  style={{ ...btnSt, flex: 'none', padding: '2px 7px', fontSize: 10.5, color: '#9a5b1f', border: '1px solid #9a5b1f', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <IconWand size={12} stroke={2} />{t('Corregir')}
                </button>
              )}
            </div>
          ))}
        </div>
      </Block>

      <Block>
        <ST>{t('Exportar')}</ST>
        <div style={{ display: 'grid', gap: 8 }}>
          <button onClick={() => runExport(() => exportLaserSVG(s, m))} style={{ ...btnSt, padding: '9px 0', border: '1px solid #9a5b1f', fontSize: 13, fontWeight: 700, color: '#9a5b1f' }}>{t('Exportar SVG para láser')}</button>
          <button onClick={() => runExport(() => exportPDF(s, m, s.pdfMode))} style={{ ...btnSt, padding: '9px 0' }}>{t('Exportar PDF 1:1')}</button>
        </div>
        <div style={{ marginTop: 10, fontSize: 10.5, lineHeight: 1.6, color: '#8a8071' }}>{t('El SVG incluye capas separadas de corte y pliegue, a escala real y en milímetros. El PDF conserva sangrado y tintas directas para imprenta.')}</div>
      </Block>
    </div>
  </>);
}
