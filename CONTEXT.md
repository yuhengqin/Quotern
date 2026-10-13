# Domain Context

## Terms

### Theme Mode（主题模式）
- **Definition**: 用户在应用内选择的主题偏好，三态：`system`（跟随系统）、`light`（亮色）、`dark`（暗色）。
- **Rules/Invariants**:
  - 是用户的**选择**，可持久化，重启后保持。
  - 选择 `light` / `dark` 即退出跟随系统，直到用户重新选择 `system`。
  - 默认值为 `system`（首次安装 / 升级后未手动选择时）。

### Theme（生效主题）
- **Definition**: 应用实际渲染使用的主题，二态：`light` / `dark`。
- **Rules/Invariants**:
  - 由 Theme Mode 与操作系统深浅色共同解析得出（`system` 模式下跟随系统实时变化）。
  - 同一时刻只有一个生效主题，所有窗口（主窗口、托盘弹窗）保持一致。

### 跟随系统（Follow System）
- **Definition**: Theme Mode 为 `system` 时，应用自动检测操作系统的深浅色偏好（Windows / macOS / Linux 的系统外观设置），并在系统切换时实时跟随。
- **Rules/Invariants**:
  - 检测以系统当前实际外观为准（如 Windows 的「深色」应用模式、macOS 的「外观」设置）。
  - 系统主题在应用运行期间变化时，应用应实时响应，无需重启。
