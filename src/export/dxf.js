// Exportación DXF 1:1 para láser / corte. Dos versiones: R12 (AC1009) y AutoCAD 2000 (AC1015). Sin dependencias.
// Capas: CORTE (rojo, corte), MARCADO (azul, pliegue), PUNTEADO (azul, discontinuo).
// PUNTEADO se parte en trazos reales (3 mm on / 2 mm off) para que se vea punteado aunque el software láser ignore el tipo de línea.
// Unidades mm 1:1. La geometría usa Y hacia abajo; en DXF y = alto de la placa - y (todo en positivo, origen abajo a la izquierda, como esperan LightBurn/RDWorks).
import { geomOf } from '../dieline/geom.js';
import { itemMatrix, uniqueSheets } from './nesting.js';
import { laserSvgOf } from './svg.js';
import { saveFile } from '../platform.js';

const LAYERS = [['0', 7, 'CONTINUOUS'], ['CORTE', 1, 'CONTINUOUS'], ['MARCADO', 5, 'CONTINUOUS'], ['PUNTEADO', 5, 'DASHED']];
const LAYER_OF = { cut: 'CORTE', crease: 'MARCADO' };
const num = v => String(Math.round(v * 1e6) / 1e6 + 0);
const samePt = (a, b) => num(a[0]) === num(b[0]) && num(a[1]) === num(b[1]);
const tagOf = version => (version === 'R12' ? 'r12' : '2000');

// Trazos del punteado: el patrón sigue por los vértices (no se reinicia en cada tramo).
export function dashPieces(pts, dash = 3, gap = 2) {
  const out = [], period = dash + gap;
  let pos = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay);
    let d = 0;
    while (L - d > 1e-9) {
      const ph = pos % period, on = ph < dash;
      const step = Math.max(1e-9, Math.min(L - d, on ? dash - ph : period - ph)); // 1e-9: evita bucles si la fase cae justo en un límite
      if (on) {
        const u0 = d / L, u1 = (d + step) / L;
        out.push([[ax + (bx - ax) * u0, ay + (by - ay) * u0], [ax + (bx - ax) * u1, ay + (by - ay) * u1]]);
      }
      d += step; pos += step;
    }
  }
  return out;
}

// Entidades ya con Y invertida. Corte/pliegue = polilíneas (cerradas si el primer punto repite el último); punteado = trazos.
function entitiesOf(segs, dash, gap, H) {
  const flip = p => [p[0], H - p[1]];
  const ents = [];
  for (const sg of segs) {
    if (sg.t === 'perf') {
      for (const [a, b] of dashPieces(sg.pts, dash, gap)) ents.push({ kind: 'line', layer: 'PUNTEADO', a: flip(a), b: flip(b) });
      continue;
    }
    const layer = LAYER_OF[sg.t];
    if (!layer || sg.pts.length < 2) continue;
    const closed = sg.pts.length > 3 && samePt(sg.pts[0], sg.pts[sg.pts.length - 1]);
    ents.push({ kind: 'poly', layer, closed, pts: (closed ? sg.pts.slice(0, -1) : sg.pts).map(flip) });
  }
  return ents;
}

function extentsOf(ents) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of ents) for (const p of e.kind === 'line' ? [e.a, e.b] : e.pts) {
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  return ents.length ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}

const extPairs = (A, [x0, y0, x1, y1]) => {
  A(9, '$EXTMIN'); A(10, num(x0)); A(20, num(y0)); A(30, 0);
  A(9, '$EXTMAX'); A(10, num(x1)); A(20, num(y1)); A(30, 0);
};

