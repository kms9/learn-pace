# Spec Delta

## Purpose

定义 Learn Pace 与 DeepTutor 一致的视觉与文案基础：浅色主题配色、中文界面文案来源，以及模型输出的 Markdown 与公式渲染。

## ADDED Requirements

### Requirement: DeepTutor light theme
The application SHALL use DeepTutor's light theme tokens across all screens: background `#fdfcf9`, primary `#b0501e`, and text, muted, border, success, and danger colors taken from DeepTutor `web/app/globals.css`, with card corner radius 16 (large cards 20).

#### Scenario: Viewing any primary tab
- **WHEN** 用户打开任一一级 Tab
- **THEN** 页面背景、主按钮与选中的 Tab 使用 DeepTutor 浅色主题颜色

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
