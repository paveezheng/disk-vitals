/*
 * smart_shim.h — IOKit NVMe SMART 取数层，暴露朴素 C ABI 供 Rust 调用
 *
 * 设计约束见 AGENTS.md：所有与 IOKit COM 风格 plugin interface 的交互都封闭在
 * 本模块内，Rust 侧只接触 POD 结构体与整型返回值。
 */
#ifndef DV_SMART_SHIM_H
#define DV_SMART_SHIM_H

#include <stdint.h>

#define DV_STR_LEN     64
#define DV_MAX_DEVICES 32

/* 与 Rust 侧 #[repr(C)] struct 逐字段对齐，改动务必同步 */
typedef struct {
    char     model[DV_STR_LEN];
    char     serial[DV_STR_LEN];
    char     firmware[DV_STR_LEN];
    char     bsd_name[DV_STR_LEN];
    char     protocol[DV_STR_LEN];     /* "PCI-Express" / "Apple Fabric" 等 */
    int32_t  is_internal;              /* 1=内置 0=外接 -1=未知 */
    uint64_t capacity_bytes;

    /* --- SMART / Health Information Log (NVMe 规范 5.10.1.2) --- */
    uint8_t  critical_warning;         /* 位域，逐位解析 */
    int32_t  temperature_k;            /* 原始值，单位开尔文 */
    uint8_t  available_spare;          /* % */
    uint8_t  available_spare_threshold;/* % */
    uint8_t  percentage_used;          /* 寿命已消耗 % */
    uint64_t data_units_read;          /* 1 unit = 512000 bytes */
    uint64_t data_units_written;
    uint64_t host_read_commands;
    uint64_t host_write_commands;
    uint64_t controller_busy_time;     /* 分钟 */
    uint64_t power_cycles;
    uint64_t power_on_hours;
    uint64_t unsafe_shutdowns;
    uint64_t media_errors;
    uint64_t error_log_entries;
} DvNvmeDevice;

/*
 * 枚举所有 NVMe SMART 可读设备并填充 out 数组。
 * 返回实际写入的设备数（>=0），负值表示错误。
 * 不需要 root 权限。
 */
int32_t dv_nvme_enumerate(DvNvmeDevice *out, int32_t max_count);

/*
 * 返回 sizeof(DvNvmeDevice)。供 Rust 侧测试断言 #[repr(C)] 布局与 C 一致，
 * 防止字段增删时两边悄悄错位。
 */
int32_t dv_nvme_device_size(void);

#endif /* DV_SMART_SHIM_H */
