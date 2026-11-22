use std::{path::PathBuf, sync::Mutex};
use tauri::{ipc::InvokeBody, ipc::Request, AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

// WebView2 ignores <a download>, so exports go through a native "Save as" dialog.
// Two steps keep the file name in JSON (Unicode-safe) and the bytes in a raw body (no base64).
#[derive(Default)]
struct PickedPath(Mutex<Option<PathBuf>>);

#[tauri::command]
async fn pick_save_path(app: AppHandle, picked: State<'_, PickedPath>, name: String) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some(ext) = name.rsplit_once('.').map(|(_, e)| e.to_string()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext.as_str()]);
    }
    let path = dialog.blocking_save_file().and_then(|p| p.into_path().ok());
    *picked.0.lock().map_err(|e| e.to_string())? = path.clone();
    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn write_picked(picked: State<'_, PickedPath>, request: Request<'_>) -> Result<(), String> {
    // Only ever writes to the path the user just chose in the dialog.
    let path = picked.0.lock().map_err(|e| e.to_string())?.take().ok_or("no destination chosen")?;
    match request.body() {
        InvokeBody::Raw(bytes) => std::fs::write(&path, bytes).map_err(|e| e.to_string()),
        _ => Err("expected raw bytes".into()),
    }
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https links".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PickedPath::default())
        .invoke_handler(tauri::generate_handler![pick_save_path, write_picked, open_external])
        .run(tauri::generate_context!())
        .expect("error while running CatBox Tool");
}
