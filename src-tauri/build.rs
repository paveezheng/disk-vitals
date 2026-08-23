fn main() {
    // 取数层用 C 编写：IOKit 的 SMART 接口是 COM 风格 plugin interface，
    // 用 Rust 手写 vtable 极易在 reserved 字段上静默错位。详见 AGENTS.md。
    cc::Build::new()
        .file("csrc/smart_shim.c")
        .flag_if_supported("-Wno-deprecated-declarations")
        .compile("smart_shim");

    println!("cargo:rustc-link-lib=framework=IOKit");
    println!("cargo:rustc-link-lib=framework=CoreFoundation");
    println!("cargo:rerun-if-changed=csrc/smart_shim.c");
    println!("cargo:rerun-if-changed=csrc/smart_shim.h");

    tauri_build::build();
}
