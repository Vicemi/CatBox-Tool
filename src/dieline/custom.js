// Constructor de cajas: dos modos que comparten el mismo motor 2D / 3D / SVG.
//   mode 'box' = caja rápida paramétrica (fondo + 4 paredes + cierre).
//   mode 'net' = red libre de caras: varias piezas raíz, caras hijas, solapas,
//                pestañas, ángulos de plegado y cualquier combinación de bordes.
// Unidades internas: mm. La interfaz convierte a cm.
import { shapePoints, wrapFlapInfo } from './shapes.js';

export const WALL_IDS = ['front', 'back', 'left', 'right'];
export const WALL_NAMES = {
  front: 'Frente', back: 'Dorso', left: 'Lateral izq.', right: 'Lateral der.'
};
export const WALL_NAMES_LONG = {
  front: 'Frente', back: 'Dorso', left: 'Lateral izquierdo', right: 'Lateral derecho'
};
export const BUILD_OPTIONS = [
  { id: 'tuck', name: 'Con solapa y lengüeta' },
  { id: 'lid', name: 'Con tapa plana' },
  { id: 'dust', name: 'Solo solapas guardapolvo' },
  { id: 'open', name: 'Bandeja abierta' }
];
export const LID_WALL_OPTIONS = WALL_IDS.map(id => ({ id, name: WALL_NAMES_LONG[id] }));
export const EDGE_OPTIONS = [
  { id: 'far', name: 'Borde exterior' },
  { id: 'near', name: 'Borde de bisagra' },
  { id: 'xmin', name: 'Borde izquierdo' },
  { id: 'xmax', name: 'Borde derecho' }
];
export const PANEL_TYPES = [
  { id: 'wall', name: 'Cara / pared', shape: 'rect', h: 0 },
  { id: 'lid', name: 'Tapa', shape: 'lid', h: 40 },
  { id: 'dust', name: 'Solapa guardapolvo', shape: 'dust', h: 14 },
  { id: 'tuck', name: 'Lengüeta', shape: 'tuck', h: 16 },
  { id: 'ear', name: 'Pestaña de esquina', shape: 'ear', h: 16 },
  { id: 'side-tab', name: 'Pestaña lateral', shape: 'side-tab', h: 30 },
  { id: 'glue', name: 'Pestaña de pegado', shape: 'glue', h: 14 },
  { id: 'wrap-flap', name: 'Solapa envolvente con pestañas', shape: 'wrap-flap', h: 60 },
  { id: 'rect', name: 'Rectángulo libre', shape: 'rect', h: 40 }
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => Number.isFinite(+v) ? +v : d;
const ATTACH_OF_ROT = { 0: 'b', 90: 'r', 180: 't', 270: 'l' };
const ROTADD = { far: 0, near: 180, xmin: 90, xmax: 270 };
const EDGES = ['far', 'near', 'xmin', 'xmax'];
const isPolyEdge = e => typeof e === 'string' && /^e\d+$/.test(e);
const isAnyEdge = e => EDGES.includes(e) || isPolyEdge(e);
const edgeIndex = e => isPolyEdge(e) ? Number(e.slice(1)) : -1;
const edgeLenOf = (n, edge) => {
  const i = edgeIndex(edge);
  if (i < 0 || !n.shapePts || n.shapePts.length < 3) {
    return (edge === 'far' || edge === 'near') ? n.w : n.h;
  }
  const pts = n.shapePts, p0 = pts[i % pts.length], p1 = pts[(i + 1) % pts.length];
  return Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
};

export function defaultCustom() {
  return {
    mode: 'box',
    build: 'tuck',
    lidWall: 'back',
    lidDepth: 0,
    tongue: 16,
    dust: 14,
    dustOn: true,
    lidShape: 'rect',
    lidCorner: 3,
    cornerTabs: true,
    tabDepth: 16,
    baseShape: 'rect',
    baseCorner: 4,
    heroWall: 'front',
    walls: {
      front: { h: 0, shape: 'rect', corner: 4 },
      back: { h: 0, shape: 'rect', corner: 4 },
      left: { h: 0, shape: 'rect', corner: 4 },
      right: { h: 0, shape: 'rect', corner: 4 }
    },
    // Red libre. Solo se usa cuando mode === 'net'.
    panels: [],
    lines: [],
    rootGap: 30,
    // Envolvente: anchos de las alas exterior/interior.
    outer: 0,
    inner: 0,
    childGap: 0,
    joinPreview: false,
    kerf: 0.15,
    sheet: 'a3',
    sheetCustom: { w: 600, h: 400 },
    margin: 10,
    showPage: true
  };
}

export function normalizeCustom(raw) {
  const d = defaultCustom();
  const r = raw && typeof raw === 'object' ? raw : {};
  const walls = {};
  for (const id of WALL_IDS) {
    const w = (r.walls && r.walls[id]) || {};
    walls[id] = {
      h: clamp(num(w.h, 0), 0, 1200),
      shape: w.shape || 'rect',
      corner: clamp(num(w.corner, d.walls[id].corner), 0, 200)
    };
  }

  const seen = new Set();
  const panels = [];
  for (const p of (Array.isArray(r.panels) ? r.panels : [])) {
    if (!p || p.id == null) continue;
    const id = String(p.id);
    if (seen.has(id)) continue;
    seen.add(id);
    panels.push({
      id,
      name: String(p.name || 'Cara').slice(0, 80),
      parent: p.parent != null ? String(p.parent) : null,
      edge: isAnyEdge(p.edge) ? p.edge : 'far',
      w: clamp(num(p.w, 80), 2, 3000),
      h: clamp(num(p.h, 40), 2, 3000),
      shape: p.shape || 'rect',
      n: p.n > 0 ? clamp(Math.round(num(p.n, 24)), 3, 64) : undefined, // lados de la tapa poligonal ('disc')
      corner: clamp(num(p.corner, 0), 0, 200),
      angle: clamp(num(p.angle, 90), 0, 360),
      sign: p.sign === 1 ? 1 : p.sign === -1 ? -1 : undefined,
      zOff: clamp(num(p.zOff, 0), -5, 5),
      shift: clamp(num(p.shift, 0), -2000, 2000),
      align: ['start', 'center', 'end'].includes(p.align) ? p.align : 'center',
      role: p.role === 'hero' ? 'hero' : 'design',
      slits: Array.isArray(p.slits) ? p.slits.filter(q => q && [q.x1, q.y1, q.x2, q.y2].every(Number.isFinite)).map(q => ({ x1: +q.x1, y1: +q.y1, x2: +q.x2, y2: +q.y2, w: clamp(num(q.w, 1.2), 0, 20) })) : [],
      folds: Array.isArray(p.folds) ? p.folds.filter(q => Array.isArray(q) && q.length === 2 && q[0] && q[1] && [q[0][0], q[0][1], q[1][0], q[1][1]].every(Number.isFinite)).map(q => [[+q[0][0], +q[0][1]], [+q[1][0], +q[1][1]]]) : []
    });
  }
  const ids = new Set(panels.map(p => p.id));
  for (const p of panels) {
    if (p.parent && (!ids.has(p.parent) || p.parent === p.id)) p.parent = null;
  }
  // corta ciclos de parentesco
  const byId = new Map(panels.map(p => [p.id, p]));
  for (const p of panels) {
    const visited = new Set([p.id]);
    let cur = p.parent;
    while (cur) {
      if (visited.has(cur)) { p.parent = null; break; }
      visited.add(cur);
      const q = byId.get(cur);
      cur = q ? q.parent : null;
    }
  }
  const lines = (Array.isArray(r.lines) ? r.lines : []).filter(l => l && l.panelId && [l.x1, l.y1, l.x2, l.y2].every(Number.isFinite)).map((l, i) => ({
    id: String(l.id || ('l' + i)),
    panelId: String(l.panelId),
    kind: ['cut', 'crease', 'slot'].includes(l.kind) ? l.kind : 'cut',
    x1: +l.x1, y1: +l.y1, x2: +l.x2, y2: +l.y2,
    w: clamp(num(l.w, l.kind === 'slot' ? 1.2 : 0), 0, 20)
  }));
  const mode = r.mode === 'net' ? 'net' : 'box';
  if (mode === 'net' && !panels.length) {
    panels.push({ id: 'p1', name: 'Pieza 1', parent: null, edge: 'far', w: 80, h: 40, shape: 'rect', corner: 0, angle: 90, role: 'hero' });
  }
  if (mode === 'net' && panels.length && !panels.some(p => p.role === 'hero')) {
    const firstRoot = panels.find(p => !p.parent);
    if (firstRoot) firstRoot.role = 'hero';
  }

  return {
    ...d, ...r,
    mode,
    wrapStyle: r.wrapStyle === true,
    lines,
    lidDepth: clamp(num(r.lidDepth, 0), 0, 1200),
    tongue: clamp(num(r.tongue, d.tongue), 2, 120),
    dust: clamp(num(r.dust, d.dust), 2, 120),
    lidCorner: clamp(num(r.lidCorner, d.lidCorner), 0, 200),
    tabDepth: clamp(num(r.tabDepth, d.tabDepth), 2, 120),
    baseCorner: clamp(num(r.baseCorner, d.baseCorner), 0, 200),
    rootGap: clamp(num(r.rootGap, d.rootGap), 0, 300),
    childGap: clamp(num(r.childGap, d.childGap), -50, 100),
    outer: clamp(num(r.outer, 0), 0, 2000),
    inner: clamp(num(r.inner, 0), 0, 2000),
    joinPreview: r.joinPreview === true,
    walls, panels,
    kerf: clamp(num(r.kerf, d.kerf), 0, 1),
    margin: clamp(num(r.margin, d.margin), 0, 100),
    sheetCustom: {
      w: clamp(num(r.sheetCustom && r.sheetCustom.w, 600), 50, 5000),
      h: clamp(num(r.sheetCustom && r.sheetCustom.h, 400), 50, 5000)
    }
  };
}

function wallHeight(c, state, id) {
  return c.walls[id].h > 0 ? c.walls[id].h : state.H;
}
function openingDepth(state, lidWall) {
  return lidWall === 'front' || lidWall === 'back' ? state.W : state.L;
}

// Convierte la caja rápida en una lista de paneles editables (sin layout).
export function boxPanelDefs(state, c) {
  const L = Math.max(1, state.L), W = Math.max(1, state.W), H = Math.max(1, state.H);
  const hs = {};
  for (const id of WALL_IDS) hs[id] = wallHeight(c, state, id);
  const panels = [];
  const add = (p) => { panels.push(p); return p; };

  add({ id: 'base', name: 'Fondo', parent: null, edge: 'far', w: L, h: W, shape: c.baseShape, corner: c.baseCorner, angle: 90, role: 'design' });
  const walls = {};
  for (const id of WALL_IDS) {
    const edge = id === 'front' ? 'near' : id === 'back' ? 'far' : id === 'left' ? 'xmin' : 'xmax';
    const w = id === 'front' || id === 'back' ? L : W;
    walls[id] = add({
      id, name: WALL_NAMES_LONG[id], parent: 'base', edge, w, h: hs[id],
      shape: c.walls[id].shape, corner: c.walls[id].corner, angle: 90,
      role: c.heroWall === id ? 'hero' : 'design'
    });
  }

  if (c.build === 'tuck' || c.build === 'lid') {
    const host = walls[c.lidWall] || walls.back;
    const depth = c.lidDepth > 0 ? c.lidDepth : openingDepth(state, c.lidWall) + 1;
    add({ id: 'lid', name: 'Tapa', parent: host.id, edge: 'far', w: host.w, h: depth, shape: c.lidShape, corner: c.lidCorner, angle: 90, role: 'design' });
    if (c.build === 'tuck') add({ id: 'lid-tongue', name: 'Lengüeta', parent: 'lid', edge: 'far', w: host.w, h: Math.min(c.tongue, Math.max(4, depth * 0.58)), shape: 'tuck', corner: 0, angle: 100, role: 'design' });
  }

  if (c.dustOn !== false && (c.build === 'tuck' || c.build === 'lid' || c.build === 'dust')) {
    for (const id of WALL_IDS) {
      if ((c.build !== 'dust') && id === c.lidWall) continue;
      const host = walls[id];
      add({
        id: 'dust-' + id, name: 'Solapa ' + WALL_NAMES[id].toLowerCase(), parent: host.id, edge: 'far',
        w: host.w, h: Math.min(c.dust, Math.max(4, host.h * 0.55)), shape: 'dust', corner: 0, angle: 90, role: 'design'
      });
    }
  }

  if (c.cornerTabs) {
    for (const id of WALL_IDS) {
      const wall = walls[id];
      for (const side of ['xmin', 'xmax']) {
        add({
          id: 'tab-' + id + '-' + side, name: 'Pestaña', parent: wall.id, edge: side,
          w: wall.h, h: Math.min(c.tabDepth, Math.max(4, wall.h * 0.6)), shape: 'ear', corner: 0, angle: 90, role: 'design'
        });
      }
    }
  }
  return { panels, maxWall: Math.max(...WALL_IDS.map(id => hs[id]), 1) };
}

// —— Motor de layout: cualquier árbol de paneles → rectángulos 2D + ejes locales ——
function bboxNodes(nodes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.rect[0]); y0 = Math.min(y0, n.rect[1]);
    x1 = Math.max(x1, n.rect[0] + n.rect[2]); y1 = Math.max(y1, n.rect[1] + n.rect[3]);
  }
  return [x0, y0, x1, y1];
}

