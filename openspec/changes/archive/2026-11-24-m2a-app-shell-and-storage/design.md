# Design

## Context

参见 `proposal.md` 的背景说明。M1 已在 `apps/mobile`（Expo 58.0.22 + React Native 0.88.1 + Hermes ARM64）、`packages/infra`（`ExpoLearningStore` + `expoSecretStore`）、`packages/runtime`（`PiDurableRuntime` + `@earendil-works/pi-durable@1.6.0`）和 `packages/domain`（DeepTutor `1284116` 领域核心）打通单屏验证闭环。

本 Change 为 M2-A 六个竖切中的第一个（参见 `openspec/ROADMAP.md`），目标是把单屏验证壳升级为可承载 LF01/LF02 的 4 Tab 应用底座、P00/P07 正式页面与统一本地持久化层，同时不破坏既有 M1 测试与真机回归路径。

## Goals / Non-Goals

**Goals:**
- 建立 4 Tab（首页 / 问答 / 路径 / 我的）与沉浸式子路由骨架，为 Change 2–6 提供页面挂载点。
- 在 `packages/infra` 中把 `learn-pace.db` 平滑升级到 M2-A 所需的完整最小表族，并同时提供 `MemoryAppStore`（Node/Vitest 单测）与 `ExpoLearningStore`（Android 真机）两套同构实现。
- 完成 P00 场景选择与 P07 DeepSeek Flash 设置（复用并演进 M1 的 `configuration.ts`、USB 配对导入与连通性探测）。
- 建立轻量的蓝白卡片设计 tokens（参考 `docs/design/v0.2/prototype.html` D08/D09/D10），统一安全区与视觉基调。

**Non-Goals:**
- 不引入重型 UI/CSS 框架（如 Uniwind、Skia、Storybook、NativeWind）；先使用 React Native 原生 `StyleSheet` + 统一 `theme.ts` tokens，保持 Release APK 体积和冷启动优势（M1 基准 23.31 MiB / 214 ms）。
- 不引入 SQLite 事务控制、CAS 乐观锁、严格幂等与备份导出实现（留待 M2-B）。
- 不在 `apps/mobile` 中直接写 SQL 或调用 `@earendil-works/pi-*`，严格遵循 `UI → app-host → infra / runtime` 分层。

## Decisions

### 1. 移动端导航采用 `expo-router`（对齐 Cherry Studio Mobile 基线）
- **决策**：在 `apps/mobile` 引入 `expo-router`（对齐 Cherry Studio Mobile 的 `58.0.29` 与配套 `react-native-screens`、`react-native-safe-area-context`、`expo-linking`、`expo-constants`），使用文件系统路由组织 `(tabs)/index`（P01 首页）、`(tabs)/chat`（P02 问答）、`(tabs)/paths`（P03 路径）、`(tabs)/me`（P07 我的）、`onboarding/scene`（P00 场景选择）、`path/new`（P04 占位）、`path/[pathId]/workbench`（P06 占位）以及 `dev/m1-workbench`（仅 `__DEV__` 可访问）。
- **理由**：`apps/mobile/app.json` 已声明 `scheme: "learnpace"`；使用 `expo-router` 可原生处理 Android 物理返回键、Tab 状态保活与 P04/P06 沉浸式隐藏底部 Tab 栏，后续 Change 2–6 只需往对应路由文件填充页面即可。
- **备选方案**：纯 React State 手写 Tab 切换器。虽然少装几个包，但后续 P02 → Little Tutor、P03 → P04 → P06、P05 → P06 返回栈与 Android 返回键很快会演变成脆弱的手写路由栈。

### 2. SQLite Schema 演进采用 `PRAGMA user_version` + 聚合 JSON 与独立会话/交互表结合
- **决策**：保持 `learn-pace.db` 单库 + WAL 模式，使用 `PRAGMA user_version` 驱动幂等顺序迁移：
  - **v1（M1 基线）**：`settings`、`learning_progress (path_id, progress)`、`interactions`。
  - **v2（本 Change 新增）**：
    - `learning_progress` 增补索引列（`status TEXT NOT NULL DEFAULT 'active'`、`name TEXT NOT NULL DEFAULT ''`、`updated_at REAL NOT NULL DEFAULT 0`），仍以 `progress` JSON 为聚合权威。迁移从旧 JSON 回填名称与更新时间，旧路径默认 `active`。后续保存进度时在同一行同步摘要（符合 PRD 05 §9.1 与 PRD 08 §9.2）。
    - `sessions (session_id PRIMARY KEY, kind TEXT, path_id TEXT, mode TEXT, title TEXT, model_id TEXT, created_at REAL, updated_at REAL)`，支撑 LF01 自由问答会话与 LF02 路径关联会话。
    - `messages (message_id PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, status TEXT, turn_id TEXT, metadata TEXT, created_at REAL)` + `(session_id, created_at)` 索引。
    - `session_threads (thread_id PRIMARY KEY, parent_session_id TEXT, source_message_id TEXT, selected_text TEXT, title TEXT, created_at REAL, updated_at REAL)` + `(parent_session_id, created_at)` 索引，支撑 Little Tutor 锚点子会话。
