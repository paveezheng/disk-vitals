# AGENTS.md — disk-vitals 开发指引

macOS 硬盘健康监测工具。本文件是 AI agent 在本仓库工作时的操作指引，背景与决策依据见 [README.md](README.md)。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | **Tauri v2**（系统 WKWebView，产物体积小） |
| 前端 | **React + TypeScript + Vite + Tailwind CSS** |
| 后端 | **Rust**（Tauri command 层） |
| 取数 | **C 垫片**（`src-tauri/csrc/`）直接调 IOKit，经 `cc` crate 编入二进制 |

## 目录结构

```
src/                      React 前端
  components/             UI 组件
  types.ts                与 Rust 侧对齐的类型定义
src-tauri/
  csrc/smart_shim.{c,h}   IOKit 取数层（C ABI）★ 核心
  src/smart/nvme.rs       C ABI 的 Rust 安全封装
  src/lib.rs              Tauri commands
  build.rs                编译 C 垫片 + 链接 IOKit/CoreFoundation
tools/probe/smart_probe.c 独立探针，取数层的对拍基准
```

## 常用命令

```bash
npm install                                  # 装前端依赖
npm run tauri dev                            # 开发模式
npm run tauri build                          # 打包 .app
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 侧测试

# 取数层独立验证（不经过 Tauri，排查问题时最快）
clang -o /tmp/sp tools/probe/smart_probe.c -framework IOKit -framework CoreFoundation && /tmp/sp
```

---

## 硬性约束

### 1. 当前范围：只做 NVMe，不做 USB

**不要实现任何 USB / SATA / ATA / SAT 相关逻辑。** 当前阶段只支持内置及 PCIe/Thunderbolt 外接的 NVMe 设备。

USB 支持在 macOS 上需要用户自行安装第三方内核扩展，涉及降低系统安全等级，已决定**推迟**。相关背景见 README §6，但**不要**据此提前实现 ATA 路径。

### 2. 绝不需要提权

取数全部走公开 IOKit API，**已实测确认不需要 root**。如果你写出的代码需要 `sudo`、特权 helper、`SMJobBless` 或 kext，说明方向错了，停下来重新审视。

### 3. 绝不分发内核扩展

本项目不打包、不镜像、不分发任何 kext。

### 4. 不引入 smartmontools

GPL-2.0 会传染分发方式，且它在 macOS 上不支持 USB，没有收益。

---

## 取数层要点

### 为什么用 C 垫片而不是纯 Rust FFI

IOKit 的 SMART 接口是 COM 风格的 plugin interface（`IOCFPlugInInterface**` + UUID `QueryInterface`）。用 Rust 手写这个 vtable 需要精确匹配结构体布局，其中大量 `reserved` 字段一旦错位会**静默读出垃圾数据**，且没有编译期保护。

因此：**C 垫片负责所有与 IOKit 交互的部分，只向 Rust 暴露朴素 C ABI（POD 结构体 + 整型返回值）**。Rust 侧不得直接触碰 `IOCFPlugInInterface`。

修改 `smart_shim.c` 后，务必先用 `tools/probe/smart_probe.c` 的方式独立编译验证，再走 Tauri。

### 关键 API

- 头文件：`$(xcrun --show-sdk-path)/System/Library/Frameworks/IOKit.framework/Headers/storage/nvme/NVMeSMARTLibExternal.h`
- 匹配设备：按属性 `"NVMe SMART Capable" = true` 匹配 IOService
- 打开接口：`IOCreatePlugInInterfaceForService(..., kIONVMeSMARTUserClientTypeID, ...)` → `QueryInterface(kIONVMeSMARTInterfaceID)`
- 读数据：`SMARTReadData()` 取健康数据，`GetIdentifyData()` 取型号/序列号/固件版本

### 数据换算（易错，务必遵守）

| 字段 | 换算 |
|---|---|
| `TEMPERATURE` | 单位是**开尔文**，显示需 `- 273.15` |
| `DATA_UNITS_READ/WRITTEN` | 1 unit = **512000 字节**（不是 512） |
| 各计数器 | 声明为 `uint64_t[2]`，是 **128 位**小端整数；取 `[0]` 即可，但不要误当成两个独立值 |
| `PERCENTAGE_USED` | 寿命**已消耗**百分比，健康度 = `100 - used` |
| `CRITICAL_WARNING` | 位域，逐位解析（bit0 备用空间不足 / bit1 温度越界 / bit2 可靠性下降 / bit3 只读模式 / bit4 易失内存备份失效） |

### 设备身份识别

**不得使用 USB 序列号作为设备唯一标识**——实测同型号硬盘盒会上报相同序列号。使用硬盘自身序列号（`GetIdentifyData` 返回的 `SERIAL_NUMBER`）。

注意 `IOEmbeddedNVMeBlockDevice` / `IONVMeBlockStorageDevice` 这两个 service 上**没有** `Model Number` / `Serial Number` 属性，必须走 `GetIdentifyData`，或向上遍历到 `IONVMeController`。

---

## 对拍基准

开发机（Apple M4 / macOS 27.0）上有两台真实 NVMe 设备，取数层任何改动都应确保这两台仍能正确读出。数值会随时间增长，**看数量级和字段合理性，不要硬编码断言具体数值**：

| 设备 | class | 特征 |
|---|---|---|
| APPLE SSD AP0256Z | `IOEmbeddedNVMeBlockDevice` | 内置，251 GB，`PERCENTAGE_USED` 0%，通电约 270h |
| aigo P7000Z 2TB | `IONVMeBlockStorageDevice` | PCIe 外接，2 TB，`PERCENTAGE_USED` 3%，通电约 6237h，写入约 150 TB |

合理性断言建议：温度在 0–100°C、`available_spare` ≤ 100、`percentage_used` ≤ 255、序列号非空。

---

## 约定

- 前端类型定义（`src/types.ts`）必须与 Rust 侧 `serde` 序列化结果保持一致，字段名统一用 `camelCase`（Rust 侧加 `#[serde(rename_all = "camelCase")]`）
- C 垫片中所有 `IOObjectRelease` / `IODestroyPlugInInterface` / `Release` 必须配对，出错分支也要释放
- 温度、容量等原始值在 Rust 侧保持原始单位，**格式化只在前端做**
- 提交信息用中文或英文均可，但需说明「改了什么」而非「做了什么任务」