function layoutPanels(defs, state, t, opts = {}) {
  const nodes = defs.map((p, i) => ({
    ...p,
    index: i,
    kids: [],
    rect: null,
    rotZ: 0,
    attach: undefined,
    shapePts: null
  }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const childrenOf = {};
  for (const n of nodes) {
    if (n.parent && byId.has(n.parent)) {
      (childrenOf[n.parent] || (childrenOf[n.parent] = [])).push(n);
      byId.get(n.parent).kids.push(n);
    } else {
      n.parent = null;
    }
  }
  const roots = nodes.filter(n => !n.parent);
  if (!roots.length && nodes.length) { nodes[0].parent = null; roots.push(nodes[0]); }

  const frameOf = n => {
    const [x, y, w, h] = n.rect;
    if (n.rotZ === 0) return { O: [x, y + h], ex: [1, 0], ey: [0, -1] };
    if (n.rotZ === 90) return { O: [x + w, y + h], ex: [0, -1], ey: [-1, 0] };
    if (n.rotZ === 180) return { O: [x + w, y], ex: [-1, 0], ey: [0, 1] };
    return { O: [x, y], ex: [0, 1], ey: [1, 0] };
  };

  const polyFrame = (parent, child, edge, off) => {
    const pts = parent.shapePts || shapePoints(parent.shape, parent.w, parent.h, { corner: parent.corner, hinge: false, n: parent.n });
    const idx = edgeIndex(edge) % pts.length;
    const p0 = pts[idx], p1 = pts[(idx + 1) % pts.length];
    // El motor de plegado espera la bisagra en dirección p1→p0: así el eje +y
    // local de la hija apunta al exterior del polígono, igual que en los bordes
    // rectangulares 'far'/'near'/'xmin'/'xmax'.
    const dx = p0[0] - p1[0], dy = p0[1] - p1[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length];
      area += pts[i][0] * q[1] - q[0] * pts[i][1];
    }
    // Normal exterior: izquierda de p1→p0 en polígonos CCW.
    const nx = area >= 0 ? -uy : uy;
    const ny = area >= 0 ? ux : -ux;
    const lx = p1[0] + ux * off, ly = p1[1] + uy * off;
    const toWorld = (x, y) => [
      parent.O[0] + parent.ex[0] * x + parent.ey[0] * y,
      parent.O[1] + parent.ex[1] * x + parent.ey[1] * y
    ];
    const O = toWorld(lx, ly);
    const ex = [
      parent.ex[0] * ux + parent.ey[0] * uy,
      parent.ex[1] * ux + parent.ey[1] * uy
    ];
    const ey = [
      parent.ex[0] * nx + parent.ey[0] * ny,
      parent.ex[1] * nx + parent.ey[1] * ny
    ];
    const rotZ = ((-Math.atan2(ex[1], ex[0]) * 180 / Math.PI) % 360 + 360) % 360;
    const corners = [[0, 0], [child.w, 0], [child.w, child.h], [0, child.h]]
      .map(([x, y]) => [O[0] + ex[0] * x + ey[0] * y, O[1] + ex[1] * x + ey[1] * y]);
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    return {
      O, ex, ey, rotZ,
      rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)],
      hinge: { x: p1[0], y: p1[1], rot: Math.atan2(dy, dx) * 180 / Math.PI, len, edge: idx }
    };
  };

  const placeChild = (parent, child, edge, off) => {
    let O, ex, ey, hinge = null;
    if (isPolyEdge(edge)) {
      const pf = polyFrame(parent, child, edge, off);
      O = pf.O; ex = pf.ex; ey = pf.ey; hinge = pf.hinge;
      child.rotZ = pf.rotZ;
      if (child.rotZ === 0) child.rect = [O[0], O[1] - child.h, child.w, child.h];
      else if (child.rotZ === 90) child.rect = [O[0] - child.h, O[1] - child.w, child.h, child.w];
      else if (child.rotZ === 180) child.rect = [O[0] - child.w, O[1], child.w, child.h];
      else if (child.rotZ === 270) child.rect = [O[0], O[1], child.h, child.w];
      else child.rect = pf.rect;
    } else {
      const f = frameOf(parent);
      if (edge === 'far') {
        O = [f.O[0] + f.ex[0] * off + f.ey[0] * parent.h, f.O[1] + f.ex[1] * off + f.ey[1] * parent.h];
        ex = f.ex; ey = f.ey;
      } else if (edge === 'near') {
        const start = off + child.w;
        O = [f.O[0] + f.ex[0] * start, f.O[1] + f.ex[1] * start];
        ex = [-f.ex[0], -f.ex[1]]; ey = [-f.ey[0], -f.ey[1]];
      } else if (edge === 'xmin') {
        O = [f.O[0] + f.ey[0] * off, f.O[1] + f.ey[1] * off];
        ex = f.ey; ey = [-f.ex[0], -f.ex[1]];
      } else {
        const start = off + child.w;
        O = [f.O[0] + f.ex[0] * parent.w + f.ey[0] * start, f.O[1] + f.ex[1] * parent.w + f.ey[1] * start];
        ex = [-f.ey[0], -f.ey[1]]; ey = f.ex;
      }
      child.rotZ = (parent.rotZ + ROTADD[edge]) % 360;
      if (child.rotZ === 0) child.rect = [O[0], O[1] - child.h, child.w, child.h];
      else if (child.rotZ === 90) child.rect = [O[0] - child.h, O[1] - child.w, child.h, child.w];
      else if (child.rotZ === 180) child.rect = [O[0] - child.w, O[1], child.w, child.h];
      else child.rect = [O[0], O[1], child.h, child.w];
    }
    child.O = O; child.ex = ex; child.ey = ey;
    child.hinge = hinge;
    child.attach = ATTACH_OF_ROT[child.rotZ] || 'b';
    child.edgeOffset = off;
    child.shapePts = shapePoints(child.shape, child.w, child.h, { corner: child.corner, hinge: true, n: child.n });
    placeChildren(child);
  };

  const placeChildren = (parent) => {
    const list = childrenOf[parent.id] || [];
    if (!list.length) return;
    const used = [...new Set(list.map(ch => ch.edge))];
    for (const edge of used) {
      const group = list.filter(ch => ch.edge === edge);
      if (!group.length) continue;
      const edgeLen = edgeLenOf(parent, edge);
      const gap = opts.childGap == null ? 0 : opts.childGap;
      const total = group.reduce((a, ch) => a + ch.w, 0) + gap * (group.length - 1);
      let off = (edgeLen - total) / 2;
      if (group.length === 1 && group[0].align === 'start') off = 0;
      else if (group.length === 1 && group[0].align === 'end') off = edgeLen - group[0].w;
      for (const ch of group) {
        placeChild(parent, ch, edge, off + (ch.shift || 0));
        off += ch.w + gap;
      }
    }
  };

  const shiftTree = (n, dx) => {
    n.rect[0] += dx;
    n.O[0] += dx;
    for (const ch of (childrenOf[n.id] || [])) shiftTree(ch, dx);
  };

  let cursorX = 0;
  const gap = opts.rootGap == null ? 30 : opts.rootGap;
  for (const root of roots) {
    root.rotZ = 0;
    root.rect = [0, 0, root.w, root.h];
    root.O = [0, root.h]; root.ex = [1, 0]; root.ey = [0, -1];
    root.attach = undefined;
    root.edgeOffset = 0;
    root.shapePts = shapePoints(root.shape, root.w, root.h, { corner: root.corner, hinge: false, n: root.n });
    placeChildren(root);
    const treeNodes = nodes.filter(n => n === root || isDescendant(n, root, byId));
    const bb = bboxNodes(treeNodes);
    const dx = cursorX - bb[0];
    if (dx) shiftTree(root, dx);
    cursorX += bb[2] - bb[0] + gap;
  }

  return {
    nodes, byId, roots, childrenOf,
    bbox: bboxNodes(nodes),
    t
  };
}

