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
  if (kind === 'poly' && Array.isArray(opt.pts) && opt.pts.length >= 3 && (opt.R || opt.B)) return polyOutline(opt.pts, opt).pts;
  const pts = mitred(baseShape(kind, w, h, opt), w, opt);
  // Esquinas libres redondeadas por lado (rL a la izquierda de la bisagra, rR a la derecha); la bisagra no se toca.
  return (opt.rL > 0 || opt.rR > 0) ? filletCorners(pts, w, opt.rL || 0, opt.rR || 0, !!opt.hinge) : pts;
}

/**
 * Contorno de una cara de forma libre con radio por vértice (opt.R[i]) y curva por lado (opt.B[i] = flecha en mm,
 * + hacia fuera, − hacia dentro). Devuelve { pts, seg } donde seg[k] es el lado lógico (índice de opt.pts) del tramo
 * que empieza en pts[k]: así los tipos de línea y las uniones siguen al lado aunque se muestree en curva.
 * En una hija (opt.hinge) la bisagra (y = 0) no se curva ni se redondea; opt.lockV = vértices que no se redondean.
 */
export function polyOutline(P, opt = {}) {
  const n = P.length, R = opt.R || [], B = opt.B || [], lock = opt.lockV || new Set();
  let area = 0; for (let i = 0; i < n; i++) { const q = P[(i + 1) % n]; area += P[i][0] * q[1] - q[0] * P[i][1]; }
  const isHinge = i => opt.hinge && Math.abs(P[i][1]) < 1e-6 && Math.abs(P[(i + 1) % n][1]) < 1e-6;
  const bulge = i => (isHinge(i) ? 0 : +B[i] || 0);
  // Esquinas: [punto de entrada, ...arco, punto de salida] (o el vértice solo).
  const corner = P.map((p, i) => {
    const r = +R[i] || 0, a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    const onHinge = opt.hinge && Math.abs(p[1]) < 1e-6;
    if (r <= 0 || onHinge || lock.has(i) || bulge((i - 1 + n) % n) || bulge(i)) return [p];
    const u1 = [a[0] - p[0], a[1] - p[1]], u2 = [b[0] - p[0], b[1] - p[1]], l1 = Math.hypot(...u1), l2 = Math.hypot(...u2);
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    if (l1 < 1e-6 || l2 < 1e-6 || Math.abs(cross) < 1e-9) return [p];
    const ang = Math.acos(Math.max(-1, Math.min(1, (u1[0] * u2[0] + u1[1] * u2[1]) / (l1 * l2))));
    const d = Math.min(r / Math.tan(ang / 2), l1 * 0.49, l2 * 0.49), rr = d * Math.tan(ang / 2);
    const t1 = [p[0] + u1[0] / l1 * d, p[1] + u1[1] / l1 * d], t2 = [p[0] + u2[0] / l2 * d, p[1] + u2[1] / l2 * d];
    const bis = [u1[0] / l1 + u2[0] / l2, u1[1] / l1 + u2[1] / l2], bl = Math.hypot(...bis) || 1;
    const c = [p[0] + bis[0] / bl * rr / Math.sin(ang / 2), p[1] + bis[1] / bl * rr / Math.sin(ang / 2)];
    const a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    let da = Math.atan2(t2[1] - c[1], t2[0] - c[0]) - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const N = Math.max(4, Math.min(16, Math.round(rr)));
    return Array.from({ length: N + 1 }, (_, k) => [c[0] + rr * Math.cos(a0 + da * k / N), c[1] + rr * Math.sin(a0 + da * k / N)]);
  });
  const pts = [], seg = [];
  for (let i = 0; i < n; i++) {
    const cIn = corner[i], s0 = cIn[cIn.length - 1], s1 = corner[(i + 1) % n][0];
    // El arco de la esquina pertenece al lado que sale de ella.
    for (let k = 0; k < cIn.length; k++) { pts.push(cIn[k]); seg.push(i); }
    const s = bulge(i);
    if (s) {
      const dx = s1[0] - s0[0], dy = s1[1] - s0[1], chord = Math.hypot(dx, dy);
      if (chord > 1e-6) {
        const nx = (area >= 0 ? dy : -dy) / chord, ny = (area >= 0 ? -dx : dx) / chord; // normal hacia fuera
        const sag = Math.max(-chord * 2, Math.min(chord * 2, s)), N = Math.max(8, Math.min(48, Math.round(chord / 2)));
        // Curva suave por s0 y s1 con flecha `sag` en el centro: parábola para curvas suaves, seno para muy abombadas.
        for (let k = 1; k < N; k++) {
          const t = k / N;
          const f = Math.abs(sag) < chord * 0.3 ? 4 * t * (1 - t) : Math.sin(Math.PI * t);
          pts.push([s0[0] + dx * t + nx * sag * f, s0[1] + dy * t + ny * sag * f]); seg.push(i);
        }
      }
    }
  }
  return { pts, seg };
}

