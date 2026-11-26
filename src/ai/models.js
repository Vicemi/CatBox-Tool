// Catálogo de módulos IA (ONNX, se ejecutan en el navegador con onnxruntime-web / wasm).
// Tamaños y sha256 verificados contra la descarga real (HTTP 200) el 2026-11-26.
const W2X = 'https://huggingface.co/deepghs/waifu2x_onnx/resolve/main/20230329/onnx_models/';
const MB = b => Math.round(b / 1048576 * 10) / 10;
const m = o => ({ ...o, sizeMB: MB(o.sizeBytes) });

export const MODELS = [
  m({
    id: 'waifu2x-photo-x2', name: 'waifu2x Foto ×2', task: 'upscale', scale: 2, engine: 'waifu2x',
    params: { scale: 2, pad: 8, core: 96 },
    sizeBytes: 19008421, sha256: '75830a7b0fc0310372d88917fa66bf2b92b83a6a725f3c90d4ec410d3ee747d2',
    license: 'MIT (nagadomi/nunif)', url: W2X + 'swin_unet/photo/noise1_scale2x.onnx',
    description: 'Amplía fotografías ×2 y suaviza ruido/artefactos leves (swin_unet, ruido 1).'
  }),
  m({
    id: 'waifu2x-art-x2', name: 'waifu2x Ilustración ×2', task: 'upscale', scale: 2, engine: 'waifu2x',
    params: { scale: 2, pad: 18, core: 128 },
    sizeBytes: 5178788, sha256: '5d3288a2847e51d8944002dc81aea76ef1a2879db33b8fb86d5953b4b1c442bf',
    license: 'MIT (nagadomi/nunif)', url: W2X + 'cunet/art/noise1_scale2x.onnx',
    description: 'Amplía ilustraciones, logos y dibujos ×2 (cunet, ruido 1). Muy ligero y rápido.'
  }),
  m({
    id: 'realesr-general-x4v3', name: 'Real-ESRGAN General ×4', task: 'upscale', scale: 4, engine: 'esrgan',
    params: { scale: 4, pad: 10, core: 108 },
    sizeBytes: 4876654, sha256: '83adcbbe5f96dc323c839abef6ca540e719bbdbd4c1bc91ffc7526f83073bedf',
    license: 'BSD-3-Clause (xinntao/Real-ESRGAN)', url: 'https://huggingface.co/tamnvcc/Real-ESRGAN-General-x4v3_float/resolve/main/onnx/model.onnx',
    description: 'Amplía ×4 imágenes generales (fotos y gráficos) con realesr-general-x4v3.'
  }),
  m({
    id: 'waifu2x-photo-denoise', name: 'waifu2x Reducir ruido (foto)', task: 'denoise', scale: 1, engine: 'waifu2x',
    params: { scale: 1, pad: 8, core: 96 },
    sizeBytes: 19008421, sha256: '12e593b8db71d25f458194ac9e7713ea89703d90641addd4be53bb81c30c7d7e',
    license: 'MIT (nagadomi/nunif)', url: W2X + 'swin_unet/photo/noise2.onnx',
    description: 'Reduce ruido y artefactos JPEG en fotos sin cambiar el tamaño (swin_unet, ruido 2).'
  }),
  m({
    id: 'u2netp', name: 'U²-Netp Quitar fondo', task: 'background', engine: 'u2net',
    params: { size: 320 },
    sizeBytes: 4574861, sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    license: 'Apache-2.0 (xuebinqin/U-2-Net)', url: 'https://huggingface.co/BritishWerewolf/U-2-Netp/resolve/main/onnx/model.onnx',
    description: 'Segmentación de primer plano para recortar el fondo (genera transparencia).'
  })
];

export const byId = id => { const x = MODELS.find(o => o.id === id); if (!x) throw new Error('Unknown AI module: ' + id); return x; };