// Pares [código, valor] de un DXF R12 (AC1009): HEADER, TABLES (LTYPE, LAYER), ENTITIES con POLYLINE/VERTEX/SEQEND y LINE.
function r12Pairs(ents, ext) {
  const P = [], A = (c, v) => P.push([c, v]);
  A(0, 'SECTION'); A(2, 'HEADER');
  A(9, '$ACADVER'); A(1, 'AC1009');
  A(9, '$MEASUREMENT'); A(70, 1);
  extPairs(A, ext);
  A(0, 'ENDSEC');
  A(0, 'SECTION'); A(2, 'TABLES');
  A(0, 'TABLE'); A(2, 'LTYPE'); A(70, 2);
  A(0, 'LTYPE'); A(2, 'CONTINUOUS'); A(70, 0); A(3, 'Solid line'); A(72, 65); A(73, 0); A(40, 0);
  A(0, 'LTYPE'); A(2, 'DASHED'); A(70, 0); A(3, 'Dashed 3 on 2 off'); A(72, 65); A(73, 2); A(40, 5); A(49, 3); A(49, -2);
  A(0, 'ENDTAB');
  A(0, 'TABLE'); A(2, 'LAYER'); A(70, LAYERS.length);
  for (const [n, col, lt] of LAYERS) { A(0, 'LAYER'); A(2, n); A(70, 0); A(62, col); A(6, lt); }
  A(0, 'ENDTAB');
  A(0, 'ENDSEC');
  A(0, 'SECTION'); A(2, 'ENTITIES');
  for (const e of ents) {
    if (e.kind === 'line') {
      A(0, 'LINE'); A(8, e.layer); A(10, num(e.a[0])); A(20, num(e.a[1])); A(30, 0); A(11, num(e.b[0])); A(21, num(e.b[1])); A(31, 0);
      continue;
    }
    A(0, 'POLYLINE'); A(8, e.layer); A(66, 1); A(10, 0); A(20, 0); A(30, 0); A(70, e.closed ? 1 : 0);
    for (const p of e.pts) { A(0, 'VERTEX'); A(8, e.layer); A(10, num(p[0])); A(20, num(p[1])); A(30, 0); }
    A(0, 'SEQEND'); A(8, e.layer);
  }
  A(0, 'ENDSEC'); A(0, 'EOF');
  return P;
}

