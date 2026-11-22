// Preflight compartido por Estructura, Mi caja y Salida.
// No sustituye al RIP/láser: detecta errores de modelo y avisos de preparación.
import { normalizeCustom, mapLocal } from './custom.js';
import { sheetOf, fmtCm, fmtMm } from '../units.js';
import { t } from '../i18n/index.js';

const segLen = sg => {
  let l = 0;
  for (let i = 0; i < sg.pts.length - 1; i++) l += Math.hypot(sg.pts[i + 1][0] - sg.pts[i][0], sg.pts[i + 1][1] - sg.pts[i][1]);
  return l;
};
const ptsLen = pts => {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return l;
};
const r1 = v => Math.round(v * 10) / 10;
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const FLAPS = ['dust', 'tuck', 'ear', 'glue', 'wrap-flap'];

// Razonamiento sobre la red: devuelve hallazgos { level, key, vars, fix? }.
// `key` es el texto en español (clave i18n); `fix()` devuelve un parche { panels?, lines? } sobre el custom normalizado.
// Solo ofrece correcciones en modo red: en caja rápida las caras salen de los parámetros y no se pueden parchear.
export function netFindings(c, lay) {
  const out = [];
  const net = c.mode === 'net';
  const add = (level, key, vars, fix) => out.push({ level, key, vars, fix: net ? fix : undefined });
  const setP = (id, patch) => () => ({ panels: c.panels.map(p => p.id === id ? { ...p, ...patch } : p) });

  for (const n of lay.nodes) {
    if (Math.min(n.w, n.h) < 2) add('err', 'La cara «{name}» mide menos de 2 mm.', { name: n.name }, setP(n.id, { w: Math.max(n.w, 10), h: Math.max(n.h, 10) }));
    if (!n.parent) continue;
    const par = lay.byId.get(n.parent);
    const polyEdge = /^e\d+$/.test(n.edge);
    let along, across;
    if (polyEdge && par.shapePts && par.shapePts.length >= 3) {
      const i = Number(n.edge.slice(1)) % par.shapePts.length;
      const p0 = par.shapePts[i], p1 = par.shapePts[(i + 1) % par.shapePts.length];
      along = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      across = Math.max(par.w, par.h);
    } else {
      along = n.edge === 'far' || n.edge === 'near' ? par.w : par.h;
      across = n.edge === 'far' || n.edge === 'near' ? par.h : par.w;
    }
    if (n.w > along + 0.5) add('warn', '«{name}» es más ancha que el borde al que se une ({w} > {max} mm).', { name: n.name, w: r1(n.w), max: r1(along) }, setP(n.id, { w: r1(along) }));
    if (FLAPS.includes(n.shape)) {
      const tuck = n.shape === 'tuck';
      if (n.h > (tuck ? across * 0.8 : across) + 0.5) {
        add('warn', tuck ? 'La lengüeta «{name}» es más profunda que su tapa ({h} mm sobre {max} mm).' : 'La solapa «{name}» es más profunda que la cara contra la que pliega ({h} mm sobre {max} mm).',
          { name: n.name, h: r1(n.h), max: r1(across) }, setP(n.id, { h: r1(tuck ? across * 0.58 : across) }));
      }
    }
    if (n.angle <= 0.5 || n.angle >= 359.5) add('warn', '«{name}» tiene ángulo de plegado {a}°: no pliega.', { name: n.name, a: Math.round(n.angle) }, setP(n.id, { angle: 90 }));
  }

  // Ranuras: las de las líneas libres y las que ya trae la cara.
  const slots = [];
  for (const l of c.lines) if (l.kind === 'slot') slots.push({ id: l.panelId, q: l });
  for (const n of lay.nodes) for (const q of (n.slits || [])) slots.push({ id: n.id, q });
  let maxSlot = 0;
  const bad = new Set();
  for (const { id, q } of slots) {
    const n = lay.byId.get(id);
    if (!n) continue;
    maxSlot = Math.max(maxSlot, Math.hypot(q.x2 - q.x1, q.y2 - q.y1));
    const outside = [q.x1, q.x2].some(x => x < -0.2 || x > n.w + 0.2) || [q.y1, q.y2].some(y => y < -0.2 || y > n.h + 0.2);
    if (outside && !bad.has(id)) {
      bad.add(id);
      const clampQ = z => ({ ...z, x1: clampN(z.x1, 0, n.w), x2: clampN(z.x2, 0, n.w), y1: clampN(z.y1, 0, n.h), y2: clampN(z.y2, 0, n.h) });
      add('err', 'Hay ranuras de «{name}» fuera de su cara o más largas que ella.', { name: n.name }, () => ({
        lines: c.lines.map(l => l.panelId === id && l.kind === 'slot' ? clampQ(l) : l),
        panels: c.panels.map(p => p.id === id ? { ...p, slits: (p.slits || []).map(clampQ) } : p)
      }));
    }
  }
  if (maxSlot > 0) {
    for (const n of lay.nodes) {
      if (n.shape === 'side-tab' && n.w > maxSlot + 0.5) {
        add('warn', 'La pestaña lateral «{name}» ({w} mm) es más ancha que la ranura mayor ({s} mm).', { name: n.name, w: r1(n.w), s: r1(maxSlot) }, setP(n.id, { w: Math.max(2, r1(maxSlot - 1)) }));
      }
    }
  }

  // Solapes en el plano: cajas envolventes de la silueta; padre/hija solo se tocan en la bisagra.
  const boxes = lay.nodes.map(n => {
    const pts = n.shapePts.map(p => mapLocal(n, p[0], p[1]));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  const hits = [];
  for (let i = 0; i < lay.nodes.length; i++) {
    for (let j = i + 1; j < lay.nodes.length; j++) {
      const a = lay.nodes[i], b = lay.nodes[j];
      if (a.parent === b.id || b.parent === a.id) continue;
      const dx = Math.min(boxes[i][2], boxes[j][2]) - Math.max(boxes[i][0], boxes[j][0]);
      const dy = Math.min(boxes[i][3], boxes[j][3]) - Math.max(boxes[i][1], boxes[j][1]);
      if (dx > 1 && dy > 1) hits.push(a.name + ' / ' + b.name);
    }
  }
  // Sin fix: mover caras solapadas es una decisión de diseño.
  if (hits.length) add('warn', '{n} par(es) de caras se solapan en el plano: {list}.', { n: hits.length, list: hits.slice(0, 3).join('; ') + (hits.length > 3 ? '…' : '') });
  return out;
}

export function preflightOf(s, mat, g, lay) {
  const rows = [];
  const add = (level, label, vars, fix) => rows.push({ level, label: t(label, vars), fix });
  const c = normalizeCustom(s.custom);
  const sheet = c.sheet === 'custom' ? c.sheetCustom : sheetOf(c.sheet);
  const netW = g.sbb[2] - g.sbb[0], netH = g.sbb[3] - g.sbb[1];
  const needW = netW + 2 * c.margin, needH = netH + 2 * c.margin;
  const fits = !sheet.w || (needW <= sheet.w && needH <= sheet.h) || (needW <= sheet.h && needH <= sheet.w);

  if (!g.panels.length) add('err', 'No hay caras diseñables.');
  const ids = g.panels.map(p => p.panelId);
  if (new Set(ids).size !== ids.length) add('err', 'Hay identificadores de cara duplicados.');
  const heroes = g.panels.filter(p => p.role === 'hero');
  if (heroes.length !== 1) add('err', 'Debe existir exactamente una cara principal (★).');
  else add('ok', 'Cara principal definida: {id}', { id: heroes[0].panelId });

  if (s.tpl === 'custom' && lay) {
    if (!lay.roots.length) add('err', 'La red no tiene ninguna pieza raíz.');
    else add('ok', '{r} pieza(s) · {n} cara(s)', { r: lay.roots.length, n: lay.nodes.length });
    if (lay.nodes.some(n => !n.shapePts || n.shapePts.length < 3)) add('err', 'Hay caras con silueta inválida.');
    const found = netFindings(c, lay);
    for (const f of found) add(f.level, f.key, f.vars, f.fix);
    if (!found.length) add('ok', 'Sin problemas de geometría en la red.');
  }

  const tiny = g.segs.filter(sg => segLen(sg) < 0.5 && segLen(sg) > 0);
  if (tiny.length) add('warn', '{n} tramo(s) de corte/pliegue miden menos de 0,5 mm.', { n: tiny.length });
  else add('ok', 'Sin tramos de línea degenerados.');

  // Encajes: son cortes reales y también una feature de ensamblaje.
  if (g.slotN) {
    const shortSlots = g.slots.filter(sl => ptsLen(sl.pts) < 1);
    const outside = g.slots.filter(sl => {
      if (!sl.panelId) return false;
      const panel = g.panels.find(p => p.panelId === sl.panelId);
      if (!panel) return true;
      const xs = panel.pts.map(p => p[0]), ys = panel.pts.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      return sl.pts.some(p => p[0] < x0 - 0.5 || p[0] > x1 + 0.5 || p[1] < y0 - 0.5 || p[1] > y1 + 0.5);
    });
    if (shortSlots.length) add('err', '{n} encaje(s) miden menos de 1 mm.', { n: shortSlots.length });
    if (outside.length) add('err', '{n} encaje(s) quedan fuera de su cara.', { n: outside.length });
    if (!shortSlots.length && !outside.length) add('ok', '{n} encaje(s) de solapa detectados y marcados como corte ({len} de corte).', { n: g.slotN, len: fmtMm(g.slotLen) });
  }

  if (s.bleed < mat.bleed) add('warn', 'Sangrado {b} < recomendado {r} ({note}).', { b: fmtMm(s.bleed), r: fmtMm(mat.bleed), note: mat.note });
  else add('ok', 'Sangrado correcto: {b}.', { b: fmtMm(s.bleed) });

  if (c.kerf > 0.5) add('warn', 'Kerf {k} es alto; revisa la compensación de la máquina.', { k: fmtMm(c.kerf, 2) });
  else add('ok', 'Kerf declarado: {k}.', { k: fmtMm(c.kerf, 2) });

  if (!fits) add('err', 'El despliegue con márgenes ({need}) no cabe en la placa {sheet}.', { need: fmtCm(needW) + ' × ' + fmtCm(needH), sheet: fmtCm(sheet.w) + ' × ' + fmtCm(sheet.h) });
  else add('ok', sheet.w ? 'Cabe en placa {sheet}.' : 'Exportación ajustada al contorno.', { sheet: sheet.w ? fmtCm(sheet.w) + ' × ' + fmtCm(sheet.h) : '' });

  add('info', 'Contorno cerrado, autointersecciones y separación mínima real: revisar en el RIP / software láser.');
  return {
    rows,
    errors: rows.filter(r => r.level === 'err').length,
    warnings: rows.filter(r => r.level === 'warn').length,
    blocking: rows.some(r => r.level === 'err')
  };
}

export const LEVEL_DOT = { ok: '#3f9e5f', warn: '#d0a02a', err: '#d05a2a', info: '#9a8f7e' };
