/** 与 src-tauri 侧 serde 序列化结果保持一致（smart/nvme.rs、monitor.rs） */

export type HealthStatus = "good" | "warning" | "critical";

export interface NvmeDevice {
  model: string;
  serial: string;
  firmware: string;
  bsdName: string;
  protocol: string;
  /** null 表示无法判断内置/外接 */
  isInternal: boolean | null;
  capacityBytes: number;

  status: HealthStatus;
  healthPercent: number;
  temperatureC: number;
  criticalWarning: number;
  criticalWarningFlags: string[];
  availableSpare: number;
  availableSpareThreshold: number;
  percentageUsed: number;

  bytesRead: number;
  bytesWritten: number;
  dataUnitsRead: number;
  dataUnitsWritten: number;
  hostReadCommands: number;
  hostWriteCommands: number;
  controllerBusyTimeMinutes: number;
  powerCycles: number;
  powerOnHours: number;
  unsafeShutdowns: number;
  mediaErrors: number;
  errorLogEntries: number;
}

/** 一次取数的结果，对应 monitor.rs 的 Snapshot */
export interface NvmeSnapshot {
  /** 每次读取递增，用于丢弃乱序到达的旧结果 */
  seq: number;
  /** 最近一次成功读取到的设备 */
  devices: NvmeDevice[];
  /** 最近一次读取失败的原因；成功时为 null */
  error: string | null;
  /** 最近一次成功读取的时间（Unix 毫秒）；从未成功时为 null */
  updatedAt: number | null;
}
