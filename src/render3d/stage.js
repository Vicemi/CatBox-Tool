// 地面场景：Poly Haven CC0 实拍 PBR 材质（diff + nor_gl + arm 三件套，public/textures/）
// arm 打包图：R=AO、G=Roughness、B=Metalness——roughnessMap 读 G 通道，直接用
import * as THREE from 'three';
import { asset } from '../asset.js';

export const STAGES = [
  { id: 'none', name: 'Sin suelo (fondo liso)' },
  { id: 'cyclorama', name: 'Ciclorama (plató continuo)', cyc: true },
  { id: 'wood_table_001', name: 'Mesa de madera oscura', tileMm: 600, source: 'https://polyhaven.com/a/wood_table_001' },
  { id: 'checkered_pavement_tiles', name: 'Baldosa damero', tileMm: 1800, source: 'https://polyhaven.com/a/checkered_pavement_tiles' },
  { id: 'beige_wall_001', name: 'Pared texturizada beige', tileMm: 1200, source: 'https://polyhaven.com/a/beige_wall_001' },
  { id: 'crepe_satin', name: 'Satén crepé arena', tileMm: 800, source: 'https://polyhaven.com/a/crepe_satin' },
  { id: 'painted_plaster_wall', name: 'Yeso pintado', tileMm: 1500, source: 'https://polyhaven.com/a/painted_plaster_wall' },
  { id: 'climbing_wall_base', name: 'Piedra texturizada', tileMm: 1500, source: 'https://polyhaven.com/a/climbing_wall_base' },
  { id: 'stretch_poplin', name: 'Popelín verde', tileMm: 800, source: 'https://polyhaven.com/a/stretch_poplin' }
];

// 旧程序化地面 id → 新材质映射（旧存档/URL/预设兼容）
const LEGACY = { wood: 'wood_table_001', oak: 'wood_table_001', kraft: 'beige_wall_001', slate: 'checkered_pavement_tiles' };
export const stageId = id => STAGES.some(s => s.id === id) ? id : (LEGACY[id] || 'none');
export const stagePreset = id => STAGES.find(s => s.id === stageId(id)) || STAGES[0];

// 生成地面 mesh（半径 R mm）；none 返回 null。贴图异步加载，就绪前是中性灰；
// 返回对象带 dispose()——加载未完成就销毁会置标志，迟到的贴图直接释放不上屏。
// Ciclorama: suelo que se curva sin costura hasta una pared envolvente (lathe), del color del fondo.
function makeCyclorama(color) {
  const r0 = 1200, rc = 700, pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r0, 0)];
  for (let i = 1; i <= 16; i++) { const a = i / 16 * Math.PI / 2; pts.push(new THREE.Vector2(r0 + rc * Math.sin(a), rc - rc * Math.cos(a))); }
  pts.push(new THREE.Vector2(r0 + rc, rc + 4000));
  const geo = new THREE.LatheGeometry(pts, 96);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.15; // casi a ras: la caja no flota y el ShadowMaterial (y=0) queda por encima
  mesh.userData.setColor = c => mat.color.set(c);
  mesh.userData.dispose = () => { geo.dispose(); mat.dispose(); };
  return mesh;
}

export function makeStageGround(id, renderer, color = '#f4f4f2', onChange = null) {
  const spec = stagePreset(id);
  if (!spec || spec.id === 'none') return null;
  if (spec.cyc) return makeCyclorama(color);
  const R = 3200, repeat = (R * 2) / spec.tileMm;
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 0.85, metalness: 0 });
  // Borde difuminado: sin esto el disco del suelo se ve como un plato cortado contra el fondo al orbitar.
  const fade = document.createElement('canvas'); fade.width = fade.height = 256;
  const fx = fade.getContext('2d'), grd = fx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, '#fff'); grd.addColorStop(0.3, '#fff'); grd.addColorStop(0.95, '#000');
  fx.fillStyle = grd; fx.fillRect(0, 0, 256, 256);
  const fadeTex = new THREE.CanvasTexture(fade);
  mat.alphaMap = fadeTex; mat.transparent = true; mat.depthWrite = false;
  const geo = new THREE.CircleGeometry(R, 72);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.15; mesh.renderOrder = -1; // el ShadowMaterial (y=0, renderOrder 1) se pinta encima sin z-fight ni hueco visible
  mesh.receiveShadow = false; // 阴影统一由 y=0 的透明承影网合成，避免实体地面再接收一次形成过黑双影
  const loader = new THREE.TextureLoader(), texs = [];
  let disposed = false, pending = 3;
  const mk = (file, srgb) => {
    const t = loader.load(asset('/textures/' + file), () => {
      if (disposed) { t.dispose(); return; }
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (--pending === 0) { mat.map = texs[0]; mat.roughnessMap = texs[2]; mat.normalMap = texs[1]; mat.roughness = 1; mat.color.set(0xffffff); mat.needsUpdate = true; if (onChange) onChange(); }
    });
    texs.push(t);
    return t;
  };
  mk(spec.id + '_diff_1k.jpg', true);
  mk(spec.id + '_nor_gl_1k.jpg', false);
  mk(spec.id + '_arm_1k.jpg', false);
  mesh.userData.dispose = () => { disposed = true; geo.dispose(); mat.dispose(); fadeTex.dispose(); texs.forEach(t => t.dispose()); };
  return mesh;
}
