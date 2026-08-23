import { useCallback, useEffect, useState } from "react";
import type { NvmeDevice } from "./types";
import { listNvmeDevices } from "./lib/api";
import DeviceDetail from "./components/DeviceDetail";
import { StatusDot } from "./components/StatusPill";
import { formatBytes, formatTemp } from "./lib/format";

const REFRESH_INTERVAL_MS = 30_000;

export default function App() {
  const [devices, setDevices] = useState<NvmeDevice[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listNvmeDevices();
      setDevices(list);
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const current = devices[selected];

  return (
    <div className="flex h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* 侧栏 */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white/70 dark:border-white/8 dark:bg-white/3">
        {/* 顶部留出红绿灯按钮的位置 */}
        <div data-tauri-drag-region className="h-11 shrink-0" />
        <div className="px-4 pb-2">
          <h1 className="text-[13px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
            存储设备
          </h1>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {devices.map((d, i) => (
            <button
              key={`${d.serial}-${d.bsdName}`}
              onClick={() => setSelected(i)}
              className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                i === selected
                  ? "bg-sky-500/12 ring-1 ring-sky-500/25 ring-inset"
                  : "hover:bg-slate-500/8"
              }`}
            >
              <div className="flex items-center gap-2">
                <StatusDot status={d.status} />
                <span className="truncate text-sm font-medium">{d.model}</span>
              </div>
              <div className="tnum mt-1 pl-4 text-xs text-slate-500 dark:text-slate-400">
                {formatBytes(d.capacityBytes)} · {formatTemp(d.temperatureC)}
              </div>
            </button>
          ))}

          {!loading && devices.length === 0 && !error && (
            <p className="px-3 py-2 text-sm text-slate-400">未发现设备</p>
          )}
        </nav>

        <footer className="border-t border-slate-200 px-4 py-3 dark:border-white/8">
          <button
            onClick={() => void refresh()}
            className="w-full rounded-lg bg-slate-900/5 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-900/10 dark:bg-white/8 dark:hover:bg-white/12"
          >
            刷新
          </button>
          {updatedAt && (
            <p className="tnum mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
              {updatedAt.toLocaleTimeString("zh-CN")} 更新
            </p>
          )}
        </footer>
      </aside>

      {/* 主区 */}
      <main className="flex-1 overflow-y-auto">
        <div data-tauri-drag-region className="h-11 shrink-0" />
        <div className="px-8 pb-10">
          {loading && (
            <p className="text-sm text-slate-400">正在读取 S.M.A.R.T. 数据…</p>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/8 p-4">
              <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                读取失败
              </div>
              <p className="mt-1 font-mono text-xs text-rose-600/90 dark:text-rose-300/90">
                {error}
              </p>
            </div>
          )}

          {!loading && !error && devices.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white/60 p-6 dark:border-white/8 dark:bg-white/4">
              <h2 className="text-base font-semibold">未发现可读取的 NVMe 设备</h2>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                当前版本仅支持内置及 PCIe / Thunderbolt 外接的 NVMe 设备。
                通过 USB 连接的硬盘受 macOS 限制无法读取 S.M.A.R.T. 数据。
              </p>
            </div>
          )}

          {current && <DeviceDetail d={current} />}
        </div>
      </main>
    </div>
  );
}
