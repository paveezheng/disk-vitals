//! NVMe SMART 取数：C 垫片（csrc/smart_shim.c）的安全封装。
//!
//! 本模块是 Rust 侧唯一接触 FFI 的地方。IOKit 的 COM 风格 plugin interface
//! 全部封闭在 C 内，这里只处理 POD 结构体与整型返回值。

use serde::Serialize;
use std::os::raw::c_char;

const DV_STR_LEN: usize = 64;
const DV_MAX_DEVICES: usize = 32;

/// NVMe 规范：1 data unit = 1000 × 512 字节
const BYTES_PER_DATA_UNIT: u64 = 512_000;

/// 必须与 csrc/smart_shim.h 中的 DvNvmeDevice 逐字段对齐。
/// 布局一致性由 tests::struct_layout_matches_c 断言保证。
#[repr(C)]
#[derive(Copy, Clone)]
struct DvNvmeDevice {
    model: [c_char; DV_STR_LEN],
    serial: [c_char; DV_STR_LEN],
    firmware: [c_char; DV_STR_LEN],
    bsd_name: [c_char; DV_STR_LEN],
    protocol: [c_char; DV_STR_LEN],
    is_internal: i32,
    capacity_bytes: u64,

    critical_warning: u8,
    temperature_k: i32,
    available_spare: u8,
    available_spare_threshold: u8,
    percentage_used: u8,
    data_units_read: u64,
    data_units_written: u64,
    host_read_commands: u64,
    host_write_commands: u64,
    controller_busy_time: u64,
    power_cycles: u64,
    power_on_hours: u64,
    unsafe_shutdowns: u64,
    media_errors: u64,
    error_log_entries: u64,
}

extern "C" {
    fn dv_nvme_enumerate(out: *mut DvNvmeDevice, max_count: i32) -> i32;
    /// 仅用于测试断言 FFI 布局一致性
    #[cfg_attr(not(test), allow(dead_code))]
    fn dv_nvme_device_size() -> i32;
}

/// 健康状态。判定规则见 [`NvmeDevice::derive_status`]。
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    Good,
    Warning,
    Critical,
}

/// 传给前端的设备信息。原始值保持原始单位，格式化由前端负责。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NvmeDevice {
    pub model: String,
    pub serial: String,
    pub firmware: String,
    pub bsd_name: String,
    pub protocol: String,
    /// None 表示无法判断内置/外接
    pub is_internal: Option<bool>,
    pub capacity_bytes: u64,

    pub status: HealthStatus,
    /// 100 - percentage_used，下限 0
    pub health_percent: u8,
    pub temperature_c: f64,
    pub critical_warning: u8,
    /// critical_warning 位域解析出的可读条目
    pub critical_warning_flags: Vec<String>,
    pub available_spare: u8,
    pub available_spare_threshold: u8,
    pub percentage_used: u8,

    pub bytes_read: u64,
    pub bytes_written: u64,
    pub data_units_read: u64,
    pub data_units_written: u64,
    pub host_read_commands: u64,
    pub host_write_commands: u64,
    pub controller_busy_time_minutes: u64,
    pub power_cycles: u64,
    pub power_on_hours: u64,
    pub unsafe_shutdowns: u64,
    pub media_errors: u64,
    pub error_log_entries: u64,
}

