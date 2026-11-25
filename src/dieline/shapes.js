// Siluetas compartidas entre el plano 2D y la malla 3D.
// Coordenadas locales de una cara: x = 0..w a lo largo de la bisagra, y = 0..h hacia fuera.
// La bisagra siempre vive en y = 0 para que el plegado 3D y el troquel 2D coincidan.

const EPS = 1e-6;

function arc(cx, cy, r, a0, a1, n = 6) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

const add = (arr, pts) => { for (const p of pts) arr.push(p); };

export function wrapFlapInfo(w, h, tab) {
  w = Math.max(1, w); h = Math.max(1, h);
  const t = Math.max(3, Math.min(tab == null ? Math.min(14, h * 0.32) : tab, h * 0.6));
  return {
    tab: t,
    bodyH: h - t,
    inset: Math.min(6, w * 0.04),
    gap: Math.min(8, w * 0.06),
    ch: Math.min(4, t * 0.42)
  };
}

function roundedRect(w, h, rbl, rbr, rtr, rtl) {
  const p = [];
  p.push([0, rbl > 0 ? rbl : 0]);
  if (rbr > 0) { p.push([w - rbr, 0]); add(p, arc(w - rbr, rbr, rbr, -Math.PI / 2, 0)); }
  else p.push([w, 0]);
  if (rtr > 0) { p.push([w, h - rtr]); add(p, arc(w - rtr, h - rtr, rtr, 0, Math.PI / 2)); }
  else p.push([w, h]);
  if (rtl > 0) { p.push([rtl, h]); add(p, arc(rtl, h - rtl, rtl, Math.PI / 2, Math.PI)); }
  else p.push([0, h]);
  if (rbl > 0) { p.push([0, rbl]); add(p, arc(rbl, rbl, rbl, Math.PI, Math.PI * 1.5)); }
  else p.push([0, 0]);
  return p;
}

function chamferRect(w, h, cbl, cbr, ctr, ctl) {
  const p = [];
  p.push([0, cbl > 0 ? cbl : 0]);
  if (cbr > 0) { p.push([w - cbr, 0]); p.push([w, cbr]); } else p.push([w, 0]);
  if (ctr > 0) { p.push([w, h - ctr]); p.push([w - ctr, h]); } else p.push([w, h]);
  if (ctl > 0) { p.push([ctl, h]); p.push([0, h - ctl]); } else p.push([0, h]);
  if (cbl > 0) p.push([0, cbl]); else p.push([0, 0]);
  return p;
}

/**
 * Devuelve la silueta local de una cara o solapa.
 * @param {string} kind rect | round | chamfer | arch | taper | tuck | dust | ear | glue | lid
 * @param {number} w ancho de la bisagra
 * @param {number} h profundidad hacia fuera
 * @param {{corner?:number, hinge?:boolean, arch?:number}} opt
 */
