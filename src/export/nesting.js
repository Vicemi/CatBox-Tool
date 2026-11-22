// Nesting de la red en una plancha: guillotina recursiva sobre la caja envolvente (0° / 90°).
// Sin dependencias de navegador para poder probarlo con node (nesting.check.mjs).
// shortcut: la pieza se trata como su bounding box (una red de cartón tiene esquinas vacías);
// el encaje por contorno (interlocking 180°) y la separación de varias raíces quedan para un
// empaquetador poligonal; sube de nivel cuando el rendimiento real importe más que la sencillez.

const EPS = 1e-6;

// Mejor reparto de una región W×H (celdas = pieza + gap); devuelve [{x,y,rot,w,h}] relativos a la región.
function pack(W, H, w, h, gap, rotate, depth) {
  let best = [];
  for (const rot of rotate ? [0, 90] : [0]) {
    const iw = rot ? h : w, ih = rot ? w : h, cw = iw + gap, ch = ih + gap;
    const cols = Math.floor((W + EPS) / cw), rows = Math.floor((H + EPS) / ch);
    if (cols < 1 || rows < 1) continue;
    const block = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) block.push({ x: i * cw, y: j * ch, rot, w: iw, h: ih });
    const bw = cols * cw, bh = rows * ch;
    const sub = (rw, rh, dx, dy) => (depth > 0 && rw > 0 && rh > 0 ? pack(rw, rh, w, h, gap, rotate, depth - 1).map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) : []);
    // dos particiones guillotina: franja derecha alta o franja inferior ancha
    for (const tall of [true, false]) {
      const all = block.concat(sub(W - bw, tall ? H : bh, bw, 0), sub(tall ? bw : W, H - bh, 0, bh));
      if (all.length > best.length) best = all;
    }
  }
  return best;
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

// item = { w, h, area } (mm); opts = { sheetW, sheetH, margin, gap, qty (0 = llenar una plancha), rotate }
export function nest(item, opts) {
  const { sheetW, sheetH, margin = 0, gap = 0, qty = 0, rotate = true } = opts;
  const W = sheetW - 2 * margin, H = sheetH - 2 * margin;
  const base = pack(W + gap, H + gap, item.w, item.h, gap, rotate, 3)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(p => ({ ...p, x: p.x + margin, y: p.y + margin }));
  const perSheet = base.length;
  const sheets = [];
  if (perSheet) {
    if (qty > 0) for (let left = qty; left > 0; left -= perSheet) sheets.push(base.slice(0, Math.min(perSheet, left)));
    else sheets.push(base);
  }
  const count = sheets.reduce((a, s) => a + s.length, 0);
  const used = sheets.length * sheetW * sheetH;
  return {
    perSheet, sheets, count,
    yield: used ? Math.min(1, count * (item.area || item.w * item.h) / used) : 0,
    boxFill: used ? Math.min(1, count * item.w * item.h / used) : 0
  };
}

// Hojas distintas con su repetición (las llenas se exportan una sola vez).
export function uniqueSheets(res) {
  const out = [];
  res.sheets.forEach(s => { const prev = out.find(o => o.items.length === s.length); if (prev) prev.repeat++; else out.push({ items: s, repeat: 1 }); });
  return out;
}

// Matriz SVG [a b c d e f] que lleva coordenadas locales de la pieza (mm, y abajo, origen en su esquina) a la plancha.
// 90° = giro horario: (u,v) -> (h0 - v, u) con h0 el alto de la pieza sin girar.
export function itemMatrix(p, h0) {
  return p.rot ? [0, 1, -1, 0, p.x + h0, p.y] : [1, 0, 0, 1, p.x, p.y];
}
