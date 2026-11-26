// Página de pruebas manuales (solo dev: /src/ai/harness.html). No entra en el build.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AIImagePanel } from '../ui/AIModules.jsx';
import { DialogHost } from '../ui/dialogs.jsx';

function makeImage(n) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, n, n); g.addColorStop(0, '#2a6f97'); g.addColorStop(1, '#f6c177');
  x.fillStyle = g; x.fillRect(0, 0, n, n);
  x.fillStyle = '#d1495b'; x.beginPath(); x.arc(n * 0.5, n * 0.5, n * 0.28, 0, 7); x.fill();
  x.fillStyle = '#fff'; x.font = `bold ${n * 0.14}px sans-serif`; x.textAlign = 'center'; x.fillText('CatBox', n * 0.5, n * 0.54);
  x.strokeStyle = '#222'; x.lineWidth = Math.max(1, n / 128); for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(0, i * n / 12); x.lineTo(n, i * n / 12 + n / 8); x.stroke(); }
  const d = x.getImageData(0, 0, n, n); for (let i = 0; i < d.data.length; i += 4) { const r = (Math.random() - 0.5) * 24; d.data[i] += r; d.data[i + 1] += r; d.data[i + 2] += r; }
  x.putImageData(d, 0, 0);
  return c;
}

function H() {
  const [cv, setCv] = useState(() => makeImage(512));
  const host = useRef(null), [log, setLog] = useState([]);
  window.__h = { set: n => setCv(makeImage(n)), cv, log };
  React.useEffect(() => { if (host.current) { host.current.replaceChildren(cv); cv.style.cssText = 'max-width:300px;max-height:300px;background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/16px 16px'; } }, [cv]);
  return <div style={{ display: 'flex', gap: 16, padding: 16 }}>
    <div style={{ width: 300 }}>
      <AIImagePanel getCanvas={() => cv} applyCanvas={(c, label) => { setLog(l => l.concat(label + ' ' + c.width + 'x' + c.height)); setCv(c); }} />
      <button id="s512" onClick={() => setCv(makeImage(512))}>512</button> <button id="s2000" onClick={() => setCv(makeImage(2000))}>2000</button>
    </div>
    <div><div ref={host} /><div id="log">{log.join(' | ')}</div><div id="size">{cv.width}x{cv.height}</div></div>
    <DialogHost />
  </div>;
}
createRoot(document.getElementById('root')).render(<H />);
