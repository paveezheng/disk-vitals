import { invoke } from "@tauri-apps/api/core";
import type { NvmeDevice } from "../types";

/** 是否运行在 Tauri 容器内（而非普通浏览器） */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 读取 NVMe 设备列表。
 * 在浏览器中以 DEV 模式运行时回退到样本数据，便于不重编 Rust 直接调界面。
 */
export async function listNvmeDevices(): Promise<NvmeDevice[]> {
  if (inTauri()) {
    return invoke<NvmeDevice[]>("list_nvme_devices");
  }
  if (import.meta.env.DEV) {
    const { MOCK_DEVICES } = await import("./mock");
    return MOCK_DEVICES;
  }
  throw new Error("未运行在 Tauri 容器中，无法读取设备");
}
