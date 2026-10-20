import type { HealthStatus } from "../types";
import { useCountUp } from "../lib/motion";

const STROKE: Record<HealthStatus, string> = {
  good: "stroke-emerald-500",
  warning: "stroke-amber-500",
  critical: "stroke-rose-500",
};

interface Props {
  percent: number;
  status: HealthStatus;
  size?: number;
}

export default function HealthRing({ percent, status, size = 132 }: Props) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  // 入场时从 0 扫到目标值；切换设备时从上一个值接着过渡，圆环与数字同步
  const shown = useCountUp(clamped);
  const offset = circumference * (1 - shown / 100);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="fill-none stroke-slate-200 dark:stroke-white/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          // 0% 时圆头线帽会残留一个点，直接隐藏
          opacity={shown < 0.5 ? 0 : 1}
          className={`fill-none transition-colors duration-500 ${STROKE[status]}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum text-3xl font-semibold text-slate-900 dark:text-white">
          {Math.round(shown)}
          <span className="text-lg text-slate-400 dark:text-slate-500">%</span>
        </span>
        <span className="mt-0.5 text-[11px] tracking-wide text-slate-500 dark:text-slate-400">
          健康度
        </span>
      </div>
    </div>
  );
}
