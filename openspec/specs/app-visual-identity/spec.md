# app-visual-identity Specification

## Purpose

定义 Learn Pace 与 DeepTutor 一致的视觉与文案基础：浅色主题配色、中文界面文案来源，以及模型输出的 Markdown 与公式渲染。

## Requirements

### Requirement: DeepTutor light theme
应用各页面 SHALL 使用 DeepTutor 的浅色主题，包括背景色 `#fdfcf9`、主色 `#b0501e`，取自 `web/app/globals.css` 的正文、弱化文字、边框、成功与危险配色，以及语义浅底色 `primarySoft`、`successSoft`、`dangerSoft`、`warningSoft`。字号和圆角使用统一阶梯，卡片圆角为 16，大卡片为 20。

#### Scenario: Viewing any primary tab
- **WHEN** 用户打开任一一级 Tab
- **THEN** 页面背景、卡片、状态徽章、主按钮与选中 Tab 均使用统一的 DeepTutor 浅色主题与语义浅底色 Token

### Requirement: DeepTutor Chinese terminology
User-facing labels for chat, side chat, and Mastery Path SHALL use the Chinese text from DeepTutor `web/locales/zh/app.json` when an equivalent key exists.

#### Scenario: Chat labels match DeepTutor
- **WHEN** 用户查看问答页的操作按钮与选文工具
- **THEN** 文案为「新对话」「停止生成」「重新生成」「添加到对话框」「问 Dito」，侧聊标记为「小老师 ×N」

### Requirement: Markdown and formula rendering
Model output SHALL render Markdown structure and LaTeX formulas (`$...$`, `$$...$$`) while stored content stays unchanged; during streaming, unclosed formulas or code blocks MUST display as raw text until complete.

#### Scenario: Rendering an explanation with formulas
- **WHEN** 助手回复包含列表、代码块与公式
- **THEN** 页面以对应结构与公式排版展示，选文仍按消息原文计算位置
