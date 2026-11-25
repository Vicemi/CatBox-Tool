// Modelo de capas: caja envolvente, DPI y avisos de pliegue / salida de cara.
export const FIN = { none: '', foil: 'Oro', silver: 'Plata', uv: 'UV', gloss: 'Brillo', emboss: 'Relieve', holo: 'Holo' };
export const FIN_NAMES = { foil: 'Estampado oro', silver: 'Estampado plata', uv: 'UV local', gloss: 'Brillo', emboss: 'Relieve', holo: 'Holográfico' };
export const randomImageName = () => 'Imagen·' + Math.random().toString(36).slice(2, 6).toUpperCase();
export const layerNameOf = l => {
  if (l && typeof l.name === 'string' && l.name.trim()) return l.name.trim();
  if (l && l.kind === 'image') return 'Imagen·' + Number(l.id || 0).toString(36).toUpperCase().padStart(4, '0').slice(-4);
  return l && l.content || '(vacío)';
};

export const BLENDS = [['normal', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Trama'], ['overlay', 'Superponer'], ['darken', 'Oscurecer'], ['lighten', 'Aclarar'], ['soft-light', 'Luz suave'], ['hard-light', 'Luz fuerte'], ['difference', 'Diferencia']];
export const FONTS = ['Noto Sans', 'Noto Serif', 'JetBrains Mono', 'Tomcat'];
export const SHAPES = ['rect', 'ellipse', 'triangle', 'polygon', 'star', 'line', 'poly'];

// Medición real del texto (canvas) con caché; sin DOM (tests) cae a una estimación por carácter.
let mctx = null;
const widthCache = new Map();
function lineWidth(l, line) {
  const chars = [...line].length, ls = (l.letterSpacing || 0) * chars;
  if (typeof document === 'undefined') return [...line].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 1 : 0.55), 0) * l.size + ls;
  const font = (l.italic ? 'italic ' : '') + (l.weight || 400) + ' 100px "' + (l.font || 'Noto Sans') + '"', key = font + '|' + line;
  let m = widthCache.get(key);
  if (m == null) {
    mctx = mctx || document.createElement('canvas').getContext('2d');
    mctx.font = font; m = mctx.measureText(line).width / 100;
    if (document.fonts && document.fonts.check(font)) widthCache.set(key, m); // si la fuente aún carga, no cachear
  }
  return m * l.size + ls;
}
// Métricas de texto: líneas, anchura sin escalar y caja (x = centro de la caja; y = línea base de la 1.ª línea).
export function textMetrics(l) {
  const lines = String(l.content || '').split('\n'), lh = l.lineHeight == null ? 1.15 : l.lineHeight;
  const w0 = Math.max(2, ...lines.map(x => lineWidth(l, x))), h0 = l.size * 1.15 + (lines.length - 1) * l.size * lh;
  return { lines, lh, w0, h0, cy: l.y - l.size * 0.92 + h0 / 2, ax: l.align === 'left' ? l.x - w0 / 2 : l.align === 'right' ? l.x + w0 / 2 : l.x, anchor: l.align === 'left' ? 'start' : l.align === 'right' ? 'end' : 'middle' };
}

export function bboxOf(l) {
  if (l.kind === 'text') {
    const m = textMetrics(l), sx = l.scaleX == null ? 1 : l.scaleX, sy = l.scaleY == null ? 1 : l.scaleY;
    const w = m.w0 * sx, h = m.h0 * sy;
    return [l.x - w / 2, m.cy - h / 2, w, h];
  }
  return [l.x, l.y, l.w, l.h];
}

// Caja alineada a los ejes que ocupa la capa tras girarla (para alinear, imanes y marquesina).
export function rotBBox(l) {
  const b = bboxOf(l), r = (l.rot || 0) * Math.PI / 180;
  if (!r) return b;
  const co = Math.abs(Math.cos(r)), si = Math.abs(Math.sin(r)), w = b[2] * co + b[3] * si, h = b[2] * si + b[3] * co, cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
  return [cx - w / 2, cy - h / 2, w, h];
}

