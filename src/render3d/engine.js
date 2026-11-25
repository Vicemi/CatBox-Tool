// 3D 引擎（P1 满血版）：整版 UV 图集 + 全套 PBR 贴图 + 单材质装配
// 烫金(metalnessMap)×压纹(normal+displacement) 在同一 MeshPhysicalMaterial 内叠加
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Folder, makePieces } from './fold.js';
import { bakeAtlas, paintFilmChannels, paintFoilRoughness } from './bake.js';
import { makeAtlasTextures, disposeTextures, applyFaceMaterial, applyCoreMaterial } from './materials.js';
import { setupStudio } from './lighting.js';
import { makeStageGround } from './stage.js';
import { t } from '../i18n/index.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const STUDIO_CONTROL_KEYS = ['environmentIntensity', 'environmentRotation', 'backgroundShown', 'backgroundMode', 'backgroundColor', 'backgroundBlur', 'domeSpec', 'shadowSoftness', 'shadowOpacity'];
const FILM_CONTROL_KEYS = ['filmClearcoat', 'filmClearcoatRoughness', 'uvClearcoat', 'uvRoughness'];
const MATERIAL_CONTROL_KEYS = ['surfaceRoughness', 'filmRoughnessFactor', 'filmSheen', 'foilMetalness', 'iridescence', 'holoSpan', 'embNormalStrength', 'embDisplacementStrength'];
const cameraTypeOf = v => v === 'orthographic' ? 'orthographic' : 'perspective';

