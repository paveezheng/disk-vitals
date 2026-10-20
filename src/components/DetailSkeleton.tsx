/** 首次取数较慢时的占位，形状与 DeviceDetail 一致 */
export default function DetailSkeleton() {
  const block = "bg-slate-500/10";
  return (
    <div
      aria-busy="true"
      aria-label="正在读取 S.M.A.R.T. 数据"
      className="space-y-6 motion-safe:animate-pulse"
    >
      <div className="space-y-2">
        <div className={`h-7 w-64 rounded-lg ${block}`} />
        <div className={`h-4 w-80 rounded ${block}`} />
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <div className={`size-[132px] shrink-0 rounded-full ${block}`} />
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={`h-[88px] rounded-xl ${block}`} />
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className={`h-72 rounded-xl ${block}`} />
        ))}
      </div>
    </div>
  );
}
