import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { NvmeSnapshot } from "../types";

/** 与 src-tauri/src/monitor.rs 的 DEVICES_EVENT 保持一致 */
const DEVICES_EVENT = "nvme-devices";

const NOT_IN_TAURI = "未运行在 Tauri 容器中，无法读取设备";

/** 是否运行在 Tauri 容器内（而非普通浏览器） */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 浏览器 DEV 模式下回退到样本数据，便于不重编 Rust 直接调界面 */
async function mockSnapshot(): Promise<NvmeSnapshot> {
  const { MOCK_DEVICES } = await import("./mock");
  const now = Date.now();
  return { seq: now, devices: MOCK_DEVICES, error: null, updatedAt: now };
}

/** 最近一次取数结果；后端还没读取过时会同步读取一次 */
export async function listNvmeDevices(): Promise<NvmeSnapshot> {
  if (inTauri()) return invoke<NvmeSnapshot>("list_nvme_devices");
  if (import.meta.env.DEV) return mockSnapshot();
  throw new Error(NOT_IN_TAURI);
}

/** 立即重新读取；结果同时会通过 DEVICES_EVENT 广播 */
export async function refreshNvmeDevices(): Promise<NvmeSnapshot> {
  if (inTauri()) return invoke<NvmeSnapshot>("refresh_nvme_devices");
  if (import.meta.env.DEV) return mockSnapshot();
  throw new Error(NOT_IN_TAURI);
}

/** 订阅后端定时取数的推送 */
export async function onDevicesUpdated(
  handler: (snapshot: NvmeSnapshot) => void,
): Promise<UnlistenFn> {
  if (!inTauri()) return () => {};
  return listen<NvmeSnapshot>(DEVICES_EVENT, (e) => handler(e.payload));
}

/** 窗口可见性变化时通知后端暂停 / 恢复定时取数 */
export async function setMonitorActive(active: boolean): Promise<void> {
  if (inTauri()) await invoke("set_monitor_active", { active });
}
