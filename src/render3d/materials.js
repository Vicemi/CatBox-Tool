// 材质装配：单 MeshPhysicalMaterial 挂全套图集贴图——烫金(metalnessMap)×压纹(normal+displacement) 天然叠加
import * as THREE from 'three';
import { paperPreset, filmPreset } from './presets.js';

export function makeAtlasTextures(baked) {
  const mk = (c, srgb) => {
    const x = new THREE.CanvasTexture(c);
    if (srgb) x.colorSpace = THREE.SRGBColorSpace;
    x.anisotropy = 8;
    return x;
  };
  const tex = {
    map: mk(baked.colorC, true),
    normal: mk(baked.normalFull), normalPaper: baked.normalFull === baked.normalPaper ? null : mk(baked.normalPaper),
    rough: mk(baked.roughC), metal: mk(baked.metalC),
    cc: mk(baked.ccC), ccR: mk(baked.ccRC),
    disp: mk(baked.dispC)
  };
  if (!tex.normalPaper) tex.normalPaper = tex.normal; // 无压纹：两张法线是同一幅画布，共用一个纹理（只上传一次）
  // 检查模式专用贴图：首次访问才建（画布与纹理都不为日常「成品」视图占内存）；检查模式「烫金版」显示金+银并集 mask
  const lazy = (name, make) => {
    let v;
    Object.defineProperty(tex, name, { enumerable: false, configurable: true, get: () => v || (v = make()), });
    tex._lazyDispose = (tex._lazyDispose || []).concat(() => v && v.dispose());
  };
  lazy('checker', () => mk(baked.makeChecker(), true));
  lazy('maskFoil', () => {
    const c = document.createElement('canvas'); c.width = Math.max(baked.maskFoil.width, baked.maskSilver.width); c.height = Math.max(baked.maskFoil.height, baked.maskSilver.height);
    const g = c.getContext('2d');
    [baked.maskFoil, baked.maskSilver].forEach(m => { if (m.width > 1) g.drawImage(m, 0, 0); });
    return mk(c, true);
  });
  lazy('maskUv', () => mk(baked.maskUv, true));
  lazy('maskGloss', () => mk(baked.maskGloss, true));
  lazy('maskHolo', () => baked.maskHolo ? mk(baked.maskHolo, true) : null);
  lazy('dispCheck', () => mk(baked.dispC, true));
  return tex;
}

export function disposeTextures(tex) {
  if (!tex) return;
  new Set(Object.values(tex).filter(t => t && t.dispose)).forEach(t => t.dispose());
  (tex._lazyDispose || []).forEach(f => f());
}

