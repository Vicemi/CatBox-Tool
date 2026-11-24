<div align="center">

<img src="public/brand/catbox-logo-dark.png" alt="CatBox Tool logo" width="96">

# CatBox Tool

**Estudio de packaging para diseñar cajas: troqueles paramétricos, constructor de redes libre, diseño por capas con acabados, editor de imágenes, plegado 3D y archivos de producción para láser e imprenta.**

**Packaging studio for designing boxes: parametric dielines, a free-form net builder, layer design with print finishes, an image editor, 3D folding preview and production files for laser cutters and print shops.**

[Español](#español) · [English](#english) · 中文 (UI)

<img src="docs/screenshots/demo-3d.jpg" alt="CatBox Tool 3D preview" width="820">

</div>

> **Basado en / Based on [OpenBox3D](https://github.com/yuyou-dev/OpenBox3D)** by yuyou-dev (MIT).

<sub>Las capturas usan cajas de demostración con marcas ficticias. / Screenshots use demo boxes with fictional brands.</sub>

| Diseño por cara / Per-face design | Constructor de redes / Net builder |
|---|---|
| <img src="docs/screenshots/demo-design.jpg" alt="Design workspace" width="420"> | <img src="docs/screenshots/demo-builder.jpg" alt="Net builder" width="420"> |
| **Plegado 3D / 3D folding** | **Producción y nesting / Production and nesting** |
| <img src="docs/screenshots/demo-fold.jpg" alt="3D folding" width="420"> | <img src="docs/screenshots/demo-output.jpg" alt="Output and nesting" width="420"> |

---

## Español

CatBox Tool adapta OpenBox3D al español, inglés y chino, suma herramientas para construir cajas, un sistema de producción más completo, una app de escritorio (Rust/Tauri) y una interfaz y vista 3D mejoradas.

### Funciones

- **Biblioteca de troqueles**: tuck inverso y recto, caja de envío, tapa y base, cajón, cilindro, hexágono y envolvente, con compensación de espesor, sangrado y zona segura.
- **Mi caja**: caja paramétrica rápida o editor de red avanzado. Se agregan, mueven y ajustan caras, solapas, lengüetas, cortes, pliegues y ranuras, con reglas, guías y desplazamiento fino.
- **Caras de forma libre** (v0.1.4): una cara con `shape: "poly"` lleva su propio contorno en `pts` (mm locales, bisagra de `[0,0]` a `[w,0]`). Permite pirámides, bisagras inclinadas y lóbulos curvos (tapas de corazón).
- **Cajas autobloqueantes sin pegamento**: lengüetas tipo hongo que pasan por ranuras de 0,8 mm, trabas de esquina y tapas con solapa de una sola pieza.
- **Revisión automática**: detecta caras, solapas y ranuras incoherentes y sugiere correcciones.
- **Diseño**: texto, imágenes y formas por cara, con acabados por capa (oro/plata, UV, brillo, holográfico, relieve). Cada capa se recorta a la cara a la que pertenece.
- **Editor de imágenes**: capas, pincel, borrador, formas, texto, recorte, ajustes y quitar fondo.
- **Vista 3D**: materiales PBR y plegado paso a paso. El arte se mapea exacto en caras con cualquier ángulo de bisagra y las redes plegadas ya no se ven espejadas (v0.1.4).
- **Producción**: SVG láser 1:1 con capas de corte y pliegue, PDF para imprenta con sangrado y separaciones, y nesting de varias cajas por plancha.
- **Proyectos** `.boxproj` locales (sin servidor, cuenta ni telemetría). Se pueden abrir por URL: `?project=/ruta/archivo.boxproj`.

### Inicio rápido

Requisitos: Node.js 18+ (y Rust + los [requisitos de Tauri](https://tauri.app/start/prerequisites/) para la app de escritorio).

```bash
npm install
npm run dev            # app web en http://localhost:5173
npm run build          # build de producción en dist/
npm run desktop:dev    # app de escritorio (Tauri)
npm run desktop:build  # instalador de escritorio
```

Los instaladores para Windows están en [Releases](https://github.com/Vicemi/CatBox-Tool/releases).

### Traducciones

Los textos pasan por `t('Texto en español')`. Para agregar o corregir una traducción, editá el archivo del área en `src/i18n/locales/` (mapas `en` y `zh` con el texto en español como clave).

---

## English

CatBox Tool ports OpenBox3D to Spanish, English and Chinese, and adds more box-building tools, a more complete production system, a desktop app (Rust/Tauri) and an improved interface and 3D view.

### Features

- **Dieline library**: reverse and straight tuck, mailer, lid & base, drawer, cylinder, hexagon and wrap boxes, with material thickness compensation, bleed and safe zone.
- **My box**: quick parametric box or advanced net editor. Add, move and resize faces, flaps, tabs, cuts, creases and slots, with rulers, guides and fine nudging.
- **Free-form faces** (v0.1.4): a face with `shape: "poly"` carries its own outline in `pts` (panel-local mm, hinge from `[0,0]` to `[w,0]`). Pyramids, slanted hinges and curved lobes (heart lids) work.
- **Self-locking boxes, no glue**: mushroom tabs through 0.8 mm slits, corner locks and one-piece tuck lids.
- **Smart checks**: preflight detects inconsistent faces, flaps and slots and suggests fixes.
- **Design**: text, images and shapes per face, with per-layer finishes (gold/silver foil, spot UV, gloss, holographic, emboss). Each layer is clipped to the face it belongs to.
- **Image editor**: layers, brush, eraser, shapes, text, crop, adjustments and background removal.
- **3D preview**: PBR materials and step-by-step folding. Art is mapped exactly on faces at any hinge angle, and folded nets are no longer shown mirrored (v0.1.4).
- **Production output**: 1:1 laser SVG with cut and crease layers, print PDF with bleed and separations, and nesting of several boxes per sheet.
- **Projects**: local `.boxproj` files (no server, no account, no telemetry). Open one by URL: `?project=/path/file.boxproj`.

### Quick start

Requirements: Node.js 18+ (and Rust + the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for the desktop app).

```bash
npm install
npm run dev            # web app at http://localhost:5173
npm run build          # production build in dist/
npm run desktop:dev    # desktop app (Tauri)
npm run desktop:build  # desktop installer
```

Windows installers are on [Releases](https://github.com/Vicemi/CatBox-Tool/releases).

### Translations

UI strings go through `t('Texto en español')`. To add or fix a translation, edit the area file in `src/i18n/locales/` (`en` and `zh` maps keyed by the Spanish text). Missing keys fall back to Spanish.

---

## Estructura / Project layout

| Ruta / Path | Contenido / What |
|---|---|
| `src/dieline/` | Plantillas, geometría de redes, revisión / templates, net geometry, preflight |
| `src/design/` | Capas de diseño / design layers |
| `src/editor/` | Editor de imágenes / image editor |
| `src/render3d/` | Plegado 3D, materiales, luces / 3D folding, materials, lighting |
| `src/export/` | PDF, SVG láser, separaciones, nesting / PDF, laser SVG, separations, nesting |
| `src/i18n/` | Traducciones / translations |
| `src/ui/` | Espacios de trabajo / workspaces |
| `src-tauri/` | App de escritorio / desktop shell (Rust/Tauri) |
| `docs/ROADMAP.md` | Hoja de ruta / roadmap |

## Créditos y licencia / Credits and license

- Proyecto original / original project: [OpenBox3D](https://github.com/yuyou-dev/OpenBox3D) © yuyou-dev, MIT.
- Los cambios de CatBox Tool usan la misma licencia MIT / CatBox Tool changes use the same MIT License (`LICENSE`).
- Texturas y HDRI / textures and HDRIs: [Poly Haven](https://polyhaven.com) (CC0).
- Fuente del título / title font: *Tomcat* (`public/fonts/Tomcat.ttf`); revisar su licencia antes de redistribuir / check its license before redistributing.
