/** 展示层格式化。取数层只提供原始数值，单位换算与显示都在这里做。 */

export function formatBytes(bytes: number, digits = 2): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  const v = bytes / Math.pow(1000, i);
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** 通电时长：小时数转成「x 年 y 天 z 小时」的紧凑写法 */
export function formatHours(hours: number): string {
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  if (days < 365) return `${days} 天 ${h} 小时`;
  const years = Math.floor(days / 365);
  return `${years} 年 ${days % 365} 天`;
}

export function formatTemp(c: number): string {
  return `${c.toFixed(1)}°C`;
}

export function formatBusyTime(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  return formatHours(Math.floor(minutes / 60));
}
