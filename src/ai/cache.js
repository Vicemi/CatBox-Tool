// Almacén persistente de modelos: Cache Storage (persiste en el navegador y en el perfil WebView2 de la app de escritorio).
// Lo usan el hilo principal y el worker.
const NAME = 'catbox-ai-models-v1';
const key = id => 'https://catbox-ai.invalid/' + id;

export const cacheSupported = () => typeof caches !== 'undefined';
export async function cacheHas(id, sizeBytes) {
  if (!cacheSupported()) return false;
  const r = await (await caches.open(NAME)).match(key(id));
  return !!r && Number(r.headers.get('x-size')) === sizeBytes;
}
export async function cacheGet(id) {
  const r = await (await caches.open(NAME)).match(key(id));
  if (!r) throw new Error('Module not installed: ' + id);
  return r.arrayBuffer();
}
export async function cachePut(id, blob) {
  await (await caches.open(NAME)).put(key(id), new Response(blob, { headers: { 'content-type': 'application/octet-stream', 'x-size': String(blob.size) } }));
}
export async function cacheDelete(id) { if (cacheSupported()) await (await caches.open(NAME)).delete(key(id)); }
