// Vista 3D: plegado, papel/laminado, acabados, relieve y parámetros PBR.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { store, useStore } from '../state/store.js';
import { TPLS } from '../dieline/templates.js';
import { wrapCustom } from '../dieline/custom.js';
import { embDirOf } from '../design/emboss.js';
import { BoxPreview, boxPreviewContextOf } from '../render3d/BoxPreview.jsx';
import { STAGES } from '../render3d/stage.js';
import { PAPER_PRESETS, FILM_PRESETS, paperPreset, filmPreset } from '../render3d/presets.js';
import { SCENE_PRESETS, ENTORNOS, entornoRig, scenePreset, rigToStorePatch } from '../render3d/rig.js';
import * as Tabs from '@radix-ui/react-tabs';
import { IconCube, IconPalette, IconPhoto, IconBulb, IconTexture, IconCamera, IconArmchair, IconBuildingWarehouse, IconWall, IconMoon, IconShoppingBag, IconSun, IconDownload } from '@tabler/icons-react';
import { useT } from '../i18n/index.js';
import { ST, Block, Toggle, ToggleRow, Note, selectSt, btnSt, inputSt, captureThumb, Range, ColorRow } from './widgets.jsx';
import { fmtCm, fmtMm } from '../units.js';
import { notifyError } from './dialogs.jsx';
import { saveFile } from '../platform.js';

const ICONS = { IconCamera, IconArmchair, IconBuildingWarehouse, IconWall, IconMoon, IconPalette, IconShoppingBag, IconSun };
const TABS = [['montaje', 'Montaje', IconCube], ['material', 'Material', IconPalette], ['escena', 'Escena', IconPhoto], ['luces', 'Luces', IconBulb], ['relieve', 'Relieve', IconTexture]];
const CAM_PRESETS = [['hero', '3/4 héroe'], ['front', 'Frontal'], ['top', 'Superior'], ['low', 'Contrapicado'], ['close', 'Primer plano']];
// Distancia focal equivalente (sensor de 24 mm de alto) ↔ fov vertical
const fovToMm = fov => 12 / Math.tan(fov * Math.PI / 360);
const mmToFov = mm => Math.round(2 * Math.atan(12 / mm) * 1800 / Math.PI) / 10;

