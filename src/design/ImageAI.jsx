// «Mejorar con IA» para una capa de imagen del diseñador: la imagen original se decodifica a un canvas y el resultado
// (p. ej. ×4) reemplaza imgSrc; la capa conserva su tamaño en mm, así que los dpi suben.
import React, { useEffect, useRef } from 'react';
import { AIImagePanel } from '../ui/AIModules.jsx';
import { patchLayers } from './ops.js';

export function ImageAIBlock({ sel }) {
  const cv = useRef(null);
  useEffect(() => {
    cv.current = null;
    if (!sel.imgSrc) return undefined;
    let live = true; const im = new Image();
    im.onload = () => { if (!live) return; const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); cv.current = c; };
    im.src = sel.imgSrc;
    return () => { live = false; };
  }, [sel.id, sel.imgSrc]);
  const id = sel.id, png = /^data:image\/png/i.test(sel.imgSrc || '');
  const getCanvas = () => cv.current || document.createElement('canvas');
  const applyCanvas = res => {
    if (!res || !res.width) return;
    patchLayers([id], { imgSrc: res.toDataURL(png ? 'image/png' : 'image/jpeg', 0.95), imgW: res.width, imgH: res.height, pxw: res.width });
  };
  return <AIImagePanel getCanvas={getCanvas} applyCanvas={applyCanvas} />;
}
