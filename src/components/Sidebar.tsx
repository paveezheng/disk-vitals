import { useLayoutEffect, useRef, useState } from "react";
import type { NvmeDevice } from "../types";
import { StatusDot } from "./StatusPill";
import { formatBytes, formatClock, formatTemp } from "../lib/format";

interface Props {
  devices: NvmeDevice[];
  selectedSerial: string | undefined;
  onSelect: (serial: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  updatedAt: number | null;
  showEmpty: boolean;
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3h-3" />
    </svg>
  );
}

export default function Sidebar({
  devices,
  selectedSerial,
  onSelect,
  refreshing,
  onRefresh,
  updatedAt,
  showEmpty,
}: Props) {
  const items = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

  // 选中高亮是独立的一层，切换时用 transform 滑过去，只走合成层
  useLayoutEffect(() => {
    const el = selectedSerial ? items.current.get(selectedSerial) : undefined;
    const next = el ? { top: el.offsetTop, height: el.offsetHeight } : null;
    setIndicator((prev) =>
      prev && next && prev.top === next.top && prev.height === next.height ? prev : next,
    );
  }, [selectedSerial, devices]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 dark:border-white/8">
      {/* 顶部留出红绿灯按钮的位置 */}
      <div data-tauri-drag-region className="h-11 shrink-0" />
      <div className="px-4 pb-2">
        <h1 className="text-[13px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
          存储设备
        </h1>
      </div>

      <nav className="relative flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {indicator && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-2 top-0 rounded-lg bg-sky-500/12 ring-1 ring-sky-500/25 ring-inset transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ height: indicator.height, transform: `translateY(${indicator.top}px)` }}
          />
        )}

        {devices.map((d) => (
          <button
            key={`${d.serial}-${d.bsdName}`}
            ref={(el) => {
              if (!el) return;
              items.current.set(d.serial, el);
              return () => {
                items.current.delete(d.serial);
              };
            }}
            onClick={() => onSelect(d.serial)}
            aria-current={d.serial === selectedSerial ? "true" : undefined}
            className={`relative w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
              d.serial === selectedSerial ? "" : "hover:bg-slate-500/8"
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

        {showEmpty && <p className="px-3 py-2 text-sm text-slate-400">未发现设备</p>}
      </nav>

      <footer className="border-t border-slate-200 px-4 py-3 dark:border-white/8">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900/5 px-3 py-1.5 text-sm font-medium transition-colors enabled:hover:bg-slate-900/10 enabled:active:bg-slate-900/15 disabled:opacity-60 dark:bg-white/8 dark:enabled:hover:bg-white/12 dark:enabled:active:bg-white/16"
        >
          <RefreshIcon className={`size-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`} />
          {refreshing ? "刷新中…" : "刷新"}
        </button>
        {updatedAt !== null && (
          <p className="tnum mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
            {formatClock(updatedAt)} 更新
          </p>
        )}
      </footer>
    </aside>
  );
}