// flags: { check:'art'|'foil'|'suv'|'gloss'|'emb'|'checker', embOn, embDepth, embBoost, embDir, hasEmb }
export function applyFaceMaterial(faceMat, appearance, tex, flags) {
  const paper = paperPreset(appearance.paperId), film = filmPreset(appearance.filmId);
  const check = flags.check || 'art';
  // 检查模式：单通道直出，关闭其余贴图
  if (check !== 'art') {
    faceMat.color.set(0xffffff);
    faceMat.map = check === 'checker' ? tex.checker : check === 'foil' ? tex.maskFoil : check === 'suv' ? tex.maskUv : check === 'gloss' ? tex.maskGloss : check === 'holo' ? tex.maskHolo : tex.dispCheck;
    faceMat.roughnessMap = null; faceMat.roughness = check === 'emb' ? 0.4 : 0.65;
    faceMat.metalnessMap = null; faceMat.metalness = 0;
    faceMat.clearcoatMap = null; faceMat.clearcoatRoughnessMap = null; faceMat.clearcoat = 0;
    faceMat.normalMap = null; faceMat.clearcoatNormalMap = null;
    faceMat.displacementMap = null; faceMat.displacementScale = 0;
    faceMat.sheen = 0; faceMat.envMapIntensity = 1;
    faceMat.iridescence = 0; faceMat.iridescenceMap = null;
    faceMat.needsUpdate = true;
    return;
  }
  faceMat.color.set(0xffffff);            // albedo 图集含纸基色，color 置白避免叠乘
  faceMat.map = tex.map;
  faceMat.roughness = 1; faceMat.roughnessMap = tex.rough;
  faceMat.metalness = Math.max(0, Math.min(1, appearance.foilMetalness == null ? 1 : appearance.foilMetalness)); faceMat.metalnessMap = tex.metal;
  faceMat.clearcoat = 1; faceMat.clearcoatMap = tex.cc;
  faceMat.clearcoatRoughness = 1; faceMat.clearcoatRoughnessMap = tex.ccR;
  const useEmb = flags.embOn && flags.hasEmb;
  faceMat.normalMap = useEmb ? tex.normal : tex.normalPaper;
  const normalStrength = Math.max(0, Math.min(3, appearance.embNormalStrength == null ? 1 : appearance.embNormalStrength));
  faceMat.normalScale.set(normalStrength, normalStrength);
  // 关键：clearcoat 高光层默认无视 normalMap，必须单独指定，否则覆膜下浮雕对光无反应
  faceMat.clearcoatNormalMap = useEmb ? tex.normal : tex.normalPaper;
  faceMat.clearcoatNormalScale.set(normalStrength, normalStrength);
  if (useEmb) {
    faceMat.displacementMap = tex.disp;
    const amp = flags.embDepth * (flags.embBoost ? 3 : 1);
    const displacementStrength = Math.max(0, Math.min(2, appearance.embDisplacementStrength == null ? 1 : appearance.embDisplacementStrength));
    faceMat.displacementScale = amp * 2 * displacementStrength;
    faceMat.displacementBias = -amp * displacementStrength;
  } else {
    faceMat.displacementMap = null; faceMat.displacementScale = 0;
  }
  const roughnessFactor = appearance.filmRoughnessFactor == null ? film.roughnessFactor : appearance.filmRoughnessFactor;
  faceMat.roughness = Math.max(0.12, Math.min(1, appearance.roughness == null ? paper.roughness * roughnessFactor : appearance.roughness * roughnessFactor));
  faceMat.sheen = Math.max(paper.sheen || 0, Math.max(0, Math.min(1, appearance.filmSheen == null ? film.sheen : appearance.filmSheen))); faceMat.sheenRoughness = film.id === 'soft' ? 0.82 : 0.9; faceMat.sheenColor.set(0xf7efe3);
  // 镭射：iridescence 薄膜干涉。metalnessMap 是三通道打包贴图——R=iridescence mask、G=膜厚噪声、B=金属度，
  // iridescenceMap 与 iridescenceThicknessMap 复用同一纹理（真机纹理单元上限 16，打包省一个单元）。
  // IOR 1.8。厚度区间随 holoSpan（色彩跨度）：下限钉 100nm 保住鲜艳区，上限 320→880nm——
  // 注意高膜厚端会被灵敏度曲线高斯窗衰减成灰白（实测 800nm 上半段大面积失色），宽跨度靠 G 噪声触底扫出全色谱。
  const iridescence = Math.max(0, Math.min(1, appearance.iridescence || 0));
  const holoSpan = Number.isFinite(+appearance.holoSpan) ? Math.max(0, Math.min(1, +appearance.holoSpan)) : 0.5;
  faceMat.iridescence = iridescence; faceMat.iridescenceIOR = 1.8;
  faceMat.iridescenceThicknessRange = [100, Math.round(320 + 560 * holoSpan)];
  faceMat.iridescenceMap = iridescence > 0 ? tex.metal : null;
  faceMat.iridescenceThicknessMap = iridescence > 0 ? tex.metal : null;
  // 环境能量唯一由 scene.environmentIntensity 控制；材质不再二次叠乘。
  faceMat.envMapIntensity = 1;
  const paperSpec = paper.specularIntensity == null ? (paper.id === 'black-card' ? 0.72 : 1) : paper.specularIntensity;
  faceMat.specularIntensity = paperSpec * (film.specularIntensity == null ? 1 : film.specularIntensity);
  faceMat.needsUpdate = true;
}

// 纸芯侧面：卡纸米白 / 瓦楞棕
export function applyCoreMaterial(coreMat, paperId) {
  coreMat.color.set(paperPreset(paperId).core);
  coreMat.roughness = 0.92;
  coreMat.needsUpdate = true;
}