function isDescendant(node, root, byId) {
  let cur = node.parent;
  while (cur) {
    if (cur === root.id) return true;
    const p = byId.get(cur);
    cur = p ? p.parent : null;
  }
  return false;
}

function makeLayout(state, t) {
  const c = normalizeCustom(state.custom);
  let defs, maxWall;
  if (c.mode === 'net') {
    defs = c.panels;
    maxWall = Math.max(...defs.map(p => p.h), 1);
  } else {
    const box = boxPanelDefs(state, c);
    defs = box.panels;
    maxWall = box.maxWall;
  }
  const lay = layoutPanels(defs, state, t, { rootGap: c.rootGap, childGap: c.childGap });
  return { ...lay, c, maxWall, L: Math.max(1, state.L), W: Math.max(1, state.W), H: Math.max(1, state.H) };
}

export function customLayout(state, t) {
  return makeLayout(state, t);
}

export function mapLocal(node, x, y) {
  return [node.O[0] + node.ex[0] * x + node.ey[0] * y, node.O[1] + node.ex[1] * x + node.ey[1] * y];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function genCustom(ctx, state, t) {
  const lay = customLayout(state, t);
  const { nodes, bbox } = lay;

  for (const n of nodes) {
    const pts = n.shapePts.map(p => mapLocal(n, p[0], p[1]));
    ctx.fill(pts);
    ctx.region(pts, { panelId: n.id, role: n.role, surface: 'outside', up: 'top' });
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const small = Math.min(n.w, n.h) < 28;
    const fs = small ? 2.8 : 3.8, full = !n.parent ? n.name + ' ' + ctx.fmt(n.w) + '×' + ctx.fmt(n.h) : n.name;
    // El nombre no debe desbordar la cara (en pestañas estrechas se recorta con «…»)
    const fit = Math.max(3, Math.floor(((Math.max(...xs) - Math.min(...xs)) * 0.9) / (fs * 0.55)));
    ctx.label(cx, cy, full.length > fit ? full.slice(0, fit - 1) + '…' : full, fs);
    ctx.safeR(n.rect[0], n.rect[1], n.rect[2], n.rect[3], Math.min(3, n.w / 4, n.h / 4));
  }

  // Bisagras
  for (const n of nodes) {
    if (!n.parent) continue;
    if (isPolyEdge(n.edge)) {
      const parent = lay.byId.get(n.parent);
      const pts = parent && parent.shapePts;
      const idx = pts ? edgeIndex(n.edge) % pts.length : -1;
      if (pts && idx >= 0) {
        const p0 = pts[idx], p1 = pts[(idx + 1) % pts.length];
        ctx.crease([mapLocal(parent, p0[0], p0[1]), mapLocal(parent, p1[0], p1[1])]);
        continue;
      }
    }
    ctx.crease([mapLocal(n, 0, 0), mapLocal(n, n.w, 0)]);
  }

  // Pliegues internos declarados por la cara (p. ej. base de pestaña de una solapa envolvente)
  for (const n of nodes) {
    for (const f of (n.folds || [])) ctx.crease([mapLocal(n, f[0][0], f[0][1]), mapLocal(n, f[1][0], f[1][1])]);
  }

  // Cortes: bordes libres; los tramos ocupados por bisagras no se cortan.
  const edgeEnds = [
    ['far', n => [0, n.h], n => [n.w, n.h]],
    ['near', n => [0, 0], n => [n.w, 0]],
    ['xmin', n => [0, 0], n => [0, n.h]],
    ['xmax', n => [n.w, 0], n => [n.w, n.h]]
  ];
  for (const n of nodes) {
    if (n.shape !== 'rect') {
      // Siluetas especiales: se corta su perímetro real (pestañas, muescas, arcos…),
      // no el rectángulo envolvente.
      const pts = n.shapePts;
      const attached = new Set((lay.childrenOf[n.id] || []).filter(ch => isPolyEdge(ch.edge)).map(ch => edgeIndex(ch.edge)));
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
        if (n.parent && Math.abs(p0[1]) < 0.01 && Math.abs(p1[1]) < 0.01) continue; // bisagra
        if (attached.has(i)) continue; // borde poligonal usado como bisagra
        const a = mapLocal(n, p0[0], p0[1]), b = mapLocal(n, p1[0], p1[1]);
        if (dist(a, b) >= 0.05) ctx.cut([a, b]);
      }
      continue;
    }
    for (const [edge, p0, p1] of edgeEnds) {
      if (n.parent && edge === 'near') continue;
      const a = mapLocal(n, ...p0(n)), b = mapLocal(n, ...p1(n));
      if (dist(a, b) < 0.05) continue;
      const kids = (lay.childrenOf[n.id] || []).filter(ch => ch.edge === edge);
      if (!kids.length) { ctx.cut([a, b]); continue; }
      const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
      const tOf = p => clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (L2 || 1), 0, 1);
      const intervals = kids.map(ch => {
        const c = mapLocal(ch, 0, 0), d = mapLocal(ch, ch.w, 0);
        let t1 = tOf(c), t2 = tOf(d);
        if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
        return [t1, t2];
      }).sort((u, v) => u[0] - v[0]);
      let cursor = 0;
      for (const [t1, t2] of intervals) {
        if (t1 > cursor + 1e-4) ctx.cut([lerp(a, b, cursor), lerp(a, b, t1)]);
        cursor = Math.max(cursor, t2);
      }
      if (cursor < 1 - 1e-4) ctx.cut([lerp(a, b, cursor), b]);
    }
  }

  // Ranuras / encajes declarados por la cara (p. ej. ranuras laterales de la envolvente).
  // Si la ranura tiene ancho, se corta como rectángulo cerrado; si no, como línea.
  const drawSlot = (n, s) => {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    if (s.w > 0) {
      const nx = -dy / len * s.w / 2, ny = dx / len * s.w / 2;
      const pts = [
        [s.x1 + nx, s.y1 + ny], [s.x2 + nx, s.y2 + ny],
        [s.x2 - nx, s.y2 - ny], [s.x1 - nx, s.y1 - ny], [s.x1 + nx, s.y1 + ny]
      ].map(p => mapLocal(n, p[0], p[1]));
      ctx.encaje(pts, { panelId: n.id, kind: 'encaje', len, w: s.w });
    } else {
      ctx.encaje([mapLocal(n, s.x1, s.y1), mapLocal(n, s.x2, s.y2)], { panelId: n.id, kind: 'encaje', len, w: 0 });
    }
  };
  for (const n of nodes) for (const s of (n.slits || [])) drawSlot(n, s);

  // Líneas libres añadidas con las herramientas de la red.
  for (const l of (lay.c.lines || [])) {
    const n = lay.byId.get(l.panelId);
    if (!n) continue;
    if (l.kind === 'slot') drawSlot(n, l);
    else if (l.kind === 'crease') ctx.crease([mapLocal(n, l.x1, l.y1), mapLocal(n, l.x2, l.y2)]);
    else ctx.cut([mapLocal(n, l.x1, l.y1), mapLocal(n, l.x2, l.y2)]);
  }

  ctx.dimH(bbox[0], bbox[2], bbox[3] + 9, ctx.fmt(bbox[2] - bbox[0]));
  ctx.dimV(bbox[1], bbox[3], bbox[0] - 8, ctx.fmt(bbox[3] - bbox[1]));
  return lay;
}

