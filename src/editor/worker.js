// Heavy pixel ops off the main thread. Message: {id, kind, name, params, buf, w, h} -> {id, buf}.
import { runOp } from './fx.js';
self.onmessage = e => {
  const { id, kind, name, params, buf, w, h } = e.data;
  const img = { data: new Uint8ClampedArray(buf), width: w, height: h };
  runOp(img, kind, name, params);
  self.postMessage({ id, buf: img.data.buffer }, [img.data.buffer]);
};