// Contorno de una forma en mm (sin giro): el mismo path sirve para el SVG del lienzo y para Path2D en 2D/PDF/3D.
export function shapePathD(l) {
  const x = l.x, y = l.y, w = l.w, h = l.h, kind = l.shape || 'rect', f = v => Math.round(v * 1000) / 1000;
  const poly = pts => 'M' + pts.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + 'Z';
  const cx = x + w / 2, cy = y + h / 2;
  if (kind === 'poly' && l.poly && l.poly.length > 2) return poly(l.poly.map(p => [x + p[0] * w, y + p[1] * h])); // contorno de una cara: puntos normalizados a la caja
  if (kind === 'line') return 'M' + f(x) + ' ' + f(cy) + 'L' + f(x + w) + ' ' + f(cy);
  if (kind === 'ellipse') return 'M' + f(x) + ' ' + f(cy) + 'A' + f(w / 2) + ' ' + f(h / 2) + ' 0 1 0 ' + f(x + w) + ' ' + f(cy) + 'A' + f(w / 2) + ' ' + f(h / 2) + ' 0 1 0 ' + f(x) + ' ' + f(cy) + 'Z';
  if (kind === 'triangle') return poly([[cx, y], [x + w, y + h], [x, y + h]]);
  if (kind === 'polygon' || kind === 'star') {
    const n = Math.max(3, Math.min(24, Math.round(l.sides || (kind === 'star' ? 5 : 6)))), pts = [], inner = kind === 'star' ? (l.innerR == null ? 0.45 : l.innerR) : 1;
    for (let i = 0; i < (kind === 'star' ? n * 2 : n); i++) {
      const a = -Math.PI / 2 + (kind === 'star' ? i * Math.PI / n : i * 2 * Math.PI / n), rr = kind === 'star' && i % 2 ? inner : 1;
      pts.push([cx + Math.cos(a) * w / 2 * rr, cy + Math.sin(a) * h / 2 * rr]);
    }
    return poly(pts);
  }
  const r = Math.max(0, Math.min(l.radius || 0, w / 2, h / 2));
  if (!r) return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  return 'M' + f(x + r) + ' ' + f(y) + 'H' + f(x + w - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x + w) + ' ' + f(y + r) + 'V' + f(y + h - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x + w - r) + ' ' + f(y + h) + 'H' + f(x + r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x) + ' ' + f(y + h - r) + 'V' + f(y + r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x + r) + ' ' + f(y) + 'Z';
}
// —— Máscaras de píxeles: PNG en escala de grises (blanco = visible) guardado como data URL en l.mask = {url, on}. ——
// Caché url → {grey, alpha}: alpha = blanco con la luminancia como alfa (lo que usa destination-in). Se rellena de forma síncrona al pintar y se precarga al abrir un proyecto.
const maskCache = new Map();
export const maskOn = l => !!(l && l.mask && l.mask.url && l.mask.on !== false);
export const maskKeyOf = l => {
  const m = l && l.mask; if (!m || !m.url) return '';
  let h = 0; for (let i = 0; i < m.url.length; i += 61) h = (h * 31 + m.url.charCodeAt(i)) | 0;
  return (m.on === false ? 0 : 1) + ':' + m.url.length + ':' + h;
};
export function cacheMask(url, grey) {
  const a = document.createElement('canvas'); a.width = grey.width; a.height = grey.height;
  const ag = a.getContext('2d'); ag.drawImage(grey, 0, 0);
  const d = ag.getImageData(0, 0, a.width, a.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) { px[i + 3] = Math.round((px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) * (px[i + 3] / 255)); px[i] = px[i + 1] = px[i + 2] = 255; }
  ag.putImageData(d, 0, 0);
  const e = { grey, alpha: a }; maskCache.set(url, e); return e;
}
// Solo se aceptan máscaras incrustadas (data:image/…): un proyecto abierto no puede hacer que la app cargue URLs externas.
export const isMaskUrl = u => typeof u === 'string' && u.startsWith('data:image/');
export const loadMask = url => new Promise(resolve => {
  const c = maskCache.get(url); if (c) return resolve(c);
  if (typeof Image === 'undefined' || !isMaskUrl(url)) return resolve(null);
  const im = new Image();
  // Siempre resuelve (aunque falle el decodificado o el canvas): abrir un proyecto no puede quedarse colgado.
  im.onload = () => {
    try { const g = document.createElement('canvas'); g.width = im.naturalWidth; g.height = im.naturalHeight; g.getContext('2d').drawImage(im, 0, 0); resolve(cacheMask(url, g)); }
    catch (_) { resolve(null); }
  };
  im.onerror = () => resolve(null); im.src = url;
});
export const maskEntry = url => maskCache.get(url) || null;
export const preloadMasks = layers => Promise.all(layers.filter(l => l.mask && l.mask.url).map(l => loadMask(l.mask.url)));
// Firma de estilo de una capa: BoxPreview.bakeKey (render3d) debe incluirla para re-hornear el 3D al cambiar estos campos.
export const layerStyleKey = l => [l.gOp, maskKeyOf(l), l.blend, l.flipX, l.flipY, l.shape, l.stroke, l.strokeW, l.radius, l.sides, l.innerR, l.fillOn, l.italic, l.letterSpacing, l.lineHeight, l.align, JSON.stringify([l.grad, l.shadow, l.tStroke, l.tStrokeW, l.poly, l.clipMask])].join('|');

