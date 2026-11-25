// Grupos de capas (carpetas de un nivel). store.layers sigue siendo una lista plana; cada capa lleva groupId y store.groups guarda
// {id, name, collapsed, visible, locked, opacity}. Visibilidad, bloqueo y opacidad del grupo se propagan a los hijos (visible/locked/gOp)
// para que lienzo, horneado 3D y PDF —que solo ven capas sueltas— sigan idénticos. Los hijos ocultados/bloqueados por el grupo se recuerdan en hid/lck.
import { store } from '../state/store.js';
import { setSel } from './ui.js';

export const groupOf = (st, l) => (l && l.groupId != null && (st.groups || []).find(g => g.id === l.groupId)) || null;
export const membersOf = (layers, gid) => layers.filter(l => l.groupId === gid);
const nextId = gs => 'g' + (gs.reduce((a, g) => Math.max(a, parseInt(String(g.id).slice(1), 10) || 0), 0) + 1);
const pruneG = (gs, ls) => (gs || []).filter(g => ls.some(l => l.groupId === g.id));
// Aplica el estado del grupo a una capa que entra en él (o lo limpia si sale).
const adopt = (l, g) => g
  ? { ...l, groupId: g.id, gOp: g.opacity < 1 ? g.opacity : undefined, visible: g.visible ? l.visible : false, locked: g.locked ? true : l.locked }
  : { ...l, groupId: undefined, gOp: undefined };
// Cada grupo ocupa un bloque contiguo de la pila (en la posición de su hijo más alto).
export function compactGroups(ls) {
  const seen = new Set(), out = [];
  ls.forEach((l, i) => {
    if (l.groupId == null) { out.push(l); return; }
    const last = ls.reduce((a, x, j) => x.groupId === l.groupId ? j : a, -1);
    if (i !== last) return; // el bloque se emite en el hijo más alto
    if (!seen.has(l.groupId)) { seen.add(l.groupId); ls.forEach(x => { if (x.groupId === l.groupId) out.push(x); }); }
  });
  return out;
}

export function groupLayers(ids, name) {
  store.set(st => {
    const sel = st.layers.filter(l => ids.includes(l.id)); if (!sel.length) return null;
    const topIdx = st.layers.reduce((a, l, i) => ids.includes(l.id) ? i : a, -1);
    const g = { id: nextId(st.groups || []), name, collapsed: false, visible: true, locked: false, opacity: 1 };
    const rest = st.layers.filter(l => !ids.includes(l.id)), at = topIdx - (sel.length - 1);
    rest.splice(at, 0, ...sel.map(l => ({ ...adopt(l, g), visible: l.visible, locked: l.locked })));
    return { layers: rest, groups: pruneG((st.groups || []).concat([g]), rest) };
  });
}
// Disuelve los grupos de las capas indicadas (los hijos conservan su orden y estado).
export function ungroupLayers(ids) {
  store.set(st => {
    const gids = new Set(st.layers.filter(l => ids.includes(l.id) && l.groupId != null).map(l => l.groupId)); if (!gids.size) return null;
    const ls = st.layers.map(l => gids.has(l.groupId) ? adopt(l, null) : l);
    return { layers: ls, groups: pruneG(st.groups, ls) };
  });
}
export const patchGroup = (gid, patch) => store.set(st => ({ groups: st.groups.map(g => g.id === gid ? { ...g, ...patch } : g) }));
export const toggleCollapsed = gid => store.set(st => ({ groups: st.groups.map(g => g.id === gid ? { ...g, collapsed: !g.collapsed } : g) }));

export function setGroupVisible(gid, on) {
  store.set(st => {
    const g = st.groups.find(x => x.id === gid); if (!g || g.visible === on) return null;
    const mem = membersOf(st.layers, gid);
    const hid = on ? undefined : mem.filter(l => l.visible).map(l => l.id), back = on ? new Set(g.hid || mem.map(l => l.id)) : null;
    return {
      groups: st.groups.map(x => x.id === gid ? { ...x, visible: on, hid } : x),
      layers: st.layers.map(l => l.groupId !== gid ? l : { ...l, visible: on ? (back.has(l.id) ? true : l.visible) : false })
    };
  });
}
export function setGroupLocked(gid, on) {
  store.set(st => {
    const g = st.groups.find(x => x.id === gid); if (!g || g.locked === on) return null;
    const mem = membersOf(st.layers, gid);
    const lck = on ? mem.filter(l => !l.locked).map(l => l.id) : undefined, back = on ? null : new Set(g.lck || mem.map(l => l.id));
    return {
      groups: st.groups.map(x => x.id === gid ? { ...x, locked: on, lck } : x),
      layers: st.layers.map(l => l.groupId !== gid ? l : { ...l, locked: on ? true : back.has(l.id) ? false : l.locked })
    };
  });
}
export function setGroupOpacity(gid, v) {
  store.set(st => ({
    groups: st.groups.map(g => g.id === gid ? { ...g, opacity: v } : g),
    layers: st.layers.map(l => l.groupId === gid ? { ...l, gOp: v < 1 ? v : undefined } : l)
  }));
}
export const selectGroup = gid => setSel(membersOf(store.get().layers, gid).map(l => l.id));
// Si la selección es exactamente un grupo entero (en canvas o desde la fila del grupo), devuelve ese grupo.
export function groupOfSelection(st, ids) {
  if (!ids.length) return null;
  const gid = (st.layers.find(l => l.id === ids[0]) || {}).groupId; if (gid == null) return null;
  const mem = membersOf(st.layers, gid);
  return mem.length === ids.length && mem.every(l => ids.includes(l.id)) ? (st.groups.find(g => g.id === gid) || null) : null;
}

// Arrastrar en la lista. dragKey/targetKey: id de capa (número) o 'G:' + id de grupo. above = encima en la pila visual.
// Capa sobre capa: hereda el grupo del destino (entra/sale); capa sobre cabecera: arriba = fuera, abajo = dentro; grupo: se mueve como bloque.
export function dropItem(dragKey, targetKey, above) {
  store.set(st => {
    const isG = k => typeof k === 'string' && k.startsWith('G:'), gid = k => String(k).slice(2);
    if (dragKey === targetKey) return null;
    const dragG = isG(dragKey) ? st.groups.find(g => g.id === gid(dragKey)) : null;
    const moving = dragG ? membersOf(st.layers, dragG.id) : st.layers.filter(l => l.id === dragKey);
    if (!moving.length) return null;
    const rest = st.layers.filter(l => !moving.includes(l));
    const tl = isG(targetKey) ? null : rest.find(l => l.id === targetKey), tgid = isG(targetKey) ? gid(targetKey) : tl && tl.groupId;
    if (dragG && tgid === dragG.id) return null;
    const blockIdx = tgid != null ? rest.map((l, i) => l.groupId === tgid ? i : -1).filter(i => i >= 0) : tl ? [rest.indexOf(tl)] : [];
    if (!blockIdx.length) return null;
    const hi = Math.max(...blockIdx), lo = Math.min(...blockIdx);
    let at, add;
    if (dragG) { at = above ? hi + 1 : lo; add = moving; }
    else if (isG(targetKey)) { const g = st.groups.find(x => x.id === tgid); at = hi + 1; add = [adopt(moving[0], above ? null : g)]; }
    else { const g = tgid != null ? st.groups.find(x => x.id === tgid) : null; at = rest.indexOf(tl) + (above ? 1 : 0); add = [adopt(moving[0], g)]; }
    rest.splice(at, 0, ...add);
    return { layers: rest, groups: pruneG(st.groups, rest) };
  });
}
