import { useCallback, useEffect, useRef, useState } from "react";
import type { NvmeSnapshot } from "./types";
import {
  listNvmeDevices,
  onDevicesUpdated,
  refreshNvmeDevices,
  setMonitorActive,
} from "./lib/api";
import { useDelayedFlag, withViewTransition } from "./lib/motion";
import DetailSkeleton from "./components/DetailSkeleton";
import DeviceDetail from "./components/DeviceDetail";
import Sidebar from "./components/Sidebar";

export default function App() {
  const [snapshot, setSnapshot] = useState<NvmeSnapshot | null>(null);
  /** IPC 本身失败；取数失败放在 snapshot.error */
  const [ipcError, setIpcError] = useState<string | null>(null);
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);

  // 首次加载、后端推送、手动刷新可能乱序到达，只保留序号最新的一份
  const accept = useCallback((next: NvmeSnapshot) => {
    setSnapshot((prev) => (prev && prev.seq > next.seq ? prev : next));
    setIpcError(null);
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisten = onDevicesUpdated(accept);
    listNvmeDevices()
      .then((s) => {
        if (!disposed) accept(s);
      })
      .catch((e) => {
        if (!disposed) setIpcError(String(e));
      });
    return () => {
      disposed = true;
      void unlisten.then((off) => off());
    };
  }, [accept]);

  // 刷新节奏由后端调度；窗口不可见时让它暂停
  useEffect(() => {
    const sync = () => void setMonitorActive(!document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      accept(await refreshNvmeDevices());
    } catch (e) {
      setIpcError(String(e));
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [accept]);

  const devices = snapshot?.devices ?? [];
  // 按硬盘自身序列号选中：设备插拔或顺序变化时不会选到别的盘
  const current = devices.find((d) => d.serial === selectedSerial) ?? devices[0];
  const error = ipcError ?? snapshot?.error ?? null;
  const loading = snapshot === null && ipcError === null;
  const showSkeleton = useDelayedFlag(loading, 150);
  const empty = !loading && !error && devices.length === 0;

  const select = useCallback(
    (serial: string) => {
      if (serial !== current?.serial) withViewTransition(() => setSelectedSerial(serial));
    },
    [current?.serial],
  );

  return (
    <div className="flex h-full text-slate-900 select-none dark:text-slate-100">
      <Sidebar
        devices={devices}
        selectedSerial={current?.serial}
        onSelect={select}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        updatedAt={snapshot?.updatedAt ?? null}
        showEmpty={empty}
      />

      {/* 主区不透明；侧栏透出窗口的原生毛玻璃材质 */}
      <main className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
        <div data-tauri-drag-region className="h-11 shrink-0" />
        <div className="px-8 pb-10">
          {showSkeleton && <DetailSkeleton />}

          {error && (
            <div className="banner-enter mb-6 rounded-xl border border-rose-500/25 bg-rose-500/8 p-4">
              <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                读取失败
              </div>
              <p className="mt-1 font-mono text-xs text-rose-600/90 select-text dark:text-rose-300/90">
                {error}
              </p>
              {current && (
                <p className="mt-1.5 text-xs text-rose-600/80 dark:text-rose-300/80">
                  下方显示的是上次成功读取的数据
                </p>
              )}
            </div>
          )}

          {empty && (
            <div className="rounded-xl border border-slate-200 bg-white/60 p-6 dark:border-white/8 dark:bg-white/4">
              <h2 className="text-base font-semibold">未发现可读取的 NVMe 设备</h2>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                当前版本仅支持内置及 PCIe / Thunderbolt 外接的 NVMe 设备。
                通过 USB 连接的硬盘受 macOS 限制无法读取 S.M.A.R.T. 数据。
              </p>
            </div>
          )}

          {current && (
            <div className="detail-pane">
              <DeviceDetail d={current} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