function nodeTree(n, lay) {
  const kids = (lay.childrenOf[n.id] || []).map(k => nodeTree(k, lay));
  const base = {
    edge: n.parent ? n.edge : undefined,
    out: n.h,
    w: n.w,
    uv: n.rect,
    panelId: n.id,
    role: n.role,
    surface: 'outside',
    up: 'top',
    attach: undefined, // el rectángulo UV ya está orientado como el plano 2D
    sign: n.parent ? n.sign : undefined,
    // Las pestañas laterales se pliegan pegadas a la pared: sin separación quedan coplanares y parpadean (z-fighting).
    zOff: n.zOff || (n.shape === 'side-tab' ? -0.9 : 0),
    align: n.parent ? n.align : 'center',
    edgeOffset: n.parent && !n.hinge ? n.edgeOffset : undefined,
    hinge: n.hinge || undefined,
    rotZ: n.rotZ || 0,
    angle: n.angle == null ? 90 : n.angle,
    kids
  };
  if (['round', 'chamfer', 'arch', 'taper', 'triangle', 'rttri', 'notch', 'wave', 'wrap-flap', 'side-tab', 'disc'].includes(n.shape)) {
    base.shape = 'poly'; base.pts = n.shapePts;
  } else if (n.shape === 'lid') {
    base.shape = 'lid';
  } else if (['tuck', 'dust', 'ear', 'glue'].includes(n.shape)) {
    base.shape = n.shape;
  } else {
    base.shape = 'rect';
  }
  return base;
}

