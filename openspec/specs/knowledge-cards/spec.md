# knowledge-cards Specification

## Purpose

定义 Learn Pace 的轻量知识卡能力：从消息选文与已判分题卡解析一键收藏、备注编辑、软删除、搜索、删除主题时保留卡片，以及在新建精通目标向导中作为 `text_note` 资料选用（对应 V0.4 AC-11）。

## Requirements

### Requirement: Saving knowledge cards from messages and graded question cards
应用 SHALL 允许学习者在问答或小老师的选文确认界面选择「收藏为知识卡」，并从已判分题卡选择「收藏解析」。应用将来源元数据、正文、可选备注、可选 `path_id` 和时间戳保存到 `knowledge_cards`。

#### Scenario: Saving a reply selection as a knowledge card
- **WHEN** 用户在问答或小老师中选文并点击「收藏为知识卡」
- **THEN** 系统创建一条知识卡并持久化保存其正文、来源会话与消息锚点，可在知识卡列表中查到

#### Scenario: Saving a graded card explanation as a knowledge card
- **WHEN** 精通会话题卡判分完成后用户点击「收藏解析」
- **THEN** 系统将该题的题干、参考答案与解析保存为一条知识卡并关联原路径 ID

### Requirement: Searching, editing notes, soft-deleting, and preserving cards on topic delete
知识卡列表 SHALL 支持按标题、正文和备注搜索、编辑备注，并通过设置 `deleted_at` 软删除卡片。删除精通路径时 MUST 将其关联卡片的 `path_id` 置空并保留卡片。

#### Scenario: Searching and soft-deleting knowledge cards
- **WHEN** 用户在知识卡列表输入关键词搜索并软删除其中一张卡片
- **THEN** 搜索只展示匹配的未删除卡片，被软删除的卡片不再出现在列表中

#### Scenario: Deleting a path preserves saved knowledge cards
- **WHEN** 用户删除一条关联了 2 张知识卡的精通路径
- **THEN** 路径及其会话与题卡被删除，这 2 张知识卡仍保留在知识卡列表中且不再指向已删路径

### Requirement: Reusing knowledge cards as text_note materials in topic creation
新建主题向导的资料步骤 SHALL 允许学习者选择已保存的知识卡，并按现有的 `text_note` 资料类型附加。

#### Scenario: Creating a mastery topic from a knowledge card
- **WHEN** 用户在新建精通目标第二步勾选一张知识卡并提交创建
- **THEN** 新路径保存一条 `kind = "text_note"` 的来源资料（含卡片标题与正文），编辑大纲会话的导师可通过 `read_source` 读取该内容
