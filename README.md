# disk-vitals

macOS 原生的硬盘健康监测工具。读取并展示磁盘 S.M.A.R.T. 信息，功能对标 [DriveDx](https://binaryfruit.com/drivedx) 与 [CrystalDiskInfo](https://crystalmark.info/en/software/crystaldiskinfo/)。

---

## 1. 项目目标

- **小体积**：目标产物 `.app` < 5 MB
- **零门槛**：不需要 root、不需要输密码、不需要安装驱动、不需要特权 helper
- **现代化**：原生 macOS 设计语言，菜单栏常驻
- **AI 主导开发**：技术栈选择偏向 AI 能高质量产出、且可快速验证的方向

## 2. 平台范围与约束

| 项 | 决定 |
|---|---|
| 目标平台 | **仅 macOS**（不做 Windows / Linux） |
| 最低系统 | macOS 26+ |
| 架构 | Apple Silicon 优先，Intel 兼容（universal binary） |
| 开发机基线 | macOS 27.0 (26A5416b) / Apple M4 / SIP enabled |

> 明确放弃跨平台。CrystalDiskInfo 只作为**功能参考**，不作为移植目标——它的 USB 支持依赖 Windows 独有的用户态 SCSI 透传能力，macOS 上不存在对应机制（见 §6）。

## 3. 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| 外壳 | **Tauri v2** | 复用系统 WKWebView，实测产物 3.9 MB |
| 前端 | **React 19 + TypeScript + Vite + Tailwind CSS v4** | 界面表现力与开发速度 |
| 后端 | **Rust** | Tauri command 层，仅做薄封装 |
| 取数 | **C 垫片 + IOKit** | 见下方说明 |

### 取数层为什么用 C 而不是 Rust FFI

IOKit 的 SMART 接口是 COM 风格 plugin interface（`IOCFPlugInInterface**` + UUID `QueryInterface`）。用 Rust 手写这个 vtable 需精确匹配结构体布局，其中大量 `reserved` 字段一旦错位会**静默读出垃圾数据**，且无编译期保护。

因此所有与 IOKit 的交互封闭在 `src-tauri/csrc/smart_shim.c`，只向 Rust 暴露朴素 C ABI。布局一致性由单元测试 `struct_layout_matches_c` 断言（C 侧导出 `sizeof`，与 Rust `#[repr(C)]` 比对），字段增删时若两侧不同步会立即失败。

### 备选方案与取舍

| 方案 | 结论 |
|---|---|
| **SwiftUI 原生** | 包体更小（2–5 MB）、无 FFI 层、菜单栏与图表框架内置。技术上是 macOS-only 场景的最优解，**但放弃了 Web 生态和未来跨平台的可能性**。权衡后选择 Tauri |
| Electron | 否决：包体 80–150 MB，与「小体积」目标直接冲突 |
| Flutter / Avalonia | 否决：20–40 MB 运行时，且**照样要写原生取数层**，用体积换不到东西 |
| 打包 smartmontools | 否决：GPL-2.0 传染分发方式；且它在 macOS 上**根本不支持 USB**，付出授权代价却买不到功能 |

> 这类工具的复杂度 90% 在取数层、10% 在 UI。重型跨平台 UI 框架并不能解决真正的问题。

## 4. 架构

```
src/                          React 前端
  components/                 HealthRing / StatusPill / StatTile / DeviceDetail / Sidebar
  lib/format.ts               单位换算与展示格式化
  lib/api.ts                  取数入口与事件订阅（浏览器 DEV 下回退到样本数据）
  lib/motion.ts               动效工具，均尊重系统「减弱动态效果」
  types.ts                    与 Rust serde 输出对齐的类型
src-tauri/
  csrc/smart_shim.{c,h}       IOKit 取数层，暴露 C ABI     ★ 核心
  src/smart/nvme.rs           C ABI 的 Rust 安全封装 + 测试
  src/monitor.rs              定时取数调度与事件推送
  src/lib.rs                  Tauri command 注册
  capabilities/default.json   窗口权限（拖动区、事件监听）
  build.rs                    cc 编译 C 垫片 + 链接 IOKit/CoreFoundation
tools/probe/smart_probe.c     独立探针，排查问题时最快的验证手段
```

数据流：`smart_shim.c`（IOKit）→ `nvme.rs`（`#[repr(C)]` FFI → serde 结构）→ `monitor.rs`（窗口可见时每 30 秒读取，不可见时暂停）→ Tauri 事件 / IPC → React。所有调用 IOKit 的命令都在阻塞线程池执行，不占用主线程。

原始值在 Rust 侧保持原始单位，单位换算与格式化全部在前端 `lib/format.ts` 完成。

## 5. 已验证的技术事实

以下均在开发机上**实测确认**，参考实现见 [`tools/probe/smart_probe.c`](tools/probe/smart_probe.c)：

```bash
clang -o smart_probe tools/probe/smart_probe.c -framework IOKit -framework CoreFoundation
./smart_probe      # 不需要 sudo
```

### 5.1 NVMe：完全可用，且不需要 root

`NVMeSMARTLibExternal.h` 与 `ATASMARTLib.h` 均随 SDK 分发，提供 `SMARTReadData` / `GetIdentifyData` / `GetLogPage`。以 `uid=501` 普通用户身份实测：

| 磁盘 | 类型 | 实测结果 |
|---|---|---|
| disk0 APPLE SSD AP0256Z | NVMe / Apple Fabric | 48.9°C，已用 0%，通电 270h，267 次循环，写入 6.67 TB |
| disk4 aigo P7000Z 2TB | NVMe / PCIe 外接 | 44.9°C，已用 3%，通电 6237h，3549 次循环，写入 149.72 TB |

CrystalDiskInfo 展示的 NVMe 信息可全量覆盖。

### 5.2 USB 硬盘：公开 API 无法访问

```
ioreg -l | grep -c 'SCSITaskUserClient GUID'   →   0
```

macOS 上**没有任何块设备**对外提供 `SCSITaskUserClient`。`SCSITaskLib.h` 虽在 SDK 中（含 `ObtainExclusiveAccess`），但 `IOSCSIPeripheralDeviceType00`（普通硬盘）不 vend 该 user client——只有光驱类设备才有。USB 磁盘被 `IOUSBMassStorageDriver` 独占，用户态没有任何透传通道。

> 这不是 API 没找到，是这条路在 macOS 上**不存在**。

### 5.3 能力矩阵

| 连接方式 | 是否可读 | 途径 | 权限要求 |
|---|---|---|---|
| 内置 NVMe | ✅ | `NVMeSMARTLibExternal.h` | 无 |
| PCIe / Thunderbolt NVMe | ✅ | 同上 | 无 |
| USB NVMe / SATA | ⚠️ 需第三方驱动 | `ATASMARTLib.h` | 用户自行安装 kext |
| USB（桥接芯片不支持 SAT） | ❌ | 无解 | — |

## 6. 外置 USB 硬盘策略

### 两个参考产品是怎么做的

- **CrystalDiskInfo（Windows）**：Windows 允许管理员权限的用户态程序通过 `IOCTL_SCSI_PASS_THROUGH_DIRECT` 下发任意 SCSI CDB，因此可直接发 T10 SAT 的 `ATA PASS-THROUGH (12/16)`。对不支持 SAT 的桥接芯片，另有 JMicron / ASMedia / Sunplus / Realtek / Cypress / Prolific 等厂商私有命令分支。**不需要装驱动。**
- **DriveDx（macOS）**：没有取巧办法，**安装第三方内核扩展 SAT SMART Driver**。BinaryFruit 官方文档原话：macOS 不原生支持 SAT，"currently there is only one option – you can install 3rd party kernel extension"。

**差异来自操作系统，不是应用能力。**

### 本项目的决定：不分发驱动

理由不是 license，而是**签名**：

- 上游 [`kasbert/OS-X-SAT-SMART-Driver`](https://github.com/kasbert/OS-X-SAT-SMART-Driver) 为 APSL 协议（声明在 README，仓库无 LICENSE 文件），**最后提交 2016-12-01**，事实废弃
- [`BinaryFruit/OS-X-SAT-SMART-Driver`](https://github.com/BinaryFruit/OS-X-SAT-SMART-Driver) 是 DriveDx 官方 fork，但其 `REL_0_10_3` / `REL_0_12` 分支相对上游**仅多出一个 2024-02-14 修序列号截断的补丁**，Apple Silicon 移植工作未公开
- 社区最活跃分支为 [`RJVB`](https://github.com/RJVB/OS-X-SAT-SMART-Driver)（2023-12，加了 JMS578 支持）
- **GitHub 上不存在任何 DriverKit / dext 版实现**，架构上也没有这条路
- 分发可加载的 kext 需要带 Kernel Extension 能力的 Developer ID 证书，Apple 要求论证"没有其他方式能实现该功能"，对本类工具基本不可能获批

APSL 是文件级弱 copyleft，法律上允许借用；但编译产物在 Apple Silicon 上加载不了，因此借用无意义。

### 产品行为

1. NVMe 设备开箱即用
2. 扫描不到的 USB 设备，明确展示原因：这是 macOS 限制，而非本应用缺陷
3. 检测 SAT SMART Driver 是否已加载，界面显示状态（参考 DriveDx 的 `SAT SMART Driver version` 字段）
4. 提供第三方驱动的说明与外链，由用户自行决定是否安装（见下）
5. 用户装好驱动后，ATA 路径**自动生效**，无需应用更新

### 引导用户安装驱动时的规则

**只链接到 [BinaryFruit 官方下载页](https://binaryfruit.com/drivedx/usb-drive-support)**（`SATSMARTDriver-0.10.3.macOS11_and_AppleSilicon.zip`，免费独立下载，无需购买 DriveDx）。
**不得自行镜像、打包或重新分发该驱动**——用户应当拿到原厂签名产物，本项目也不承担分发责任。同类产品（如 Micromat TechTool）亦采用此做法。

不要引导用户去编译 `RJVB` / `kasbert` 的源码：

- 两个仓库均**无任何 release，纯源码**，`RJVB` 全库零处提及 `arm64`
- 自行编译的产物未签名，需要将系统降至 **Permissive Security（等同关闭 SIP）** 才能加载

Apple Silicon 两档安全等级的区别：

| 安全等级 | 可加载 | 用户代价 |
|---|---|---|
| Reduced Security + 允许认证开发者的内核扩展 | 带 kext 权限的 Developer ID 签名产物（BinaryFruit 版属此类） | 进恢复模式改设置、重启 |
| Permissive Security（≈ 关闭 SIP） | 未签名 / 自签名产物 | 整机安全防护大幅降级 |

**UI 文案原则：陈述事实，不做推销。** 必须同时说明三点：(a) 这是 macOS 的限制；(b) 安装后**仍可能读不到**，取决于硬盘盒桥接芯片是否支持 SAT；(c) 会降低系统安全等级。把选择权留给用户，不使用「立即安装」这类引导性强的主按钮。

### 驱动状态必须区分四态（重要）

实测发现 DriveDx 在这里有误导：它读取**已安装文件**的版本号并显示 `SAT SMART Driver version: 0.10.3s`，让用户以为驱动在工作，但此时内核**根本没有加载**它。本项目不得重复这个错误。

| 状态 | 判定方法 | UI 应提示 |
|---|---|---|
| 1. 未安装 | `/Library/Extensions/SATSMARTDriver.kext` 不存在 | 说明情况 + 官方下载链接 |
| 2. **已安装但未加载** | 文件存在，但 `kmutil showloaded` 中无 `com.binaryfruit.driver.SATSMARTDriver` | 提示需在恢复模式降至 Reduced Security 并勾选允许内核扩展 |
| 3. 已加载但盒子不支持 | kext 已加载，但 ATA 路径扫不到该设备 | 明确告知是**硬盘盒桥接芯片**不支持 SAT，非软件问题 |
| 4. 正常 | ATA 路径有数据 | — |

**开发机实测（macOS 27.0 / M4，2026-08-23）**：安装 BinaryFruit 0.10.3 并重启后仍处于状态 2。排查结论——kext 本身无问题（`arm64e` 原生 universal binary、`Developer ID Application: Kirill Luzanov (4ZNF85T75D)` 签名有效、依赖的 5 个 KPI 在 macOS 27 上均存在、已 staged 至 `/Library/StagedExtensions/`），零个第三方 kext 被加载的原因是**启动安全策略仍为 Full Security**。

> 关键教训：在 Apple Silicon 上，用户在「系统设置」中点击批准**并不足以**让 kext 加载，必须先在恢复模式的「启动安全性实用工具」中降至 Reduced Security。UI 引导文案必须写明这一步，否则用户会卡在状态 2 而不自知。

### 已知限制

- 开发机上的两个 16TB 外置盘使用 **VIA Labs VL715**（`0x2109:0x0715`，BOT 非 UAS）。VIA 系桥接芯片 SAT 支持记录不佳（同门 VL711 明确不支持 ATA pass-through，Linux 为此打过 `NO_ATA_1X` 补丁），**即使安装驱动也未必可读**
- 该型号硬盘盒两个实例上报**相同 USB 序列号** `000000123AE8`（VLI 固件缺陷）→ **设备身份识别不得使用 USB 序列号**，须使用硬盘自身序列号或 IOMedia UUID

## 7. 功能需求

### P0 — 首个可用版本

- [x] 磁盘列表：型号、容量、接口类型、内置/外置、固件版本、序列号
- [x] 健康度评分与状态（正常 / 警告 / 危险）
- [x] 当前温度
- [x] 通电时间、通电次数、非正常关机次数
- [x] 累计写入 / 读取量，SSD 寿命消耗百分比
- [x] NVMe 关键警告位（`CRITICAL_WARNING`）解析
- [ ] 菜单栏常驻，显示温度或健康度
- [x] 无设备时的空状态说明（USB 引导文案待完善）

### P1

- [ ] SMART 原始属性表（ID / 名称 / 当前值 / 阈值 / 原始值）
- [ ] 温度与写入量历史曲线（本地采样存储 + 图表库）
- [ ] 阈值告警通知：温度过高、健康度下降、出现关键警告位
- [ ] 开机自启
- [ ] 中英文本地化
- [ ] SAT SMART Driver 安装状态检测与版本显示

### P2

- [ ] 自定义告警阈值
- [ ] 数据导出（JSON / CSV）
- [ ] NVMe Error Information Log 解析（`GetLogPage`）
- [ ] 寿命预估（基于历史写入速率）

## 8. 分发与签名

- **Developer ID 签名 + 公证（notarization）**，直接分发
- **不上 Mac App Store**：沙盒会拦截 IOKit user client，需要 temporary exception entitlement，审核通过率极低
- 不需要 kext 签名证书、不需要特权 helper、不需要 `SMJobBless`

## 9. 开发里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 取数层可行性验证 | ✅ 见 `tools/probe/` |
| M1 | C 垫片 + Rust 封装 + 单元测试（含 FFI 布局断言、真机数据校验） | ✅ 4 项测试通过 |
| M2 | Tauri + React 界面，P0 功能 | ✅ 产物 3.9 MB（dmg 1.4 MB） |
| M3 | 历史数据、图表、告警、菜单栏常驻（P1） | 待开始 |
| M4 | 签名、公证、打包分发 | 待开始 |

### 快速开始

```bash
npm install
npm run tauri dev      # 开发
npm run tauri build    # 打包
cargo test --manifest-path src-tauri/Cargo.toml   # 取数层测试
```

## 10. 参考资料

- [DriveDx — external USB and FireWire drive support](https://binaryfruit.com/drivedx/usb-drive-support)
- [CrystalDiskInfo — External Drives](https://crystalmark.info/en/software/crystaldiskinfo/crystaldiskinfo-external-drives/)
- [kasbert/OS-X-SAT-SMART-Driver](https://github.com/kasbert/OS-X-SAT-SMART-Driver)（APSL，已废弃）
- [Apple — System Extensions and DriverKit](https://developer.apple.com/system-extensions/)
- SDK 头文件：`$(xcrun --show-sdk-path)/System/Library/Frameworks/IOKit.framework/Headers/storage/`
