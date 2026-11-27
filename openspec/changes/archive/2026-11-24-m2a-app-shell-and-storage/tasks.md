# Tasks

## 1. Local Storage Ports, Memory Store, and SQLite v2 Migration (`packages/infra`)

- [x] 1.1 在 `packages/infra/src/index.ts` 中扩展纯 TS 存储端口（`SettingsStore`、`SessionStore`、`MessageStore`、`ThreadStore` 及组合接口 `AppStore`，含 `StoredSession`、`StoredMessage`、`StoredThread` 与 `PathSummaryRecord` 类型），保留既有 `LearningProgressStore`、`InteractionStore`、`SecretStore` 兼容；运行 `corepack pnpm --filter @learn-pace/infra typecheck` 验证通过。
- [x] 1.2 在 `packages/infra/src/memory.ts` 实现纯 TS 内存版 `MemoryAppStore`（与 `MemorySecretStore`），并在 `packages/infra/src/__tests__/memory-store.test.ts` 中覆盖设置读写、学习路径列表、交互状态更新、会话/消息排序与 Little Tutor 线程锚点查询；运行 `corepack pnpm test` 验证全部通过。
- [x] 1.3 在 `packages/infra/src/expo.ts` 中为 `ExpoLearningStore` 补齐 `PRAGMA user_version` 幂等迁移（0/1 → 2：保持 `WAL`，安全检测并补齐 `learning_progress` 索引列 `status`/`name`/`updated_at`，新增 `sessions`、`messages`、`session_threads` 表及索引）并实现完整 `AppStore` 接口，同时补齐 `packages/infra/src/__tests__/migration-sql.test.ts` 验证新库初始化与 M1 老库升级 SQL 幂等性；运行 `corepack pnpm typecheck && corepack pnpm test` 验证通过。

## 2. Application Bootstrap & Model Settings Service (`packages/app-host`)

- [x] 2.1 在 `packages/app-host/src/app-bootstrap.ts` 实现应用启动与配置服务（读取/写入 `curriculum_profile`、读取/保存 DeepSeek Flash 非敏感设置 + `SecretStore` API Key、同源部分更新时保留既有 Key，跨源时要求填写目标 Key、发起短探测连通性测试并返回耗时或脱敏失败提示、查询本地基础汇总用于 P01/P07）；确保既有 `StudyWorkbench` 导出与测试不受影响，运行 `corepack pnpm --filter @learn-pace/app-host typecheck` 验证通过。
- [x] 2.2 在 `packages/app-host/src/__tests__/app-bootstrap.test.ts` 使用 `MemoryAppStore` + `MemorySecretStore` 覆盖首次启动无场景、已设场景跳过 P00、切换场景不删路径数据、API Key 仅写 `SecretStore` 不落 SQLite、同源局部更新保留旧 Key、跨源拒绝缺少 Key 的更新、连通性成功/失败反馈及未配置模型离线可读；运行 `corepack pnpm test` 验证全部通过。

## 3. Mobile 4-Tab Navigation & Theme Shell (`apps/mobile`)

- [x] 3.1 在 `apps/mobile/package.json` 添加与 Expo 58 兼容的导航依赖（对齐 Cherry Studio Mobile 基线的 `expo-router`、`react-native-screens`、`react-native-safe-area-context`、`expo-linking`、`expo-constants`），更新 `apps/mobile/app.json`、`apps/mobile/metro.config.js` 与入口配置，并执行 `corepack pnpm install` 验证依赖解析与工作区安装无冲突。
- [x] 3.2 建立 `apps/mobile/src/theme.ts`（蓝白卡片基础 tokens 与安全区间距）与 `apps/mobile/src/context/AppContext.tsx`（管理 `ExpoLearningStore`、`AppBootstrapService`、当前场景与模型配置状态），搭建 `apps/mobile/app/_layout.tsx` 与 `apps/mobile/app/(tabs)/_layout.tsx` 4 Tab 导航（首页 / 问答 / 路径 / 我的）以及沉浸式子路由占位（`path/new`、`path/[pathId]/workbench`）；运行 `corepack pnpm --filter @learn-pace/mobile typecheck` 验证通过。

## 4. P00 Learning Scene Selection & P07 Model Settings UI (`apps/mobile`)

- [x] 4.1 实现 `apps/mobile/app/onboarding/scene.tsx`（P00 五种学习场景卡片：小学、初中、高中、考证/自学、自由；无虚构推荐标签；一键确认或直接进入自由模式，持久化后进入首页；从 P07 进入切换场景时返回并保留全部既有数据），并在首启动路由守卫中接入非强制跳转逻辑；运行 `corepack pnpm typecheck` 验证通过。
- [x] 4.2 实现 `apps/mobile/app/(tabs)/me.tsx`（P07 我的 / 设置：当前学习场景展示与切换入口、DeepSeek Flash 网关地址/模型 ID/API Key 配置保存、同源更新非敏感配置可沿用 Key，跨源时提示重填、连通性测试及耗时/错误展示、仅 `__DEV__` 可见的 USB 配对导入与「打开 M1 验证工作台」入口），并将原 `App.tsx` 迁移为 `apps/mobile/app/dev/m1-workbench.tsx`（仅 `__DEV__`）；运行 `corepack pnpm typecheck` 验证通过。
- [x] 4.3 为 `apps/mobile/app/(tabs)/index.tsx`（P01 首页壳）、`apps/mobile/app/(tabs)/chat.tsx`（P02 问答壳）与 `apps/mobile/app/(tabs)/paths.tsx`（P03 路径壳）补齐基础蓝白卡片骨架与未配置 DeepSeek Flash 时的非阻塞引导卡（点击跳 P07，离线本地可正常浏览），并运行 `corepack pnpm typecheck && corepack pnpm test` 验证全仓通过。

## 5. Android ARM64 Physical Device Integration Check

- [x] 5.1 在已连接 Android 真机（`86ceabbf`，`ANDROID_HOME=$HOME/Library/Android/sdk`）重新构建并安装 Dev Client APK，验证从既有 M1 数据库升级启动无报错、首次进入 P00 选场景、4 Tab 自由切换与返回键行为、P07 配置 DeepSeek Flash（含 USB 导入与连通性测试）后执行 `adb shell am force-stop app.learnpace.m1` 重启仍保留场景与密钥、未配置状态下所有 Tab 离线可浏览，并在 `apps/mobile/README.md` 补充更新后的真机检查与 APK/冷启动实测记录。

## Workflow follow-up

- 在完成全部任务与真机验收后，运行 OpenSpec archive 将 `app-navigation`、`local-storage`、`model-settings` 同步为正式主规格，随后 propose Change 2（`m2a-lf01-chat-and-little-tutor`）。
