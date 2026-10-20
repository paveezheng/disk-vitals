import type { CSSProperties } from "react";
import type { NvmeDevice } from "../types";
import HealthRing from "./HealthRing";
import StatusPill from "./StatusPill";
import StatTile from "./StatTile";
import {
  formatBusyTime,
  formatBytes,
  formatCount,
  formatHours,
  formatTemp,
} from "../lib/format";

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-200/70 py-2.5 last:border-0 dark:border-white/6">
      <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={`truncate text-sm text-slate-900 select-text dark:text-slate-100 ${mono ? "font-mono text-[13px]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

/** 与 nvme.rs derive_status 的温度警告阈值一致 */
const TEMP_WARN_C = 70;
/** 色阶条满格对应的温度 */
const TEMP_SCALE_MAX_C = 85;

function TempMeter({ celsius }: { celsius: number }) {
  const ratio = Math.max(0, Math.min(1, celsius / TEMP_SCALE_MAX_C));
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-500/15">
      {/* 动画见 index.css .meter-fill：scaleX 只走合成层，不动 width */}
      <div
        className={`meter-fill h-full ${celsius >= TEMP_WARN_C ? "bg-amber-500" : "bg-emerald-500"}`}
        style={{ "--meter": ratio } as CSSProperties}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
        {title}
      </h3>
      <div className="rounded-xl border border-slate-200/80 bg-white/60 px-4 dark:border-white/8 dark:bg-white/4">
        {children}
      </div>
    </section>
  );
}

export default function DeviceDetail({ d }: { d: NvmeDevice }) {
  const location =
    d.isInternal === null ? "未知" : d.isInternal ? "内置" : "外接";

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-slate-900 select-text dark:text-white">
            {d.model}
          </h2>
          <StatusPill status={d.status} />
        </div>
        <p className="tnum mt-1 text-sm text-slate-500 select-text dark:text-slate-400">
          {d.protocol} · {location} · {formatBytes(d.capacityBytes)} · /dev/{d.bsdName}
        </p>
      </header>

      {d.criticalWarningFlags.length > 0 && (
        <div className="banner-enter rounded-xl border border-rose-500/25 bg-rose-500/8 p-4">
          <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">
            设备报告了关键警告
          </div>
          <ul className="mt-1.5 list-inside list-disc text-sm text-rose-600/90 dark:text-rose-300/90">
            {d.criticalWarningFlags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-6">
        <HealthRing percent={d.healthPercent} status={d.status} />
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="温度" value={formatTemp(d.temperatureC)}>
            <TempMeter celsius={d.temperatureC} />
          </StatTile>
          <StatTile
            label="通电时间"
            value={`${formatCount(d.powerOnHours)} 小时`}
            sub={formatHours(d.powerOnHours)}
          />
          <StatTile label="累计写入" value={formatBytes(d.bytesWritten)} />
          <StatTile label="通电次数" value={formatCount(d.powerCycles)} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="设备信息">
          <Field label="型号" value={d.model} />
          <Field label="序列号" value={d.serial} mono />
          <Field label="固件版本" value={d.firmware} mono />
          <Field label="容量" value={formatBytes(d.capacityBytes)} />
          <Field label="接口" value={d.protocol} />
          <Field label="位置" value={location} />
          <Field label="设备节点" value={`/dev/${d.bsdName}`} mono />
        </Section>

        <Section title="健康数据">
          <Field label="寿命已消耗" value={`${d.percentageUsed}%`} />
          <Field
            label="可用备用空间"
            value={`${d.availableSpare}%（阈值 ${d.availableSpareThreshold}%）`}
          />
          <Field label="介质错误" value={formatCount(d.mediaErrors)} />
          <Field label="错误日志条目" value={formatCount(d.errorLogEntries)} />
          <Field label="非正常关机" value={formatCount(d.unsafeShutdowns)} />
          <Field label="控制器繁忙时长" value={formatBusyTime(d.controllerBusyTimeMinutes)} />
          <Field
            label="关键警告位"
            value={`0x${d.criticalWarning.toString(16).padStart(2, "0")}`}
            mono
          />
        </Section>

        <Section title="读写统计">
          <Field label="累计写入" value={formatBytes(d.bytesWritten)} />
          <Field label="累计读取" value={formatBytes(d.bytesRead)} />
          <Field label="写入数据单元" value={formatCount(d.dataUnitsWritten)} />
          <Field label="读取数据单元" value={formatCount(d.dataUnitsRead)} />
          <Field label="主机写命令数" value={formatCount(d.hostWriteCommands)} />
          <Field label="主机读命令数" value={formatCount(d.hostReadCommands)} />
        </Section>
      </div>
    </div>
  );
}
