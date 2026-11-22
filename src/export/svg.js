// Exportación SVG 1:1 para láser / plotter de corte.
// Capas separadas: CORTE (rojo) y PLIEGUE (azul discontinuo). Unidades reales en mm.
import { geomOf } from '../dieline/geom.js';
import { normalizeCustom } from '../dieline/custom.js';
import { SHEETS, sheetOf } from '../units.js';
import { itemMatrix, uniqueSheets } from './nesting.js';
import { saveFile } from '../platform.js';

const n3 = v => (Math.round(v * 1000) / 1000).toString();
const pathOf = segs => segs.map(sg => 'M' + sg.pts.map(p => n3(p[0]) + ' ' + n3(p[1])).join('L')).join(' ');

export function laserSvgOf(s, mat) {
  const g = geomOf(s, mat.t);
  const c = normalizeCustom(s.custom);
  const b = g.sbb;
  const netW = b[2] - b[0], netH = b[3] - b[1];
  const sheet = c.sheet === 'custom' ? c.sheetCustom : sheetOf(c.sheet);
  const margin = c.margin;
  const minW = netW + 2 * margin, minH = netH + 2 * margin;
  const pageW = Math.max(sheet.w || 0, minW);
  const pageH = Math.max(sheet.h || 0, minH);
  const ox = (pageW - netW) / 2 - b[0];
  const oy = (pageH - netH) / 2 - b[1];
  const cut = pathOf(g.segs.filter(sg => sg.t === 'cut'));
  const crease = pathOf(g.segs.filter(sg => sg.t === 'crease'));
  const showPage = c.showPage && !!sheet.w;
  const title = 'Caja ' + (s.L / 10) + ' x ' + (s.W / 10) + ' x ' + (s.H / 10) + ' cm - ' + (mat ? mat.name : '');
  const meta = {
    generador: 'OpenBox3D',
    unidades: 'mm',
    escala: '1:1',
    medida_interior_cm: [s.L / 10, s.W / 10, s.H / 10],
    material: mat ? { id: mat.id, nombre: mat.name, espesor_mm: mat.t } : null,
    kerf_mm: c.kerf,
    encajes: { cantidad: g.slotN, longitud_corte_mm: Math.round(g.slotLen * 100) / 100 },
    placa: { ancho: pageW, alto: pageH, margen: margin },
    aviso: 'El kerf se informa como dato de máquina; aplícalo en tu software láser (LightBurn/RDWorks) o en el ajuste de compensación.'
  };
  const metaJson = JSON.stringify(meta).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return {
    pageW, pageH, cut, crease, netW, netH,
    svg: '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + n3(pageW) + 'mm" height="' + n3(pageH) + 'mm" viewBox="0 0 ' + n3(pageW) + ' ' + n3(pageH) + '">\n'
      + '  <title>' + title.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</title>\n'
      + '  <metadata id="openbox3d">' + metaJson + '</metadata>\n'
      + '  <desc>Corte rojo, pliegue azul. Escala 1:1 en milímetros. Kerf declarado: ' + c.kerf + ' mm. ' + (g.slotN ? 'Incluye ' + g.slotN + ' encaje(s) de solapa en la capa CORTE.' : '') + '</desc>\n'
      + (showPage ? '  <g id="PLACA" fill="none" stroke="#b8b0a0" stroke-width="0.2" stroke-dasharray="4 3"><rect x="0" y="0" width="' + n3(pageW) + '" height="' + n3(pageH) + '"/></g>\n' : '')
      + '  <g id="CORTE" transform="translate(' + n3(ox) + ' ' + n3(oy) + ')" fill="none" stroke="#ff0000" stroke-width="0.1" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">\n'
      + '    <path d="' + cut + '"/>\n'
      + '  </g>\n'
      + '  <g id="PLIEGUE" transform="translate(' + n3(ox) + ' ' + n3(oy) + ')" fill="none" stroke="#0000ff" stroke-width="0.1" stroke-dasharray="3 2" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">\n'
      + '    <path d="' + crease + '"/>\n'
      + '  </g>\n'
      + '</svg>\n'
  };
}