// —— Degradados, sombras y máscaras (compartidos por el lienzo SVG, el horneado 3D y el PDF) ——
export const gradStops = (gr, base) => ((gr && gr.stops && gr.stops.length > 1 ? gr.stops : [[0, base || '#9a5b1f'], [1, '#ffffff']]).slice().sort((a, b) => a[0] - b[0]));
// Geometría del degradado en mm sobre la caja b=[x,y,w,h]: lineal por ángulo (0° = izquierda→derecha) o radial desde el centro.
export function gradGeom(gr, b) {
  const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
  if (gr.type === 'radial') return { t: 'radial', cx, cy, r: Math.max(b[2], b[3], 1e-3) / 2 };
  const a = (gr.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), hl = Math.max(1e-3, (Math.abs(b[2] * c) + Math.abs(b[3] * s)) / 2);
  return { t: 'linear', x1: cx - c * hl, y1: cy - s * hl, x2: cx + c * hl, y2: cy + s * hl };
}
export function canvasGrad(ctx, gr, b, sc, base) {
  const q = gradGeom(gr, b);
  const cg = q.t === 'radial' ? ctx.createRadialGradient(q.cx * sc, q.cy * sc, 0, q.cx * sc, q.cy * sc, q.r * sc) : ctx.createLinearGradient(q.x1 * sc, q.y1 * sc, q.x2 * sc, q.y2 * sc);
  gradStops(gr, base).forEach(st => cg.addColorStop(Math.min(1, Math.max(0, st[0])), st[1]));
  return cg;
}
export function rgbaOf(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''), n = m ? parseInt(m[1], 16) : 0;
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (a == null ? 1 : a) + ')';
}
// Instantánea de la forma de una capa (para «recortar con la capa de abajo»): se guarda dentro de la capa recortada,
// así drawLayer no necesita ver el resto de la pila.
export function clipMaskOf(b) {
  const bb = bboxOf(b), isShape = b.kind === 'shape' && b.shape !== 'line';
  return isShape
    ? { shape: b.shape || 'rect', x: b.x, y: b.y, w: b.w, h: b.h, poly: b.poly, radius: b.radius, sides: b.sides, innerR: b.innerR, rot: b.rot || 0, flipX: !!b.flipX, flipY: !!b.flipY }
    : { shape: 'rect', x: bb[0], y: bb[1], w: bb[2], h: bb[3], rot: b.rot || 0, flipX: !!b.flipX, flipY: !!b.flipY };
}
export const sameMask = (a, c) => JSON.stringify(a) === JSON.stringify(c);
export const hasShadow = l => !!(l.shadow && l.shadow.opacity !== 0 && (l.shadow.x || l.shadow.y || l.shadow.blur));

export function dpiOf(l) {
  if (l.kind !== 'image' || !l.pxw) return 0;
  return Math.round(l.pxw / (l.w / 25.4));
}

