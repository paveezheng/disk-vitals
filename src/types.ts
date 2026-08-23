/** 与 src-tauri/src/smart/nvme.rs 的 serde 序列化结果保持一致 */

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
