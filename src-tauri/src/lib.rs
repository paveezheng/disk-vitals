mod monitor;
mod smart;

use std::sync::Arc;

use monitor::{Monitor, Snapshot, DEVICES_EVENT};
use tauri::{AppHandle, Emitter, State};

/// 最近一次取数结果；后端还没读取过时同步读取一次。
#[tauri::command]
async fn list_nvme_devices(monitor: State<'_, Arc<Monitor>>) -> Result<Snapshot, String> {
    let monitor = Arc::clone(monitor.inner());
    // IOKit 调用会向设备下发管理命令，放到阻塞线程池，不占用主线程
    tauri::async_runtime::spawn_blocking(move || monitor.snapshot_or_read())
        .await
        .map_err(|e| e.to_string())
}

/// 立即重新读取，并把结果广播给所有监听者。
#[tauri::command]
async fn refresh_nvme_devices(
    app: AppHandle,
    monitor: State<'_, Arc<Monitor>>,
) -> Result<Snapshot, String> {
    let monitor = Arc::clone(monitor.inner());
    let snapshot = tauri::async_runtime::spawn_blocking(move || monitor.read_now())
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit(DEVICES_EVENT, &snapshot);
    Ok(snapshot)
}

/// 窗口可见性变化：不可见时暂停定时取数，省电，也不反复唤醒外接盘。
#[tauri::command]
fn set_monitor_active(active: bool, monitor: State<'_, Arc<Monitor>>) {
    monitor.set_active(active);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let monitor = Arc::new(Monitor::default());
    tauri::Builder::default()
        .manage(Arc::clone(&monitor))
        .setup(move |app| {
            monitor.spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_nvme_devices,
            refresh_nvme_devices,
            set_monitor_active
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 应用启动失败");
}
