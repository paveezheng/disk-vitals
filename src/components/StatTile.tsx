import type { ReactNode } from "react";

interface Props {
  label: string;
  value: string;
  sub?: string;
  accent?: ReactNode;
  /** 放在数值下方的附加内容，例如温度色阶条 */
  children?: ReactNode;
}

export default function StatTile({ label, value, sub, accent, children }: Props) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/60 p-4 dark:border-white/8 dark:bg-white/4">
      <div className="text-[11px] font-medium tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="tnum mt-1.5 flex items-baseline gap-1.5 text-lg leading-snug font-semibold text-slate-900 dark:text-white">
        {value}
        {accent}
      </div>
      {sub && (
        <div className="tnum mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</div>
      )}
      {children}
    </div>
  );
}
