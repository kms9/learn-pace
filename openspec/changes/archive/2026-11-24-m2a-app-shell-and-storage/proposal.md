# Proposal

## Why

M1 技术验证（S1–S6）已通过单屏调试页在 Android ARM64 真机上证实 `expo-sqlite`（WAL）、`expo-secure-store`、`@earendil-works/pi-durable@1.6.0` 与 DeepSeek Flash 可稳定跑通，但当前 `apps/mobile` 仅是单页验证工作台，尚无 PRD V0.2 规定的 4 Tab 应用导航骨架、P00 学习场景入口、P07 完整设置页以及支撑 LF01/LF02 双流程的统一本地数据库 Schema 与 Repository。在进入 LF01 问答与 LF02 掌握路径功能开发前，需要先建立这一层稳定的应用底座与数据存储基线。

## What Changes

- **应用导航与页面壳（`apps/mobile`）**：引入 4 个一级 Tab（首页、问答、路径、我的）与路由结构，实现 P00 轻量学习场景选择页（首次启动可选择或直接跳过，之后可从 P07 切换）与 P07「我的 / 设置」页；为首页、问答、路径 Tab 建立清晰占位壳，并保留 M1 调试工作台入口（仅开发模式可访问）以免丢弃真机回归能力。
- **P07 DeepSeek Flash 模型配置（`apps/mobile` + `packages/infra`）**：将 M1 的 `configuration.ts` 升级为正式的 P07 配置体验——API Key 独立存入 `expo-secure-store`，非敏感配置（网关地址、模型 ID、reasoning 等）存入 SQLite `settings`，提供「连通性测试」和开发期 USB 配对导入；未配置模型时仅提示配置，不阻塞浏览本地页面与历史。
- **M2-A 基础本地存储扩展（`packages/infra` + `packages/app-host`）**：在现有 `learn-pace.db`（WAL 模式）上扩展表结构与版本号迁移机制，补齐支撑后续 LF01/LF02 主流程的最小表族（`settings`、`sessions`、`messages`、`session_threads`、`learning_progress`、`interactions`），提供纯 TS 可测试的 Repository 端口（内存实现 + Expo SQLite 实现），供后续 Change 2–6 直接复用。

### Out of Scope（本 Change 明确不做）
- 不实现 LF01 完整自由问答与 Little Tutor 交互逻辑（归属 Change 2：`m2a-lf01-chat-and-little-tutor`）。
- 不实现 LF02 创建目标、大纲生成、Study 教学评分与 Review 复习流程（归属 Change 3–5）。
- 不实现 SQLite 原子事务控制、Revision CAS、严格 `submission_id` 幂等、崩溃注入对账与数据备份/恢复（按决策 D3 归属 M2-B）。
- 不支持多厂商模型兼容矩阵或自报掌握入口（按决策 D5、D7）。

## Capabilities

### New Capabilities
- `app-navigation`: 4 Tab 主导航（首页、问答、路径、我的）、P00 学习场景偏好选择与非强制启动恢复、P04/P06 沉浸式路由约定与返回不丢失基本上下文。
- `local-storage`: `learn-pace.db`（WAL）M2-A 全量基础表结构、轻量 Schema 迁移以及面向会话、线程、学习路径、交互与设置的顺序读写 Repository 契约（含内存测试实现与 Expo SQLite 实现）。
- `model-settings`: P07 DeepSeek Flash 接入配置、SecureStore 密钥隔离持久化、连通性探测、开发期 USB 配对导入与未配置模型时的本地离线只读降级。

### Modified Capabilities
<!-- 仓库首个 OpenSpec Change，openspec/specs/ 当前为空，无既有能力规格修改 -->

## Impact

- **`packages/infra`**：扩展 `index.ts` Repository 端口与内存测试实现，扩展 `expo.ts`（`ExpoLearningStore`）支持 `PRAGMA user_version` 迁移以及 `sessions` / `messages` / `session_threads` / `learning_progress` 表读写。
- **`packages/app-host`**：新增应用级基础上下文/初始化服务（启动加载设置、当前场景与模型配置、检测未完成待答题卡摘要），保留现有 `StudyWorkbench` 及其单元测试兼容。
- **`apps/mobile`**：引入路由导航库（如 `expo-router` 或轻量 React Navigation Tab + Stack 方案，见 `design.md` 选型），将 `App.tsx` 重构为 4 Tab + P00/P07 应用壳，建立蓝白卡片基础视觉主题（对齐 `docs/design/v0.2/prototype.html` D08/D09/D10）。
- **测试与验证**：新增 `packages/infra` 内存/迁移单元测试；继续保持 `corepack pnpm typecheck`、`corepack pnpm test` 全绿并在 Android ARM64 真机验证冷启动、4 Tab 切换、P00 场景持久化与 P07 DeepSeek Flash 配置/测试/强杀留存。