export function customPieces(state) {
  const lay = customLayout(state, 0);
  const c = lay.c;
  if (state.tpl === 'wrap' || c.wrapStyle) {
    const root = lay.roots[0];
    if (!root) return [];
    return [{
      tree: { ...nodeTree(root, lay), lx: root.w, ly: root.h, edge: undefined, out: undefined, w: undefined, attach: undefined },
      sign: -1,
      lift: Math.max(1, state.W || 0),
      stand: true,       // sin rotY: girar 180° en el plano dejaba la solapa superior abajo y los laterales cambiados
      off: [0, 0]
    }];
  }
  const join = c.joinPreview && lay.roots.length === 2;
  const wallH = root => Math.max(1, ...(lay.childrenOf[root.id] || []).map(k => k.h));
  const h0 = lay.roots[0] ? wallH(lay.roots[0]) : 0;
  const h1 = lay.roots[1] ? wallH(lay.roots[1]) : 0;
  let cursor = 0;
  const cfgOf = i => {
    const a = Array.isArray(c.assembly) ? c.assembly[i] : null;
    return a && typeof a === 'object' ? a : {};
  };
  const pieces = lay.roots.map((root, i) => {
    const tree = nodeTree(root, lay);
    const ac = cfgOf(i);
    const hasAsm = Array.isArray(c.assembly);
    const numOr = (v, d) => Number.isFinite(+v) ? +v : d;
    const piece = {
      tree: { ...tree, lx: root.w, ly: root.h, edge: undefined, out: undefined, w: undefined, attach: undefined },
      sign: numOr(ac.sign, -1),  // -1 pliega hacia la cara exterior
      lift: numOr(ac.lift, 0),
      off: hasAsm ? [0, 0] : [cursor, 0],
      yOff: numOr(ac.yOff, wallH(root))
    };
    if (Number.isFinite(+ac.rotY)) piece.rotY = +ac.rotY;
    if (Number.isFinite(+ac.flip)) piece.flip = +ac.flip;
    if (Number.isFinite(+ac.xOff)) piece.xOff = +ac.xOff;
    if (Number.isFinite(+ac.zOff)) piece.zOff = +ac.zOff;
    if (ac.place && typeof ac.place === 'object') piece.place = { ...ac.place };
    cursor += root.w + 60;
    if (join) {
      // Montaje: pieza 0 = mitad superior (fondo arriba, paredes abajo),
      // pieza 1 = mitad inferior (fondo abajo, paredes arriba). Los bordes se encuentran.
      piece.flip = 0; piece.lift = 0; piece.rotY = 0; piece.yOff = 0;
      piece.off = [0, 0];
      if (i === 0) { piece.sign = -1; piece.yOff = h0 + h1; }
      else {
        piece.sign = 1;
        piece.yOff = 0;
        piece.xOff = (lay.roots[0].w - root.w) / 2;
        piece.zOff = (root.h - lay.roots[0].h) / 2;
      }
    }
    return piece;
  });
  return pieces;
}

// Convierte la caja rápida actual en red editable, conservando todas las caras.
// force=true regenera desde los parámetros de caja rápida; si no, conserva la red existente.
export function toNetCustom(state, force = false) {
  const c = normalizeCustom(state.custom);
  if (state.tpl === 'wrap') {
    const wc = wrapCustom(state);
    const lines = [];
    let li = 1;
    const panels = wc.panels.map(p => {
      const clean = { ...p, slits: [], folds: [] };
      for (const s of (p.slits || [])) lines.push({ id: 'l' + (li++), panelId: p.id, kind: 'slot', x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, w: s.w });
      for (const f of (p.folds || [])) lines.push({ id: 'l' + (li++), panelId: p.id, kind: 'crease', x1: f[0][0], y1: f[0][1], x2: f[1][0], y2: f[1][1], w: 0 });
      return clean;
    });
    return normalizeCustom({ ...wc, mode: 'net', wrapStyle: true, panels, lines });
  }
  if (c.mode === 'net') return c;
  if (!force && c.panels.length) return normalizeCustom({ ...c, mode: 'net' });
  const lay = customLayout({ ...state, custom: { ...c, mode: 'box' } }, 0);
  const panels = lay.nodes.map(n => ({
    id: n.id, name: n.name, parent: n.parent, edge: n.edge,
    w: n.w, h: n.h, shape: n.shape, corner: n.corner, angle: n.angle, role: n.role
  }));
  return normalizeCustom({ ...c, mode: 'net', panels });
}

// —— Plantilla «Envolvente»: caja con alas laterales, dorso y solapas de pestañas ——
// Se construye como una red normal, así reutiliza 2D, 3D, UV y diseño por cara.
export function wrapCustom(state) {
  const c = normalizeCustom(state.custom);
  const L = Math.max(20, state.L || 80);
  const H = Math.max(20, state.H || 120);
  const D = Math.max(10, state.W || 40);
  const wp = state.wrap || (state.custom && state.custom.__wrap) || {};
  const flap = wp.flap > 0 ? wp.flap : Math.max(20, D); // fondo de la cara superior/inferior
  const outer = wp.outer > 0 ? wp.outer : Math.max(20, L / 2 + 1);
  const inner = wp.inner > 0 ? wp.inner : Math.max(20, D);
  const tab = wp.tab > 0 ? wp.tab : 15;
  const sideTabW = wp.sideTab > 0 ? wp.sideTab : Math.min(30, Math.max(10, D * 0.35));
  const sideTabOut = Math.max(20, H * 0.28);
  const slot = Math.max(wp.slot > 0 ? wp.slot : Math.min(D * 0.7, 50), sideTabW + 12);
  const slotW = wp.slotW > 0 ? wp.slotW : 1.2;
  const sideSlits = () => {
    const y1 = Math.min(D * 0.12, Math.max(2, D * 0.12));
    const y2 = Math.min(D * 0.92, y1 + slot);
    return [
      { x1: H * 0.28, y1, x2: H * 0.28, y2, w: slotW },
      { x1: H * 0.72, y1, x2: H * 0.72, y2, w: slotW }
    ];
  };
  const tuckW = Math.max(20, (L - 40) / 2);
  const tuck = (id, name, parent, edge) => ({
    id, name, parent, edge, w: tuckW, h: tab, shape: 'chamfer', corner: Math.min(4, tab * 0.4),
    angle: 90, role: 'design'
  });
  const panels = [
    { id: 'back', name: 'CARA TRASERA', parent: null, edge: 'far', w: L, h: H, shape: 'rect', corner: 0, angle: 90, role: 'hero' },
    { id: 'left', name: 'CARA IZQUIERDA', parent: 'back', edge: 'xmin', w: H, h: D, shape: 'rect', corner: 0, angle: 90, role: 'design', slits: sideSlits() },
    { id: 'outer-left', name: 'CARA EXTERIOR IZQUIERDA', parent: 'left', edge: 'far', w: H, h: outer, shape: 'rect', corner: 0, angle: 90, zOff: 0.2, role: 'design' },
    { id: 'inner-left', name: 'CARA INTERIOR IZQUIERDA', parent: 'outer-left', edge: 'far', w: H, h: inner, shape: 'rect', corner: 0, angle: 270, sign: 1, zOff: 0.2, role: 'design' },
    { id: 'right', name: 'CARA DERECHA', parent: 'back', edge: 'xmax', w: H, h: D, shape: 'rect', corner: 0, angle: 90, role: 'design', slits: sideSlits() },
    { id: 'outer-right', name: 'CARA EXTERIOR DERECHA', parent: 'right', edge: 'far', w: H, h: outer, shape: 'rect', corner: 0, angle: 90, zOff: 0.4, role: 'design' },
    { id: 'inner-right', name: 'CARA INTERIOR DERECHA', parent: 'outer-right', edge: 'far', w: H, h: inner, shape: 'rect', corner: 0, angle: 270, sign: 1, zOff: 0.4, role: 'design' },
    { id: 'top', name: 'CARA SUPERIOR', parent: 'back', edge: 'far', w: L, h: flap, shape: 'rect', corner: 0, angle: 90, zOff: 0.15, role: 'design' },
    { id: 'bottom', name: 'CARA INFERIOR', parent: 'back', edge: 'near', w: L, h: flap, shape: 'rect', corner: 0, angle: 90, zOff: 0.15, role: 'design' },
    tuck('top-tuck-left', 'Pestaña frontal sup. izq.', 'top', 'far'),
    tuck('top-tuck-right', 'Pestaña frontal sup. der.', 'top', 'far'),
    tuck('bottom-tuck-left', 'Pestaña frontal inf. izq.', 'bottom', 'far'),
    tuck('bottom-tuck-right', 'Pestaña frontal inf. der.', 'bottom', 'far'),
    { id: 'top-tab-left', name: 'Pestaña lateral sup. izq.', parent: 'top', edge: 'xmin', w: sideTabW, h: sideTabOut, shape: 'side-tab', corner: 3, angle: 90, align: 'start', role: 'design' },
    { id: 'top-tab-right', name: 'Pestaña lateral sup. der.', parent: 'top', edge: 'xmax', w: sideTabW, h: sideTabOut, shape: 'side-tab', corner: 3, angle: 90, align: 'start', role: 'design' },
    { id: 'bottom-tab-left', name: 'Pestaña lateral inf. izq.', parent: 'bottom', edge: 'xmin', w: sideTabW, h: sideTabOut, shape: 'side-tab', corner: 3, angle: 90, align: 'start', role: 'design' },
    { id: 'bottom-tab-right', name: 'Pestaña lateral inf. der.', parent: 'bottom', edge: 'xmax', w: sideTabW, h: sideTabOut, shape: 'side-tab', corner: 3, angle: 90, align: 'start', role: 'design' }
  ];
  return normalizeCustom({ ...c, mode: 'net', panels, childGap: 20 });
}

