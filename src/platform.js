// Browser vs desktop (Tauri) differences: saving files and opening external links.
const isDesktop = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

// Saves a Blob. Desktop: native "Save as" dialog (WebView2 ignores <a download>). Browser: download.
// Resolves false if the user cancels the dialog.
export async function saveFile(name, blob) {
  if (isDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke('pick_save_path', { name });
    if (!path) return false;
    await invoke('write_picked', new Uint8Array(await blob.arrayBuffer()));
    return true;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}

export async function openExternal(url) {
  if (!isDesktop()) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_external', { url });
}
