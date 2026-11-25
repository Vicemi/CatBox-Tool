// Operaciones de capas del diseñador. Todo es inmutable y pasa por store.set (→ historial deshacer/rehacer).
import { store } from '../state/store.js';
import { dstore, setSel } from './ui.js';
import { bboxOf, rotBBox, clipMaskOf } from './layers.js';
import { polyCentroid, edgeRotation } from './faces.js';
import { bboxOfPts, containerOfLayer, containerAt } from './containers.js';
import { compactGroups } from './groups.js';

export const mapLayers = (ids, fn) => store.set(st => ({ layers: st.layers.map(l => ids.includes(l.id) ? { ...fn(l), heroPreset: undefined } : l) }));
export const patchLayers = (ids, patch) => mapLayers(ids, l => ({ ...l, ...patch }));
export const moveBy = (ids, dx, dy) => mapLayers(ids, l => l.locked ? l : { ...l, x: l.x + dx, y: l.y + dy });
export const flipLayers = (ids, axis) => mapLayers(ids, l => ({ ...l, [axis === 'x' ? 'flipX' : 'flipY']: !l[axis === 'x' ? 'flipX' : 'flipY'] }));

const addClones = (src, off) => {
  const st = store.get();
  const added = src.map((l, i) => ({ ...l, id: st.seq + i, x: l.x + off, y: l.y + off, locked: false, visible: true, heroPreset: undefined }));
  store.set({ layers: compactGroups(st.layers.concat(added)), seq: st.seq + added.length });
  setSel(added.map(l => l.id));
};
export const dupLayers = (ids, off = 2) => { const src = store.get().layers.filter(l => ids.includes(l.id)); if (src.length) addClones(src, off); };
export const delLayers = ids => { if (!ids.length) return; store.set(st => { const ls = st.layers.filter(l => !ids.includes(l.id)); return { layers: ls, groups: (st.groups || []).filter(g => ls.some(l => l.groupId === g.id)) }; }); setSel([]); };
export const copyLayers = ids => { const src = store.get().layers.filter(l => ids.includes(l.id)); if (src.length) dstore.set({ clip: src.map(l => ({ ...l })), pasteN: 0 }); };
export function pasteLayers() {
  const d = dstore.get(); if (!d.clip.length) return;
  dstore.set({ pasteN: d.pasteN + 1 });
  addClones(d.clip, 3 * (d.pasteN + 1));
}

// how: front | back | up | down (varias capas a la vez, conservando su orden relativo)
export function reorder(ids, how) {
  store.set(st => {
    let ls = st.layers.slice();
    const on = l => ids.includes(l.id), sel = ls.filter(on);
    if (!sel.length) return null;
    if (how === 'front') ls = ls.filter(l => !on(l)).concat(sel);
    else if (how === 'back') ls = sel.concat(ls.filter(l => !on(l)));
    else if (how === 'up') { for (let i = ls.length - 2; i >= 0; i--) if (on(ls[i]) && !on(ls[i + 1])) [ls[i], ls[i + 1]] = [ls[i + 1], ls[i]]; }
    else { for (let i = 1; i < ls.length; i++) if (on(ls[i]) && !on(ls[i - 1])) [ls[i], ls[i - 1]] = [ls[i - 1], ls[i]]; }
    return { layers: compactGroups(ls) };
  });
}
// Arrastrar en la lista: coloca `id` justo encima (above) o debajo de `targetId` en la pila visual.
export function placeLayer(id, targetId, above) {
  store.set(st => {
    const l = st.layers.find(x => x.id === id); if (!l || id === targetId) return null;
    const rest = st.layers.filter(x => x.id !== id), ti = rest.findIndex(x => x.id === targetId); if (ti < 0) return null;
    rest.splice(ti + (above ? 1 : 0), 0, l);
    return { layers: rest };
  });
}

// Tras alinear/distribuir, una capa cuyo centro cae en otra cara pasa a esa cara (como al arrastrar).
const rebind = (ids, g) => store.set(st => ({ layers: st.layers.map(l => {
  if (!ids.includes(l.id)) return l;
  const b = bboxOf(l), hit = containerAt(g, [b[0] + b[2] / 2, b[1] + b[3] / 2]);
  return hit && hit.panelId !== l.panelId ? { ...l, panelId: hit.panelId } : l;
}) }));