// Pares de un DXF AutoCAD 2000 (AC1015): handles y owners, tablas completas, BLOCKS, ENTITIES (LWPOLYLINE/LINE) y OBJECTS.
function r2000Pairs(ents, ext) {
  let seq = 0x10;
  const H = () => (seq++).toString(16).toUpperCase();
  const P = [], A = (c, v) => P.push([c, v]);
  const table = (name, count) => { const h = H(); A(0, 'TABLE'); A(2, name); A(5, h); A(330, 0); A(100, 'AcDbSymbolTable'); A(70, count); return h; };
  const rec = (type, owner, subs) => { const h = H(); A(0, type); A(5, h); A(330, owner); subs.forEach(([c, v]) => A(c, v)); return h; };
  const sym = (cls) => [[100, 'AcDbSymbolTableRecord'], [100, cls]];

  A(0, 'SECTION'); A(2, 'CLASSES'); A(0, 'ENDSEC');
  A(0, 'SECTION'); A(2, 'TABLES');
  let th = table('VPORT', 1);
  rec('VPORT', th, [...sym('AcDbViewportTableRecord'), [2, '*Active'], [70, 0], [10, 0], [20, 0], [11, 1], [21, 1], [12, 0.5], [22, 0.5],
    [13, 0], [23, 0], [14, 0.5], [24, 0.5], [15, 0.5], [25, 0.5], [16, 0], [26, 0], [36, 1], [17, 0], [27, 0], [37, 0], [40, 100],
    [41, 1.6], [42, 50], [43, 0], [44, 0], [50, 0], [51, 0], [71, 0], [72, 100], [73, 1], [74, 3], [75, 0], [76, 0], [77, 0], [78, 0]]);
  A(0, 'ENDTAB');
  th = table('LTYPE', 4);
  rec('LTYPE', th, [...sym('AcDbLinetypeTableRecord'), [2, 'ByBlock'], [70, 0], [3, ''], [72, 65], [73, 0], [40, 0]]);
  rec('LTYPE', th, [...sym('AcDbLinetypeTableRecord'), [2, 'ByLayer'], [70, 0], [3, ''], [72, 65], [73, 0], [40, 0]]);
  rec('LTYPE', th, [...sym('AcDbLinetypeTableRecord'), [2, 'CONTINUOUS'], [70, 0], [3, 'Solid line'], [72, 65], [73, 0], [40, 0]]);
  rec('LTYPE', th, [...sym('AcDbLinetypeTableRecord'), [2, 'DASHED'], [70, 0], [3, 'Dashed 3 on 2 off'], [72, 65], [73, 2], [40, 5], [49, 3], [74, 0], [49, -2], [74, 0]]);
  A(0, 'ENDTAB');
  th = table('LAYER', LAYERS.length);
  for (const [n, col, lt] of LAYERS) rec('LAYER', th, [...sym('AcDbLayerTableRecord'), [2, n], [70, 0], [62, col], [6, lt]]);
  A(0, 'ENDTAB');
  th = table('STYLE', 1);
  rec('STYLE', th, [...sym('AcDbTextStyleTableRecord'), [2, 'Standard'], [70, 0], [40, 0], [41, 1], [50, 0], [71, 0], [42, 0.2], [3, 'txt'], [4, '']]);
  A(0, 'ENDTAB');
  th = table('VIEW', 0); A(0, 'ENDTAB');
  th = table('UCS', 0); A(0, 'ENDTAB');
  th = table('APPID', 1);
  rec('APPID', th, [...sym('AcDbRegAppTableRecord'), [2, 'ACAD'], [70, 0]]);
  A(0, 'ENDTAB');
  th = table('DIMSTYLE', 1); A(100, 'AcDbDimStyleTable'); A(71, 1);
  { const h = H(); A(0, 'DIMSTYLE'); A(105, h); A(330, th); A(100, 'AcDbSymbolTableRecord'); A(100, 'AcDbDimStyleTableRecord'); A(2, 'Standard'); A(70, 0); }
  A(0, 'ENDTAB');
  th = table('BLOCK_RECORD', 2);
  const ms = rec('BLOCK_RECORD', th, [...sym('AcDbBlockTableRecord'), [2, '*Model_Space'], [340, 0], [70, 0], [280, 1], [281, 0]]);
  const ps = rec('BLOCK_RECORD', th, [...sym('AcDbBlockTableRecord'), [2, '*Paper_Space'], [340, 0], [70, 0], [280, 1], [281, 0]]);
  A(0, 'ENDTAB');
  A(0, 'ENDSEC');

  A(0, 'SECTION'); A(2, 'BLOCKS');
  for (const [name, owner] of [['*Model_Space', ms], ['*Paper_Space', ps]]) {
    const hb = H(), he = H();
    A(0, 'BLOCK'); A(5, hb); A(330, owner); A(100, 'AcDbEntity'); A(8, '0'); A(100, 'AcDbBlockBegin'); A(2, name); A(70, 0); A(10, 0); A(20, 0); A(30, 0); A(3, name); A(1, '');
    A(0, 'ENDBLK'); A(5, he); A(330, owner); A(100, 'AcDbEntity'); A(8, '0'); A(100, 'AcDbBlockEnd');
  }
  A(0, 'ENDSEC');

  A(0, 'SECTION'); A(2, 'ENTITIES');
  for (const e of ents) {
    const h = H();
    if (e.kind === 'line') {
      A(0, 'LINE'); A(5, h); A(330, ms); A(100, 'AcDbEntity'); A(8, e.layer); A(100, 'AcDbLine');
      A(10, num(e.a[0])); A(20, num(e.a[1])); A(30, 0); A(11, num(e.b[0])); A(21, num(e.b[1])); A(31, 0);
    } else {
      A(0, 'LWPOLYLINE'); A(5, h); A(330, ms); A(100, 'AcDbEntity'); A(8, e.layer); A(100, 'AcDbPolyline');
      A(90, e.pts.length); A(70, e.closed ? 1 : 0);
      for (const p of e.pts) { A(10, num(p[0])); A(20, num(p[1])); }
    }
  }
  A(0, 'ENDSEC');

  const root = H(), grp = H();
  A(0, 'SECTION'); A(2, 'OBJECTS');
  A(0, 'DICTIONARY'); A(5, root); A(330, 0); A(100, 'AcDbDictionary'); A(280, 1); A(281, 1); A(3, 'ACAD_GROUP'); A(350, grp);
  A(0, 'DICTIONARY'); A(5, grp); A(330, root); A(100, 'AcDbDictionary'); A(280, 1); A(281, 1);
  A(0, 'ENDSEC'); A(0, 'EOF');

  // HEADER al final: $HANDSEED debe quedar por encima de todos los handles usados.
  const HD = [];
  const B = (c, v) => HD.push([c, v]);
  B(0, 'SECTION'); B(2, 'HEADER');
  B(9, '$ACADVER'); B(1, 'AC1015');
  B(9, '$HANDSEED'); B(5, seq.toString(16).toUpperCase());
  B(9, '$INSUNITS'); B(70, 4);
  B(9, '$MEASUREMENT'); B(70, 1);
  extPairs(B, ext);
  B(0, 'ENDSEC');
  return HD.concat(P);
}