// Redondea cada vértice convexo con el radio de su mitad (izquierda/derecha); en hijas se respetan los vértices de bisagra (y = 0).
function filletCorners(pts, w, rL, rR, hinge) {
  const n = pts.length; if (n < 3) return pts;
  let area = 0; for (let i = 0; i < n; i++) { const q = pts[(i + 1) % n]; area += pts[i][0] * q[1] - q[0] * pts[i][1]; }
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const r = p[0] < w / 2 ? rL : rR;
    const u1 = [a[0] - p[0], a[1] - p[1]], u2 = [b[0] - p[0], b[1] - p[1]];
    const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2);
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    const convex = (area >= 0 ? -cross : cross) > 1e-9;
    if (r <= 0 || (hinge && Math.abs(p[1]) < 1e-6) || !convex || l1 < 1e-6 || l2 < 1e-6) { out.push(p); continue; }
    const ang = Math.acos(Math.max(-1, Math.min(1, (u1[0] * u2[0] + u1[1] * u2[1]) / (l1 * l2))));
    let d = r / Math.tan(ang / 2);
    d = Math.min(d, l1 * 0.49, l2 * 0.49); // no pasar de la mitad del lado (el vecino también redondea)
    const rr = d * Math.tan(ang / 2);
    const t1 = [p[0] + u1[0] / l1 * d, p[1] + u1[1] / l1 * d], t2 = [p[0] + u2[0] / l2 * d, p[1] + u2[1] / l2 * d];
    const bis = [u1[0] / l1 + u2[0] / l2, u1[1] / l1 + u2[1] / l2], bl = Math.hypot(...bis) || 1;
    const cdist = rr / Math.sin(ang / 2), c = [p[0] + bis[0] / bl * cdist, p[1] + bis[1] / bl * cdist];
    let a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]), a1 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const N = 8;
    for (let k = 0; k <= N; k++) { const aa = a0 + da * k / N; out.push([c[0] + rr * Math.cos(aa), c[1] + rr * Math.sin(aa)]); }
  }
  return out;
}

function mitred(pts, w, opt) {
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
  if (k === 'halfdisc') {
    // Solapa circular: media elipse sobre la bisagra (semicírculo si h = w/2).
    const p = [[0, 0], [w, 0]], n = 24;
    for (let i = 1; i < n; i++) { const a = Math.PI * i / n; p.push([w / 2 + (w / 2) * Math.cos(a), h * Math.sin(a)]); }
    return p;
  }
  if (k === 'quarter') {
    // Un lado recto (izquierda, vertical) y el otro curvo (cuarto de elipse hasta la bisagra).
    const p = [[0, 0], [w, 0]], n = 16;
    for (let i = 1; i <= n; i++) { const a = (Math.PI / 2) * i / n; p.push([w * Math.cos(a), h * Math.sin(a)]); }
    return p;
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
  { id: 'halfdisc', name: 'Solapa circular', h: 25 },
  { id: 'quarter', name: 'Solapa recta + curva', h: 22 },
  { id: 'lid', name: 'Tapa recta', h: 40 }
];

// Trazo SVG de la silueta con la bisagra abajo (y de SVG hacia abajo), para las miniaturas del selector.
export function shapePath(id, w = 44, h = 26) {
  const corner = id === 'round' || id === 'chamfer' ? 6 : undefined;
  const pts = shapePoints(id, w, h, { corner, hinge: true });
  return 'M' + pts.map(p => p[0].toFixed(1) + ' ' + (h - p[1]).toFixed(1)).join('L') + 'Z';
}
