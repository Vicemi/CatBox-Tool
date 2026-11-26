// Plantilla de referencia del constructor: un DXF, SVG, PNG o JPG que se ve semitransparente bajo la red
// para dibujar encima. Todo se convierte en una imagen incrustada (data:image/…) con su tamaño en mm.

const toB64 = s => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
const svgUrl = svg => 'data:image/svg+xml;base64,' + toB64(svg);
const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };

/** Pares (código, valor) de un DXF de texto. */
function dxfPairs(text) {
  const L = text.split(/\r?\n/), out = [];
  for (let i = 0; i + 1 < L.length; i += 2) out.push([+L[i].trim(), L[i + 1].trim()]);
  return out;
}

/**
 * DXF (R12 a 2018, texto) → { svg, w, h } en mm. Entidades: LINE, LWPOLYLINE (con bulge), POLYLINE/VERTEX,
 * CIRCLE, ARC, SPLINE (por puntos de control/ajuste), ELLIPSE. Capas con color 1 (rojo) se pintan en rojo y el
 * resto en azul/gris, como en los archivos láser. Y se invierte (el DXF crece hacia arriba).
 */
export function dxfToSvg(text) {
  const P = dxfPairs(text);
  let unit = 1; // $INSUNITS: 1 in, 4 mm, 5 cm, 6 m; sin dato = mm
  const iu = P.findIndex(p => p[0] === 9 && p[1] === '$INSUNITS');
  if (iu >= 0 && P[iu + 1]) unit = { 1: 25.4, 4: 1, 5: 10, 6: 1000 }[+P[iu + 1][1]] || 1;
  const layerColor = {};
  const paths = [];
  let i = P.findIndex(p => p[0] === 2 && p[1] === 'ENTITIES');
  if (i < 0) i = 0;
  const pts = [];
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x, y) => { bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y); bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y); };
  // Colores de capa (tabla LAYER) para distinguir corte (rojo) del resto.
  for (let k = 0; k < P.length - 1; k++) if (P[k][0] === 0 && P[k][1] === 'LAYER') {
    let name = null, col = 7;
    for (let j = k + 1; j < P.length && P[j][0] !== 0; j++) { if (P[j][0] === 2) name = P[j][1]; if (P[j][0] === 62) col = Math.abs(+P[j][1]); }
    if (name) layerColor[name] = col;
  }
  const entities = [];
  for (let k = i; k < P.length; k++) {
    if (P[k][0] !== 0) continue;
    const type = P[k][1];
    if (type === 'ENDSEC') break;
    const props = [];
    for (let j = k + 1; j < P.length && P[j][0] !== 0; j++) props.push(P[j]);
    entities.push({ type, props });
  }
  const get = (props, c) => { const p = props.find(q => q[0] === c); return p ? +p[1] : 0; };
  const all = (props, c) => props.filter(q => q[0] === c).map(q => +q[1]);
  const arcPts = (cx, cy, r, a0, a1) => {
    let da = a1 - a0; while (da <= 0) da += 360;
    const n = Math.max(8, Math.ceil(da / 6)), out = [];
    for (let s = 0; s <= n; s++) { const a = (a0 + da * s / n) * Math.PI / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  };
  const bulgeArc = (p, q, b) => { // tramo con bulge (LWPOLYLINE): arco entre p y q
    const th = 4 * Math.atan(b), dx = q[0] - p[0], dy = q[1] - p[1], c = Math.hypot(dx, dy);
    if (!c || !b) return [q];
    const r = c / (2 * Math.sin(th / 2)), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, d = r * Math.cos(th / 2);
    const cx = mx - d * dy / c, cy = my + d * dx / c, a0 = Math.atan2(p[1] - cy, p[0] - cx);
    const n = Math.max(4, Math.ceil(Math.abs(th) / 0.1)), out = [];
    for (let s = 1; s <= n; s++) { const a = a0 + th * s / n; out.push([cx + Math.abs(r) * Math.cos(a) * Math.sign(r) * Math.sign(r), cy + Math.abs(r) * Math.sin(a)]); }
    out[out.length - 1] = q;
    return out;
  };
  let poly = null;
  for (const e of entities) {
    const layer = (e.props.find(q => q[0] === 8) || [0, '0'])[1];
    const red = (e.props.find(q => q[0] === 62) ? Math.abs(get(e.props, 62)) : layerColor[layer]) === 1;
    const push = (list, closed) => { if (list.length > 1) { paths.push({ list, closed, red }); list.forEach(p => add(...p)); } };
    if (e.type === 'LINE') push([[get(e.props, 10), get(e.props, 20)], [get(e.props, 11), get(e.props, 21)]], false);
    else if (e.type === 'LWPOLYLINE') {
      const xs = all(e.props, 10), ys = all(e.props, 20), closed = (get(e.props, 70) & 1) === 1;
      // bulge (42) va tras el vértice al que pertenece
      const bul = []; let vi = -1;
      for (const [c, v] of e.props) { if (c === 10) { vi++; bul[vi] = 0; } else if (c === 42 && vi >= 0) bul[vi] = +v; }
      const V = xs.map((x, n) => [x, ys[n]]), list = [V[0]];
      for (let n = 0; n < V.length - (closed ? 0 : 1); n++) list.push(...bulgeArc(V[n], V[(n + 1) % V.length], bul[n] || 0));
      push(list, closed);
    } else if (e.type === 'POLYLINE') poly = { list: [], closed: (get(e.props, 70) & 1) === 1, red };
    else if (e.type === 'VERTEX' && poly) poly.list.push([get(e.props, 10), get(e.props, 20)]);
    else if (e.type === 'SEQEND' && poly) { push(poly.closed ? [...poly.list, poly.list[0]] : poly.list, poly.closed); poly = null; }
    else if (e.type === 'CIRCLE') push(arcPts(get(e.props, 10), get(e.props, 20), get(e.props, 40), 0, 360), true);
    else if (e.type === 'ARC') push(arcPts(get(e.props, 10), get(e.props, 20), get(e.props, 40), get(e.props, 50), get(e.props, 51)), false);
    else if (e.type === 'SPLINE') { const xs = all(e.props, 11).length ? all(e.props, 11) : all(e.props, 10), ys = all(e.props, 21).length ? all(e.props, 21) : all(e.props, 20); push(xs.map((x, n) => [x, ys[n]]), false); }
    else if (e.type === 'ELLIPSE') {
      const cx = get(e.props, 10), cy = get(e.props, 20), mx = get(e.props, 11), my = get(e.props, 21), ratio = get(e.props, 40) || 1;
      const t0 = get(e.props, 41), t1 = get(e.props, 42) || Math.PI * 2, a = Math.hypot(mx, my), rot = Math.atan2(my, mx), out = [];
      const n = 64;
      for (let s = 0; s <= n; s++) { const tt = t0 + (t1 - t0) * s / n, x = a * Math.cos(tt), y = a * ratio * Math.sin(tt); out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); }
      push(out, false);
    }
  }
  if (!paths.length) throw new Error('El DXF no tiene líneas que se puedan mostrar.');
  const [x0, y0, x1, y1] = bbox, W = (x1 - x0) * unit, H = (y1 - y0) * unit;
  const f = v => (Math.round(v * 1000) / 1000).toString();
  const d = red => paths.filter(p => p.red === red).map(p => 'M' + p.list.map(([x, y]) => f((x - x0) * unit) + ' ' + f((y1 - y) * unit)).join('L') + (p.closed ? 'Z' : '')).join(' ');
  const sw = Math.max(W, H) / 600;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f(W) + ' ' + f(H) + '" width="' + f(W) + 'mm" height="' + f(H) + 'mm">'
    + '<path d="' + d(false) + '" fill="none" stroke="#1f4fbf" stroke-width="' + f(sw) + '"/>'
    + '<path d="' + d(true) + '" fill="none" stroke="#d01c2c" stroke-width="' + f(sw) + '"/></svg>';
  return { svg, w: W, h: H };
}