// Cajas de panel para el atlas UV (exportación y 3D alineados)
export function panelBoxes(g) {
  return g.fills.map(pts => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pts.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    return [x0, y0, x1, y1];
  });
}

export function warnsOf(l, creaseSegs, sbb) {
  const b = bboxOf(l), out = [];
  // Una capa vinculada a una cara se recorta en todos los canales; salir de la cara ya no es un fallo.
  if (l.panelId == null) {
    for (const seg2 of creaseSegs) {
      const p1 = seg2[0], p2 = seg2[1];
      if (Math.abs(p1[0] - p2[0]) < 0.01) {
        const cx = p1[0], y0 = Math.min(p1[1], p2[1]), y1 = Math.max(p1[1], p2[1]);
        if (cx > b[0] && cx < b[0] + b[2] && y0 < b[1] + b[3] && y1 > b[1]) { out.push('Cruza un pliegue: el dibujo puede romperse o deformarse'); break; }
      } else if (Math.abs(p1[1] - p2[1]) < 0.01) {
        const cy = p1[1], x0 = Math.min(p1[0], p2[0]), x1 = Math.max(p1[0], p2[0]);
        if (cy > b[1] && cy < b[1] + b[3] && x0 < b[0] + b[2] && x1 > b[0]) { out.push('Cruza un pliegue: el dibujo puede romperse o deformarse'); break; }
      }
    }
    if (b[0] < sbb[0] - 0.5 || b[1] < sbb[1] - 0.5 || b[0] + b[2] > sbb[2] + 0.5 || b[1] + b[3] > sbb[3] + 0.5) out.push('Fuera del despliegue: entra en sangrado o zona de recorte');
  }
  if (l.kind === 'image') { const dpi = dpiOf(l); if (dpi < 300) out.push('Resolución insuficiente: ' + dpi + ' dpi < 300 dpi'); }
  return out;
}

// Máscara efectiva de una imagen de acabado: RGB a blanco, alfa = luminancia × alfa original.
const craftMaskCache = new WeakMap();
function craftMaskOf(img) {
  let m = craftMaskCache.get(img);
  if (m) return m;
  m = document.createElement('canvas');
  m.width = img.naturalWidth; m.height = img.naturalHeight;
  const mg = m.getContext('2d');
  mg.drawImage(img, 0, 0);
  const d = mg.getImageData(0, 0, m.width, m.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    px[i] = px[i + 1] = px[i + 2] = 255;
    px[i + 3] = Math.round(lum * (px[i + 3] / 255));
  }
  mg.putImageData(d, 0, 0);
  craftMaskCache.set(img, m);
  return m;
}