export function exportLaserSVG(s, mat) {
  const out = laserSvgOf(s, mat);
  const net = s.tpl === 'custom' && s.custom && s.custom.mode === 'net';
  const dims = [s.L / 10, s.W / 10, s.H / 10].map(v => String(v).replace('.', ',')).join('x');
  const name = (net ? 'red_' : 'caja_') + dims + 'cm_laser.svg';
  return saveFile(name, new Blob([out.svg], { type: 'image/svg+xml;charset=utf-8' }));
}

// Plancha con la red repetida (nesting). items = [{x,y,rot}] en mm; capas CORTE / PLIEGUE como en el SVG individual.
export function nestedSvgOf(s, mat, items, sheetW, sheetH, info = {}) {
  const g = geomOf(s, mat.t);
  const b = g.sbb, netH = b[3] - b[1];
  const cut = pathOf(g.segs.filter(sg => sg.t === 'cut'));
  const crease = pathOf(g.segs.filter(sg => sg.t === 'crease'));
  const tf = p => 'matrix(' + itemMatrix(p, netH).map(n3).join(' ') + ') translate(' + n3(-b[0]) + ' ' + n3(-b[1]) + ')';
  const layer = (id, stroke, dash, d) => '  <g id="' + id + '" fill="none" stroke="' + stroke + '" stroke-width="0.1"' + (dash ? ' stroke-dasharray="3 2"' : '') + ' stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">\n'
    + items.map(p => '    <path transform="' + tf(p) + '" d="' + d + '"/>\n').join('') + '  </g>\n';
  const meta = JSON.stringify({ generador: 'OpenBox3D', unidades: 'mm', escala: '1:1', plancha: { ancho: sheetW, alto: sheetH }, piezas: items.length, repeticion: info.repeat || 1, kerf_mm: info.kerf || 0, separacion_mm: info.gap || 0, material: mat ? { id: mat.id, nombre: mat.name, espesor_mm: mat.t } : null })
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + n3(sheetW) + 'mm" height="' + n3(sheetH) + 'mm" viewBox="0 0 ' + n3(sheetW) + ' ' + n3(sheetH) + '">\n'
    + '  <title>Nesting ' + items.length + ' pzs</title>\n'
    + '  <metadata id="openbox3d">' + meta + '</metadata>\n'
    + '  <desc>Corte rojo, pliegue azul. Escala 1:1 en milímetros. Kerf declarado: ' + (info.kerf || 0) + ' mm; aplícalo en el software láser.</desc>\n'
    + '  <g id="PLACA" fill="none" stroke="#b8b0a0" stroke-width="0.2" stroke-dasharray="4 3"><rect x="0" y="0" width="' + n3(sheetW) + '" height="' + n3(sheetH) + '"/></g>\n'
    + layer('CORTE', '#ff0000', false, cut) + layer('PLIEGUE', '#0000ff', true, crease)
    + '</svg>\n';
}

const download = (blob, name) => saveFile(name, blob);

// Un archivo por plancha distinta (las repetidas indican "×N" en el nombre).
export async function exportNestedSVG(s, mat, res, sheetW, sheetH, info) {
  for (const [i, u] of uniqueSheets(res).entries()) { // sequential: one save dialog at a time
    const svg = nestedSvgOf(s, mat, u.items, sheetW, sheetH, { ...info, repeat: u.repeat });
    if (!(await download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'nesting_' + s.tpl + '_' + s.L + 'x' + s.W + 'x' + s.H + '_plancha' + (i + 1) + '_' + u.items.length + 'pzs_x' + u.repeat + '.svg'))) return;
  }
}

// Plantilla de calibración de kerf: cuadrado de 20 mm y peine de 10 pasos de 2 mm.
export function exportKerfTest() {
  const size = 76, s = 20, cx = 10, cy = 10;
  let path = 'M' + cx + ' ' + cy + 'h' + s + 'v' + s + 'h' + -s + 'Z';
  let comb = '';
  for (let i = 0; i < 10; i++) {
    const x = cx + s + 6 + i * 2.5;
    comb += 'M' + x + ' ' + cy + 'v8';
  }
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + size + 'mm" height="' + size + 'mm" viewBox="0 0 ' + size + ' ' + size + '">\n'
    + '<g fill="none" stroke="#ff0000" stroke-width="0.1"><path d="' + path + '"/><path d="' + comb + '"/></g>\n'
    + '</svg>\n';
  return saveFile('calibracion_kerf_20mm.svg', new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
}

export { SHEETS };
