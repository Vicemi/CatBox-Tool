// Brush engine: dabs accumulate into a transparent stroke buffer (flow); the buffer is composited over the untouched base at
// `opacity` (so overlapping dabs never exceed it) and clipped by the selection. The result is previewed through a canvas the
// renderer draws instead of the layer, and copied into the layer when the stroke ends.
import { mkCanvas, cloneCanvas } from './doc.js';

const rgbOf = hex => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export function makeStamp(size, hard, color, pencil) {
  const d = Math.max(2, Math.ceil(size) + 2), c = mkCanvas(d, d), x = c.getContext('2d'), r = Math.max(0.5, size / 2), [R, G, B] = rgbOf(color);
  if (pencil || hard >= 0.99) { x.fillStyle = color; x.beginPath(); x.arc(d / 2, d / 2, r, 0, Math.PI * 2); x.fill(); return c; }
  const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, r);
  g.addColorStop(0, `rgba(${R},${G},${B},1)`); g.addColorStop(Math.max(0, Math.min(0.99, hard)), `rgba(${R},${G},${B},1)`); g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  x.fillStyle = g; x.fillRect(0, 0, d, d);
  return c;
}

// target: layer canvas (document sized); setPreview(canvas|null) tells the renderer to draw `canvas` instead.
export function startStroke({ target, w, h, size, hard, opacity, flow, color, erase, pencil, selCanvas, setPreview, redraw }) {
  const base = cloneCanvas(target), buf = mkCanvas(w, h), bx = buf.getContext('2d'), pv = mkCanvas(w, h), pc = pv.getContext('2d'), tmp = selCanvas ? mkCanvas(w, h) : null;
  const stamp = makeStamp(size, hard, color, pencil), step = pencil ? 1 : Math.max(1, size * 0.12), half = stamp.width / 2;
  let last = null, carry = 0;
  const dab = (x, y) => { if (pencil) { x = Math.round(x); y = Math.round(y); } bx.globalAlpha = pencil ? 1 : flow; bx.drawImage(stamp, x - half, y - half); };
  const compose = () => {
    pc.globalCompositeOperation = 'source-over'; pc.globalAlpha = 1; pc.clearRect(0, 0, w, h); pc.drawImage(base, 0, 0);
    let src = buf;
    if (tmp) { const tc = tmp.getContext('2d'); tc.globalCompositeOperation = 'source-over'; tc.clearRect(0, 0, w, h); tc.drawImage(buf, 0, 0); tc.globalCompositeOperation = 'destination-in'; tc.drawImage(selCanvas, 0, 0); src = tmp; }
    pc.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; pc.globalAlpha = opacity; pc.drawImage(src, 0, 0);
    pc.globalAlpha = 1; pc.globalCompositeOperation = 'source-over';
  };
  setPreview(pv);
  return {
    to(p) {
      if (!last) { dab(p[0], p[1]); last = p; }
      else {
        const dx = p[0] - last[0], dy = p[1] - last[1], dist = Math.hypot(dx, dy);
        let t = step - carry;
        while (t <= dist) { dab(last[0] + dx * t / dist, last[1] + dy * t / dist); t += step; }
        carry = dist - (t - step); if (carry < 0) carry = 0; last = p;
      }
      compose(); redraw();
    },
    end() {
      const x = target.getContext('2d'); x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'copy'; x.drawImage(pv, 0, 0); x.restore();
      setPreview(null);
    },
    cancel() { setPreview(null); }
  };
}