// Dibuja una capa en un canvas 2D (exportación PDF y horneado 3D comparten esta función)
export function drawLayer(ctx, l, sc, fill, clipPts) {
  const hasDoc = typeof document !== 'undefined', me = hasDoc && maskOn(l) ? maskEntry(l.mask.url) : null;
  if (hasDoc && maskOn(l) && !me) loadMask(l.mask.url).then(e => e && window.dispatchEvent(new Event('catbox-mask-ready')));
  if (me) { // capa con máscara: se dibuja aparte, se multiplica por la máscara (destination-in) y se compone con su opacidad y fusión
    const m0 = ctx.getTransform(), tmp = document.createElement('canvas'); tmp.width = ctx.canvas.width; tmp.height = ctx.canvas.height;
    const tg = tmp.getContext('2d'); tg.setTransform(m0);
    drawLayer(tg, { ...l, mask: undefined, opacity: 1, gOp: 1, blend: 'normal' }, sc, fill, clipPts);
    const b = bboxOf(l), cx = (b[0] + b[2] / 2) * sc, cy = (b[1] + b[3] / 2) * sc;
    tg.globalCompositeOperation = 'destination-in'; tg.translate(cx, cy);
    if (l.rot) tg.rotate(l.rot * Math.PI / 180);
    if (l.flipX || l.flipY) tg.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
    tg.translate(-cx, -cy); tg.drawImage(me.alpha, b[0] * sc, b[1] * sc, b[2] * sc, b[3] * sc);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = (l.opacity == null ? 1 : l.opacity) * (l.gOp == null ? 1 : l.gOp);
    if (!fill && l.blend && l.blend !== 'normal') ctx.globalCompositeOperation = l.blend;
    ctx.drawImage(tmp, 0, 0); ctx.restore();
    return;
  }
  ctx.save();
  if (clipPts && clipPts.length > 2) {
    ctx.beginPath();
    clipPts.forEach((p, i) => i ? ctx.lineTo(p[0] * sc, p[1] * sc) : ctx.moveTo(p[0] * sc, p[1] * sc));
    ctx.closePath(); ctx.clip();
  }
  if (l.clipMask) { // recortada con la capa de abajo: el clip sobrevive a setTransform
    const cm = l.clipMask, m0 = ctx.getTransform();
    if (cm.rot || cm.flipX || cm.flipY) {
      const mx = (cm.x + cm.w / 2) * sc, my = (cm.y + cm.h / 2) * sc;
      ctx.translate(mx, my); if (cm.rot) ctx.rotate(cm.rot * Math.PI / 180); if (cm.flipX || cm.flipY) ctx.scale(cm.flipX ? -1 : 1, cm.flipY ? -1 : 1); ctx.translate(-mx, -my);
    }
    ctx.scale(sc, sc); ctx.clip(new Path2D(shapePathD(cm))); ctx.setTransform(m0);
  }
  ctx.globalAlpha = (l.opacity == null ? 1 : l.opacity) * (l.gOp == null ? 1 : l.gOp);
  if (!fill && l.blend && l.blend !== 'normal') ctx.globalCompositeOperation = l.blend; // los canales de acabado son máscaras: sin mezcla
  if (l.rot || l.flipX || l.flipY) {
    const b = bboxOf(l), rcx = (b[0] + b[2] / 2) * sc, rcy = (b[1] + b[3] / 2) * sc;
    ctx.translate(rcx, rcy);
    if (l.rot) ctx.rotate(l.rot * Math.PI / 180);
    if (l.flipX || l.flipY) ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
    ctx.translate(-rcx, -rcy);
  }
  // Sombra (offset/blur en mm; no gira con la capa) solo en el color: los canales de acabado son máscaras.
  const shadowOn = () => { if (!fill && hasShadow(l)) { const sh = l.shadow; ctx.shadowColor = rgbaOf(sh.color || '#000000', sh.opacity == null ? 0.4 : sh.opacity); ctx.shadowBlur = (sh.blur || 0) * sc; ctx.shadowOffsetX = (sh.x || 0) * sc; ctx.shadowOffsetY = (sh.y || 0) * sc; } };
  const shadowOff = () => { ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };
  const finishColor = l.finish === 'foil' ? '#C9A227' : l.finish === 'silver' ? '#B8BAC4' : null;
  if (l.kind === 'text') {
    const sx = l.scaleX == null ? 1 : l.scaleX, sy = l.scaleY == null ? 1 : l.scaleY, m = textMetrics(l);
    if (sx !== 1 || sy !== 1) {
      const b = bboxOf(l), cx = (b[0] + b[2] / 2) * sc, cy = (b[1] + b[3] / 2) * sc;
      ctx.translate(cx, cy); ctx.scale(sx, sy); ctx.translate(-cx, -cy);
    }
    ctx.font = (l.italic ? 'italic ' : '') + (l.weight || 400) + ' ' + (l.size * sc) + 'px "' + (l.font || 'Noto Sans') + '"';
    ctx.textAlign = l.align === 'left' ? 'left' : l.align === 'right' ? 'right' : 'center'; ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (l.letterSpacing || 0) * sc + 'px';
    const emb = !fill && l.finish === 'emboss';
    if (fill) ctx.fillStyle = fill;
    else if (emb) { ctx.strokeStyle = '#b8b0a0'; ctx.lineWidth = sc * 0.15; }
    else ctx.fillStyle = !finishColor && l.grad ? canvasGrad(ctx, l.grad, [l.x - m.w0 / 2, m.cy - m.h0 / 2, m.w0, m.h0], sc, l.color) : finishColor || l.color || '#211d18';
    const outer = !fill && !emb && l.tStrokeW > 0, each = fn => m.lines.forEach((ln, i) => fn(ln, m.ax * sc, (l.y + i * l.size * m.lh) * sc));
    if (outer) { // contorno exterior: se dibuja debajo del relleno con el doble de grosor
      ctx.save(); ctx.strokeStyle = l.tStroke || '#ffffff'; ctx.lineWidth = 2 * l.tStrokeW * sc; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
      shadowOn(); each((ln, x, y) => ctx.strokeText(ln, x, y)); ctx.restore();
    } else shadowOn();
    each((ln, x, y) => { if (emb) ctx.strokeText(ln, x, y); else ctx.fillText(ln, x, y); });
  } else if (l.kind === 'shape') {
    const p = new Path2D(shapePathD(l)), line = l.shape === 'line', sw = line ? (l.strokeW == null ? 0.8 : l.strokeW) : (l.strokeW || 0);
    ctx.save(); ctx.scale(sc, sc);
    const doFill = !line && l.fillOn !== false;
    if (doFill) {
      ctx.fillStyle = fill || (l.finish === 'emboss' ? 'rgba(33,29,24,0.12)' : finishColor || (l.grad ? canvasGrad(ctx, l.grad, [l.x, l.y, l.w, l.h], 1, l.color) : l.color) || '#211d18');
      shadowOn(); ctx.fill(p); shadowOff();
    }
    if (sw > 0) {
      if (!doFill) shadowOn(); ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = fill || finishColor || (line ? l.stroke || l.color : l.stroke) || '#211d18'; ctx.stroke(p); }
    ctx.restore();
  } else if (l.img) {
    const cr = l.crop || [0, 0, 1, 1];
    const iw = l.img.naturalWidth, ih = l.img.naturalHeight;
    const sx = cr[0] * iw, sy = cr[1] * ih, sw = cr[2] * iw, sh = cr[3] * ih;
    const dx = l.x * sc, dy = l.y * sc, dw = l.w * sc, dh = l.h * sc;
    if (fill || (l.finish && l.finish !== 'none')) {
      const t = document.createElement('canvas');
      t.width = Math.max(1, Math.ceil(dw)); t.height = Math.max(1, Math.ceil(dh));
      const tg = t.getContext('2d');
      tg.fillStyle = fill || (l.finish === 'foil' ? '#C9A227' : l.finish === 'silver' ? '#B8BAC4'
        : l.finish === 'uv' ? 'rgba(33,29,24,0.08)' : 'rgba(33,29,24,0.12)');
      tg.fillRect(0, 0, t.width, t.height);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(craftMaskOf(l.img), sx, sy, sw, sh, 0, 0, t.width, t.height);
      ctx.drawImage(t, dx, dy, dw, dh);
    } else {
      shadowOn(); ctx.drawImage(l.img, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  } else if (fill) {
    ctx.fillStyle = fill; ctx.fillRect(l.x * sc, l.y * sc, l.w * sc, l.h * sc);
  } else {
    ctx.strokeStyle = fill || '#b3a88f'; ctx.lineWidth = fill ? 2 : sc * 0.3;
    if (!fill) ctx.setLineDash([sc * 2, sc * 1.4]);
    ctx.strokeRect(l.x * sc, l.y * sc, l.w * sc, l.h * sc); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(l.x * sc, l.y * sc); ctx.lineTo((l.x + l.w) * sc, (l.y + l.h) * sc);
    ctx.moveTo((l.x + l.w) * sc, l.y * sc); ctx.lineTo(l.x * sc, (l.y + l.h) * sc);
    ctx.lineWidth = fill ? 2 : sc * 0.2; ctx.stroke();
    if (!fill) { ctx.font = '500 ' + (3.4 * sc) + 'px "Noto Sans"'; ctx.textAlign = 'center'; ctx.fillStyle = '#8a8071'; ctx.fillText(l.content || '', (l.x + l.w / 2) * sc, (l.y + l.h / 2) * sc); }
  }
  ctx.restore();
}
