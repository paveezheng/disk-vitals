import type { HealthStatus } from "../types";

const LABEL: Record<HealthStatus, string> = {
  good: "正常",
  warning: "注意",
  critical: "危险",
};

const STYLE: Record<HealthStatus, string> = {
  good: "bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
  warning: "bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-400",
  critical: "bg-rose-500/12 text-rose-600 ring-rose-500/25 dark:text-rose-400",
};

const DOT: Record<HealthStatus, string> = {
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
};

export function StatusDot({ status }: { status: HealthStatus }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {status !== "good" && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${DOT[status]}`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${DOT[status]}`} />
    </span>
  );
}

export default function StatusPill({ status }: { status: HealthStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STYLE[status]}`}
    >
      <StatusDot status={status} />
      {LABEL[status]}
    </span>
  );
}
