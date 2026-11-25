# CatBox Tool — Roadmap

CatBox Tool is a fork of [OpenBox3D](https://github.com/yuyou-dev/OpenBox3D) with Spanish/English/Chinese UI, more box-building tools, a prepress/laser output module, an image editor and a desktop app.

Status legend: ☐ todo · ◐ in progress · ☑ done

## 0. Foundation (owner: lead)
- ☑ Rename to **CatBox Tool**, Tomcat title font, white logo in the header
- ☑ `.gitignore` (agent folders `.claude/`, `.serena/`, `.impeccable/`, secrets, builds)
- ☑ Radix UI primitives + `@tabler/icons-react` installed
- ☑ i18n base: `src/i18n/` (key = Spanish text, `en`/`zh` per area in `src/i18n/locales/*.js`)
- ☑ Undo/redo covers structure + design
- ☑ README with attribution to OpenBox3D

## 1. Box builder — «Mi caja» (agent: builder)
- ☑ Any library template can be opened and edited in Mi caja (no more lock)
- ☑ Visible tool palette (icons + tooltips)
- ☑ Flap/tab picker (tuck, dust, glue, ear, side tab, chamfer…) with previews
- ☑ Slots/locks presets (slot, tab-and-slot pair, lock tab)
- ☑ Self-locking presets: triangular slice (right/equilateral), one-piece tuck box with hinged lid, mushroom tabs, 0.8 mm slits and corner locks; no glue
- ☑ Smart checker: detects bad dimensions/overlaps/mismatched tabs and offers one-click fixes
- ☑ ES/EN/ZH strings

## 2. Output — laser & print shop (agent: output)
- ☑ Board/paper type and sheet format (A0–A6, SRA3, Letter, laser beds, custom)
- ☑ Smart nesting: place N boxes on a sheet efficiently, yield report
- ☑ Nested SVG (laser) and PDF (print, crop marks) export
- ☑ ES/EN/ZH strings

## 3. 3D environments (agent: three)
- ☑ More environments (cyclorama, desk, shelf, outdoor HDRI…) combining HDRI + floor + backdrop
- ☑ Camera presets and PNG render export
- ☑ ES/EN/ZH strings

## 4. Image editor in Design (agent: editor)
- ☑ Canvas editor: layers, brush, eraser, shapes, text, crop, rotate/flip
- ☑ Adjustments (brightness, contrast, hue/saturation), background removal (magic wand / color key)
- ☑ Compose several images for one face and send the result back as a layer
- ☑ ES/EN/ZH strings

## 5. Desktop app — Rust/Tauri (agent: desktop)
- ☑ Tauri 2 shell around the Vite app (`cargo check` clean)
- ☑ Native "Save as" for every export (`src/platform.js` → Rust `pick_save_path` / `write_picked`), verified in the built .exe
- ☑ In-app dialogs replace alert/confirm/prompt (`src/ui/dialogs.jsx`)
- ☑ `npm run desktop:dev` / `desktop:build`
- ☑ Release build: `CatBox Tool_0.1.2_x64-setup.exe` and `.msi`

## 6. Shell strings (agent: haiku — opencode free model stalled and was stopped)
- ☑ Translate canvas/status-bar/widget strings

## 7. Integration (owner: lead)
- ◐ Build ☑, all views load without errors and switch ES/EN/ZH ☑; visual review in a visible browser ☐

## 8. Free-form faces and exact art mapping (v0.1.4)
- ☑ Free polygon net faces (`shape: 'poly'` + `pts`)
- ☑ Exact art mapping on custom faces at any hinge angle (`uvAffine`)
- ☑ Folded custom nets no longer render mirrored (pieces reflected in X)
- ☑ `?project=<url>` opens a `.boxproj` at startup
- ☐ UI to draw/edit `poly` outlines (today they come from project files)

## 9. v0.2.0 — builder, designer, DXF, 3D performance
- ☑ Builder: shape palette (drag onto any edge, "+" on free edges), start from scratch, real polygon sides on every non-rect face, mitred flaps, flaps on flaps, flaps follow their edge (`fit`)
- ☑ Flap profiles: asymmetric, circular (`halfdisc`), straight + curved (`quarter`), corner radius per side (`roundL`/`roundR`), mitre per side (`miterL`/`miterR`)
- ☑ Free-form faces: vertex editing on canvas (`toFreeForm`, `editVertex`)
- ☑ Line kinds: cut, crease, perforation (`perf`), slot (optional rounded ends), circular hole (`hole`); holes cut in the 3D mesh
- ☑ Safe zones and resize handles follow the real outline
- ☑ Designer: Photoshop-style toolbar and layers, transform, align/distribute, multi-select and group transform, gradients, shadows, text outline, clipping mask, face-shaped layers, fit/cover to face, centroid centring
- ☑ DXF R12 / AutoCAD 2000 export (CORTE, MARCADO, PUNTEADO with real dashes); perforation layer in laser SVG
- ☑ 3D: render on demand, cached shadows and paper maps, 1×1 empty channels
- Checks: `node scripts/check-builder-flaps.mjs`, `node scripts/check-builder-shapes.mjs`, `node scripts/check-dxf.mjs`, `npm run check:template-sync`

## 10. v0.2.1 — everything editable
- ☑ Per-side line type (cut, crease, perforation, none) incl. the hinge (dgeTypes, hingeType); Structure view can remove any line (	ypeOvr: 'none')
- ☑ Free form: curved sides (ptsB) and radius per corner (ptsR), sides keep their logical index for joins and line types
- ☑ Fold direction (valley/mountain) and angle per face with V/M marks on the sheet
- ☑ Designer: layer groups and paintable non-destructive layer masks

## Known limits / next
- Nesting packs the bounding box of the whole dieline (no contour interlock, no per-piece split).
- Templates converted to «Mi caja» lose the 3D assembly info of lid/drawer templates.
- Face names drawn on the 2D sheet, material names (MATS) and template names (TPLS) are still Spanish only.
- Image editor: no Safari support for adjustments (ctx.filter); text layers are rasterized.
- Desktop: release installer built (`tauri build`); CSP verified by loading the app and importing a project.