// —— Presets de red libre ——
function trayPanels(prefix, L, W, H, opts = {}) {
  const tabs = opts.tabs !== false;
  const tab = opts.tab == null ? 16 : opts.tab;
  const hero = opts.hero || null;
  const baseId = prefix + '-base';
  const out = [{ id: baseId, name: 'Fondo', parent: null, edge: 'far', w: L, h: W, shape: 'rect', corner: 0, angle: 90, role: 'design' }];
  const walls = [
    ['front', 'near', L], ['back', 'far', L], ['left', 'xmin', W], ['right', 'xmax', W]
  ];
  for (const [id, edge, w] of walls) {
    out.push({ id: prefix + '-' + id, name: WALL_NAMES_LONG[id], parent: baseId, edge, w, h: H, shape: 'rect', corner: 0, angle: 90, role: hero === id ? 'hero' : 'design' });
    if (tabs) for (const side of ['xmin', 'xmax']) {
      out.push({
        id: prefix + '-' + id + '-tab-' + side, name: 'Pestaña', parent: prefix + '-' + id, edge: side,
        w: H, h: Math.min(tab, Math.max(4, H * 0.6)), shape: 'ear', corner: 0, angle: 90, role: 'design'
      });
    }
  }
  return out;
}

// —— Presets auto-bloqueantes (una pieza, sin pegamento) ——
// Caja rebanada: base triangular, paredes verticales, tapa unida y lengüeta
// que entra en una ranura. Reproduce el patrón de caja-rebanada de la imagen.
const SELF_SLOT = 0.8;
const selfPanel = (id, name, parent, edge, w, h, opt = {}) => ({
  id, name, parent, edge, w, h,
  shape: opt.shape || 'rect', corner: opt.corner || 0,
  angle: opt.angle == null ? 90 : opt.angle,
  sign: opt.sign, role: opt.role || 'design',
  slits: opt.slits || [], folds: opt.folds || [],
  align: opt.align || 'center', shift: opt.shift || 0, zOff: opt.zOff || 0, n: opt.n
});
const selfSlit = (x1, y1, x2, y2, w = SELF_SLOT) => ({ x1, y1, x2, y2, w });

function slicePanels(state, equal = false) {
  const side = Math.max(80, Math.min(400, +state.L || 140));
  const H = Math.max(20, Math.min(200, +state.H || 44));
  const tab = Math.max(10, Math.min(22, H * 0.4));
  const ear = Math.min(14, Math.max(8, H * 0.28));
  if (equal) {
    const alt = side * Math.sqrt(3) / 2;
    const p = 'eq';
    return [
      selfPanel(p + '-base', 'Fondo triangular', null, 'far', side, alt, { shape: 'triangle', role: 'hero' }),
      selfPanel(p + '-back', 'Dorso', p + '-base', 'e0', side, H, { sign: 1 }),
      selfPanel(p + '-right', 'Lateral derecho', p + '-base', 'e1', side, H, { sign: 1 }),
      selfPanel(p + '-left', 'Lateral izquierdo', p + '-base', 'e2', side, H, { sign: 1, slits: [selfSlit(side * 0.12, H - tab, side * 0.88, H - tab)] }),
      selfPanel(p + '-lid', 'Tapa unida', p + '-back', 'far', side, alt, { shape: 'triangle', sign: 1 }),
      selfPanel(p + '-tab', 'Lengüeta', p + '-lid', 'e1', side, tab, { shape: 'tuck', sign: 1 }),
      selfPanel(p + '-ear-back', 'Oreja dorso derecha', p + '-back', 'xmax', H, ear, { shape: 'ear', sign: 1 }),
      selfPanel(p + '-ear-back-left', 'Oreja dorso izquierda', p + '-back', 'xmin', H, ear, { shape: 'ear', sign: 1 })
    ];
  }
  const hyp = side * Math.SQRT2;
  const p = 'slice';
  return [
    selfPanel(p + '-base', 'Fondo de rebanada', null, 'far', side, side, { shape: 'rttri', role: 'hero' }),
    selfPanel(p + '-back', 'Dorso', p + '-base', 'e0', side, H, { sign: 1 }),
    selfPanel(p + '-front', 'Frente inclinado', p + '-base', 'e1', hyp, H, { sign: 1, slits: [selfSlit(hyp * 0.12, H - tab, hyp * 0.88, H - tab)] }),
    selfPanel(p + '-left', 'Lateral', p + '-base', 'e2', side, H, { sign: 1 }),
    selfPanel(p + '-lid', 'Tapa unida', p + '-back', 'far', side, side, { shape: 'rttri', sign: 1 }),
    selfPanel(p + '-tab', 'Lengüeta frontal', p + '-lid', 'e1', hyp, tab, { shape: 'tuck', sign: 1 }),
    selfPanel(p + '-ear-back', 'Oreja dorso derecha', p + '-back', 'xmax', H, ear, { shape: 'ear', sign: 1 }),
    selfPanel(p + '-ear-back-left', 'Oreja dorso izquierda', p + '-back', 'xmin', H, ear, { shape: 'ear', sign: 1 })
  ];
}

