// Estado de interfaz del diseñador (herramienta, selección múltiple, portapapeles). Vive aparte de store.js:
// no es parte del proyecto ni del historial. `store.sel` sigue siendo la capa primaria.
import { useSyncExternalStore } from 'react';
import { store } from '../state/store.js';

let ds = { tool: 'move', shape: 'rect', sels: [], primary: null, face: null, color: null, clip: [], pasteN: 0, space: false };
const ls = new Set();
export const dstore = {
  get: () => ds,
  set(p) { ds = { ...ds, ...(typeof p === 'function' ? p(ds) : p) }; ls.forEach(f => f()); },
  subscribe: f => { ls.add(f); return () => ls.delete(f); }
};
export const useD = () => useSyncExternalStore(dstore.subscribe, dstore.get);

// Ids seleccionados que siguen existiendo; si store.sel cambió desde fuera (lista, undo) la selección es solo esa capa.
export function selIdsOf(s, d) {
  if (s.sel == null) return [];
  const ex = new Set(s.layers.map(l => l.id));
  if (d.primary === s.sel) { const ids = d.sels.filter(id => ex.has(id)); if (ids.includes(s.sel)) return ids; }
  return ex.has(s.sel) ? [s.sel] : [];
}
export function setSel(ids) {
  const p = ids.length ? ids[ids.length - 1] : null;
  dstore.set({ sels: ids, primary: p });
  store.set({ sel: p });
}
export const setTool = tool => dstore.set({ tool });