- **理由**：为后续 Change 提供兼容 M1 数据的基础表结构，可按功能增量扩展。
- **备选方案**：把每个领域实体（modules、objectives、attempts、evidence）拆成 15+ 张规范化表。在 M2-A 无事务控制阶段，拆表越多越容易出现半更新状态，且背离 DeepTutor 聚合存储的迁移路径。

### 3. `packages/infra` 提供纯 TS 端口 + 内存实现与 Expo 实现双轨
- **决策**：在 `packages/infra/src/index.ts` 定义统一组合端口 `AppStore`（包含 `SettingsStore`、`LearningProgressStore`、`InteractionStore`、`SessionStore`、`MessageStore`、`ThreadStore`）并实现 `MemoryAppStore`（纯 TS，可在 Node/Vitest 零依赖运行）；在 `packages/infra/src/expo.ts` 中让 `ExpoLearningStore` 实现同一 `AppStore` 接口。
- **理由**：满足架构硬约束“`domain` 和 `app-host` 必须能直接在 Node/vitest 里跑”，后续 Change 2–6 的 Host 逻辑都可以用 `MemoryAppStore` 写高速自动化单测。

### 4. 应用初始化上下文封装在 `packages/app-host`
- **决策**：在 `packages/app-host` 新增 `AppBootstrapService`（或 `LearnPaceAppHost` 雏形），负责启动时从 `AppStore` + `SecretStore` 加载 `curriculum_profile`、`ModelConfig`、基础计数摘要（路径数、待答题卡状态）以及保存/探测 DeepSeek Flash 配置。Host 将 Key 与当前网关同源范围绑定，跨源更换网关时要求填写目标 Key；`apps/mobile` 通过轻量 React Context 订阅这些状态。
- **理由**：避免 `apps/mobile` 页面直接操作 SQLite / SecureStore，同时保留现有 `StudyWorkbench` 不变以便 `__DEV__` 工作台继续可用。

### 5. `apps/mobile` 入口与 M1 验证能力兼容
- **决策**：保留自定义 `index.ts`，先加载 Hermes 初始化，再由 `expo-router/entry` 注册应用；原有 M1 单屏组件迁移为 `apps/mobile/src/screens/M1WorkbenchScreen.tsx`，仅在 `__DEV__` 时从 P07 底部按钮进入。

## Risks / Trade-offs

- **[Risk] 引入 `expo-router` 及原生依赖（`react-native-screens`、`react-native-safe-area-context`）需要重新编译 Android Dev Client APK，并可能略微增加包体积** → Mitigation：严格对齐 Cherry Studio Mobile 已验证过的 Expo 58 兼容版本号，在 `apps/mobile` 完成 prebuild + Android ARM64 真机安装验证，并复测 APK 体积与冷启动耗时确认可控。
- **[Risk] 既有 M1 真机设备上的 `learn-pace.db` 没有设置 `PRAGMA user_version`（默认值为 0）** → Mitigation：迁移逻辑对 `user_version < 2` 时先确保 v1 基础表存在，再通过 `PRAGMA table_info(learning_progress)` 检测缺失列后安全执行 `ALTER TABLE`，保证新库与老库都能幂等升级到 `user_version = 2`。
- **[Risk] 未配置模型时用户误以为应用不可用** → Mitigation：P01/P02/P03 顶部或空态展示非阻塞的「配置 DeepSeek Flash」引导卡片，点击直达 P07，同时仍允许查看本地数据与切换场景。

## Migration Plan

1. 升级 `packages/infra` 端口、`MemoryAppStore` 与 `ExpoLearningStore`（`user_version` 0/1 → 2 幂等迁移）并先通过 Node/Vitest 单测。
2. 在 `packages/app-host` 新增应用启动与设置服务，确保既有 `StudyWorkbench` 测试不回归。
3. 在 `apps/mobile` 引入 `expo-router` 与 4 Tab + P00/P07 页面，更新 `metro.config.js` / `app.json`。
4. 在已连接 Android 真机（`86ceabbf`）重新构建并安装 Dev Client APK，验证从既有 M1 数据库升级启动、P00 场景选择、4 Tab 切换、P07 DeepSeek Flash 配置/测试/强杀留存。
