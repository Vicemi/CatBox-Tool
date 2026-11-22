// Presets de aspecto 3D: papel y laminado; la energía de entorno pertenece al estudio.
// Los presets de estudio se derivan de SCENE_PRESETS (rig.js).
import { SCENE_PRESETS, scenePreset } from './rig.js';

export const PAPER_PRESETS = [
  { id: 'coated-white', name: 'Cartulina estucada blanca', color: '#f4f1e8', roughness: 0.48, grain: 'fine', grainStrength: 0.45, grainMm: 8, core: '#d8cdb2' },
  { id: 'ivory-uncoated', name: 'Marfil sin estucar', color: '#eee5d2', roughness: 0.72, grain: 'open', grainStrength: 0.72, grainMm: 9, core: '#d2c3a6' },
  { id: 'art-paper', name: 'Estucado / papel ilustración', color: '#f6f3eb', roughness: 0.38, grain: 'fine', grainStrength: 0.28, grainMm: 7, core: '#ded8c9' },
  { id: 'kraft-natural', name: 'Kraft natural', color: '#b9834c', roughness: 0.9, grain: 'kraft', grainStrength: 0.28, grainMm: 8, core: '#a9703e' },
  { id: 'black-card', name: 'Cartulina negra', color: '#24211e', roughness: 0.68, grain: 'fine', grainStrength: 0.12, grainMm: 14, core: '#4a443d', specularIntensity: 0.72 },
  { id: 'white-grayback', name: 'Blanco reverso gris', color: '#eeeae0', roughness: 0.62, grain: 'open', grainStrength: 0.55, grainMm: 9, core: '#77756f' },
  { id: 'pearlescent-white', name: 'Blanco perlado', color: '#f2eee6', roughness: 0.42, grain: 'fine', grainStrength: 0.3, grainMm: 7, core: '#ddd5c4', sheen: 0.35 },
  { id: 'metal-silver-card', name: 'Cartulina plateada', color: '#e8e8ea', roughness: 0.32, grain: 'fine', grainStrength: 0.25, grainMm: 7, core: '#c9c9cc', metalBase: 0.9 }
];

export const FILM_PRESETS = [
  { id: 'none', name: 'Sin laminado', clearcoat: 0, clearcoatRoughness: 0.5, roughnessFactor: 1, sheen: 0 },
  { id: 'matte', name: 'Mate', clearcoat: 0.38, clearcoatRoughness: 0.5, roughnessFactor: 0.92, sheen: 0.05, specularIntensity: 0.5 },
  { id: 'gloss', name: 'Brillante', clearcoat: 1, clearcoatRoughness: 0.045, roughnessFactor: 0.42, sheen: 0 },
  { id: 'soft', name: 'Táctil / soft touch', clearcoat: 0.18, clearcoatRoughness: 0.72, roughnessFactor: 1.12, sheen: 0.48 }
];

export const STUDIO_PRESETS = SCENE_PRESETS.map(r => {
  const I = id => { const l = r.lights.find(x => x.id === id); return l ? l.intensity : 0; };
  return {
    id: r.id, name: r.name, env: r.environment.intensity, exposure: r.tone.exposure,
    key: I('key'), fill: I('fill'), rim: I('rim'), hemi: I('hemi'),
    shadowSoftness: r.shadow.softness, shadowOpacity: r.shadow.opacity
  };
});

export const ENVIRONMENT_PRESETS = [
  { id: 'procedural', name: 'Estudio procedural', url: null, kb: 'Cúpula editable integrada', source: 'Integrado' },
  { id: 'room-neutral', name: 'Sala neutra Lab', url: null, kb: 'RoomEnvironment neutro', source: 'Integrado' },
  { id: 'studio_small_08', name: 'Estudio suave · Studio Small 08', url: '/hdri/studio_small_08_1k.hdr', kb: '~6000K frío y limpio', source: 'Poly Haven' },
  { id: 'studio_small_03', name: 'Estudio contrastado · Studio Small 03', url: '/hdri/studio_small_03_1k.hdr', kb: '~5400K alto contraste', source: 'Poly Haven' },
  { id: 'studio_small_09', name: 'Estudio cálido · Studio Small 09', url: '/hdri/studio_small_09_1k.hdr', kb: '2750K cálido', source: 'Poly Haven' },
  { id: 'white_studio_03', name: 'Fondo blanco ecommerce · White Studio 03', url: '/hdri/white_studio_03_1k.hdr', kb: '~5300K plató blanco', source: 'Poly Haven' },
  { id: 'white_studio_06', name: 'Plató blanco luminoso · White Studio 06', url: '/hdri/white_studio_06_1k.hdr', kb: 'Plató blanco de clave alta', source: 'Poly Haven' },
  { id: 'cyclorama_hard_light', name: 'Ciclorama blanco · Cyclorama', url: '/hdri/cyclorama_hard_light_1k.hdr', kb: '~5400K luz dura', source: 'Poly Haven' },
  { id: 'photo_studio_01', name: 'Estudio frío · Photo Studio 01', url: '/hdri/photo_studio_01_1k.hdr', kb: '~5622K contraste medio', source: 'Poly Haven' }
];

export const paperPreset = id => PAPER_PRESETS.find(x => x.id === id) || PAPER_PRESETS[0];
export const filmPreset = id => FILM_PRESETS.find(x => x.id === id) || FILM_PRESETS[0];
export const studioPreset = id => STUDIO_PRESETS.find(x => x.id === id) || STUDIO_PRESETS.find(x => x.id === scenePreset(id).id) || STUDIO_PRESETS[0];
export const environmentPreset = id => ENVIRONMENT_PRESETS.find(x => x.id === id) || ENVIRONMENT_PRESETS[1];

export function legacyAppearance(id) {
  return {
    sbs: ['coated-white', 'none'], black: ['black-card', 'none'], kraft: ['kraft-natural', 'none'],
    matte: ['coated-white', 'matte'], gloss: ['coated-white', 'gloss'], soft: ['coated-white', 'soft']
  }[id] || ['coated-white', 'none'];
}
