# model-settings Specification

## Purpose

定义 P07「我的 / 设置」页面中的 DeepSeek Flash 官方默认连接、外部网关配置、密钥隔离存储、连通性测试、开发期 USB 配对导入以及未配置模型时的本地离线只读降级行为。

## Requirements

### Requirement: Isolated credential storage for DeepSeek Flash
The application SHALL store the DeepSeek Flash API key exclusively in platform secure storage (`SecureStore`) and MUST NOT persist the API key in SQLite tables, plain settings JSON, message logs, or source code.

#### Scenario: Saving manual DeepSeek Flash configuration
- **WHEN** 用户在 P07 确认 DeepSeek Flash 的网关地址和模型 ID，并填写 API Key 后点击保存。首次配置默认填入 `https://api.deepseek.com` 和 `deepseek-flash`
- **THEN** API Key 被写入 `SecureStore`，其余非敏感配置写入 SQLite `settings`
- **AND** 表单立即清空内存中的明文 Key 输入框并显示「已配置」状态

#### Scenario: Updating non-secret settings without re-entering API key
- **WHEN** 用户在已保存 API Key 的情况下仅修改同源网关地址或模型参数并保存
- **THEN** 应用保留 `SecureStore` 中既有 API Key 并更新非敏感配置

#### Scenario: Requiring a key for a different gateway origin
- **WHEN** 用户修改网关协议、主机或端口，且没有填写目标网关的 API Key
- **THEN** 应用要求填写目标 Key，保留原配置且不会向目标网关发送旧 Key

#### Scenario: Selecting DeepSeek official connection settings
- **WHEN** 已保存自定义网关的用户点击「使用 DeepSeek 官方配置」
- **THEN** 表单回填官方地址和 Flash 模型 ID。用户确认保存后才会更新已保存配置，切换来源时需要填写目标 Key

### Requirement: Model connectivity probe
The settings screen SHALL allow the user to run a live connectivity test against the configured DeepSeek Flash endpoint and MUST report clear success or bounded failure feedback without exposing the API key.

#### Scenario: Successful connectivity test
- **WHEN** 用户已保存有效的 DeepSeek Flash 配置并点击「测试连通性」
- **THEN** 应用向配置端点发起一次短探测请求，在收到有效响应后显示连通成功与耗时反馈

#### Scenario: Failed connectivity test
- **WHEN** 网关地址不可达、Key 无效或网络离线时用户点击「测试连通性」
- **THEN** 应用展示明确的失败原因提示（不含 API Key 原文）且不破坏已保存的本地学习数据

### Requirement: Development-only USB configuration import
In development builds (`__DEV__`), P07 SHALL support one-time pairing code import from the local USB provisioning helper without bundling `.env` credentials into the app package, and this action MUST NOT be available in release builds.

#### Scenario: Importing configuration via USB pairing code in dev build
- **WHEN** 开发者在开发版 P07 中输入本机配对码并点击「通过 USB 导入」
- **THEN** 应用通过本机回环端口获取配置并分别写入 `SecureStore` 与 SQLite `settings`

### Requirement: Offline local browsing without configured model
The application SHALL remain navigable across all local tabs and stored data when no model API key is configured.

#### Scenario: Browsing local pages before configuring a model
- **WHEN** 用户尚未配置 DeepSeek Flash API Key 并切换到「学习」「问答」或「精通之路」Tab
- **THEN** 应用正常展示本地页面与清晰的配置引导入口，不崩溃也不强制锁死在设置页
