// i18n mínimo: la clave es el texto en español; si falta la traducción se muestra el español.
// Cada área de la app tiene su archivo en locales/ para que se pueda editar sin conflictos.
import { store, useStore } from '../state/store.js';
import core from './locales/core.js';
import structure from './locales/structure.js';
import designer from './locales/designer.js';
import design from './locales/design.js';
import three from './locales/three.js';
import output from './locales/output.js';
import editor from './locales/editor.js';
import ai from './locales/ai.js';

const DICTS = [core, structure, designer, design, three, output, editor, ai];
export const LANGS = [['es', 'Español'], ['en', 'English'], ['zh', '中文']];

export function tr(lang, key, vars) {
  let out = key;
  if (lang !== 'es') for (const d of DICTS) { const v = d[lang] && d[lang][key]; if (v) { out = v; break; } }
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : out;
}
export const t = (key, vars) => tr(store.get().lang, key, vars);
export function useT() { const s = useStore(); return (key, vars) => tr(s.lang, key, vars); }
export function setLang(lang) {
  try { localStorage.setItem('catbox.lang', lang); } catch (_) { /* almacenamiento no disponible */ }
  document.documentElement.lang = lang;
  store.set({ lang });
}
