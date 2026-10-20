//! 取数调度：窗口可见时定时读取 SMART，并通过事件推送给前端。
//!
//! 刷新节奏放在 Rust 侧而不是前端 setInterval：WKWebView 在窗口隐藏一段时间后会
//! 挂起页面定时器，后续菜单栏常驻也需要在没有窗口时取数。

use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::smart::nvme::{self, NvmeDevice};

/// 推送取数结果的事件名，与前端 src/lib/api.ts 保持一致
pub const DEVICES_EVENT: &str = "nvme-devices";

/// 窗口可见时的定时刷新间隔
const REFRESH_INTERVAL: Duration = Duration::from_secs(30);
/// 窗口重新可见时，数据超过这个时长才立即补读
const STALE_AFTER: Duration = Duration::from_secs(10);
/// 刚读过就直接复用结果，合并并发到达的请求
const COALESCE_WITHIN: Duration = Duration::from_secs(1);

/// 传给前端的取数快照。原始值保持原始单位，格式化由前端负责。
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// 每次读取递增，前端据此丢弃乱序到达的旧结果
    pub seq: u64,
    /// 最近一次成功读取到的设备
    pub devices: Vec<NvmeDevice>,
    /// 最近一次读取失败的原因；成功时为 None
    pub error: Option<String>,
    /// 最近一次成功读取的时间（Unix 毫秒）；从未成功时为 None
    pub updated_at: Option<u64>,
}

impl Snapshot {
    fn apply(&mut self, result: Result<Vec<NvmeDevice>, String>) {
        self.seq += 1;
        match result {
            Ok(devices) => {
                self.devices = devices;
                self.error = None;
                self.updated_at = Some(unix_millis());
            }
            // 读取失败时保留上一次的设备数据，由前端标注可能已过期
            Err(e) => self.error = Some(e),
        }
    }
}

#[derive(Default)]
struct Latest {
    snapshot: Snapshot,
    read_at: Option<Instant>,
}

#[derive(Default)]
struct Schedule {
    /// 窗口可见时才定时取数
    active: bool,
    /// 需要立即取数一次
    wake: bool,
}

#[derive(Default)]
pub struct Monitor {
    latest: Mutex<Latest>,
    /// 串行化 IOKit 枚举，避免定时任务与手动刷新同时打开同一设备
    reading: Mutex<()>,
    schedule: Mutex<Schedule>,
    signal: Condvar,
}

impl Monitor {
    /// 最近一次快照；还没读取过时同步读取一次
    pub fn snapshot_or_read(&self) -> Snapshot {
        {
            let latest = self.latest.lock().unwrap();
            if latest.read_at.is_some() {
                return latest.snapshot.clone();
            }
        }
        self.read_now()
    }

    /// 立即读取一次并更新快照
    pub fn read_now(&self) -> Snapshot {
        let _reading = self.reading.lock().unwrap();
        {
            let latest = self.latest.lock().unwrap();
            if latest.read_at.is_some_and(|t| t.elapsed() < COALESCE_WITHIN) {
                return latest.snapshot.clone();
            }
        }
        let result = nvme::enumerate();
        let mut latest = self.latest.lock().unwrap();
        latest.read_at = Some(Instant::now());
        latest.snapshot.apply(result);
        latest.snapshot.clone()
    }

    /// 窗口可见性变化。重新可见且数据已过期时立即补读。
    pub fn set_active(&self, active: bool) {
        let stale = {
            let latest = self.latest.lock().unwrap();
            latest.read_at.map_or(true, |t| t.elapsed() >= STALE_AFTER)
        };
        let mut schedule = self.schedule.lock().unwrap();
        if schedule.active != active {
            schedule.active = active;
            schedule.wake = active && stale;
            self.signal.notify_one();
        }
    }

    /// 启动后台调度线程，每次读取结果通过 DEVICES_EVENT 推送
    pub fn spawn(self: &Arc<Self>, app: AppHandle) {
        let monitor = Arc::clone(self);
        thread::Builder::new()
            .name("nvme-monitor".into())
            .spawn(move || loop {
                monitor.wait_for_turn();
                let snapshot = monitor.read_now();
                let _ = app.emit(DEVICES_EVENT, snapshot);
            })
            .expect("无法启动取数线程");
    }

    /// 阻塞到下一次该取数的时刻：被唤醒，或可见状态下到达刷新间隔
    fn wait_for_turn(&self) {
        let mut schedule = self.schedule.lock().unwrap();
        loop {
            if schedule.wake {
                schedule.wake = false;
                return;
            }
            if !schedule.active {
                schedule = self.signal.wait(schedule).unwrap();
                continue;
            }
            let (guard, timeout) = self
                .signal
                .wait_timeout(schedule, REFRESH_INTERVAL)
                .unwrap();
            schedule = guard;
            if timeout.timed_out() && schedule.active {
                return;
            }
        }
    }
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_read_keeps_last_success() {
        let mut s = Snapshot::default();
        s.apply(Ok(Vec::new()));
        assert_eq!(s.seq, 1);
        assert!(s.error.is_none());
        let updated_at = s.updated_at;
        assert!(updated_at.is_some());

        s.apply(Err("boom".into()));
        assert_eq!(s.seq, 2);
        assert_eq!(s.error.as_deref(), Some("boom"));
        assert_eq!(s.updated_at, updated_at, "失败不应刷新成功时间");
    }

    #[test]
    fn becoming_visible_without_data_wakes_immediately() {
        let m = Monitor::default();
        m.set_active(true);
        // 从未读取过视为过期，应立即返回而不是等满刷新间隔
        let started = Instant::now();
        m.wait_for_turn();
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn going_hidden_cancels_pending_wake() {
        let m = Monitor::default();
        m.set_active(true);
        m.set_active(false);
        let schedule = m.schedule.lock().unwrap();
        assert!(!schedule.active);
        assert!(!schedule.wake, "刚可见又隐藏时不应再补读");
    }
}
