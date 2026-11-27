import type { AppStore, Clock, QuestionGrade, StoredKnowledgeCard } from "@learn-pace/infra";
import { publicQuickCheck } from "./chat-quick-check.js";
import { limitText } from "./chat-turns.js";
import { selectionInChatMessage, type ChatSelection } from "./lf01-chat.js";
import { questionLeaves } from "./mastery/study.js";
import { restoreGateFor } from "./restore-gate.js";
import { messageKnowledgeProvenance } from "./extensions/knowledge/provenance.js";

export class KnowledgeCardError extends Error {}

type CardSource = Pick<StoredKnowledgeCard, "source_kind" | "path_id" | "source_session_id" | "source_message_id" | "source_interaction_id">;
type CardQuestion = { prompt: string; options: { label: string; body: string }[]; explanation?: string; expected_answer?: string };

function explanationText(question: CardQuestion, grade: QuestionGrade | undefined) {
  if (!grade?.final || grade.voided || grade.result === "ungraded") throw new KnowledgeCardError("题目尚无可收藏的判分结果");
  const answer = grade.reference_answer || grade.correct_option || question.expected_answer;
  const reference = question.options.find(({ label }) => label === answer)?.body ?? answer;
  const explanation = grade.explanation || question.explanation;
  return [question.prompt.trim(), reference && "参考答案：" + reference.trim(),
    explanation && "解析：" + explanation.trim(), grade.feedback && grade.feedback !== explanation && "反馈：" + grade.feedback.trim()]
    .filter(Boolean).join("\n\n");
}

export class KnowledgeCardService {
  constructor(private readonly store: AppStore, private readonly clock: Clock, private readonly makeId: () => string) {}

  list(query?: string): Promise<StoredKnowledgeCard[]> {
    return restoreGateFor(this.store).writeAfterRestore(() => this.store.listKnowledgeCards({ query }));
  }

  saveSelection(sessionId: string, messageId: string, selection: ChatSelection, confirmKnowledge = false) {
    return this.edit(async (tx) => {
      const [session, message] = await Promise.all([tx.getSession(sessionId), tx.getMessage(messageId)]);
      if (!session || (session.kind !== "lf01" && session.kind !== "little_tutor") ||
          message?.session_id !== sessionId || message.status !== "committed" || message.metadata?.quick_check !== undefined) {
        throw new KnowledgeCardError("原消息已无法收藏");
      }
      if (messageKnowledgeProvenance(message) && !confirmKnowledge) throw new KnowledgeCardError("请确认将外部知识库内容保存到本地知识卡。");
      const { text } = selectionInChatMessage(message, selection);
      return this.create(tx, text, text, { source_kind: session.kind === "lf01" ? "chat" : "little_tutor",
        path_id: null, source_session_id: sessionId, source_message_id: messageId, source_interaction_id: null });
    });
  }

  saveMasteryExplanation(interactionId: string, questionId: string) {
    return this.edit(async (tx) => {
      const row = await tx.getInteraction(interactionId);
      const question = row && questionLeaves(row.question).find(({ question_id }) => question_id === questionId);
      if (!row || !question || row.status === "abandoned") throw new KnowledgeCardError("原题卡已无法收藏");
      return this.create(tx, question.prompt, explanationText(question, row.grade?.questions[questionId]), {
        source_kind: "mastery_card", path_id: row.path_id, source_session_id: row.session_id,
        source_message_id: null, source_interaction_id: row.interaction_id,
      });
    });
  }

  saveQuickCheckExplanation(messageId: string, questionId: string) {
    return this.edit(async (tx) => {
      const message = await tx.getMessage(messageId);
      const check = message && publicQuickCheck(message);
      const question = check?.questions.find(({ question_id }) => question_id === questionId);
      if (!message || check?.status !== "graded" || !question) throw new KnowledgeCardError("自测题卡已无法收藏");
      return this.create(tx, question.prompt, explanationText(question, check.grades[questionId]), {
        source_kind: "chat", path_id: null, source_session_id: message.session_id,
        source_message_id: messageId, source_interaction_id: null,
      });
    });
  }

  updateNote(id: string, note: string) {
    return this.edit(async (tx) => {
      const card = await tx.getKnowledgeCard(id);
      if (!card || card.deleted_at !== null) throw new KnowledgeCardError("该知识卡已删除");
      await tx.saveKnowledgeCard({ ...card, note: note.trim(), updated_at: this.clock.nowSeconds() });
    });
  }

  remove(id: string) {
    return restoreGateFor(this.store).write(() => this.store.softDeleteKnowledgeCard(id, this.clock.nowSeconds()));
  }

  private edit<T>(work: (tx: AppStore) => Promise<T>): Promise<T> {
    return restoreGateFor(this.store).write(() => this.store.runInTransaction(work));
  }

  private async create(tx: AppStore, title: string, content: string, source: CardSource) {
    const now = this.clock.nowSeconds();
    const card: StoredKnowledgeCard = { ...source, card_id: this.makeId(), content,
      title: limitText(title.trim().replace(/\s+/g, " "), 80), note: "", created_at: now, updated_at: now, deleted_at: null };
    await tx.saveKnowledgeCard(card);
    return card;
  }
}
