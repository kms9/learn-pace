# Spec Delta

## MODIFIED Requirements

### Requirement: DeepTutor light theme
The application SHALL use DeepTutor's light theme tokens across all screens: background `#fdfcf9`, primary `#b0501e`, semantic soft surface tints (`primarySoft`, `successSoft`, `dangerSoft`, `warningSoft`), text, muted, border, success, and danger colors taken from DeepTutor `web/app/globals.css`, plus shared typography and corner-radius scales (card 16, large card 20).

#### Scenario: Viewing any primary tab
- **WHEN** 用户打开任一一级 Tab
- **THEN** 页面背景、卡片、状态徽章、主按钮与选中 Tab 均使用统一的 DeepTutor 浅色主题与语义浅底色 Token