export class BoxEngine {
  constructor(container, props = {}) {
    this.el = container;
    this.props = { ...props };
    this.ready = false;
    this._disposed = false;
    this.faceMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f1e8, roughness: 0.5 });
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb2, roughness: 0.92 });
    this.init().catch(e => {
      if (this.el) this.el.innerHTML = '<div style="padding:20px;color:#a33;font:12px sans-serif">Error al iniciar 3D: ' + e.message + '</div>';
      console.error(e);
    });
  }

  // 外部驱动：props 全量下发，内部 diff
  update(props) {
    const prev = this.props;
    this.props = { ...props };
    if (!this.ready) return;
    const p = this.props;
    if (prev.l !== p.l || prev.w !== p.w || prev.h !== p.h || prev.t !== p.t || prev.tpl !== p.tpl || prev.glue !== p.glue || prev.sbbKey !== p.sbbKey || prev.custom !== p.custom || prev.wrap !== p.wrap) {
      clearTimeout(this._bt);
      this._bt = setTimeout(() => { if (this._disposed) return; this.build(); this.rebake(); this.applyFold(); this.frame(); this.invalidate(); }, 150);
    } else if (prev.bakeKey !== p.bakeKey) {
      clearTimeout(this._at);
      this._at = setTimeout(() => { if (this._disposed) return; this.rebake(); this.invalidate(); }, 150);
    }
    if (prev.panelOpen !== p.panelOpen) this.applyFold();
    if (prev.fold !== p.fold) {
      this.touchInteraction();
      this.applyFold();
      clearTimeout(this._ft);
      const fv = this.num('fold', 0);
      if (p.fitFold === '1' || fv >= 99.5) this.frame(true);
      else if (fv <= 0.5) this.frame();
    }
    if (prev.fitFold === '1' && p.fitFold !== '1' && this.num('fold', 0) < 99.5) this._fitGoal = null;
    if (prev.film !== p.film || FILM_CONTROL_KEYS.some(k => prev[k] !== p[k])) this.updateFilm();
    if (prev.foilRoughness !== p.foilRoughness) this.updateFoilRoughness();
    if (prev.check !== p.check || prev.embOn !== p.embOn || prev.embBoost !== p.embBoost || prev.embDepth !== p.embDepth || prev.film !== p.film || MATERIAL_CONTROL_KEYS.some(k => prev[k] !== p[k])) this.applyFlags();
    if (prev.xray !== p.xray) this.applyXray();
    if (prev.environment !== p.environment && this.studio) this.envChanged(this.studio.setEnvironment(p.environment));
    if (prev.lightsSpec !== p.lightsSpec && this.studio) { this.studio.setLights(p.lightsSpec); this.studio.updateHelpers(); }
    if (prev.lightEdit !== p.lightEdit && this.studio) this.studio.setHelpersVisible(p.lightEdit === '1');
    if (prev.selLight !== p.selLight && this.studio) this.studio.setHelperSelected(p.selLight || null);
    if (STUDIO_CONTROL_KEYS.some(k => prev[k] !== p[k])) this.applyStudioControls();
    if (prev.stage !== p.stage) this.setStage(p.stage);
    else if (prev.backgroundColor !== p.backgroundColor && this.stageGround && this.stageGround.userData.setColor) this.stageGround.userData.setColor(p.backgroundColor);
    if (prev.spin !== p.spin) this.syncTurnReset();
    if (prev.exposure !== p.exposure && this.renderer) this.renderer.toneMappingExposure = this.num('exposure', 1.05);
    if (prev.toneMapping !== p.toneMapping && this.renderer) this.applyToneMapping();
    if (prev.cameraType !== p.cameraType && this.camera) this.switchCamera(cameraTypeOf(p.cameraType));
    if (prev.fov !== p.fov && this.camera && this.camera.isPerspectiveCamera) {
      // Dolly con la focal: el sujeto mantiene su tamaño y cambia la perspectiva
      const nf = clamp(this.num('fov', 35), 16, 46), k = Math.tan(this.camera.fov * Math.PI / 360) / Math.tan(nf * Math.PI / 360), tg = this.controls.target;
      if (isFinite(k) && prev.fov !== undefined) this.camera.position.sub(tg).multiplyScalar(k).add(tg);
      this.camera.fov = nf;
      this.camera.updateProjectionMatrix();
    }
    this.invalidate(); // 按需渲染：任何属性下发都视为场景可能变化（含阴影图），渲染一帧即可
  }
  // —— 按需渲染 ——
  // 只在场景/相机变化、动画进行时出帧；阴影图（5 个 1024² 样本灯）只在场景内容变化时重画，纯相机环绕不重画。
  invalidate() { this._shadowDirty = true; this.invalidateView(); }
  invalidateView() { this._dirty = true; if (!this._raf && this._tick && !this._disposed) this._raf = requestAnimationFrame(this._tick); }
  envChanged(promise) { if (promise && promise.then) promise.then(() => { if (!this._disposed) this.invalidate(); }); }
  // 交互（环绕/折叠拖动）期间在高 DPI 屏降到 1×，停手 220ms 后恢复，避免重绘 4× 像素
  setPixelRatioTo(v) {
    const r = this.renderer;
    if (!r || r.getPixelRatio() === v) return;
    r.setPixelRatio(v); r.setSize(this.el.clientWidth || 10, this.el.clientHeight || 10, false);
    this.invalidateView();
  }
  touchInteraction(hold = true) {
    const idle = Math.min(devicePixelRatio, 2);
    if (idle <= 1.25) return;
    this.setPixelRatioTo(1);
    clearTimeout(this._prT);
    if (hold) this._prT = setTimeout(() => { if (!this._disposed) this.setPixelRatioTo(idle); }, 220);
  }
  num(n, d) { const v = parseFloat(this.props[n]); return isNaN(v) ? d : v; }

  async init() {
    const T = this.T = THREE;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMappingExposure = this.num('exposure', 1.02); this.applyToneMapping();
    r.shadowMap.enabled = new URLSearchParams(location.search).get('shadow') !== '0'; // ?shadow=0 调试（软渲染无头截图用）
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true; // 阴影图按需重画（invalidate 时置 needsUpdate）
    r.shadowMap.type = THREE.PCFShadowMap; // 低半径 PCF 只做边缘抗锯齿；距离相关半影由有限角主光样本产生
    r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    this.el.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.setStudio();
    this.setStage(this.props.stage);
    this.camera = new THREE.PerspectiveCamera(clamp(this.num('fov', 35), 16, 46), 1, 1, 9000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.minDistance = 15; this.controls.maxDistance = 5000;
    this.controls.screenSpacePanning = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.invalidateView());
    this.controls.addEventListener('start', () => { this._pauseSpin = Date.now() + 4000; this._fitGoal = null; this.touchInteraction(false); clearTimeout(this._prT); });
    this.controls.addEventListener('end', () => this.touchInteraction()); // 用户接管即中断自动适配过渡
    r.domElement.addEventListener('dblclick', () => this.frame());
    // Selección de cara en el visor 3D (clic sin arrastre)
    this._pickDown = e => { this._pickX = e.clientX; this._pickY = e.clientY; };
    this._pickClick = e => {
      if (!this.props.onPanelSelect || !this.boxRoot || !this.camera) return;
      if (this._pickX != null && Math.hypot(e.clientX - this._pickX, e.clientY - this._pickY) > 5) return;
      const T = this.T, rect = r.domElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const ndc = new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const rc = new T.Raycaster();
      rc.setFromCamera(ndc, this.camera);
      const hits = rc.intersectObjects(this.boxRoot.children, true);
      const hit = hits.find(h => h.object && h.object.isMesh && h.object.userData && h.object.userData.panel && h.object.userData.panel.panelId);
      if (hit) this.props.onPanelSelect(hit.object.userData.panel.panelId);
    };
    r.domElement.addEventListener('pointerdown', this._pickDown);
    r.domElement.addEventListener('click', this._pickClick);

    // 视角按钮
    const tb = document.createElement('div');
    tb.style.cssText = 'position:absolute;bottom:10px;right:10px;display:flex;gap:4px;z-index:2';
    const mkBtn = (label, fn) => {
      const b = document.createElement('button'); b.textContent = label;
      b.style.cssText = 'background:rgba(250,247,240,.92);border:1px solid #ded5c4;border-radius:5px;font:12px "Noto Sans",sans-serif;color:#5c554a;padding:4px 9px;cursor:pointer;white-space:nowrap';
      b.onmouseenter = () => b.style.background = '#f0e8d8';
      b.onmouseleave = () => b.style.background = 'rgba(250,247,240,.92)';
      b.onclick = fn; tb.appendChild(b);
    };
    mkBtn(t('Frontal'), () => this.setView('front')); mkBtn(t('Lateral'), () => this.setView('side'));
    mkBtn(t('Superior'), () => this.setView('top')); mkBtn(t('Iso'), () => this.setView('iso'));
    mkBtn(t('Ajustar'), () => this.frame());
    this.el.appendChild(tb);
    // C4D 式拖拽模式：旋转 / 平移 / 移动盒子 / 转盒
    const mb = document.createElement('div');
    mb.style.cssText = 'position:absolute;top:10px;left:10px;display:flex;align-items:center;z-index:2;border:1px solid #ded5c4;border-radius:6px;overflow:hidden;background:rgba(250,247,240,.92)';
    this._modeBtns = {};
    [['rotate', '○ ' + t('Girar')], ['pan', '✚ ' + t('Vista')], ['move', '▣ ' + t('Caja')], ['turn', '⟳ ' + t('Girar caja')]].forEach(pair => {
      const b = document.createElement('button'); b.textContent = pair[1];
      b.style.cssText = 'border:none;font:12px "Noto Sans",sans-serif;padding:5px 11px;cursor:pointer;white-space:nowrap;background:transparent;color:#5c554a';
      b.onclick = () => this.setMode(pair[0]);
      this._modeBtns[pair[0]] = b; mb.appendChild(b);
    });
    // 回正：转盒后一键归零 boxRoot 旋转；自动旋转（spin）时 rotation.y 被持续驱动，回正无意义故禁用
    const rb = document.createElement('button'); rb.textContent = t('Centrar'); rb.title = t('Poner a cero la rotación de la caja (tras Girar caja)');
    rb.style.cssText = 'border:none;border-left:1px solid #ded5c4;font:12px "Noto Sans",sans-serif;padding:5px 10px;cursor:pointer;white-space:nowrap;background:transparent;color:#5c554a';
    rb.onclick = () => { if (this.props.spin === '1' || !this.boxRoot) return; this.boxRoot.rotation.set(0, 0, 0); this.invalidate(); };
    this._turnResetBtn = rb; mb.appendChild(rb);
    this.el.appendChild(mb);
    this.syncTurnReset();
    this.setMode('rotate');
    const pick = e => {
      const rc = r.domElement.getBoundingClientRect();
      const nd = new THREE.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
      this._ray = this._ray || new THREE.Raycaster();
      this._ray.setFromCamera(nd, this.camera);
      const pt = new THREE.Vector3();
      return this._ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt) ? pt : null;
    };
    r.domElement.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this._fitGoal = null; // 用户接管（移动盒子/转盒走自定义分支，不进 OrbitControls start）：中断自动适配过渡
      if (this._mode === 'move') {
        const p = pick(e); if (!p) return;
        this._mvDrag = { p0: p, box0: this.boxRoot.position.clone(), tg0: this.controls.target.clone() };
        try { r.domElement.setPointerCapture(e.pointerId); } catch (_) { /* 合成/CDP 事件环境防御 */ }
        this._pauseSpin = Date.now() + 4000;
      } else if (this._mode === 'turn' && this.boxRoot) {
        // 转盒：仅绕盒心水平旋转（钉在桌面上，不倾斜），只转 boxRoot 不影响折叠
        this._tnDrag = { x0: e.clientX, done: 0 };
        try { r.domElement.setPointerCapture(e.pointerId); } catch (_) { /* 合成/CDP 事件环境防御 */ }
        this._pauseSpin = Date.now() + 4000;
      }
    });
    r.domElement.addEventListener('pointermove', e => {
      if (this._tnDrag) {
        const d = this._tnDrag, total = (e.clientX - d.x0) * 0.01;
        this.turnBox(total - d.done); d.done = total; // 增量式绕盒心转，枢轴不漂
        this.invalidate();
        this._pauseSpin = Date.now() + 4000;
        return;
      }
      if (!this._mvDrag) return;
      const p = pick(e); if (!p) return;
      const d = this._mvDrag;
      const dx = p.x - d.p0.x, dz = p.z - d.p0.z;
      this.boxRoot.position.set(d.box0.x + dx, d.box0.y, d.box0.z + dz);
      this.controls.target.set(d.tg0.x + dx, d.tg0.y, d.tg0.z + dz);
      this.controls.update();
      this.invalidate();
      this._pauseSpin = Date.now() + 4000;
    });
    const endMv = () => { this._mvDrag = null; this._tnDrag = null; };
    r.domElement.addEventListener('pointerup', endMv);
    r.domElement.addEventListener('pointercancel', endMv);
    // P3 灯光可视化编辑：捕获阶段挂在容器上、先于 OrbitControls——命中 helper 进入拖灯（stopPropagation 拦住相机），
    // 未命中记录候选点击，pointerup 位移 <4px 视为点击空白 → onLightSelect(null)
    const ndcOf = e => {
      const rc = r.domElement.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    };
    const helperAt = e => {
      if (!this.studio) return null;
      this._ray = this._ray || new THREE.Raycaster();
      this._ray.setFromCamera(ndcOf(e), this.camera);
      return this.studio.pickHelper(this._ray);
    };
    this._ndcOf = ndcOf;
    this._ltDown = e => {
      if (this._disposed || this.props.lightEdit !== '1' || e.button !== 0 || e.target !== r.domElement) return;
      const id = helperAt(e);
      if (!id) { this._ltClick = { x: e.clientX, y: e.clientY }; return; }
      e.stopPropagation(); e.preventDefault(); // 拖灯期间暂停 OrbitControls（相机不动）
      const ang = this.studio.lightAnglesOf(id) || { azimuth: 0, elevation: 45 };
      this._ltDrag = { id, x0: e.clientX, y0: e.clientY, moved: false };
      try { r.domElement.setPointerCapture(e.pointerId); } catch (_) { /* 合成/CDP 事件环境可能抛错，拖拽改走 window 监听 */ }
      this._pauseSpin = Date.now() + 4000;
      const move = ev => this.lightDragMove(ev);
      const up = ev => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.lightDragEnd(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    this._ltUp = e => {
      if (this._disposed || !this._ltClick) { this._ltClick = null; return; }
      const c = this._ltClick; this._ltClick = null;
      if (this.props.lightEdit !== '1' || e.button !== 0 || e.target !== r.domElement) return;
      if (Math.hypot(e.clientX - c.x, e.clientY - c.y) < 4 && this.props.onLightSelect) this.props.onLightSelect(null);
    };
    this.el.addEventListener('pointerdown', this._ltDown, true);
    this.el.addEventListener('pointerup', this._ltUp, true);
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(this.el);
    this.ready = true;
    this.resize(); this.build(); this.rebake(); this.applyFold(); this.frame();
    if (cameraTypeOf(this.props.cameraType) === 'orthographic') this.switchCamera('orthographic');
    this._tick = () => {
      this._raf = 0;
      if (this._disposed) return;
      const now = performance.now(), dt = this._loopAt ? Math.min((now - this._loopAt) / 1000, 0.05) : 1 / 60;
      this._loopAt = now;
      const goal = !!this._fitGoal;
      this.stepFrame(dt);
      const spinning = this.props.spin === '1' && this.boxRoot;
      if (spinning && Date.now() > (this._pauseSpin || 0)) this.turnBox(0.0045);
      const moved = this.controls.update();
      if (moved || this._dirty || goal || spinning) {
        if (this._shadowDirty || goal || spinning) { r.shadowMap.needsUpdate = true; this._shadowDirty = false; } // 盒体在动 → 阴影也要重画
        this._dirty = false;
        r.render(this.scene, this.camera);
      }
      if (moved || goal || spinning || this._dirty) { if (!this._raf) this._raf = requestAnimationFrame(this._tick); } // controls 'change' 可能已排过一帧
      else this._loopAt = 0;
    };
    this.invalidate();
  }
  // 拖灯：相机射线 ∩ 以盒心为心、半径=该灯 distance（平行光固定 400）的球面，取离当前灯位最近的交点换算 az/el；
  // studio 走 setLights 就地参数更新（同 id 同角色不重建灯），再经 onLightEdit 回传候选
  lightDragMove(e) {
    const d = this._ltDrag;
    if (!d || !this.studio) return;
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 3) d.moved = true;
    let list;
    try { list = JSON.parse(this.props.lightsSpec); } catch (_) { return; }
    if (!Array.isArray(list)) return;
    const light = list.find(l => l.id === d.id);
    if (!light) return;
    this._ray = this._ray || new THREE.Raycaster();
    this._ray.setFromCamera(this._ndcOf(e), this.camera);
    const center = new THREE.Vector3(...this.studio.helperCenter());
    const radius = light.type === 'point' ? (Number.isFinite(+light.distance) ? +light.distance : 350) : 400;
    const oc = this._ray.ray.origin.clone().sub(center), dir = this._ray.ray.direction;
    const b = oc.dot(dir), disc = b * b - (oc.lengthSq() - radius * radius);
    if (disc < 0) return;
    const sq = Math.sqrt(disc), cur = this.studio.lightPositionOf(d.id) || [0, radius, 0];
    let bestPt = null, bestD = Infinity;
    for (const t of [-b - sq, -b + sq]) {
      if (t <= 0) continue;
      const pt = this._ray.ray.origin.clone().addScaledVector(dir, t);
      const dd = (pt.x - cur[0]) * (pt.x - cur[0]) + (pt.y - cur[1]) * (pt.y - cur[1]) + (pt.z - cur[2]) * (pt.z - cur[2]);
      if (dd < bestD) { bestD = dd; bestPt = pt; }
    }
    if (!bestPt) return;
    const n = bestPt.sub(center).normalize();
    const az = Math.round(Math.atan2(n.z, n.x) * 1800 / Math.PI) / 10;
    const el = Math.round(Math.min(85, Math.max(5, Math.asin(Math.min(1, Math.max(-1, n.y))) * 180 / Math.PI)) * 10) / 10;
    const next = list.map(l => l.id === d.id ? { ...l, azimuth: az, elevation: el } : l);
    this.studio.setLights(JSON.stringify(next)); this.studio.updateHelpers();
    this.invalidate();
    if (this.props.onLightEdit) this.props.onLightEdit(d.id, { azimuth: az, elevation: el });
    this._pauseSpin = Date.now() + 4000;
  }
  lightDragEnd() {
    const d = this._ltDrag; this._ltDrag = null;
    if (d && !d.moved && this.props.onLightSelect) this.props.onLightSelect(d.id); // 位移 <4px 视为点选
  }
  resize() {
    const w = this.el.clientWidth || 10, h = this.el.clientHeight || 10;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    if (this.camera.isOrthographicCamera) {
      const halfH = Math.max(1, this._orthoHeight || 100) / 2;
      this.camera.left = -halfH * aspect; this.camera.right = halfH * aspect;
      this.camera.top = halfH; this.camera.bottom = -halfH;
    } else this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.invalidateView();
  }
  syncOrthoFrustum() {
    if (!this.camera || !this.camera.isOrthographicCamera) return;
    const w = this.el.clientWidth || 10, h = this.el.clientHeight || 10, halfH = Math.max(1, this._orthoHeight || 100) / 2;
    this.camera.left = -halfH * w / h; this.camera.right = halfH * w / h;
    this.camera.top = halfH; this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    this.invalidateView();
  }

  // 透视 ↔ 正交：以当前目标距离对应的可见垂直高度换算，避免切换时构图尺度跳变。
  switchCamera(type) {
    const next = cameraTypeOf(type);
    if (!this.camera || (next === 'orthographic') === !!this.camera.isOrthographicCamera) return;
    const T = this.T, old = this.camera, target = this.controls.target.clone();
    const dir = old.position.clone().sub(target);
    if (dir.lengthSq() < 1e-8) dir.set(1, 0.7, 1);
    const distance = Math.max(1, dir.length()), unit = dir.normalize();
    const fov = clamp(this.num('fov', 35), 16, 46);
    const visibleH = old.isOrthographicCamera
      ? Math.max(1, (old.top - old.bottom) / Math.max(1e-6, old.zoom))
      : Math.max(1, 2 * distance * Math.tan(T.MathUtils.degToRad(old.fov) / 2));
    let camera;
    if (next === 'orthographic') {
      this._orthoHeight = visibleH;
      camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 9000);
      camera.position.copy(target).addScaledVector(unit, distance);
      camera.zoom = 1;
    } else {
      camera = new T.PerspectiveCamera(fov, 1, 1, 9000);
      const d = visibleH / (2 * Math.tan(T.MathUtils.degToRad(fov) / 2));
      camera.position.copy(target).addScaledVector(unit, d);
    }
    camera.up.copy(old.up);
    this.camera = camera;
    this.controls.object = camera;
    this.controls.minDistance = 15; this.controls.maxDistance = 5000;
    this.controls.minZoom = 0.05; this.controls.maxZoom = 40;
    this.resize();
    this.controls.update();
  }

  // 绕盒心水平转盒（钉桌面）：枢轴=盒心，位置随动补偿使盒心原地不漂；d 为增量弧度
  turnBox(d) {
    if (!this.boxRoot || !d) return;
    this.boxRoot.updateWorldMatrix(true, false);
    const c = this._centerL ? this.boxRoot.localToWorld(this._centerL.clone()) : new this.T.Vector3();
    const p = this.boxRoot.position, dx = p.x - c.x, dz = p.z - c.z;
    const cos = Math.cos(d), sin = Math.sin(d);
    p.x = c.x + dx * cos + dz * sin; p.z = c.z - dx * sin + dz * cos; // 绕 Y 轴旋转矩阵 [cos,sin;-sin,cos]
    this.boxRoot.rotation.y += d;
  }

  build() {
    const T = this.T;
    if (this.boxRoot) {
      this.scene.remove(this.boxRoot);
      this.boxRoot.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    const L = this.num('l', 80), W = this.num('w', 40), H = this.num('h', 120);
    const t = Math.max(0.2, this.num('t', 0.45)); // 下限 0.2：art200(t=0.22) 薄纸在 3D 里保持真实厚度
    this._dims = { L, W, H, t };
    const sbb = (this.baked && this.baked.atlasSbb) || this.props.sbb || [0, 0, 100, 100];
    this.folder = new Folder(T, sbb, (this.baked || {}).innerUV);
    this.folder.hasEmb = !!(this.props.embOn === '1' && (this.baked || this._lastBakeInput || {}).hasEmb !== false);
    this.folder._dims = this._dims;
    let custom = null, wrap = null;
    try { custom = this.props.custom ? JSON.parse(this.props.custom) : null; } catch (_) { custom = null; }
    try { wrap = this.props.wrap ? JSON.parse(this.props.wrap) : null; } catch (_) { wrap = null; }
    this.pieces = makePieces(this.props.tpl || 'rte', L, W, H, t, this.num('glue', 14), custom, wrap);
    this.boxRoot = this.folder.build(this.pieces, t, this.faceMat, this.coreMat);
    this.scene.add(this.boxRoot);
    if (this.studio) {
      this.studio.setHelperTarget(0, H * 0.35, 0); // 灯位 helper 的指向/拖拽球心跟随盒高
      this.studio.setShadowBounds(L, W, H); // 按盒体尺寸收紧阴影相机，保持接触处解析度
    }
    this.invalidate();
  }

  // 图集烘焙：图层/工艺/基材变化时重烘（防抖由 update 控制）
  rebake() {
    const p = this.props;
    if (!p.layers || !p.sbb) return;
    const input = {
      layers: p.layers, panels: p.panels, sbb: p.sbb, bleed: +p.bleed || 0, paperId: p.paper || 'coated-white', filmId: p.film || 'none',
      grainStrength: this.num('grainStrength', 0.45), grainScale: this.num('grainScale', 8),
      filmClearcoat: this.num('filmClearcoat', NaN), filmClearcoatRoughness: this.num('filmClearcoatRoughness', NaN),
      uvClearcoat: this.num('uvClearcoat', 1), uvRoughness: this.num('uvRoughness', 0.05), foilRoughness: this.num('foilRoughness', 0.22),
      foilColor: p.foilColor || '#ffdb91', silverColor: p.silverColor || '#faf7f2', holoColor: p.holoColor || '#edf1f6', paperTint: p.paperTint || '', holoRainbow: this.num('holoRainbow', 0),
      foilOn: p.foilOn === '1', suvOn: p.suvOn === '1', glossOn: p.glossOn === '1', embOn: p.embOn === '1', holoOn: p.holoOn === '1',
      glossRoughness: this.num('glossRoughness', 0.08),
      embDepth: this.num('embDepth', 0.3), embSharpness: this.num('embSharpness', 0.85), embDir: p.embDir || 'up', embBoost: p.embBoost === '1'
    };
    this._lastBakeInput = input;
    const baked = bakeAtlas(input);
    this.baked = baked;
    const old = this._tex;
    this._tex = makeAtlasTextures(baked);
    disposeTextures(old);
    applyCoreMaterial(this.coreMat, p.paper || 'coated-white');
    // 压纹有无变化 → 可能需要重建高细分网格
    const needEmb = p.embOn === '1' && baked.hasEmb;
    const atlasChanged = !this.folder || baked.atlasSbb.some((v, i) => Math.abs(v - this.folder.sbb[i]) > 1e-7);
    if (atlasChanged || (this.folder && !!this.folder.hasEmb !== !!needEmb)) {
      this.build();
      this.applyFold();
    }
    this.applyFlags();
  }
  applyXray() {
    const on = this.props.xray === '1';
    for (const m of [this.faceMat, this.coreMat]) {
      if (!m) continue;
      m.transparent = on;
      m.opacity = on ? 0.24 : 1;
      m.depthWrite = !on;
      m.side = on ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    }
  }

  applyFlags() {
    if (!this._tex) return;
    applyFaceMaterial(this.faceMat, {
      paperId: this.props.paper || 'coated-white', filmId: this.props.film || 'none',
      roughness: this.num('surfaceRoughness', 0.48), filmRoughnessFactor: this.num('filmRoughnessFactor', 1), filmSheen: this.num('filmSheen', 0),
      foilMetalness: this.num('foilMetalness', 1), iridescence: this.num('iridescence', 0), holoSpan: this.num('holoSpan', 0.5), embNormalStrength: this.num('embNormalStrength', 1), embDisplacementStrength: this.num('embDisplacementStrength', 1)
    }, this._tex, {
      check: this.props.check || 'art',
      embOn: this.props.embOn === '1', hasEmb: (this.baked || {}).hasEmb,
      embDepth: this.num('embDepth', 0.3), embBoost: this.props.embBoost === '1', embDir: this.props.embDir || 'up'
    });
  }
  updateFilm() {
    if (!this.baked || !this._tex) return;
    paintFilmChannels(this.baked, this.props.film || 'none', {
      filmClearcoat: this.num('filmClearcoat', NaN), filmClearcoatRoughness: this.num('filmClearcoatRoughness', NaN),
      uvClearcoat: this.num('uvClearcoat', 1), uvRoughness: this.num('uvRoughness', 0.05)
    });
    this._tex.cc.needsUpdate = true; this._tex.ccR.needsUpdate = true;
  }
  updateFoilRoughness() { if (this.baked && this._tex) { paintFoilRoughness(this.baked, this.num('foilRoughness', 0.22)); this._tex.rough.needsUpdate = true; } }
  applyToneMapping() {
    if (!this.renderer) return;
    this.renderer.toneMapping = { agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, linear: THREE.LinearToneMapping }[this.props.toneMapping] || THREE.ACESFilmicToneMapping;
    if (this.faceMat) this.faceMat.needsUpdate = true;
    if (this.coreMat) this.coreMat.needsUpdate = true;
  }
  applyFold() { if (this.folder) { this.folder._dims = this._dims; try { this.folder.panelOpen = this.props.panelOpen ? JSON.parse(this.props.panelOpen) : {}; } catch (_) { this.folder.panelOpen = {}; } this.folder.applyFold(this.pieces, this.num('fold', 0)); } }

  applyStudioControls() {
    if (!this.studio) return;
    const p = this.props;
    this.studio.setControls({
      environmentIntensity: p.environmentIntensity, environmentRotation: p.environmentRotation,
      backgroundMode: p.backgroundShown === '1' ? 'hdri' : (p.backgroundMode === 'color' ? 'color' : 'gradient'),
      backgroundColor: p.backgroundColor, backgroundBlur: p.backgroundBlur, domeSpec: p.domeSpec,
      shadowSoftness: p.shadowSoftness, shadowOpacity: p.shadowOpacity
    });
  }

  // 影棚不再按 id 重建：灯具由 lightsSpec（JSON 字符串）经 setLights 按 id reconcile，其余参数经 setControls 下发
  setStudio() {
    if (this.studio) this.studio.dispose();
    const shadowQuery = new URLSearchParams(location.search);
    const requestedSamples = shadowQuery.get('dev3d') === '1' ? +shadowQuery.get('shadowSamples') : this.num('shadowSamples', 5);
    const shadowSamples = [3, 5, 7].includes(requestedSamples) ? requestedSamples : 5; // ?shadowSamples=3|5|7 仅用于 Dev3D 性能/视觉对照；默认 5：7 个样本灯 +8 贴图 +env 恰好顶满 16 纹理单元，iridescence 无处安放
    this.studio = setupStudio(this.renderer, this.scene, shadowSamples);
    this.envChanged(this.studio.setEnvironment(this.props.environment || 'studio_small_08'));
    this.studio.setLights(this.props.lightsSpec);
    this.studio.setHelpersVisible(this.props.lightEdit === '1');
    this.studio.setHelperSelected(this.props.selLight || null);
    this.studio.updateHelpers();
    this.applyStudioControls();
    this.applyFlags();
  }

  // 地面场景切换：none 时只有 lighting.js 的透明阴影承接网
  setStage(id) {
    if (this.stageGround) {
      this.scene.remove(this.stageGround);
      if (this.stageGround.userData.dispose) this.stageGround.userData.dispose();
      this.stageGround = null;
    }
    const g = makeStageGround(id || 'none', this.renderer, this.props.backgroundColor, () => this.invalidate());
    if (g) { this.stageGround = g; this.scene.add(g); }
    this.invalidate();
  }

  setMode(m) {
    this._mode = m;
    const T = this.T;
    this.controls.mouseButtons.LEFT = m === 'rotate' ? T.MOUSE.ROTATE : m === 'pan' ? T.MOUSE.PAN : -1;
    this.renderer.domElement.style.cursor = m === 'move' || m === 'turn' ? 'grab' : m === 'pan' ? 'all-scroll' : 'default';
    Object.entries(this._modeBtns).forEach(pair => {
      const on = pair[0] === m;
      pair[1].style.background = on ? '#9a5b1f' : 'transparent';
      pair[1].style.color = on ? '#fff' : '#5c554a';
      pair[1].style.fontWeight = on ? '700' : '400';
    });
  }
  // spin 开启时 boxRoot.rotation.y 被持续驱动，回正按钮禁用
  syncTurnReset() {
    if (!this._turnResetBtn) return;
    const off = this.props.spin === '1';
    this._turnResetBtn.style.opacity = off ? '0.4' : '1';
    this._turnResetBtn.style.cursor = off ? 'default' : 'pointer';
  }
  setView(v) {
    this._fitGoal = null;
    const rr = this._fitR || 300, hh = this._fitH || 60, t2 = this.controls.target;
    const iso = rr * 1.2 / Math.sqrt(3);
    const p = { front: [0, hh * 0.1, rr], side: [rr, hh * 0.1, 0], top: [0, rr, 0.01], iso: [iso, iso, iso] }[v];
    if (!p) return;
    this.camera.position.set(t2.x + p[0], t2.y + p[1], t2.z + p[2]);
    this.controls.update();
    this.invalidateView();
  }
  // Presets de cámara: hero 3/4, frontal, superior, contrapicado y primer plano
  setCameraPreset(v) {
    if (v === 'hero') { this.frame(true); return; }
    this._fitGoal = null;
    const R = this._fitR || 300, H = this._fitH || 60, tg = this.controls.target;
    const o = { front: [0, 0.12, 1, 1], top: [0, 1, 0.01, 1], low: [0.75, 0.04, 0.75, 0.9], close: [0.5, 0.3, 0.5, 0.5] }[v];
    if (!o) return;
    const d = new this.T.Vector3(o[0], o[1], o[2]).normalize().multiplyScalar(R * o[3]);
    if (this.camera.isOrthographicCamera) { this.camera.zoom = v === 'close' ? 1.8 : 1; this.camera.updateProjectionMatrix(); }
    this.camera.position.copy(tg).add(d);
    if (v === 'low') tg.y = Math.max(tg.y, H * 0.5);
    this.controls.update();
    this.invalidateView();
  }
  // PNG de alta resolución de la vista actual (scale × el tamaño CSS, limitado por la GPU)
  capture(scale = 2) {
    const r = this.renderer, w = this.el.clientWidth || 10, h = this.el.clientHeight || 10, pr = r.getPixelRatio();
    const gl = r.getContext(), maxS = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    const k = Math.min(scale, maxS / Math.max(w, h));
    const helpers = this.props.lightEdit === '1';
    if (helpers && this.studio) this.studio.setHelpersVisible(false);
    r.setPixelRatio(k); r.setSize(w, h, false); r.render(this.scene, this.camera);
    const done = new Promise(res => r.domElement.toBlob(b => res(b), 'image/png'));
    if (helpers && this.studio) this.studio.setHelpersVisible(true);
    r.setPixelRatio(pr); r.setSize(w, h, false);
    this.invalidateView(); // setSize 清空了画布，按需渲染下必须补一帧
    return done;
  }
  frame(smooth = false) {
    const T = this.T;
    const bb = new T.Box3().setFromObject(this.boxRoot);
    const c = bb.getCenter(new T.Vector3()), sz = bb.getSize(new T.Vector3());
    this.boxRoot.updateWorldMatrix(true, true);
    this._centerL = this.boxRoot.worldToLocal(c.clone()); // 盒心（局部坐标）——转盒/spin 的旋转枢轴，折叠或换型后随 frame 刷新
    const boxX = this.boxRoot.position.x - c.x, boxZ = this.boxRoot.position.z - c.z;
    const rr = Math.max(sz.x, sz.z, sz.y * 2, 60);
    const tubeHero = this.props.tpl === 'cyl' || this.props.tpl === 'hex';
    const topHero = this.props.tpl === 'mailer' || this.props.tpl === 'lidbase' || this.props.tpl === 'drawer';
    const lowTopHero = topHero && sz.y <= Math.max(sz.x, sz.z) * 0.65;
    const FIT = 2; // 取景放宽一倍：盒子约占画面半高（占满全屏太大，2026-08 验收反馈）
    const fitR = rr * (lowTopHero ? 1.85 : 1.1) * FIT;
    this._fitR = fitR; this._fitH = sz.y;
    const camera = lowTopHero
      ? new T.Vector3(fitR * 0.9, fitR * 0.54, fitR * 0.9)
      : new T.Vector3(rr * 0.95 * FIT * (tubeHero ? -1 : 1), rr * (topHero ? 1.05 : 0.7) * FIT, rr * 0.95 * FIT * (tubeHero ? -1 : 1));
    const target = new T.Vector3(0, Math.max(sz.y * (lowTopHero ? 0.3 : 0.4), lowTopHero ? 10 : 15), 0);
    const orthoHeight = this.camera.isOrthographicCamera
      ? Math.max(60, 2 * camera.distanceTo(target) * Math.tan(T.MathUtils.degToRad(clamp(this.num('fov', 35), 16, 46)) / 2))
      : null;
    if (smooth) { this._fitGoal = { boxX, boxZ, camera, target, orthoHeight }; return; }
    this._fitGoal = null;
    this.boxRoot.position.x = boxX; this.boxRoot.position.z = boxZ;
    this.camera.position.copy(camera); this.controls.target.copy(target);
    if (orthoHeight != null) {
      this._orthoHeight = orthoHeight;
      this.camera.zoom = 1;
      this.syncOrthoFrustum();
    }
    this.controls.update();
    this.invalidate();
  }
  stepFrame(dt) {
    const g = this._fitGoal;
    if (!g || !this.boxRoot) return;
    const a = 1 - Math.exp(-dt * 9);
    this.boxRoot.position.x += (g.boxX - this.boxRoot.position.x) * a;
    this.boxRoot.position.z += (g.boxZ - this.boxRoot.position.z) * a;
    this.camera.position.lerp(g.camera, a); this.controls.target.lerp(g.target, a);
    if (g.orthoHeight != null && this.camera.isOrthographicCamera) {
      this._orthoHeight += (g.orthoHeight - this._orthoHeight) * a;
      this.camera.zoom = 1;
      this.syncOrthoFrustum();
    }
    const left = Math.max(
      Math.abs(g.boxX - this.boxRoot.position.x), Math.abs(g.boxZ - this.boxRoot.position.z),
      this.camera.position.distanceTo(g.camera), this.controls.target.distanceTo(g.target)
    );
    if (left < 0.02) {
      this.boxRoot.position.x = g.boxX; this.boxRoot.position.z = g.boxZ;
      this.camera.position.copy(g.camera); this.controls.target.copy(g.target);
      if (g.orthoHeight != null && this.camera.isOrthographicCamera) { this._orthoHeight = g.orthoHeight; this.syncOrthoFrustum(); }
      this._fitGoal = null;
    }
  }
  dispose() {
    this._disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this._ltDown) this.el.removeEventListener('pointerdown', this._ltDown, true);
    if (this._ltUp) this.el.removeEventListener('pointerup', this._ltUp, true);
    if (this.renderer && this._pickDown) this.renderer.domElement.removeEventListener('pointerdown', this._pickDown);
    if (this.renderer && this._pickClick) this.renderer.domElement.removeEventListener('click', this._pickClick);
    this._ltDrag = null; this._ltClick = null;
    clearTimeout(this._bt); clearTimeout(this._at); clearTimeout(this._ft); clearTimeout(this._prT);
    this.setStage('none');
    if (this.studio) { this.studio.dispose(); this.studio = null; }
    disposeTextures(this._tex);
    if (this.controls) this.controls.dispose();
    this.faceMat.dispose(); this.coreMat.dispose();
    if (this.boxRoot) this.boxRoot.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement); }
  }
}
