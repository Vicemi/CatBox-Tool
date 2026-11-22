// Unidades del taller: la geometría interna SIEMPRE trabaja en milímetros (mm).
// La interfaz principal muestra centímetros (cm) para medidas de caja y capas;
// espesores, kerf, sangrado y letra se muestran en mm por ser medidas de máquina.

export const MM_PER_CM = 10;

export const mmToCm = mm => Math.round((Number(mm) || 0) / 0.1) / 100;
export const cmToMm = cm => Math.round((Number(cm) || 0) * 10 * 100) / 100;

export const round1 = v => Math.round((Number(v) || 0) * 10) / 10;
export const round2 = v => Math.round((Number(v) || 0) * 100) / 100;

// Texto corto para paneles/estadísticas: 8 cm · 8,5 cm · 12,25 cm
export function fmtCm(mm, decimals = 2) {
  const v = (Number(mm) || 0) / MM_PER_CM;
  const d = v >= 100 ? 1 : decimals;
  return v.toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace('.', ',') + ' cm';
}

export function fmtMm(mm, decimals = 2) {
  const v = Number(mm) || 0;
  return v.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace('.', ',') + ' mm';
}

// Entrada numérica en cm → mm. Acepta coma decimal española.
export function parseCm(text) {
  const n = parseFloat(String(text).replace(',', '.'));
  return Number.isFinite(n) ? cmToMm(n) : NaN;
}

export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// Tamaños de plancha (mm, vertical). kind: 'print' imprenta · 'laser' cama láser · 'any'.
const std = (id, name, w, h, kind = 'print') => ({ id, name: name + ' · ' + w + ' × ' + h + ' mm', w, h, kind });
export const SHEETS = [
  { id: 'tight', name: 'Ajustado al contorno', w: 0, h: 0, kind: 'any' },
  std('a4', 'A4', 210, 297, 'any'),
  std('a3', 'A3', 297, 420, 'any'),
  std('a2', 'A2', 420, 594),
  std('a1', 'A1', 594, 841),
  std('a0', 'A0', 841, 1189),
  std('a5', 'A5', 148, 210),
  std('a6', 'A6', 105, 148),
  std('sra4', 'SRA4', 225, 320),
  std('sra3', 'SRA3', 320, 450),
  std('letter', 'Letter', 216, 279),
  std('legal', 'Legal', 216, 356),
  std('tabloid', 'Tabloid', 279, 432),
  { id: 'laser600', name: 'Cama láser · 600 × 400 mm', w: 600, h: 400, kind: 'laser' },
  { id: 'laser900', name: 'Cama láser · 900 × 600 mm', w: 900, h: 600, kind: 'laser' },
  { id: 'laser1000', name: 'Cama láser · 1000 × 600 mm', w: 1000, h: 600, kind: 'laser' },
  { id: 'custom', name: 'Personalizada…', w: 0, h: 0, kind: 'any' }
];

export function sheetOf(id) { return SHEETS.find(s => s.id === id) || SHEETS.find(s => s.id === 'a4'); }
