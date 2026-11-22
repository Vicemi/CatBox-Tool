// Box3D 工程文件（.boxproj）：盒型/设计/正式材质/正式场景；纯本地文件导入导出，无服务端
import { storeToRig, rigToStorePatch } from '../render3d/rig.js';
import { normalizeMaterial, materialToStorePatch } from '../render3d/materialPresets.js';
import { defaultCustom, normalizeCustom } from '../dieline/custom.js';
import { asset } from '../asset.js';
import { saveFile } from '../platform.js';

export const PROJECT_SCHEMA = 'box3d-project';
export const PROJECT_VERSION = 1;

const BOX_FIELDS = ['tpl', 'L', 'W', 'H', 'matId', 'bleed', 'glue', 'ovr', 'typeOvr', 'custom', 'wrap'];
const copyFields = (src, fields) => Object.fromEntries(fields.map(k => [k, structuredClone(src[k])]));
const cleanLayer = layer => {
  const out = { ...layer };
  delete out.img;
  return out;
};
const newId = () => crypto.randomUUID ? crypto.randomUUID() : 'project-' + Date.now().toString(36);
const now = () => new Date().toISOString();

export function makeProject(state, meta = {}) {
  const time = now();
  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    meta: {
      id: meta.id || newId(),
      name: String(meta.name || 'Proyecto de packaging sin nombre').trim().slice(0, 60) || 'Proyecto de packaging sin nombre',
      createdAt: meta.createdAt || time,
      updatedAt: time,
      thumbnail: typeof state.projectThumbnail === 'string' && state.projectThumbnail.startsWith('data:image/')
        ? state.projectThumbnail
        : (typeof meta.thumbnail === 'string' ? meta.thumbnail : '')
    },
    box: copyFields(state, BOX_FIELDS),
    design: { layers: state.layers.map(cleanLayer), seq: state.seq },
    appearance: {
      material: normalizeMaterial(state),
      fx: structuredClone(state.fx),
      embDir: state.embDir
    },
    scene: storeToRig(state)
  };
}

function assertProject(doc) {
  if (!doc || doc.schema !== PROJECT_SCHEMA || doc.version !== PROJECT_VERSION || !doc.meta || !doc.box || !doc.design || !Array.isArray(doc.design.layers)) {
    throw new Error('No es un archivo de proyecto Box3D válido.');
  }
  return doc;
}

const imageOf = src => new Promise(resolve => {
  if (!src) return resolve(null);
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src[0] === '/' ? asset(src) : src; // 站点绝对路径过 base 前缀（GitHub Pages 子路径）；data:/http(s): 原样
});

export async function projectStateOf(raw, view = 'design') {
  const doc = assertProject(raw);
  const layers = await Promise.all(doc.design.layers.map(async layer => {
    const clean = { ...layer };
    const img = await imageOf(clean.imgSrc);
    return img ? { ...clean, img } : clean;
  }));
  return {
    ...copyFields(doc.box, BOX_FIELDS),
    custom: doc.box.custom ? normalizeCustom(doc.box.custom) : defaultCustom(),
    wrap: doc.box.wrap ? structuredClone(doc.box.wrap) : { flap: 0, outer: 0, inner: 0, tab: 12, slot: 20, slotW: 1.2, sideTab: 0 },
    layers,
    seq: doc.design.seq,
    ...materialToStorePatch(doc.appearance && doc.appearance.material),
    fx: doc.appearance && doc.appearance.fx ? structuredClone(doc.appearance.fx) : undefined,
    embDir: doc.appearance && doc.appearance.embDir || 'up',
    ...rigToStorePatch(doc.scene),
    view,
    sel: null,
    selSeg: null,
    editMode: false,
    uiCrop: false,
    foldFromQuery: false,
    projectThumbnail: typeof doc.meta.thumbnail === 'string' ? doc.meta.thumbnail : '',
    fitNonce: Date.now()
  };
}

export function downloadProject(state, meta) {
  const project = makeProject(state, meta);
  return saveFile(project.meta.name.replace(/[\\/:*?"<>|]+/g, '-') + '.boxproj', new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
}

export function chooseProjectFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.boxproj,application/json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      try {
        const doc = assertProject(JSON.parse(await file.text()));
        doc.meta = { ...doc.meta, id: newId(), name: doc.meta.name || file.name.replace(/\.boxproj$/i, ''), createdAt: now(), updatedAt: now() };
        resolve(doc);
      } catch (e) { reject(e); }
    };
    input.click();
  });
}
