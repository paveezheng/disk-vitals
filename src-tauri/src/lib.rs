mod smart;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![smart::nvme::list_nvme_devices])
        .run(tauri::generate_context!())
        .expect("Tauri 应用启动失败");
}