export function ThreeView() {
  const s = useStore();
  const tx = useT();
  const [tab, setTab] = useState('montaje');
  const m = store.mat();
  const t = m.t;
  const pf = useRef(null);
  const engRef = useRef(null);
  const [foldPlaying, setFoldPlaying] = useState(false);
  const [lightEdit, setLightEdit] = useState(false);
  const [selLight, setSelLight] = useState(null);
  const tplName = (TPLS.find(x => x.id === s.tpl) || TPLS[0]).name;
  const netMode = s.tpl === 'custom' && s.custom && s.custom.mode === 'net';
  const netPieces = netMode && Array.isArray(s.custom.panels) ? s.custom.panels.filter(p => !p.parent).length : 0;
  const wrapMode = s.tpl === 'wrap';
  const finCount = f => s.layers.filter(l => l.finish === f).length;
  const embCount = dir => s.layers.filter(l => l.finish === 'emboss' && embDirOf(l, s.embDir) === dir).length;
  const finSummary = tx('Acabados: oro×{a} · UV×{b} · brillo×{c} · holo×{d} · relieve↑×{e} · relieve↓×{f} (desde Diseño)', { a: finCount('foil') + finCount('silver'), b: finCount('uv'), c: finCount('gloss'), d: finCount('holo'), e: embCount('up'), f: embCount('down') });
  const preview = boxPreviewContextOf(s, m);
  const coverKey = JSON.stringify({
    scene: [s.environment3d, s.stage3d, s.expo3d, s.lightsSpec3d, s.backgroundMode3d, s.backgroundColor3d],
    material: [s.paper3d, s.film3d, s.surfaceRoughness, s.grainStrength, s.grainScale, s.foilColor3d, s.silverColor3d, s.iridescence3d, s.holoSpan3d, s.holoRainbow3d, s.glossRoughness3d],
    camera: [s.cameraProjection3d, s.fov3d]
  });
  const clearFold = () => { clearInterval(pf.current); pf.current = null; };
  const stopFold = () => { clearFold(); setFoldPlaying(false); };
  const playFold = () => {
    clearFold(); setFoldPlaying(true); store.set({ fold: 0 });
    let v = 0;
    pf.current = setInterval(() => { v += 1.4; if (v >= 100) { v = 100; stopFold(); } store.set({ fold: v }); }, 28);
  };
  useLayoutEffect(() => { if (!s.foldFromQuery) playFold(); return clearFold; }, []);
  // Miniatura del proyecto: reutiliza el renderer real cuando la caja está cerrada.
  useEffect(() => {
    if (s.fold < 99.5 || s.check !== 'art') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const eng = engRef.current;
      if (!eng || !eng.ready || eng._disposed) return;
      if (eng.studio && eng.studio.environmentReady) await eng.studio.environmentReady;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (cancelled) return;
      const thumbnail = captureThumb(engRef, 420);
      if (thumbnail && thumbnail !== store.get().projectThumbnail) store.set({ projectThumbnail: thumbnail });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [s.fold, s.check, preview.bakeKey, coverKey]);
  useEffect(() => { window.__threeEngine = engRef.current; return () => { if (window.__threeEngine === engRef.current) window.__threeEngine = null; }; }, []);
  // —— Luces editables (lightsSpec3d es un JSON de luces) ——
  const lights = (() => { try { const a = JSON.parse(s.lightsSpec3d); return Array.isArray(a) ? a : []; } catch (_) { return []; } })();
  const writeLights = arr => store.set({ lightsSpec3d: JSON.stringify(arr) });
  const setLight = (id, patch) => writeLights(lights.map(l => l.id === id ? { ...l, ...patch } : l));
  const setShadowLight = id => writeLights(lights.map(l => ({ ...l, shadow: l.id === id && l.type === 'directional' })));
  const addLight = () => {
    const id = 'l' + Date.now().toString(36);
    writeLights(lights.concat([{ id, name: 'Luz extra', type: 'directional', on: true, intensity: 1, color: '#ffffff', groundColor: '#68645d', azimuth: 0, elevation: 40, distance: 400, shadow: false }]));
    setSelLight(id);
  };
  // —— Apertura manual de caras ——
  const [, setTick] = useState(0);
  useEffect(() => { const t = setTimeout(() => setTick(x => x + 1), 600); return () => clearTimeout(t); }, [s.tpl, s.custom, s.wrap, s.L, s.W, s.H]);
  const nameMap = Object.fromEntries(((wrapMode ? wrapCustom(s).panels : (s.custom && s.custom.panels)) || []).map(q => [q.id, q.name]));
  const openIds = [...new Set(((engRef.current && engRef.current.folder && engRef.current.folder.nodes) || []).map(n => n.panelId).filter(Boolean))];
  const setOpen = (id, v) => store.set(st => ({ panelOpen3d: { ...(st.panelOpen3d || {}), [id]: v } }));
  const applyScenePreset = id => { store.set(rigToStorePatch(scenePreset(id))); };
  const applyEntorno = id => store.set({ ...rigToStorePatch(entornoRig(id)), entorno3d: id });
  const setFocal = mm => store.set({ fov3d: mmToFov(mm) });
  const capture = async scale => {
    const eng = engRef.current;
    if (!eng || !eng.ready) return;
    const blob = await eng.capture(scale);
    if (!blob) return;
    try { await saveFile('catbox-3d-' + scale + 'x.png', blob); } catch (e) { notifyError(e); }
  };
  const lbl = { fontSize: 10.5, color: '#8a8071', marginBottom: 3 };
  const hint = { fontSize: 10, color: '#a59a85', lineHeight: 1.5 };
  const sliderRow = (label, key, min, max, val, text, onChange) => <div key={key} style={{ marginTop: 7 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', ...lbl }}><span>{label}</span><span style={{ fontFamily: "'JetBrains Mono',monospace", color: '#9a5b1f' }}>{text}</span></div>
    <input aria-label={label} type="range" min={min} max={max} value={val} onChange={onChange} style={{ width: '100%', accentColor: '#9a5b1f', margin: 0 }} />
  </div>;
  const cyc = s.stage3d === 'cyclorama';
  const persp = s.cameraProjection3d !== 'orthographic';
  const focal = Math.round(fovToMm(s.fov3d ?? 35));

  return (<>
    <div style={{ width: 272, flex: 'none', background: '#faf7f0', borderRight: '1px solid #ded5c4', overflowY: 'auto' }}>
      <Block style={{ paddingBottom: 10 }}>
        <ST style={{ marginBottom: 7 }}>{tx('Entornos')}</ST>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
          {ENTORNOS.map(e => {
            const Icon = ICONS[e.icon], on = s.entorno3d === e.id, name = tx(e.name);
            return (
              <button key={e.id} onClick={() => applyEntorno(e.id)} title={name} aria-label={name} aria-pressed={on}
                style={{ padding: 3, borderRadius: 6, border: '1px solid ' + (on ? '#9a5b1f' : '#ded5c4'), background: on ? '#f7efe2' : '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'stretch' }}>
                <span style={{ height: 30, borderRadius: 4, background: 'linear-gradient(160deg,' + e.sw[1] + ' 0 45%,' + e.sw[0] + ' 45% 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#211d18', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }}><Icon size={15} stroke={1.8} style={{ background: 'rgba(255,255,255,.7)', borderRadius: 99, padding: 2 }} /></span>
                <span style={{ fontSize: 9.5, lineHeight: 1.2, color: on ? '#9a5b1f' : '#3d3830', fontWeight: on ? 700 : 400, minHeight: 23, textAlign: 'center' }}>{name}</span>
              </button>
            );
          })}
        </div>
        <div style={{ ...hint, marginTop: 6 }}>{tx('Cada entorno es un punto de partida: luces, fondo y suelo siguen siendo editables.')}</div>
      </Block>
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List aria-label={tx('Secciones 3D')} style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 3, background: '#faf7f0', borderTop: '1px solid #e7e0d4', borderBottom: '1px solid #ded5c4' }}>
          {TABS.map(([id, name, Icon]) => (
            <Tabs.Trigger key={id} value={id} style={{ flex: 1, minWidth: 0, border: 'none', borderBottom: '2px solid ' + (tab === id ? '#9a5b1f' : 'transparent'), background: 'transparent', cursor: 'pointer', padding: '7px 0 5px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, color: tab === id ? '#9a5b1f' : '#8a8071', fontSize: 9.5, fontWeight: tab === id ? 700 : 500 }}>
              <Icon size={17} stroke={1.8} /><span>{tx(name)}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="montaje">
          <Block>
            <ST>{tx('Caja actual')}</ST>
            <div style={{ background: '#f0ebe0', border: '1px solid #e2dac9', borderRadius: 6, padding: '9px 11px', fontSize: 11.5, lineHeight: 1.6, color: '#3d3830', fontFamily: "'JetBrains Mono',monospace" }}>
              {tplName} · {m.name} · t={fmtMm(t)}<br />{netMode ? tx('Red avanzada · {n} pieza(s)', { n: netPieces }) : wrapMode ? tx('Envolvente · cara trasera {a} × {b} · fondo {c}', { a: fmtCm(s.L), b: fmtCm(s.H), c: fmtCm(s.W) }) : tx('Interior {a} × {b} × {c}', { a: fmtCm(s.L), b: fmtCm(s.W), c: fmtCm(s.H) })}
            </div>
            <div style={{ fontSize: 10.5, color: '#8a8071', marginTop: 6 }}>{tx('Medidas y espesor vienen de Estructura / Mi caja.')}</div>
            <div style={{ fontSize: 10.5, color: '#9a5b1f', marginTop: 4 }}>{finSummary}</div>
          </Block>
          <Block>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <ST style={{ marginBottom: 0 }}>{tx('Progreso de plegado')}</ST>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: '#9a5b1f' }}>{Math.round(s.fold)}%</div>
            </div>
            <input aria-label={tx('Progreso de plegado')} type="range" min="0" max="100" value={s.fold} onPointerDown={stopFold} onKeyDown={stopFold} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { stopFold(); store.set({ fold: v }); } }} style={{ width: '100%', accentColor: '#9a5b1f', margin: '0 0 10px' }} />
            <div style={{ display: 'flex', gap: 7 }}>
              <button onClick={playFold} style={{ ...btnSt, flex: 1, padding: '7px 0', border: 'none', fontWeight: 700, background: '#9a5b1f', color: '#fff' }}>▶ {tx('Reproducir')}</button>
              <button onClick={() => { stopFold(); store.set({ fold: 0 }); }} style={{ ...btnSt, flex: 1, padding: '7px 0', color: '#5c554a' }}>{tx('Desplegar')}</button>
            </div>
            <div style={{ marginTop: 12 }}>
              <ST style={{ marginBottom: 6 }}>{tx('Secuencia de montaje')}</ST>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {[['0', '1 · Desplegar'], ['28', '2 · Laterales'], ['55', '3 · Separadores'], ['78', '4 · Solapas'], ['100', '5 · Encajes']].map(([v, label]) => (
                  <button key={v} onClick={() => { stopFold(); store.set({ fold: +v, xray: true }); }} style={{ ...btnSt, padding: '6px 4px', fontSize: 10.5 }}>{tx(label)}</button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#a59a85', marginTop: 5, lineHeight: 1.5 }}>{tx('Activa rayos X para ver cómo las pestañas laterales se meten en las ranuras.')}</div>
            </div>
          </Block>
          <Block>
            <ST>{tx('Abrir caras y probar pliegues')}</ST>
            <div style={{ fontSize: 10.5, color: '#a59a85', lineHeight: 1.55, marginBottom: 7 }}>{tx('Abre una cara concreta sin tocar el resto (las solapas que cuelgan de ella la acompañan). 0 % = según el plegado; 100 % = abierta del todo.')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 7 }}>
              <button onClick={() => store.set({ panelOpen3d: {} })} style={{ ...btnSt, padding: '5px 0', fontSize: 10.5 }}>{tx('Cerrar todas')}</button>
              <button onClick={() => store.set({ panelOpen3d: Object.fromEntries(openIds.map(id => [id, 100])) })} style={{ ...btnSt, padding: '5px 0', fontSize: 10.5 }}>{tx('Abrir todas')}</button>
            </div>
            <ToggleRow label={tx('Ver interior (rayos X)')} on={s.xray} onClick={() => store.set(st => ({ xray: !st.xray }))} />
            {openIds.length === 0 && <div style={{ fontSize: 10.5, color: '#a59a85' }}>{tx('Cargando caras…')}</div>}
            <div style={{ maxHeight: 300, overflowY: 'auto', paddingRight: 3 }}>
              {openIds.map(id => {
                const v = (s.panelOpen3d || {})[id] || 0;
                return (
                  <div key={id} style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: v ? '#9a5b1f' : '#8a8071' }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }}>{nameMap[id] || id}</span>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{Math.round(v)}%</span>
                    </div>
                    <input aria-label={tx('Apertura') + ' ' + (nameMap[id] || id)} type="range" min="0" max="100" value={v} onChange={e => setOpen(id, +e.target.value)} style={{ width: '100%', accentColor: '#9a5b1f', margin: 0 }} />
                  </div>
                );
              })}
            </div>
          </Block>
        </Tabs.Content>

        <Tabs.Content value="material">
          <Block>
            <ST>{tx('Papel / laminado')}</ST>
            <div style={lbl}>{tx('Papel')}</div>
            <select aria-label={tx('Papel')} value={s.paper3d} onChange={e => { const p = paperPreset(e.target.value); store.set({ paper3d: p.id, surfaceRoughness: p.roughness, grainStrength: p.grainStrength, grainScale: p.grainMm }); }} style={{ ...selectSt, marginBottom: 8 }}>
              {PAPER_PRESETS.map(x => <option key={x.id} value={x.id}>{tx(x.name)}</option>)}
            </select>
            <div style={lbl}>{tx('Laminado')}</div>
            <select aria-label={tx('Laminado')} value={s.film3d} onChange={e => { const f = filmPreset(e.target.value); store.set({ film3d: f.id, filmClearcoat3d: f.clearcoat, filmClearcoatRoughness3d: f.clearcoatRoughness, filmRoughnessFactor3d: f.roughnessFactor, filmSheen3d: f.sheen }); }} style={{ ...selectSt, marginBottom: 9 }}>
              {FILM_PRESETS.map(x => <option key={x.id} value={x.id}>{tx(x.name)}</option>)}
            </select>
            {[['Rugosidad de superficie', 'surfaceRoughness', 12, 100, Math.round(s.surfaceRoughness * 100)], ['Intensidad de fibra', 'grainStrength', 0, 120, Math.round(s.grainStrength * 100)], ['Escala de grano', 'grainScale', 3, 20, s.grainScale]].map(row =>
              sliderRow(tx(row[0]), row[1], row[2], row[3], row[4], row[1] === 'grainScale' ? fmtMm(row[4]) : row[4] + '%', e => store.set({ [row[1]]: row[1] === 'grainScale' ? +e.target.value : +e.target.value / 100 })))}
            <div style={{ fontSize: 10.5, color: '#a59a85', lineHeight: 1.55, marginTop: 8 }}>{tx('Solo cambia el aspecto 3D; no altera el espesor ni el troquel.')}</div>
          </Block>
          <Block>
            <ST style={{ marginBottom: 6 }}>{tx('Muestras de acabado')}</ST>
            {[['foil', 'Capa de oro'], ['suv', 'Capa UV local'], ['gloss', 'Capa de brillo'], ['emb', 'Capa de relieve'], ['holo', 'Capa holográfica']].map(x => (
              <ToggleRow key={x[0]} label={tx(x[1])} on={x[0] === 'gloss' || x[0] === 'holo' ? s.fx[x[0]] !== false : s.fx[x[0]]} onClick={() => store.set(st => ({ fx: { ...st.fx, [x[0]]: !(x[0] === 'gloss' || x[0] === 'holo' ? st.fx[x[0]] !== false : st.fx[x[0]]) } }))} />
            ))}
            <Range label={tx('Rugosidad del brillo')} value={s.glossRoughness3d} min={0.02} max={0.5} step={0.01} onChange={v => store.set({ glossRoughness3d: v })} />
            <div style={{ marginTop: 4, ...hint }}>{tx('Menos rugosidad = reflejo más concentrado y nítido.')}</div>
            <Range label={tx('Intensidad holográfica')} value={s.iridescence3d} min={0} max={1} step={0.01} onChange={v => store.set({ iridescence3d: v })} />
            <Range label={tx('Amplitud cromática')} value={s.holoSpan3d} min={0} max={1} step={0.01} onChange={v => store.set({ holoSpan3d: v })} />
            <Range label={tx('Arcoíris de fondo')} value={s.holoRainbow3d} min={0} max={1} step={0.01} onChange={v => store.set({ holoRainbow3d: v })} />
            <ColorRow label={tx('Color base holográfico')} value={s.holoColor3d} onChange={v => store.set({ holoColor3d: v })} />
            <div style={{ marginTop: 4, ...hint }}>{tx('El holográfico cambia de color con el ángulo de visión. La amplitud define el barrido de tonos; el arcoíris hornea el espectro en el papel.')}</div>
            <ToggleRow label={tx('Rotación automática')} on={s.spin} onClick={() => store.set(st => ({ spin: !st.spin }))} />
            <ToggleRow label={tx('Ver interior (rayos X)')} on={s.xray} onClick={() => store.set(st => ({ xray: !st.xray }))} />
            <div style={{ marginTop: 8 }}>
              <div style={lbl}>{tx('Modo de inspección')}</div>
              <select aria-label={tx('Modo de inspección')} value={s.check} onChange={e => store.set({ check: e.target.value })} style={selectSt}>
                <option value="art">{tx('Arte final (completo)')}</option>
                <option value="foil">{tx('Plancha de oro · canal R')}</option>
                <option value="suv">{tx('Plancha UV local · canal G')}</option>
                <option value="gloss">{tx('Canal especular de brillo')}</option>
                <option value="holo">{tx('Plancha holográfica')}</option>
                <option value="emb">{tx('Altura de relieve · blanco↑ / negro↓')}</option>
                <option value="checker">{tx('Damero UV · 20 mm')}</option>
              </select>
            </div>
          </Block>
        </Tabs.Content>

        <Tabs.Content value="escena">
          <Block>
            <ST>{tx('Cámara')}</ST>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 8 }}>
              {CAM_PRESETS.map(([id, name]) => (
                <button key={id} onClick={() => engRef.current && engRef.current.setCameraPreset(id)} style={{ ...btnSt, padding: '5px 3px', fontSize: 10.5 }}>{tx(name)}</button>
              ))}
            </div>
            <div style={lbl}>{tx('Proyección')}</div>
            <select aria-label={tx('Cámara')} value={s.cameraProjection3d || 'perspective'} onChange={e => store.set({ cameraProjection3d: e.target.value })} style={{ ...selectSt, marginBottom: 4 }}>
              <option value="perspective">{tx('Perspectiva')}</option>
              <option value="orthographic">{tx('Ortográfica · isométrica')}</option>
            </select>
            {persp && sliderRow(tx('Distancia focal'), 'focal', 28, 85, focal, focal + ' mm', e => setFocal(+e.target.value))}
            {persp && <div style={{ ...hint, marginTop: 4 }}>{tx('Focal corta = más perspectiva; larga = más plana y sin deformar la caja.')}</div>}
            <div style={{ ...lbl, marginTop: 10 }}>{tx('Capturar PNG')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {[2, 4].map(k => (
                <button key={k} onClick={() => capture(k)} style={{ ...btnSt, padding: '6px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, border: '1px solid #9a5b1f', color: '#9a5b1f', fontWeight: 700 }}><IconDownload size={14} stroke={1.9} />{k}×</button>
              ))}
            </div>
            <div style={{ ...hint, marginTop: 4 }}>{tx('Guarda la vista actual a 2× o 4× el tamaño del visor (se limita al máximo de tu GPU).')}</div>
          </Block>
          <Block>
            <ST>{tx('Estudio y suelo')}</ST>
            <div style={lbl}>{tx('Iluminación')}</div>
            <select aria-label={tx('Iluminación')} value={s.studio3d} onChange={e => applyScenePreset(e.target.value)} style={{ ...selectSt, marginBottom: 8 }}>
              {SCENE_PRESETS.map(x => <option key={x.id} value={x.id}>{tx(x.name)}</option>)}
            </select>
            <div style={lbl}>{tx('Escenas rápidas')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 8 }}>
              {[
                ['Estudio blanco', 'none', 'color', '#ffffff'],
                ['Gris oscuro', 'none', 'color', '#2b2926'],
                ['Mesa de madera', 'wood_table_001', 'gradient', '#d9cfba'],
                ['Pared beige', 'beige_wall_001', 'gradient', '#e8dfcf'],
                ['Baldosa damero', 'checkered_pavement_tiles', 'gradient', '#cfcfcf'],
                ['Yeso pintado', 'painted_plaster_wall', 'gradient', '#ece8e1']
              ].map(([name, stage, mode, col]) => (
                <button key={name} onClick={() => store.set({ stage3d: stage, showEnvironmentBackground: false, backgroundMode3d: mode, backgroundColor3d: col })} style={{ ...btnSt, padding: '5px 3px', fontSize: 10.5 }}>{tx(name)}</button>
              ))}
            </div>
            <div style={lbl}>{tx('Fondo')}</div>
            <select aria-label={tx('Fondo')} value={s.showEnvironmentBackground ? 'hdri' : (s.backgroundMode3d === 'color' ? 'color' : 'gradient')}
              onChange={e => store.set(e.target.value === 'hdri' ? { showEnvironmentBackground: true } : { showEnvironmentBackground: false, backgroundMode3d: e.target.value })} style={{ ...selectSt, marginBottom: 4 }}>
              <option value="color">{tx('Color liso')}</option>
              <option value="gradient">{tx('Degradado suave')}</option>
              <option value="hdri">{tx('Entorno HDRI')}</option>
            </select>
            {!cyc && !s.showEnvironmentBackground && s.backgroundMode3d === 'color' && <ColorRow label={tx('Color de fondo')} value={s.backgroundColor3d || '#ffffff'} onChange={v => store.set({ backgroundColor3d: v })} />}
            <div style={{ ...lbl, margin: '8px 0 3px' }}>{tx('Suelo')}</div>
            <select aria-label={tx('Suelo')} value={s.stage3d} onChange={e => store.set(e.target.value === 'cyclorama' ? { stage3d: 'cyclorama', showEnvironmentBackground: false, backgroundMode3d: 'color' } : { stage3d: e.target.value })} style={{ ...selectSt, marginBottom: 4 }}>
              {STAGES.map(st => <option key={st.id} value={st.id}>{tx(st.name)}</option>)}
            </select>
            {cyc && <ColorRow label={tx('Color del ciclorama')} value={s.backgroundColor3d || '#ffffff'} onChange={v => store.set({ backgroundColor3d: v, showEnvironmentBackground: false, backgroundMode3d: 'color' })} />}
            <div style={{ ...hint, marginTop: 8, fontSize: 10.5, lineHeight: 1.6 }}>{tx('El estudio sirve para revisar rápido; el suelo se cambia por separado.')}</div>
          </Block>
        </Tabs.Content>

        <Tabs.Content value="luces">
          <Block>
            <ST>{tx('Luces y sombras')}</ST>
            <ToggleRow label={tx('Mover luces en el visor 3D')} on={lightEdit} onClick={() => setLightEdit(v => !v)} />
            <div style={{ ...hint, margin: '2px 0 8px' }}>{tx('Con esto activo aparecen las luces como esferas: arrástralas para cambiar de dónde incide la luz, o elígelas en la lista.')}</div>
            <div style={{ display: 'grid', gap: 5 }}>
              {lights.map(l => (
                <div key={l.id} onClick={() => setSelLight(l.id)} style={{ border: '1px solid ' + (selLight === l.id ? '#9a5b1f' : '#e7e0d4'), background: selLight === l.id ? '#f7efe2' : '#fff', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={l.on !== false} onChange={e => setLight(l.id, { on: e.target.checked })} title={tx('Encender / apagar')} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx(l.name || l.id)}</span>
                    <input type="color" value={/^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#ffffff'} onChange={e => setLight(l.id, { color: e.target.value })} style={{ width: 22, height: 18, padding: 0, border: 'none', background: 'none' }} />
                    {l.id !== 'hemi' && <span onClick={e => { e.stopPropagation(); writeLights(lights.filter(x => x.id !== l.id)); }} title={tx('Quitar luz')} style={{ color: '#c0492b', fontSize: 12 }}>×</span>}
                  </div>
                  {selLight === l.id && (
                    <div onClick={e => e.stopPropagation()}>
                      <Range label={tx('Intensidad')} value={l.intensity} min={0} max={l.type === 'hemi' ? 1 : l.type === 'point' ? 2 : 4} step={0.01} onChange={v => setLight(l.id, { intensity: v })} />
                      {l.type !== 'hemi' && <Range label={tx('Dirección (azimut °)')} value={l.azimuth} min={-180} max={180} step={1} onChange={v => setLight(l.id, { azimuth: v })} />}
                      {l.type !== 'hemi' && <Range label={tx('Altura (elevación °)')} value={l.elevation} min={0} max={90} step={1} onChange={v => setLight(l.id, { elevation: v })} />}
                      {l.type === 'directional' && <ToggleRow label={tx('Proyecta la sombra')} on={!!l.shadow} onClick={() => setShadowLight(l.id)} />}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addLight} style={{ ...btnSt, width: '100%', marginTop: 7, padding: '6px 0', border: '1px solid #9a5b1f', color: '#9a5b1f', fontWeight: 700 }}>+ {tx('Añadir luz')}</button>
            <div style={{ height: 1, background: '#e7e0d4', margin: '10px 0 2px' }} />
            <Range label={tx('Exposición general')} value={s.expo3d} min={0.4} max={2} step={0.02} onChange={v => store.set({ expo3d: v })} />
            <Range label={tx('Intensidad del entorno')} value={s.envIntensity3d ?? 0.65} min={0} max={2} step={0.02} onChange={v => store.set({ envIntensity3d: v })} />
            <Range label={tx('Giro del entorno °')} value={s.envRotation3d ?? 0} min={-180} max={180} step={1} onChange={v => store.set({ envRotation3d: v })} />
            <Range label={tx('Suavidad de sombra')} value={s.shadowSoftness3d ?? 20} min={0} max={40} step={1} onChange={v => store.set({ shadowSoftness3d: v })} />
            <Range label={tx('Opacidad de sombra')} value={s.shadowOpacity3d ?? 0.25} min={0} max={0.8} step={0.01} onChange={v => store.set({ shadowOpacity3d: v })} />
            <div style={{ ...hint, marginTop: 6 }}>{tx('Estos ajustes valen para cualquier entorno: elige uno arriba y retócalo aquí.')}</div>
          </Block>
        </Tabs.Content>

        <Tabs.Content value="relieve">
          <Block>
            <ST>{tx('Parámetros de relieve')}</ST>
            <div style={{ fontSize: 10.5, color: '#8a8071', lineHeight: 1.6, marginBottom: 7 }}>{tx('La dirección de esta sección solo actúa como respaldo si una capa antigua no tiene dirección propia.')}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 9 }}>
              <button onClick={() => store.set({ embDir: 'up' })} style={{ ...btnSt, flex: 1, background: s.embDir === 'up' ? '#9a5b1f' : '#fff', color: s.embDir === 'up' ? '#fff' : '#5c554a' }}>{tx('Relieve')} ▲</button>
              <button onClick={() => store.set({ embDir: 'down' })} style={{ ...btnSt, flex: 1, background: s.embDir === 'down' ? '#9a5b1f' : '#fff', color: s.embDir === 'down' ? '#fff' : '#5c554a' }}>{tx('Hundido')} ▼</button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <div style={{ flex: 1 }}><div style={lbl}>{tx('Profundidad mm')}</div><input aria-label={tx('Profundidad mm')} type="number" step="0.05" min="0.05" max="1.5" value={s.embDepth} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) store.set({ embDepth: Math.min(1.5, Math.max(0.05, Math.round(v * 100) / 100)) }); }} style={inputSt} /></div>
              <div style={{ flex: 1.3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6 }}>
                <span style={{ fontSize: 12, color: '#3d3830' }}>{tx('×3 vista previa')}</span>
                <Toggle on={s.embBoost} onClick={() => store.set(st => ({ embBoost: !st.embBoost }))} />
              </div>
            </div>
            <Range label={tx('Nitidez de detalle')} value={s.embSharpness3d} min={0} max={1} step={0.05} onChange={v => store.set({ embSharpness3d: v })} />
            <Range label={tx('Detalle de normal')} value={s.embNormalStrength3d} min={0} max={3} step={0.05} onChange={v => store.set({ embNormalStrength3d: v })} />
            <Range label={tx('Desplazamiento geométrico')} value={s.embDisplacementStrength3d} min={0} max={2} step={0.05} onChange={v => store.set({ embDisplacementStrength3d: v })} />
            <div style={{ marginTop: 9, fontSize: 10.5, lineHeight: 1.6, color: '#a59a85' }}>{tx('Relieve fino: nitidez 0,8–1 · normal 1–2 · desplazamiento 0–0,4. En cartulina, 0,15–0,4 mm. La separación de producción no cambia con estos valores.')}</div>
          </Block>
          <div style={{ padding: 14 }}>
            <Note><b style={{ color: '#211d18' }}>{tx('Mapeo UV')}</b><br />{tx('El despliegue y el 3D van 1:1. El damero de 20 mm sirve para comprobar densidad y estiramiento. Los acabados se hornean en la posición exacta de cada capa.')}</Note>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>

    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 38%, #efe9db 0%, #ddd4c0 65%, #cfc4ab 100%)' }}>
      <BoxPreview s={s} m={m} context={preview} fitFold={foldPlaying} engineRef={engRef} lightEdit={lightEdit ? '1' : '0'} selLight={selLight || ''} onLightSelect={id => setSelLight(id)} onLightEdit={(id, patch) => setLight(id, patch)} />
      <div style={{ position: 'absolute', left: 12, bottom: 12, background: 'rgba(250,247,240,0.92)', border: '1px solid #ded5c4', borderRadius: 6, padding: '6px 12px', fontSize: 11, color: '#5c554a', whiteSpace: 'nowrap' }} title={tx('Rueda para zoom; doble clic para encuadrar')}>{tx('Rueda: zoom · doble clic: encuadrar')}</div>
    </div>
  </>);
}