/** Tamaño en mm de un SVG (width/height con unidades; si no, viewBox a 96 ppp). */
export function svgSizeMm(svgText) {
  const tag = (svgText.match(/<svg\b[^>]*>/i) || [''])[0];
  const attr = n => { const m = tag.match(new RegExp('\\s' + n + '\\s*=\\s*["\']([^"\']+)["\']', 'i')); return m ? m[1] : null; };
  const len = v => { const m = v && v.trim().match(/^([\d.]+)\s*(mm|cm|in|pt|pc|px)?$/i); return m ? +m[1] * UNIT_MM[(m[2] || '').toLowerCase()] : null; };
  let w = len(attr('width')), h = len(attr('height'));
  const vb = (attr('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if ((!w || !h) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (w && !h) h = w * vb[3] / vb[2];
    else if (h && !w) w = h * vb[2] / vb[3];
    else { w = vb[2] * UNIT_MM.px; h = vb[3] * UNIT_MM.px; }
  }
  return { w: w || 100, h: h || 100 };
}

/** Lee un archivo de referencia → { src (data:image/…), name, w, h } en mm. */
export async function readReferenceFile(file) {
  const name = file.name || 'referencia';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'dxf') {
    const { svg, w, h } = dxfToSvg(await file.text());
    return { src: svgUrl(svg), name, w, h };
  }
  if (ext === 'svg' || file.type === 'image/svg+xml') {
    const text = await file.text();
    const { w, h } = svgSizeMm(text);
    return { src: svgUrl(text), name, w, h };
  }
  if (/^image\/(png|jpeg|webp)$/.test(file.type) || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('No se pudo leer la imagen.')); im.src = src; });
    return { src, name, w: img.naturalWidth * UNIT_MM.px, h: img.naturalHeight * UNIT_MM.px }; // 96 ppp; luego se escala
  }
  throw new Error('Formato no admitido: usa DXF, SVG, PNG o JPG.');
}