fn cstr_to_string(buf: &[c_char]) -> String {
    let bytes: Vec<u8> = buf.iter().take_while(|&&c| c != 0).map(|&c| c as u8).collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// NVMe 规范 5.10.1.2，Critical Warning 位域
fn decode_critical_warning(bits: u8) -> Vec<String> {
    const LABELS: [(u8, &str); 5] = [
        (0b0000_0001, "备用空间低于阈值"),
        (0b0000_0010, "温度超出阈值"),
        (0b0000_0100, "可靠性下降"),
        (0b0000_1000, "介质已置为只读"),
        (0b0001_0000, "易失内存备份失效"),
    ];
    LABELS
        .iter()
        .filter(|(mask, _)| bits & mask != 0)
        .map(|(_, label)| label.to_string())
        .collect()
}

impl NvmeDevice {
    fn derive_status(raw: &DvNvmeDevice, temperature_c: f64) -> HealthStatus {
        // 任一关键警告位置位，或备用空间跌破厂商阈值 → 危险
        if raw.critical_warning != 0
            || raw.available_spare < raw.available_spare_threshold
            || raw.percentage_used >= 100
        {
            return HealthStatus::Critical;
        }
        // 寿命消耗过半以上、出现介质错误、或温度偏高 → 警告
        if raw.percentage_used >= 80 || raw.media_errors > 0 || temperature_c >= 70.0 {
            return HealthStatus::Warning;
        }
        HealthStatus::Good
    }
}

impl From<DvNvmeDevice> for NvmeDevice {
    fn from(raw: DvNvmeDevice) -> Self {
        let temperature_c = f64::from(raw.temperature_k) - 273.15;
        NvmeDevice {
            model: cstr_to_string(&raw.model),
            serial: cstr_to_string(&raw.serial),
            firmware: cstr_to_string(&raw.firmware),
            bsd_name: cstr_to_string(&raw.bsd_name),
            protocol: cstr_to_string(&raw.protocol),
            is_internal: match raw.is_internal {
                1 => Some(true),
                0 => Some(false),
                _ => None,
            },
            capacity_bytes: raw.capacity_bytes,

            status: NvmeDevice::derive_status(&raw, temperature_c),
            health_percent: 100u8.saturating_sub(raw.percentage_used),
            temperature_c,
            critical_warning: raw.critical_warning,
            critical_warning_flags: decode_critical_warning(raw.critical_warning),
            available_spare: raw.available_spare,
            available_spare_threshold: raw.available_spare_threshold,
            percentage_used: raw.percentage_used,

            bytes_read: raw.data_units_read.saturating_mul(BYTES_PER_DATA_UNIT),
            bytes_written: raw.data_units_written.saturating_mul(BYTES_PER_DATA_UNIT),
            data_units_read: raw.data_units_read,
            data_units_written: raw.data_units_written,
            host_read_commands: raw.host_read_commands,
            host_write_commands: raw.host_write_commands,
            controller_busy_time_minutes: raw.controller_busy_time,
            power_cycles: raw.power_cycles,
            power_on_hours: raw.power_on_hours,
            unsafe_shutdowns: raw.unsafe_shutdowns,
            media_errors: raw.media_errors,
            error_log_entries: raw.error_log_entries,
        }
    }
}

/// 枚举所有可读的 NVMe 设备。不需要 root 权限。
pub fn enumerate() -> Result<Vec<NvmeDevice>, String> {
    // DvNvmeDevice 是 POD，零值初始化是安全的
    let mut raw: Vec<DvNvmeDevice> = vec![unsafe { std::mem::zeroed() }; DV_MAX_DEVICES];
    let n = unsafe { dv_nvme_enumerate(raw.as_mut_ptr(), DV_MAX_DEVICES as i32) };
    if n < 0 {
        return Err(format!("dv_nvme_enumerate 返回错误码 {n}"));
    }
    Ok(raw.into_iter().take(n as usize).map(NvmeDevice::from).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// FFI 布局一致性。字段增删时若两侧不同步，这里会先炸。
    #[test]
    fn struct_layout_matches_c() {
        let c_size = unsafe { dv_nvme_device_size() } as usize;
        assert_eq!(
            c_size,
            std::mem::size_of::<DvNvmeDevice>(),
            "C 与 Rust 的 DvNvmeDevice 大小不一致，字段定义已错位"
        );
    }

    #[test]
    fn decodes_critical_warning_bits() {
        assert!(decode_critical_warning(0).is_empty());
        assert_eq!(decode_critical_warning(0b0000_0001).len(), 1);
        assert_eq!(decode_critical_warning(0b0001_0101).len(), 3);
    }

    #[test]
    fn health_percent_never_underflows() {
        let mut raw: DvNvmeDevice = unsafe { std::mem::zeroed() };
        raw.percentage_used = 255;
        raw.temperature_k = 300;
        let d = NvmeDevice::from(raw);
        assert_eq!(d.health_percent, 0);
        assert_eq!(d.status, HealthStatus::Critical);
    }

    /// 在开发机上跑真实设备。不硬编码具体数值，只断言字段合理性。
    #[test]
    fn enumerate_returns_plausible_data() {
        let devices = enumerate().expect("枚举失败");
        for d in &devices {
            assert!(!d.serial.is_empty(), "序列号不应为空: {d:?}");
            assert!(!d.model.is_empty(), "型号不应为空: {d:?}");
            assert!(
                d.temperature_c > -20.0 && d.temperature_c < 120.0,
                "温度超出合理范围: {}",
                d.temperature_c
            );
            assert!(d.available_spare <= 100, "备用空间百分比越界");
            assert!(d.capacity_bytes > 0, "容量应大于 0");
            assert_eq!(d.bytes_written, d.data_units_written * BYTES_PER_DATA_UNIT);
        }
        println!("枚举到 {} 台设备", devices.len());
    }
}
