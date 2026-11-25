# Spec Delta

## MODIFIED Requirements

### Requirement: Offline local browsing without configured model
The application SHALL remain navigable across all local tabs and stored data when no model API key is configured.

#### Scenario: Browsing local pages before configuring a model
- **WHEN** 用户尚未配置 DeepSeek Flash API Key 并切换到「学习」「问答」或「精通之路」Tab
- **THEN** 应用正常展示本地页面与清晰的配置引导入口，不崩溃也不强制锁死在设置页
