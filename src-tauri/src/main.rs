// 发布构建时不弹控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    disk_vitals_lib::run()
}