export function shapePoints(kind, w, h, opt = {}) {
  const pts = baseShape(kind, w, h, opt);
  const tl = Math.tan(Math.min(85, Math.max(0, opt.mL || 0)) * Math.PI / 180);
  const tr = Math.tan(Math.min(85, Math.max(0, opt.mR || 0)) * Math.PI / 180);
  if (!opt.hinge || (!tl && !tr)) return pts;
  // Inglete: recorta los extremos de la solapa siguiendo la bisectriz de la esquina de la madre,
  // así dos solapas en lados vecinos (p. ej. de un triángulo) no se pisan en el plano.
  const W = Math.max(0.1, Number(w) || 0.1);
  let out = clipHalf(pts, p => p[0] - p[1] * tl);
  out = clipHalf(out, p => W - p[1] * tr - p[0]);
  out = out.filter((p, i) => { const q = out[(i + 1) % out.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4; });
  return out.length >= 3 ? out : pts;
}

// Sutherland–Hodgman contra un semiplano f(p) >= 0 (f lineal).
function clipHalf(pts, f) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], fa = f(a), fb = f(b);
    if (fa >= -EPS) out.push(a);
    if ((fa >= -EPS) !== (fb >= -EPS)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

function baseShape(kind, w, h, opt) {
  w = Math.max(0.1, Number(w) || 0.1);
  h = Math.max(0.1, Number(h) || 0.1);
  const hinge = !!opt.hinge;
  const maxR = Math.min(w / 2, h / 2);
  const corner = Math.max(0, Math.min(opt.corner == null ? Math.min(4, maxR) : opt.corner, maxR));
  const k = kind || 'rect';

  if (k === 'poly' && Array.isArray(opt.pts) && opt.pts.length >= 3) {
    // Free polygon in panel-local mm (hinge from [0,0] to [w,0] for child panels).
    return opt.pts.map(p => [+p[0], +p[1]]);
  }

  if (k === 'round') {
    const rbl = hinge ? 0 : corner;
    return roundedRect(w, h, rbl, rbl, corner, corner);
  }
  if (k === 'chamfer') {
    const cbl = hinge ? 0 : corner;
    return chamferRect(w, h, cbl, cbl, corner, corner);
  }
  if (k === 'arch') {
    const hs = Math.max(0.5, h - Math.min(w * 0.5, h * 0.55, opt.arch == null ? h * 0.35 : opt.arch));
    const p = [[0, 0], [w, 0], [w, hs]];
    const n = 14;
    for (let i = 1; i <= n; i++) {
      const a = (Math.PI * i) / n;
      p.push([w / 2 + (w / 2) * Math.cos(a), hs + (h - hs) * Math.sin(a)]);
    }
    p.push([0, 0]);
    return p;
  }
  if (k === 'taper') {
    const inset = Math.max(0, Math.min(corner, w / 2 - 0.1));
    return [[0, 0], [w, 0], [w - inset, h], [inset, h]];
  }
  if (k === 'wrap-flap') {
    const q = wrapFlapInfo(w, h, opt.corner);
    const b = q.bodyH, i = q.inset, g = q.gap, ch = q.ch;
    const bc = Math.min(3, i, b * 0.2);
    const half = w / 2;
    return [
      [0, 0],
      [0, b - bc], [bc, b],
      [i, b],
      [i, h - ch], [i + ch, h],
      [half - g / 2 - ch, h], [half - g / 2, h - ch], [half - g / 2, b],
      [half + g / 2, b],
      [half + g / 2, h - ch], [half + g / 2 + ch, h],
      [w - i - ch, h], [w - i, h - ch], [w - i, b],
      [w - bc, b], [w, b - bc],
      [w, 0]
    ];
  }
  if (k === 'side-tab') {
    const ch = Math.min(corner || 3, w / 4, h / 4);
    return [[0, 0], [w, 0], [w, h - ch], [w - ch, h], [ch, h], [0, h - ch]];
  }
  if (k === 'triangle') {
    return [[0, 0], [w, 0], [w / 2, h]];
  }
  if (k === 'rttri') {
    // Triángulo rectángulo con el ángulo recto en el extremo izquierdo de la bisagra.
    // Se usa en la caja-rebanada: la tapa y la base comparten la misma silueta.
    return [[0, 0], [w, 0], [0, h]];
  }
  if (k === 'mushroom') {
    // Pestaña de encaje tipo seta: cuello estrecho + cabeza ancha.
    // Entra por una ranura de 0,8 mm y queda retenida al girar la pestaña.
    return [
      [0, 0], [w, 0],
      [w * 0.72, h * 0.36], [w * 0.72, h * 0.50],
      [w * 0.98, h * 0.57], [w * 0.98, h * 0.82],
      [w * 0.86, h * 0.95], [w * 0.72, h],
      [w * 0.28, h], [w * 0.14, h * 0.95],
      [w * 0.02, h * 0.82], [w * 0.02, h * 0.57],
      [w * 0.28, h * 0.50], [w * 0.28, h * 0.36]
    ];
  }
  if (k === 'notch') {
    const n = Math.max(2, Math.min(w * 0.22, 30));
    return [[0, 0], [w, 0], [w, h], [w / 2 + n, h], [w / 2, h * 0.58], [w / 2 - n, h], [0, h]];
  }
  if (k === 'wave') {
    const p = [[0, 0], [w, 0], [w, h * 0.82]];
    const n = 18;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      p.push([w * (1 - t), h * 0.82 + (h * 0.18) * (0.5 + 0.5 * Math.cos(t * Math.PI * 3))]);
    }
    p.push([0, 0]);
    return p;
  }
  if (k === 'tuck') {
    const sh = Math.min(5, w * 0.12);
    const rr = Math.min(3.5, h * 0.4);
    return [
      [1, 0], [sh, Math.min(2, h * 0.2)],
      [sh, h - rr], [sh + rr * 0.35, h - rr * 0.12], [sh + rr, h],
      [w - sh - rr, h], [w - sh - rr * 0.35, h - rr * 0.12], [w - sh, h - rr],
      [w - sh, Math.min(2, h * 0.2)], [w - 1, 0]
    ];
  }
  if (k === 'dust') {
    const i = Math.min(6, w * 0.12);
    const d5 = Math.min(5, h * 0.32);
    return [
      [i * 0.25, 0], [i * 0.6, h - d5], [i * 1.5, h],
      [w - i * 1.5, h], [w - i * 0.6, d5], [w - i * 0.25, 0]
    ];
  }
  if (k === 'ear') {
    const rr = Math.min(6, h * 0.4);
    return [[0.5, 0], [w - 0.5, 0], [w - 0.5, h - rr], [w - 0.5 - rr, h], [2, h], [0.5, h - 2]];
  }
  if (k === 'glue') {
    const inset = Math.min(5, w * 0.2);
    return [[0, 0], [w, 0], [w - inset, h], [inset, h]];
  }
  if (k === 'disc') {
    const N = Math.max(3, Math.round(opt.n || 24));
    const a = w / (2 * Math.tan(Math.PI / N));
    const Rp = w / (2 * Math.sin(Math.PI / N));
    const cx = w / 2, cy = a;
    const base = Math.atan2(-a, -w / 2);
    const p = [];
    for (let i = 0; i < N; i++) p.push([cx + Rp * Math.cos(base + i * 2 * Math.PI / N), cy + Rp * Math.sin(base + i * 2 * Math.PI / N)]);
    return p;
  }
  if (k === 'lid') return [[0, 0], [w, 0], [w, h], [0, h]];
  return [[0, 0], [w, 0], [w, h], [0, h]];
}

