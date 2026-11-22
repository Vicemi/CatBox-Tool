// Evita la ventana de consola en Windows (release).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    catbox_tool_lib::run()
}
