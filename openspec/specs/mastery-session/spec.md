# mastery-session Specification

## Purpose

定义精通会话（对应 DeepTutor `mastery_path` 能力与 `MasteryStudy` 页面）：一条路径的多个会话、三种模式与切换、按模式校验的导师工具、每轮状态快照与导师提示词、单路径单回合，以及消息恢复、开场消息与起手提示。

## Requirements

### Requirement: Multiple sessions per path with switchable modes
A path SHALL support multiple mastery sessions, each with a current mode of outline (编辑大纲), study (学习), or review (复习) that the learner can switch from the session header and the tutor can switch through `mastery_mode`; switching MUST be unavailable while a reply is generating, and entering study MUST be refused when the outline is empty.

#### Scenario: Learner switches mode
- **WHEN** 路径已有大纲，用户在会话顶部从「编辑大纲」切到「学习」
- **THEN** 会话模式更新并持久化，重启后该会话仍为学习模式

#### Scenario: Study refused without an outline
- **WHEN** 路径大纲为空，用户或导师尝试切到学习模式
- **THEN** 切换被拒绝，并说明需要先在编辑大纲模式定下大纲

### Requirement: Mode-gated tutor tools
All mastery tools SHALL be available to the tutor in every turn, and each tool MUST check the session's current mode at execution time and return a refusal reason instead of acting when the mode does not allow it; path and session identity MUST come from the Host, not from model arguments.

#### Scenario: Outline tool refused in study mode
- **WHEN** 学习模式中导师调用 `mastery_build`
- **THEN** 工具返回「该工具只在编辑大纲模式可用」之类的拒绝原因，大纲不变

### Requirement: Per-turn status snapshot and tutor prompt
Each tutor turn SHALL include the ported DeepTutor Chinese tutor prompt for the current mode and a fresh `mastery_status` snapshot (path, goal, outline status, mode, materials, next objective, outline map, learning stages, learner profile, pending interaction, and path revision) supplied as data.

#### Scenario: Snapshot reflects the latest outline
- **WHEN** 导师在上一轮修订了大纲，学习者发送下一条消息
- **THEN** 本轮注入的快照包含修订后的大纲与新的 `path_revision`

### Requirement: One running tutor turn per path
The system SHALL allow at most one running tutor turn per path across all of its sessions, and a session MUST show why sending is waiting while another session of the same path is generating.

#### Scenario: Two sessions of the same path
- **WHEN** 路径的会话 A 正在生成回复时，用户在会话 B 发送消息
- **THEN** 会话 B 不发起请求，提示同一精通目标的另一会话正在进行，A 结束后可发送

### Requirement: Session recovery, opening message, and starters
Mastery sessions SHALL persist and recover messages with the same streaming, interruption, and retry rules as chat, SHALL show the mode note, empty-state title, and three DeepTutor starter prompts for an empty session, and MUST send the opening message only when the session is opened from the creation wizard.

#### Scenario: Empty study session
- **WHEN** 用户新建一个学习模式会话
- **THEN** 页面以当前目标为标题，显示「先出一道题，看看我已经会了什么」「从直觉和一个具体例子讲起」「直接来一道有挑战的题」，点击即发送

#### Scenario: Interrupted tutor reply after force-stop
- **WHEN** 导师回复生成中应用被强杀
- **THEN** 重启后该回复显示为 `interrupted`，保留已收到的内容并可重试，不自动重发
