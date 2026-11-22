<div align="center">

<img src="public/brand/catbox-logo-dark.png" alt="CatBox Tool logo" width="96">

# CatBox Tool

**Packaging studio for designing boxes: parametric dielines, a free-form box builder, layer design with print finishes, a built-in image editor, 3D folding preview, and production files for laser cutters and print shops.**

Español · English · 中文

</div>

> **Based on [OpenBox3D](https://github.com/yuyou-dev/OpenBox3D)** by yuyou-dev (MIT).
> CatBox Tool ports it to Spanish, English and Chinese, adds more box-building tools, a more complete production system, a desktop app (Rust/Tauri) and an improved interface and 3D view.

---

## Features

- **Dieline library**: reverse tuck, straight tuck, mailer, lid & base, drawer, cylinder, hexagon and wrap boxes. They include material thickness compensation, bleed and safe zone.
- **My box** builder: quick parametric box or an advanced net editor. You can add, move and resize faces, flaps, tabs, cuts, creases and slots, using rulers, guides and fine nudging. Any library template can be opened here as an editable base.
- **Self-locking presets**: one-piece slice/ wedge boxes and one-piece tuck boxes. The lid, front tab, slot and corner ears are part of the same net, so the box closes without glue or tape.
- **Smart checks**: preflight detects inconsistent faces, flaps and slots and suggests fixes.
- **Design**: text, images and shapes per face, with fit/cover/center, rotation and snapping. Finishes per layer: gold/silver foil, spot UV, gloss, holographic, emboss/deboss.
- **Image editor**: layers, brush, eraser, shapes, text, crop, adjustments and background removal. You can also compose a full face from several images.
- **3D preview**: PBR materials and step-by-step folding. You can open individual faces, edit the lights and switch between several environments for presentation renders.
- **Production output**:
  - **Laser**: SVG at 1:1 scale with cut and crease layers and kerf data.
  - **Print shop**: PDF with bleed, cut/crease spot colors and finish separations.
  - **Sheet planning**: choose sheet formats (A-series, SRA, laser beds, custom) and nest several boxes on one sheet.
- **Projects**: `.boxproj` files, local-only (no server, no account, no telemetry).
- **Undo/redo** for both structure and design.

## Self-locking boxes (no glue)

The **My box → presets** menu now includes:

- **Rebanada autobloqueante** — triangular slice box with a hinged lid, a front tab and a matching slot. Based on a right isosceles triangle (or an equilateral variant).
- **Caja de una pieza** — rectangular base, four walls, hinged lid, front tab/slot and corner ears. All in one net.

The closures use **mushroom-shaped tabs** (`mushroom`) that pass through **0.8 mm slits** and stay retained: one front tab for the lid and four corner tabs for the walls. There is no glue panel and no separate lid.

These presets are ordinary `tpl: "custom"` nets. They export 2D die lines, fold in the 3D view, accept design layers and use the same laser/print output as the rest of the library. No glue panel is generated.

## Checks

```bash
npm run check:template-sync   # library, 2D and 3D contracts
```

## Quick start

Requirements: Node.js 18+ (and Rust + the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for the desktop app).

```bash
npm install
npm run dev            # web app at http://localhost:5173
npm run build          # production build in dist/
npm run desktop:dev    # desktop app (Tauri)
npm run desktop:build  # desktop installer
```

## Project layout

| Path | What |
|---|---|
| `src/dieline/` | Templates, box builder geometry, preflight checks |
| `src/design/` | Design layers, containers, images |
| `src/editor/` | Built-in image editor |
| `src/render3d/` | three.js folding, materials, lighting, environments |
| `src/export/` | PDF, laser SVG, separations, sheet nesting |
| `src/i18n/` | Translations (key = Spanish text, `en`/`zh` per area) |
| `src/ui/` | Workspaces: Structure, My box, Design, 3D, Output |
| `src-tauri/` | Desktop shell (Rust/Tauri) |
| `docs/ROADMAP.md` | Roadmap and task status |

## Translations

UI strings go through `t('Texto en español')`. To add or fix a translation, edit the area file in `src/i18n/locales/` (`en` and `zh` maps keyed by the Spanish text). Missing keys fall back to Spanish.

## Credits and license

- Original project: [OpenBox3D](https://github.com/yuyou-dev/OpenBox3D) © yuyou-dev, MIT License.
- CatBox Tool changes are released under the same MIT License (see `LICENSE`).
- PBR floor textures and HDRIs: [Poly Haven](https://polyhaven.com) (CC0).
- Title font: *Tomcat* (`public/fonts/Tomcat.ttf`). Check the font's own license before redistributing.
