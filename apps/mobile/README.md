# Learn Pace Android 客户端

Learn Pace 在 Android ARM64 上使用 Expo 58、React Native 0.88.1 和 Hermes。冷启动进入「问答」。「学习」「问答」「精通之路」「我的」四个 Tab 支持离线查看本地数据。既有数据库迁移到 SQLite v4，继续使用 WAL。

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

## S7 导师循环真机结果 · 2026-11-25

在 ARM64 真机 `86ceabbf` 的 Expo Dev Client 打开 **我的 → 开发工具 → S7 导师循环验证**。两组均先收到引导语的流式增量，再显示公开题卡并以 `question_presented` 收尾。

- **比例化简**由模型调用 `mastery_mode` 进入学习。选择题答对，Host 保存批改后继续流式反馈，UI 显示 50% 掌握度。出题 TTFT 为 2.098 s。
- **TCP 三次握手**用顶部按钮进入学习。`am force-stop` 后恢复原简答题卡 `device-2-1795600404577-q1`，模型回合数保持不变。预设错答先由 Host 保存批改，再收到导师反馈，UI 显示 0% 掌握度。出题 TTFT 为 3.960 s。

S7 验证页使用开发版独立 SQLite，沿用 SecureStore 中的模型配置。逐轮耗时、Token 与诊断试跑见报告。[S7 验收报告](../../docs/evaluation/s7-tutor-loop-verification-report.md) · [脱敏逐轮记录](../../docs/evaluation/s7-raw-runs.jsonl)

## 问答消息渲染

`react-native-enriched-markdown@1.1.1` 在 Expo 58、React Native 0.88.1 和 Hermes 的 Android ARM64 Release 构建中通过。Markdown 和公式使用原生渲染，Android 公式由 RaTeX 排版，`katex@0.17.0` 供库的 Web 渲染器使用。应用关闭视频和代码语法高亮，保留普通代码块。流式输出中的未闭合公式和代码围栏显示原文。

| ARM64 Release APK | 字节数 | 体积 |
| --- | ---: | ---: |
| 应用壳基线 | 33,668,216 | 32.11 MiB |
| 问答与小老师 | 38,424,610 | 36.64 MiB |
| 增量 | 4,756,394 | 4.54 MiB |

## M2-A 问答与小老师真机结果 · 2026-11-25

Redmi K20 Pro 尊享版，Android 11（API 30），ADB `86ceabbf`，ARM64 Release，使用已保存的 DeepSeek Flash 配置。

- **AC-01 通过。** 冷启动直接进入「问答」。新对话完成两轮，列表、行内公式和独立公式均正确显示。追问及重新生成均回忆首轮约定的词。停止生成保留部分回复，确认后删除整轮。另一次在输出期间执行 `adb shell am force-stop app.learnpace.m1`，重启从历史会话恢复原有消息、`deepseek-v4.1-flash` 模型 ID 和 657 个字符的已存片段。界面显示「生成已中断」与「重试」，等待手动操作。
- **AC-02 通过。** 长按回复选文点「问 Dito」，选文显示在页首与输入框，未自动发送。小老师从父会话找到毕达哥拉斯定理，侧聊内可添加引用。返回主会话后，草稿和原消息的屏幕位置保持一致。强杀重启后从「小老师 ×1」重开同一侧聊。解除关联后从「小老师记录」仍可打开，确认删除后列表为空。「添加到对话框」的选文随下一条主会话消息显示。「转为学习目标」进入占位页，展示原会话 ID、消息 ID 和选文。

## AC-03 精通目标与大纲真机结果 · 2026-11-25

Redmi K20 Pro 尊享版，Android 11（API 30），ARM64，ADB `86ceabbf`。覆盖安装包含 `EnrichedMarkdown` 的 Debug APK，通过 USB Metro 与 SecureStore 中的 DeepSeek Flash 配置实测。数据库打开后为 SQLite v4。