function onePiecePanels(state) {
  const L = Math.max(20, Math.min(1200, +state.L || 84));
  const W = Math.max(20, Math.min(1200, +state.W || 84));
  const H = Math.max(20, Math.min(1200, +state.H || 44));
  const tab = Math.max(10, Math.min(24, H * 0.35));
  const ear = Math.min(14, Math.max(8, H * 0.28));
  const p = 'one';
  return [
    selfPanel(p + '-base', 'Fondo', null, 'far', L, W, { role: 'hero' }),
    selfPanel(p + '-front', 'Frente', p + '-base', 'near', L, H, { sign: 1, slits: [selfSlit(L * 0.1, H - tab, L * 0.9, H - tab)] }),
    selfPanel(p + '-back', 'Dorso', p + '-base', 'far', L, H, { sign: 1 }),
    selfPanel(p + '-left', 'Lateral izquierdo', p + '-base', 'xmin', W, H, { sign: 1 }),
    selfPanel(p + '-right', 'Lateral derecho', p + '-base', 'xmax', W, H, { sign: 1 }),
    selfPanel(p + '-lid', 'Tapa unida', p + '-back', 'far', L, W, { sign: 1 }),
    selfPanel(p + '-tab', 'Lengüeta', p + '-lid', 'far', Math.max(20, L - 20), tab, { shape: 'tuck', sign: 1 }),
    selfPanel(p + '-ear-left', 'Oreja frontal izquierda', p + '-left', 'xmin', H, ear, { shape: 'ear', sign: 1 }),
    selfPanel(p + '-ear-right', 'Oreja frontal derecha', p + '-right', 'xmax', H, ear, { shape: 'ear', sign: 1 }),
    selfPanel(p + '-ear-back-left', 'Oreja trasera izquierda', p + '-back', 'xmin', H, ear, { shape: 'ear', sign: 1 }),
    selfPanel(p + '-ear-back-right', 'Oreja trasera derecha', p + '-back', 'xmax', H, ear, { shape: 'ear', sign: 1 })
  ];
}

export const NET_PRESETS = [
  {
    id: 'slice-lock', name: 'Rebanada autobloqueante', sub: 'Triángulo recto · tapa y lengüeta',
    make: state => slicePanels(state, false)
  },
  {
    id: 'slice-eq', name: 'Rebanada equilátera', sub: 'Triángulo · tapa y lengüeta',
    make: state => slicePanels(state, true)
  },
  {
    id: 'one-piece', name: 'Caja de una pieza', sub: 'Fondo, paredes, tapa y lengüeta',
    make: state => onePiecePanels(state)
  },
  {
    id: 'two-halves', name: 'Caja en dos mitades', sub: 'Dos bandejas que se unen',
    make: state => [
      ...trayPanels('a', state.L, state.W, Math.max(10, state.H * 0.5), { hero: 'front', tab: 16 }),
      ...trayPanels('b', state.L + 2, state.W + 2, Math.max(10, state.H * 0.5), { tab: 16 })
    ]
  },
  {
    id: 'base-lid', name: 'Base + tapa', sub: 'Dos piezas independientes',
    make: state => [
      ...trayPanels('base', state.L, state.W, state.H, { hero: 'front', tab: 16 }),
      ...trayPanels('lid', state.L + 2, state.W + 2, Math.max(14, state.H * 0.4), { tab: 16 })
    ]
  },
  {
    id: 'tray-insert', name: 'Bandeja + divisor', sub: 'Pieza interior aparte',
    make: state => [
      ...trayPanels('box', state.L, state.W, state.H, { hero: 'front', tab: 16 }),
      { id: 'divider', name: 'Divisor interior', parent: null, edge: 'far', w: state.L, h: state.W, shape: 'rect', corner: 0, angle: 90, role: 'design' }
    ]
  },
  {
    id: 'free', name: 'Red libre', sub: 'Empieza con una cara',
    make: state => [
      { id: 'p1', name: 'Cara 1', parent: null, edge: 'far', w: state.L, h: state.W, shape: 'rect', corner: 0, angle: 90, role: 'design' }
    ]
  }
];

export function applyNetPreset(id, current, state) {
  const p = NET_PRESETS.find(x => x.id === id);
  const base = normalizeCustom(current);
  if (!p) return base;
  return normalizeCustom({ ...base, mode: 'net', panels: p.make(state) });
}

export function nextPanelId(c) {
  const ids = new Set((c.panels || []).map(p => p.id));
  let i = 1;
  while (ids.has('p' + i)) i++;
  return 'p' + i;
}

export function edgeFree(custom, parentId, edge, exceptId) {
  const c = normalizeCustom(custom);
  return !(c.panels || []).some(p => p.parent === parentId && p.edge === edge && p.id !== exceptId);
}

export function addNetPanel(custom, state, parentId, edge, typeId) {
  const c = normalizeCustom(custom);
  const type = PANEL_TYPES.find(x => x.id === typeId) || PANEL_TYPES[0];
  const id = nextPanelId(c);
  if (!parentId) {
    return normalizeCustom({
      ...c,
      panels: [...c.panels, {
        id, name: 'Pieza ' + (c.panels.filter(p => !p.parent).length + 1), parent: null, edge: 'far',
        w: state.L, h: state.W, shape: 'rect', corner: 0, angle: 90, role: 'design'
      }]
    });
  }
  const parent = c.panels.find(p => p.id === parentId);
  if (!parent) return c;
  const edgeLen = (edge === 'far' || edge === 'near') ? parent.w : parent.h;
  const h = typeId === 'wall' ? Math.max(20, state.H) : type.h > 0 ? type.h : 40;
  return normalizeCustom({
    ...c,
    panels: [...c.panels, {
      id,
      name: type.name + ' ' + (c.panels.length + 1),
      parent: parentId,
      edge,
      w: edgeLen,
      h,
      shape: type.shape,
      corner: 0,
      angle: 90,
      role: 'design'
    }]
  });
}

function nextLineId(c) {
  const ids = new Set((c.lines || []).map(l => l.id));
  let i = 1;
  while (ids.has('l' + i)) i++;
  return 'l' + i;
}

export function addNetLine(custom, panelId, kind = 'cut') {
  const c = normalizeCustom(custom);
  const p = c.panels.find(x => x.id === panelId);
  if (!p) return c;
  const line = {
    id: nextLineId(c), panelId, kind: ['cut', 'crease', 'slot'].includes(kind) ? kind : 'cut',
    x1: p.w * 0.25, y1: p.h * 0.5, x2: p.w * 0.75, y2: p.h * 0.5,
    w: kind === 'slot' ? 1.2 : 0
  };
  return normalizeCustom({ ...c, lines: [...c.lines, line] });
}

export function updateNetLine(custom, id, patch) {
  const c = normalizeCustom(custom);
  return normalizeCustom({ ...c, lines: c.lines.map(l => l.id === id ? { ...l, ...patch } : l) });
}

export function deleteNetLine(custom, id) {
  const c = normalizeCustom(custom);
  return normalizeCustom({ ...c, lines: c.lines.filter(l => l.id !== id) });
}

export function duplicateNetPanel(custom, id) {
  const c = normalizeCustom(custom);
  const src = c.panels.find(p => p.id === id);
  if (!src) return c;
  const copy = {
    ...src,
    id: nextPanelId(c),
    name: src.name + ' copia',
    parent: null,
    edge: 'far',
    role: 'design',
    align: 'center',
    zOff: 0
  };
  return normalizeCustom({ ...c, panels: [...c.panels, copy] });
}

export function updateNetPanel(custom, id, patch) {
  const c = normalizeCustom(custom);
  const panels = c.panels.map(p => {
    if (p.id === id) return { ...p, ...patch };
    if (patch.role === 'hero') return { ...p, role: 'design' };
    return p;
  });
  return normalizeCustom({ ...c, panels });
}

