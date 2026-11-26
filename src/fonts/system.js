// Fuentes disponibles para el diseño: las de la app + las instaladas en el sistema.
// Escritorio (Tauri): el comando `list_system_fonts` lee las carpetas de fuentes del SO. Navegador: Local Font Access
// API (`queryLocalFonts`, Chromium; pide permiso y necesita un gesto del usuario). Las fuentes del sistema se dibujan
// por su nombre (CSS y canvas), no hace falta cargarlas.
import { FONTS } from '../design/layers.js';

const isDesktop = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
let systemPromise = null;

/** Familias del sistema (ordenadas, sin duplicados). Se consulta una vez por sesión. */
export function systemFonts() {
  if (systemPromise) return systemPromise;
  systemPromise = (async () => {
    try {
      if (isDesktop()) {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke('list_system_fonts');
      }
      if (typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function') {
        const fonts = await window.queryLocalFonts();
        return [...new Set(fonts.map(f => f.family))].sort((a, b) => a.localeCompare(b));
      }
    } catch (_) { systemPromise = null; /* permiso denegado o sin gesto: se puede reintentar */ }
    return [];
  })();
  return systemPromise;
}

/** true si el navegador puede listar fuentes (en escritorio siempre). */
export const canListSystemFonts = () => isDesktop() || (typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function');

export const APP_FONTS = FONTS;

const RECENT_KEY = 'catbox.recentFonts';
export function recentFonts() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 8) : []; }
  catch (_) { return []; }
}
export function pushRecentFont(f) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([f, ...recentFonts().filter(x => x !== f)].slice(0, 8))); } catch (_) { /* sin almacenamiento */ }
}

/** Valor CSS seguro para una familia con nombre libre (comillas escapadas) y fallback genérico. */
export const fontStack = f => "'" + String(f || 'Noto Sans').replace(/['\\]/g, '') + "', sans-serif";