- **直接新建**。在「精通之路」新建分数化简目标并添加文本笔记。向导自动发出开场消息，导师读取笔记并询问基础和目标，再保存学习档案并建出两模块大纲。
- **预览与提交**。预览为第一个模块新增一个知识点并交换两个模块的位置。预览阶段库中大纲保持第 2 版。下一条消息确认后提交第 3 版，模块顺序变为「比例比较 → 分数化简」，原知识点 ID 保留。大纲弹层和「大纲已就绪」同步更新。
- **学习与恢复**。点击「开始学习」创建学习会话并收到讲解。执行 `am force-stop` 后，进程从 `9163` 换为 `11937`。路径 `ec0a04a9-860a-4f0b-9d1c-f4fb914e4262` 的资料、大纲、会话、学习模式和已保存回复均恢复。重置进度后保留大纲、资料、学习档案与会话。
- **问答来源**。从问答回复「选文 → 转为学习目标」，第二步预选原选文。导师读取所选资料、询问基础、保存档案并建大纲。再次强杀后两条来源 ID 与选文均保留。确认删除该测试主题后，其路径、会话和消息均消失，原问答会话和回复仍可读取。

TTFT 从精通 Runtime 发起到首个公开文本增量或工具调用事件。Token 为每个应用回合内所有模型请求之和。

| 精通回合 | TTFT（ms） | 总耗时（ms） | 模型往返 | 输入 Token | 输出 Token |
| --- | ---: | ---: | ---: | ---: | ---: |
| 直接新建开场 | 6,449 | 9,654 | 2 | 6,025 | 439 |
| 直接新建大纲 | 6,763 | 21,256 | 4 | 16,897 | 2,068 |
| 修改与重排预览 | 5,374 | 10,614 | 2 | 12,399 | 1,542 |
| 提交预览 | 1,470 | 21,514 | 5 | 34,527 | 1,364 |
| 学习模式讲解 | 2,423 | 4,081 | 1 | 3,701 | 504 |
| 问答来源开场 | 2,467 | 5,613 | 2 | 6,175 | 500 |
| 问答来源建大纲 | 3,422 | 14,229 | 3 | 12,317 | 1,712 |

直接新建大纲与提交预览各出现一次工具拒绝，导师在同一回合完成重试。首次诊断使用的旧 Dev Client 缺少原生 Markdown，重新构建后完成正式验收。键盘打开时的发送操作也已在真机复测。

## AC-04 精通学习会话真机结果 · 2026-11-25

Redmi K20 Pro 尊享版，Android 11（API 30），ARM64，ADB `86ceabbf`。使用 Expo Dev Client、USB Metro、SQLite v4 和 SecureStore 中的 DeepSeek Flash 配置。测试以等值分数为概念知识点，以分数约分和分数比较为程序知识点。

- 分数约分连续三道选择题独立答对，掌握度依次为 **50% → 80% → 100%**，第三次显示带知识点名称的升级庆祝。
- 下一道约分题答错后，题卡展示正确选项，证据抽屉新增「应用」错因，掌握度回落至约 71%。从该题卡发起申诉，导师完成复核，原判定保留。
- 简答题输入 `1/2` 获判正确。选择「跳过」后，对应题卡标记为 `abandoned`，该操作不产生作答记录。
- 学习者用自己的话解释等值分数。`mastery_assess` 给出 `correct`（置信度 0.95），通过概念门槛，证据保留学习者原话、评估依据、三条满足的标准和模型 ID。
- 在分数比较的证据抽屉自报掌握，界面显示「由你确认」。点击「回到正常测评」后，SQLite 中的自报标记清除。
- 第一张题卡处于待答状态时执行 `adb shell am force-stop app.learnpace.m1`。进程从 `18649` 换为 `20404`，重启后用同一题卡 ID `98588e58-f4e2-4e73-95d0-fccb9f93a792` 继续作答。

四次选择题和一次简答题均在导师回合完成前落库批改。批改耗时包括读取作答、判定和写入学习进度。导师 TTFT 从发起导师回合算起，止于首个公开文本增量或工具调用。题卡提前批改的耗时单独计入「批改」列。定性评估在导师回合内调用，其耗时计入「导师总耗时」。