export function deleteNetPanel(custom, id) {
  const c = normalizeCustom(custom);
  const kill = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of c.panels) {
      if (p.parent && kill.has(p.parent) && !kill.has(p.id)) { kill.add(p.id); changed = true; }
    }
  }
  let panels = c.panels.filter(p => !kill.has(p.id));
  if (!panels.some(p => !p.parent)) {
    panels = panels.concat([{ id: nextPanelId({ panels }), name: 'Pieza 1', parent: null, edge: 'far', w: 80, h: 40, shape: 'rect', corner: 0, angle: 90, role: 'design' }]);
  }
  return normalizeCustom({ ...c, panels });
}

// —— Presets de caja rápida (mode box) ——
export const CUSTOM_PRESETS = [
  {
    id: 'tuck', name: 'Caja con solapa', sub: 'Solapa + lengüeta',
    patch: { build: 'tuck', lidWall: 'back', lidShape: 'rect', baseShape: 'rect', cornerTabs: true, walls: { front: { shape: 'rect' }, back: { shape: 'rect' }, left: { shape: 'rect' }, right: { shape: 'rect' } } }
  },
  {
    id: 'lid', name: 'Caja con tapa', sub: 'Tapa plana',
    patch: { build: 'lid', lidWall: 'back', lidShape: 'rect', baseShape: 'rect', cornerTabs: true }
  },
  {
    id: 'tray', name: 'Bandeja abierta', sub: 'Sin tapa',
    patch: { build: 'open', baseShape: 'rect', cornerTabs: true }
  },
  {
    id: 'gift', name: 'Caja de regalo', sub: 'Esquinas suaves',
    patch: { build: 'tuck', lidWall: 'back', lidShape: 'round', lidCorner: 6, baseShape: 'round', baseCorner: 6, cornerTabs: true, walls: { front: { shape: 'round', corner: 6 }, back: { shape: 'round', corner: 6 }, left: { shape: 'round', corner: 6 }, right: { shape: 'round', corner: 6 } } }
  }
];

export function applyCustomPreset(id, current) {
  const p = CUSTOM_PRESETS.find(x => x.id === id);
  if (!p) return normalizeCustom(current);
  const base = normalizeCustom(current);
  const patch = p.patch;
  const walls = { ...base.walls };
  if (patch.walls) for (const k of WALL_IDS) walls[k] = { ...walls[k], ...(patch.walls[k] || {}) };
  return normalizeCustom({ ...base, ...patch, mode: 'box', walls, panels: [] });
}

// —— Plantilla de la biblioteca → red editable ——
// Recorre el árbol de plegado de makePieces() (se pasa como argumento: fold.js importa este módulo).
// shortcut: el layout 2D deriva de aristas y centra cada hija en su borde, y se pierden sign/lift/asm del 3D
// (montaje de tapa/cajón); las tapas poligonales de cyl/hex conservan su n. Subir a offsets exactos si hiciera falta.
const TPL_NAMES = { tuck: 'Lengüeta', dust: 'Solapa guardapolvo', glue: 'Pestaña de pegado', ear: 'Pestaña de esquina', lid: 'Tapa', disc: 'Tapa poligonal' };
export function templateToNet(state, t, makePieces) {
  if (state.tpl === 'wrap' || state.tpl === 'custom') return toNetCustom(state);
  const c = normalizeCustom(state.custom);
  const pieces = makePieces(state.tpl, state.L, state.W, state.H, t, state.glue, state.custom, state.wrap);
  const panels = [];
  const used = new Set();
  let seq = 0, roots = 0, heroSeen = false;
  const walk = (spec, parent, rot) => {
    let id = spec.panelId && !used.has(spec.panelId) ? String(spec.panelId) : null;
    while (!id || used.has(id)) id = 't' + (++seq);
    used.add(id);
    const shape = spec.shape || 'rect';
    const [, , uw, uh] = spec.uv;
    let w, h;
    if (!parent) { w = rot ? uh : uw; h = rot ? uw : uh; } // uvRot=90: la raíz gira en el plano
    else if (shape === 'disc') { w = parent.edge2len(spec.edge); h = spec.out; }
    else if (spec.attach === 'l' || spec.attach === 'r') { w = uh; h = uw; } // hija lateral: la bisagra es vertical
    else { w = uw; h = uh; }
    const hero = spec.role === 'hero' && !heroSeen;
    if (hero) heroSeen = true;
    const p = {
      id, name: TPL_NAMES[shape] || (parent ? 'Cara ' + (panels.length + 1) : 'Pieza ' + (++roots)),
      parent: parent ? parent.id : null, edge: spec.edge || 'far', w, h, shape, n: spec.n, corner: 0,
      angle: spec.angle == null ? 90 : spec.angle, role: hero ? 'hero' : 'design'
    };
    panels.push(p);
    const me = { id, edge2len: e => (e === 'far' || e === 'near' ? w : h) };
    for (const k of (spec.kids || [])) walk(k, me, false);
  };
  for (const pc of pieces) walk({ ...pc.tree, role: pc.tree.role }, null, pc.tree.uvRot === 90);
  return normalizeCustom({ ...c, mode: 'net', panels, lines: [], wrapStyle: false, joinPreview: false });
}

// —— Encajes (locks) ——
export const LOCK_TYPES = [
  { id: 'slot', name: 'Ranura simple' },
  { id: 'pair', name: 'Par de ranuras' },
  { id: 'tabslot', name: 'Pestaña y ranura' },
  { id: 'locktab', name: 'Pestaña de cierre' }
];
const freeEdgeOf = (c, id) => ['far', 'xmin', 'xmax', 'near'].find(e => edgeFree(c, id, e));

// Añade el encaje a la cara `panelId`. Usa `lines` (kind slot), así se editan con las herramientas de línea.
// tabslot: ranura en la cara + pestaña del mismo ancho en `opt.target`. locktab: pestaña estrecha en un borde libre.
export function addLock(custom, panelId, kind, opt = {}) {
  let c = normalizeCustom(custom);
  const p = c.panels.find(x => x.id === panelId);
  if (!p) return c;
  const slotW = opt.slotW > 0 ? opt.slotW : 1.5;
  const maxLen = Math.max(3, p.w * 0.8);
  const len = clamp(num(opt.len, Math.min(p.w * 0.4, 30)), 3, maxLen);
  const slot = (cx, l) => {
    const line = { id: nextLineId(c), panelId, kind: 'slot', x1: cx - l / 2, y1: p.h / 2, x2: cx + l / 2, y2: p.h / 2, w: slotW };
    c = normalizeCustom({ ...c, lines: [...c.lines, line] });
  };
  const tab = (parentId, w, h) => {
    const edge = freeEdgeOf(c, parentId);
    if (!edge) return;
    c = normalizeCustom({ ...c, panels: [...c.panels, { id: nextPanelId(c), name: 'Lengüeta ' + (c.panels.length + 1), parent: parentId, edge, w, h, shape: 'tuck', corner: 0, angle: 90, role: 'design' }] });
  };
  if (kind === 'pair') { const l = Math.min(len, p.w * 0.22); slot(p.w * 0.3, l); slot(p.w * 0.7, l); }
  else if (kind === 'locktab') tab(panelId, Math.max(4, ((p.w) * 0.4)), 14);
  else {
    slot(p.w / 2, len);
    if (kind === 'tabslot' && opt.target && opt.target !== panelId) tab(opt.target, len, 14);
  }
  return c;
}