// mode: l | cx | r | t | cy | b. rel 'sel' = respecto a la caja de la selección; 'face' = cada capa respecto a su cara (margen de 3 mm en los bordes).
export function alignLayers(ids, mode, rel, g) {
  const ls = store.get().layers.filter(l => ids.includes(l.id) && !l.locked); if (!ls.length) return;
  let ub = null;
  if (rel === 'sel' && ls.length > 1) {
    ub = ls.map(rotBBox).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[0] + b[2]), Math.max(a[3], b[1] + b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  }
  const d = {};
  ls.forEach(l => {
    const b = rotBBox(l); let pb = ub, m = 0;
    let p0 = null; if (!pb) { const p = p0 = containerOfLayer(g, l); pb = p ? bboxOfPts(p.pts) : g.sbb; m = Math.min(3, (pb[2] - pb[0]) / 4, (pb[3] - pb[1]) / 4); }
    // centrar «en la cara» = centroide del contorno (en un triángulo no coincide con el centro de la caja)
    const fc = !ub && p0 ? polyCentroid(p0.pts) : [(pb[0] + pb[2]) / 2, (pb[1] + pb[3]) / 2];
    let dx = 0, dy = 0;
    if (mode === 'l') dx = pb[0] + m - b[0]; else if (mode === 'cx') dx = fc[0] - (b[0] + b[2] / 2); else if (mode === 'r') dx = pb[2] - m - (b[0] + b[2]);
    if (mode === 't') dy = pb[1] + m - b[1]; else if (mode === 'cy') dy = fc[1] - (b[1] + b[3] / 2); else if (mode === 'b') dy = pb[3] - m - (b[1] + b[3]);
    d[l.id] = [dx, dy];
  });
  mapLayers(ls.map(l => l.id), l => ({ ...l, x: l.x + d[l.id][0], y: l.y + d[l.id][1] }));
  if (ub) rebind(ls.map(l => l.id), g);
}

// Distribuye con huecos iguales entre capas (≥3) a lo largo de 'x' o 'y'.
export function distributeLayers(ids, axis, g) {
  const ls = store.get().layers.filter(l => ids.includes(l.id) && !l.locked); if (ls.length < 3) return;
  const i0 = axis === 'x' ? 0 : 1, i2 = axis === 'x' ? 2 : 3;
  const items = ls.map(l => ({ l, b: rotBBox(l) })).sort((a, b) => a.b[i0] - b.b[i0]);
  const first = items[0].b[i0], last = Math.max(...items.map(i => i.b[i0] + i.b[i2]));
  const gap = (last - first - items.reduce((a, i) => a + i.b[i2], 0)) / (items.length - 1), d = {};
  let pos = first;
  items.forEach(i => { d[i.l.id] = pos - i.b[i0]; pos += i.b[i2] + gap; });
  mapLayers(ls.map(l => l.id), l => axis === 'x' ? { ...l, x: l.x + d[l.id] } : { ...l, y: l.y + d[l.id] });
  if (g) rebind(ls.map(l => l.id), g);
}

// Gira cada capa para que quede paralela al borde más cercano de su cara.
export function alignToEdge(ids, g) {
  mapLayers(ids, l => {
    if (l.locked) return l;
    const p = containerOfLayer(g, l), b = bboxOf(l); if (!p) return l;
    return { ...l, rot: edgeRotation(p.pts, [b[0] + b[2] / 2, b[1] + b[3] / 2]) };
  });
}

// Recorta una capa con la forma de la capa inmediatamente inferior de su misma cara (clipBase = id de esa capa); sin base, la libera.
export function setClipBelow(id, g, on) {
  store.set(st => {
    const i = st.layers.findIndex(l => l.id === id); if (i < 0) return null;
    const me = st.layers[i];
    if (!on) return { layers: st.layers.map(l => l.id === id ? { ...l, clipMask: undefined, clipBase: undefined } : l) };
    const pid = (containerOfLayer(g, me) || {}).panelId;
    let base = null; for (let j = i - 1; j >= 0 && !base; j--) { const c = st.layers[j]; if (c.visible && c.kind !== 'text' && !(c.kind === 'shape' && c.shape === 'line') && (containerOfLayer(g, c) || {}).panelId === pid) base = c; }
    if (!base) return null;
    return { layers: st.layers.map(l => l.id === id ? { ...l, clipMask: clipMaskOf(base), clipBase: base.id } : l) };
  });
}

// Transformación de grupo: escala (sx, sy) respecto a (px, py) y giro dr° alrededor del mismo punto, a partir de las capas originales.
// Las capas giradas ≠ 0/90° se escalan de forma uniforme para no deformarse.
export function xformLayers(orig, px, py, sx, sy, dr) {
  const a = dr * Math.PI / 180, co = Math.cos(a), si = Math.sin(a), out = {};
  orig.forEach(l => {
    if (l.locked) return;
    const b = bboxOf(l), cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
    const vx = (cx - px) * sx, vy = (cy - py) * sy, ncx = px + vx * co - vy * si, ncy = py + vx * si + vy * co;
    const rot = ((((l.rot || 0) + dr) % 360) + 360) % 360, q = ((l.rot || 0) % 180 + 180) % 180, uni = Math.sqrt(Math.abs(sx * sy));
    const fx = q < 0.01 ? sx : Math.abs(q - 90) < 0.01 ? sy : uni, fy = q < 0.01 ? sy : Math.abs(q - 90) < 0.01 ? sx : uni;
    if (l.kind === 'text') {
      const nl = { ...l, size: Math.min(120, Math.max(1.5, l.size * uni)), rot, heroPreset: undefined }, nb = bboxOf(nl);
      out[l.id] = { ...nl, x: nl.x + (ncx - (nb[0] + nb[2] / 2)), y: nl.y + (ncy - (nb[1] + nb[3] / 2)) };
    } else {
      const w = Math.max(0.5, l.w * Math.abs(fx)), h = Math.max(l.shape === 'line' ? 0.1 : 0.5, l.h * Math.abs(fy));
      out[l.id] = { ...l, w, h, x: ncx - w / 2, y: ncy - h / 2, rot, heroPreset: undefined };
    }
  });
  return out;
}