| 操作 | 批改（ms） | 导师 TTFT（ms） | 导师总耗时（ms） |
| --- | ---: | ---: | ---: |
| 第一次独立答对 | 20 | 5,100 | 6,913 |
| 第二次独立答对 | 13 | 2,931 | 4,133 |
| 第三次独立答对 | 9 | 5,736 | 7,021 |
| 独立答错 | 8 | 2,480 | 3,634 |
| 申诉及导师复核 | — | 5,298 | 7,607 |
| 跳过后导师回复 | — | 1,425 | 7,147 |
| 简答作答 | 12 | 1,857 | 3,792 |
| 等值分数定性评估 | — | 3,664 | 13,029 |

## AC-06 精通复习真机结果 · 2026-11-25

Redmi K20 Pro 尊享版，Android 11（API 30），ARM64，ADB `86ceabbf`。通过 USB Metro 运行 Dev Client，以独立测试主题预置三个已掌握的分数程序知识点。提交、批改、补救和导师总结使用真机界面、SQLite v4 与 SecureStore 中的 DeepSeek Flash 配置。

- **复习入口**。在「我的」设置时钟偏移 4 天，再点「精通之路」的到期横幅。新会话进入复习模式，自动发送开场消息，列出约分、通分与比较分数三项。
- **独立复习与失误**。对已掌握的约分知识点答对一次后，下次日期从 11 月 28 日 18:25:33 延至 12 月 16 日 07:20:28（UTC）。在同一会话内再次答对，完整时间戳和稳定度均保持一致。随后独立答错，失误次数升至 1，掌握度回落至 75%，知识点离开复习计划，路径从「已完成」回到「学习中」。
- **补救并回到复习计划**。在学习模式连续五次独立答对，掌握度恢复至 100%，失误次数仍为 1，保留失误后缩短的复习时间。把偏移推到 7 天时，约分重新显示「现在可复习」和「有失误记录 · 1 次」。
- **提前结束**。三项到期时仅完成约分，随后要求停止。导师在原会话总结该项为正确，给出与调度数据一致的下次复习日期 `2026-12-12`（UTC）。另两项保留到期状态。
- **复习计划重排**。在路径页把记忆保持目标从 90% 调至 95%，约分的下次复习从 12 月 12 日 02:39:10 提前到 12 月 7 日 04:29:03（UTC）。点击复习计划中的约分条目可定位到大纲中的同一知识点。
- **Release 验证**。覆盖安装 ARM64 Release APK，移除本次测试的 USB Metro 映射后冷启动成功。「我的」设置页没有开发工具或时钟偏移入口。

## M2-A 学习首页与交接真机结果 · 2026-11-25

Redmi K20 Pro 尊享版，Android 11（API 30），ADB `86ceabbf`，ARM64。以独立应用 ID `app.learnpace.m2acheck` 安装 Dev Client，从空数据库开始，通过 USB 配对导入 DeepSeek Flash 配置。连通性测试耗时 2,106 ms。

- **首次启动。** 冷启动进入「问答」。四个 Tab 显示各自的空态和模型配置入口，「学习」的「精通之路」入口可打开新建向导。
- **问答到学习。** 问答和小老师均完成真实模型回合。主对话的「转为学习目标」预选原文并保存来源，在编辑大纲会话生成一个模块和一个约分知识点。学习模式三次独立答对，知识点得分依次为 50%、80%、100%。
- **到期复习。** 调试时钟前移 45 天后，学习首页、精通之路列表、路径页与会话均显示已掌握 1 / 共 1（100%），1 项复习到期。点击「该做的事」新建复习会话并自动发送列出到期知识点的开场消息。独立答错简答题后，知识点得分回落至约 71%，失误次数为 1。学习首页和会话显示已掌握 0 / 共 1（0%），0 项复习到期。
- **问答交接。** 请导师带回原学习会话，获得一张「回到这次会话」卡片。强制停止应用后从历史会话恢复卡片，编辑「开场说」并点击按钮。原学习会话保存编辑后的学习者消息，导师完成回复，学习会话数量保持一致。
- **Release。** 标准 ARM64 Release APK 为 38,652,990 字节（36.86 MiB）。同一源码以独立应用 ID 构建后覆盖安装到测试应用，断开 USB Metro 映射，用 `adb shell am start -W` 记录三次 `LaunchState: COLD` 的 `TotalTime`。首屏耗时为 261、271、216 ms，中位数 261 ms。冷启动进入「问答」，可查看原有学习记录和模型配置，开发工具入口在 Release 隐藏。
