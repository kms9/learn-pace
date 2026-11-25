# Learn Pace Android 客户端

Learn Pace 在 Android ARM64 上使用 Expo 58、React Native 0.88.1 和 Hermes。首次启动可选择学习场景或直接进入自由模式。首页、问答、路径、我的四个 Tab 支持离线查看本地数据。既有 M1 数据库会迁移到 SQLite v2，继续使用 WAL。

开发版可通过 **我的 → 打开 M1 验证工作台** 运行 DeepSeek 流式问答和比例练习。Application Host 将私有题卡写入 `learn-pace.db`，界面展示 Domain 的公开题卡。启动时恢复保存的待答题，提交时先保存原始答案，再评分并更新掌握度和下次复习时间。

## Android 开发构建

使用 Node 24、可供 Gradle 使用的 JDK 和 Android SDK。真机验证使用 JDK 21、Android Platform 37.0、Build Tools 37.0.0、NDK 27.1.12297006 和 CMake 3.22.1。

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @learn-pace/mobile android --device
```

在 **我的 → DeepSeek Flash** 填写网关地址、模型 ID 和 API Key。地址及非敏感模型参数写入 SQLite，Key 仅存入 SecureStore。同源修改可留空沿用旧 Key。协议、主机或端口变化时填写目标网关的 Key。点击 **测试连通性** 发起一次短探测。

开发版连接 USB 后，可运行配对脚本。

```sh
node apps/mobile/scripts/provision-usb.mjs <adb-device-serial>
```

在 **我的 → 开发工具** 输入一次性配对码，点击 **通过 USB 导入**。脚本在本机读取根目录 `.env`，导入一次后关闭回环传输。应用冷启动时读取已存的 Key，Expo 开发命令禁用自动加载 dotenv。

## 复现 M1 真机检查

1. 在 **我的** 点击 **测试连通性**，再打开 **M1 验证工作台**。点击 **SQLite status** 确认 `wal`。点 **Send** 发起长回复，在文本生成时点 **Cancel**，确认状态为 `cancelled`。
2. 点击 **Generate question**，记录题卡 ID 并确认 `question_presented` 和 `awaiting_input`。若 Dev Client 通过 USB 连接 Metro，保持 Metro 与 `adb reverse` 映射可用。
3. 执行 `adb -s <serial> shell am force-stop app.learnpace.m1` 后重启。确认 **我的** 显示已配置，工作台恢复相同的题卡 ID。
4. 作答后确认 SQLite 的作答数和已评分数均增加，题卡关闭，掌握度和下次复习时间刷新。

## M1 device results · 2026-11-24

Redmi K20 Pro Premium Edition, Android 11 (API 30), ADB `86ceabbf`, ARM64.

- **S1:** `learn-pace.db` reported `wal`. After `am force-stop`, a new app process opened the same database, read the key from SecureStore and completed an authenticated DeepSeek request.
- **S3:** A complete turn received 202 text deltas with a 9,635 ms first text latency. A separate turn received 21 deltas before ending as `cancelled`. The question turn ended as `question_presented` with zero public text deltas and a three-option public card.
- **S5:** The ID `9a5bb322-e711-4ce7-9e8e-1117a3961e96` persisted across the force-stop in `awaiting_input`. The same interaction moved to `graded` after answering. SQLite and the UI showed one saved answer, one correct assessment, 50% mastery, and next review at `2026-12-01T11:08:17.945Z`. The Release build also opened the saved progress with Metro disconnected.

### NFR-09 baseline

| ARM64 APK | Size | Cold first display | Median |
| --- | ---: | --- | ---: |
| Debug Dev Client | 65,027,118 bytes (62.01 MiB) | 1,387 / 1,394 / 1,403 ms | 1,394 ms |
| Release APK | 24,445,413 bytes (23.31 MiB) | 214 / 199 / 218 ms | 214 ms |

Each sample force-stopped the app, waited two seconds, then used `adb shell am start -W` and recorded `TotalTime` for `MainActivity` with `LaunchState: COLD`. Debug opened the project via its USB Metro URL. From launch to the Debug workbench's data-ready marker the median was 3,514 ms (3,518 / 3,514 / 3,475 ms). Release used its embedded Hermes bundle and the local debug signature for device installation.

The [Android patch notes](../../patches/README.md) record the single 24-line Pi AI patch and the Cherry changes evaluated for this path. Expo and the selected Expo modules, React, React Native, Pi AI, Pi Durable, Chord and Pi Schema declare MIT licenses in their installed package manifests.

## M2-A 应用壳真机结果 · 2026-11-24

Redmi K20 Pro 尊享版，Android 11（API 30），ADB `86ceabbf`，ARM64。

- 覆盖安装 Dev Client，确认 SQLite 已升级到 `user_version = 2`，保持 WAL，并创建 `sessions`、`messages`、`session_threads`。Ratios 路径、一次已评分作答、50% 掌握度、下次复习时间均保留，开发工作台恢复原题 `64ae98bf-5b1e-4dbf-bb20-7a1ce66f8385`。
- 首次启动展示五种场景，直接进入自由模式后到达首页。通过「我的」换成初中，原有数据仍可访问。按顺序检查了四个 Tab，并用 Android 返回键从沉浸式工作台回到「路径」。
- P07 通过 USB 导入 DeepSeek Flash 配置，真实探测耗时 1,561 ms。执行 `am force-stop` 后直接进入首页，恢复初中场景和待答题，使用保存的 Key 再次探测成功，耗时 2,096 ms。
- 开飞行模式并临时移开 SecureStore 记录后，四个 Tab 均可打开。首页仍显示待答题，路径页可打开 Ratios，我的页显示「尚未配置」。检查后恢复原凭据及飞行模式设置。
- 覆盖安装 Release，断开 Metro 后打开应用，恢复场景、待答题和模型配置。设置页隐藏 USB 导入及 M1 工作台入口，M1 工作台的直达链接受路由保护。两个 APK 均通过网关地址和 Key 的明文扫描。

| ARM64 APK | 体积 | 冷启动首屏耗时 | 中位数 |
| --- | ---: | ---: | ---: |
| Debug Dev Client | 96,192,196 bytes (91.74 MiB) | 1,443 / 1,438 / 1,483 ms | 1,443 ms |
| Release APK | 33,668,216 bytes (32.11 MiB) | 222 / 223 / 220 ms | 222 ms |

每次强杀后等待两秒，用 `adb shell am start -W` 记录 `MainActivity` 在 `LaunchState: COLD` 时的 `TotalTime`。Debug 通过 USB 访问 Metro，Release 使用内置 Hermes bundle 和本地调试签名。该指标测量首屏显示。
