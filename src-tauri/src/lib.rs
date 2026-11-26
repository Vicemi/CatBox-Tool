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

// Font families installed on the system, so the designer can offer them (WebView2 already renders any
// installed family by name; it just cannot list them). Read-only: scans the OS font folders and parses
// the `name` table of each file; nothing is copied or loaded into the page.
fn font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(windows) {
        let win = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        dirs.push(PathBuf::from(win).join("Fonts"));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Microsoft").join("Windows").join("Fonts"));
        }
    } else if cfg!(target_os = "macos") {
        dirs.push("/System/Library/Fonts".into());
        dirs.push("/Library/Fonts".into());
        if let Ok(home) = std::env::var("HOME") { dirs.push(PathBuf::from(home).join("Library/Fonts")); }
    } else {
        dirs.push("/usr/share/fonts".into());
        dirs.push("/usr/local/share/fonts".into());
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(&home).join(".fonts"));
            dirs.push(PathBuf::from(home).join(".local/share/fonts"));
        }
    }
    dirs
}

fn collect_font_files(dir: &std::path::Path, out: &mut Vec<PathBuf>, depth: u8) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth < 4 { collect_font_files(&p, out, depth + 1); }
        } else if let Some(ext) = p.extension().and_then(|x| x.to_str()) {
            if matches!(ext.to_ascii_lowercase().as_str(), "ttf" | "otf" | "ttc" | "otc") { out.push(p); }
        }
    }
}

// Typographic family (name ID 16) when present, else the legacy family (ID 1); English names preferred.
fn family_of(face: &ttf_parser::Face) -> Option<String> {
    let names = face.names();
    let pick = |id: u16| {
        let mut best: Option<String> = None;
        for n in names.into_iter().filter(|n| n.name_id == id) {
            if let Some(s) = n.to_string() {
                if n.language_id == 0x0409 { return Some(s); }
                if best.is_none() { best = Some(s); }
            }
        }
        best
    };
    pick(16).or_else(|| pick(1)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[tauri::command]
async fn list_system_fonts() -> Result<Vec<String>, String> {
    Ok(scan_font_families())
}

fn scan_font_families() -> Vec<String> {
    let mut files = Vec::new();
    for d in font_dirs() { collect_font_files(&d, &mut files, 0); }
    let mut fams = std::collections::BTreeSet::new();
    for f in files {
        let Ok(data) = std::fs::read(&f) else { continue };
        let count = ttf_parser::fonts_in_collection(&data).unwrap_or(1);
        for i in 0..count {
            if let Ok(face) = ttf_parser::Face::parse(&data, i) {
                // Hidden/system-UI families start with '.' or '@' (vertical CJK variants); skip them.
                if let Some(name) = family_of(&face).filter(|n| !n.starts_with('.') && !n.starts_with('@')) {
                    fams.insert(name);
                }
            }
        }
    }
    fams.into_iter().collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn finds_installed_families() {
        let fams = super::scan_font_families();
        assert!(!fams.is_empty(), "no fonts found");
        if cfg!(windows) { assert!(fams.iter().any(|f| f == "Arial"), "Arial missing"); }
        assert!(fams.iter().all(|f| !f.starts_with('@')), "vertical variants leaked");
        println!("{} families, e.g. {:?}", fams.len(), &fams[..fams.len().min(5)]);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PickedPath::default())
        .invoke_handler(tauri::generate_handler![pick_save_path, write_picked, open_external, list_system_fonts])
        .run(tauri::generate_context!())
        .expect("error while running CatBox Tool");
}