export function shapeIsRect(kind) {
  return !kind || kind === 'rect' || kind === 'lid';
}

export const SHAPE_OPTIONS = [
  { id: 'rect', name: 'Recta' },
  { id: 'round', name: 'Esquinas redondeadas' },
  { id: 'chamfer', name: 'Esquinas achaflanadas' },
  { id: 'arch', name: 'Arco superior' },
  { id: 'taper', name: 'Estrechada arriba' },
  { id: 'triangle', name: 'Triángulo' },
  { id: 'rttri', name: 'Triángulo rectángulo' },
  { id: 'mushroom', name: 'Pestaña de encaje (seta)' },
  { id: 'notch', name: 'Muesca central' },
  { id: 'wave', name: 'Borde ondulado' },
  { id: 'side-tab', name: 'Pestaña lateral' }
];

// Selector de lengüetas: id de silueta + profundidad por defecto al crear una hija con ella.
export const FLAP_SHAPES = [
  { id: 'rect', name: 'Recta', h: 20 },
  { id: 'tuck', name: 'Lengüeta', h: 16 },
  { id: 'dust', name: 'Guardapolvo', h: 14 },
  { id: 'glue', name: 'Pegado', h: 14 },
  { id: 'ear', name: 'Pestaña de esquina', h: 16 },
  { id: 'side-tab', name: 'Pestaña lateral', h: 30 },
  { id: 'wrap-flap', name: 'Solapa envolvente', h: 60 },
  { id: 'chamfer', name: 'Achaflanada', h: 20 },
  { id: 'round', name: 'Redondeada', h: 20 },
  { id: 'arch', name: 'Arco', h: 24 },
  { id: 'taper', name: 'Estrechada', h: 20 },
  { id: 'triangle', name: 'Triángulo', h: 20 },
  { id: 'rttri', name: 'Triángulo rectángulo', h: 20 },
  { id: 'mushroom', name: 'Pestaña de encaje (seta)', h: 18 },
  { id: 'notch', name: 'Muesca', h: 20 },
  { id: 'wave', name: 'Ondulada', h: 20 },
  { id: 'lid', name: 'Tapa recta', h: 40 }
];

// Trazo SVG de la silueta con la bisagra abajo (y de SVG hacia abajo), para las miniaturas del selector.
export function shapePath(id, w = 44, h = 26) {
  const corner = id === 'round' || id === 'chamfer' ? 6 : undefined;
  const pts = shapePoints(id, w, h, { corner, hinge: true });
  return 'M' + pts.map(p => p[0].toFixed(1) + ' ' + (h - p[1]).toFixed(1)).join('L') + 'Z';
}
