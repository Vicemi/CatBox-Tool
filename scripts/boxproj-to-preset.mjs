// Convierte un proyecto .boxproj en la caja de ejemplo del repositorio:
//   node scripts/boxproj-to-preset.mjs /ruta/proyecto.boxproj
// Extrae las imágenes dataURL a public/preset/layer-<id>.<ext> y escribe src/preset/preset-box.json.
// Uso desde package.json: npm run preset:from -- /ruta/proyecto.boxproj
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('Uso: node scripts/boxproj-to-preset.mjs /ruta/proyecto.boxproj'); process.exit(1); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const doc = JSON.parse(fs.readFileSync(src, 'utf8'));
if (doc.schema !== 'box3d-project' || doc.version !== 1 || !doc.box || !doc.design || !Array.isArray(doc.design.layers)) {
  console.error('No es un proyecto Box3D válido (schema box3d-project v1).');
  process.exit(1);
}

const presetDir = path.join(root, 'public', 'preset');
fs.rmSync(presetDir, { recursive: true, force: true }); // limpia los recursos de la caja de ejemplo anterior
fs.mkdirSync(presetDir, { recursive: true });

const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };
let extracted = 0;
for (const layer of doc.design.layers) {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(layer.imgSrc || '');
  if (!m) continue;
  const file = 'layer-' + (layer.id != null ? layer.id : ++extracted) + '.' + EXT[m[1]];
  fs.writeFileSync(path.join(presetDir, file), Buffer.from(m[2], 'base64'));
  layer.imgSrc = '/preset/' + file;
  extracted++;
}

doc.meta = { id: 'preset', name: 'Caja de ejemplo', createdAt: doc.meta && doc.meta.createdAt, updatedAt: doc.meta && doc.meta.updatedAt, thumbnail: '' }; // la portada se recaptura al arrancar y no se guarda en el repo
const out = path.join(root, 'src', 'preset', 'preset-box.json');
fs.writeFileSync(out, JSON.stringify(doc, null, 2));
console.log('Listo: ' + extracted + ' imágenes → public/preset/; proyecto → src/preset/preset-box.json (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