// Texto DXF completo. segs = [{ t: 'cut' | 'crease' | 'perf', pts: [[x, y], ...] }] en mm, Y hacia abajo.
export function dxfOf(segs, { version = 'R12', dash = 3, gap = 2, height } = {}) {
  if (version !== 'R12' && version !== 'R2000') throw new Error('Versión DXF no soportada: ' + version);
  const H = Number.isFinite(height) ? height : Math.max(0, ...segs.flatMap(sg => sg.pts.map(p => p[1])));
  const ents = entitiesOf(segs, dash, gap, H);
  const ext = extentsOf(ents);
  const P = version === 'R12' ? r12Pairs(ents, ext) : r2000Pairs(ents, ext);
  return P.map(([c, v]) => c + '\r\n' + v + '\r\n').join('');
}

// Misma colocación que laserSvgOf (red centrada en la placa láser).
export function laserDxfOf(s, mat, version) {
  const lay = laserSvgOf(s, mat);
  const g = geomOf(s, mat.t), b = g.sbb;
  const ox = (lay.pageW - lay.netW) / 2 - b[0], oy = (lay.pageH - lay.netH) / 2 - b[1];
  const segs = g.segs.map(sg => ({ t: sg.t, pts: sg.pts.map(p => [p[0] + ox, p[1] + oy]) }));
  const net = s.tpl === 'custom' && s.custom && s.custom.mode === 'net';
  const dims = [s.L / 10, s.W / 10, s.H / 10].map(v => String(v).replace('.', ',')).join('x');
  return { name: (net ? 'red_' : 'caja_') + dims + 'cm_laser_' + tagOf(version) + '.dxf', text: dxfOf(segs, { version, height: lay.pageH }) };
}

// Un DXF por plancha distinta (las repetidas van en el nombre como en el SVG). Piezas según la matriz de nesting.
export function nestedDxfOf(s, mat, res, version, sheetH) {
  const g = geomOf(s, mat.t), b = g.sbb, netH = b[3] - b[1];
  return uniqueSheets(res).map((u, i) => {
    const segs = [];
    for (const p of u.items) {
      const m = itemMatrix(p, netH);
      for (const sg of g.segs) {
        segs.push({ t: sg.t, pts: sg.pts.map(([x, y]) => { const dx = x - b[0], dy = y - b[1]; return [m[0] * dx + m[2] * dy + m[4], m[1] * dx + m[3] * dy + m[5]]; }) });
      }
    }
    const name = 'nesting_' + s.tpl + '_' + s.L + 'x' + s.W + 'x' + s.H + '_plancha' + (i + 1) + '_' + u.items.length + 'pzs_x' + u.repeat + '_' + tagOf(version) + '.dxf';
    return { name, text: dxfOf(segs, { version, height: sheetH }) };
  });
}

const blobOf = text => new Blob([text], { type: 'application/dxf' });

export function exportLaserDXF(s, mat, version) {
  const f = laserDxfOf(s, mat, version);
  return saveFile(f.name, blobOf(f.text));
}

// Como exportNestedSVG: guardado secuencial, un diálogo a la vez. W, H e info van por paridad de firma;
// el DXF no guarda el tamaño de la plancha (el láser usa la geometría 1:1).
export async function exportNestedDXF(s, mat, res, W, H, info, version) {
  for (const f of nestedDxfOf(s, mat, res, version, H)) {
    if (!(await saveFile(f.name, blobOf(f.text)))) return;
  }
}
