// Adapted from DeepTutor MasteryStudy, mastery-mode and next-step-copy (1284116), Apache-2.0.
import type { NextAction, SessionMode } from "@learn-pace/domain";

export const masteryModeLabels: Record<SessionMode, string> = { outline: "编辑大纲", study: "学习", review: "复习" };
export const masteryModeNotes: Record<SessionMode, string> = {
  outline: "还没有开始教任何东西——这个模式是用来商定你要学什么的。",
  study: "",
  review: "这个模式只重测你已经学过的内容，不会教新知识点。",
};
export const masteryStarters: Record<SessionMode, readonly string[]> = {
  outline: ["按我挑的资料给我一版大纲", "先问我几个问题，再提大纲", "我想先聊聊要学到什么程度"],
  study: ["先出一道题，看看我已经会了什么", "从直觉和一个具体例子讲起", "直接来一道有挑战的题"],
  review: ["复习今天到期的内容", "回头看我最吃力的部分", "把我掌握过的都考一遍"],
};
export const masteryNextLabels: Record<NextAction, string> = {
  probe: "先用一道探查题看看你是否已经掌握",
  teach: "先讲解这个知识点，再检查你是否理解",
  practice: "继续练习，直到稳定越过掌握门槛",
  assess: "用自己的话讲清楚这个概念",
  review: "复习这个记忆信标",
  answer_pending: "完成导师正在等待的回答",
  complete: "整片疆域已经点亮",
};
