# C10 平台配置切片

Windows 继续使用现有 NSIS；Linux 增加 `tauri.linux.conf.json`，候选仅 Ubuntu 24.04 x64 的 deb；macOS 增加 `tauri.macos.conf.json`，候选 app/dmg，由 macOS 原生 runner 构建。配置采用 [Tauri 官方平台合并机制](https://v2.tauri.app/reference/config/#platform-specific-configuration)，只覆盖 bundle targets/icons；标识、版本、页面、权限、生产地址和 Windows 安装器钩子保持同一个基线。不注册默认文件关联，不新增更新分发或签名凭据。

macOS ICNS 从已有 `products/liteasy/assets/brand/liteasy-mark.svg` 经仓库锁定的 Tauri CLI 生成；没有引入另一套 logo。原有资源检查同时检查平台覆盖声明的图标、跟踪状态和 ICNS 头，缺失/损坏在昂贵原生打包之前失败。

先运行平台配置回归，原先缺少两平台配置且资源检查仅覆盖 Windows，2 个用例失败。补配置后 11 个平台/资源/大小写用例通过，包含 9 个 `ci:smoke` 对应检查。生产 build、clean contracts 的实际结果见 `C10-platform-config-verification.json`。本机是 Ubuntu 24.04 x64 **WSL2/WSLg**，Node 22.13.1（仓库要求 22.23.2）、Rust 1.98.0（workflow 要求 1.98.1），不能作为原生 Windows 或物理 Linux 交付认证。

本片只使候选构建配置可执行。真实 Linux deb 安装/卸载、macOS 启动/签名/公证、最低操作系统兼容矩阵尚未验收，均为 not_run；不能据此宣称三平台正式支持。回退不迁移用户数据，可移除平台覆盖恢复之前仅配置 NSIS 的构建行为。下一片是 C10 系统文件打开授权接线与 C11 手动候选构建证据。
