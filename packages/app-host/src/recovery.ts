import type { LearningEvidence } from "@learn-pace/domain";
import type { AppStore, Clock, StoredInteraction } from "@learn-pace/infra";
import { interruptedReplies } from "./chat-turns.js";
import { evidenceKey, partReceipt, questionLeaves, ready, savedAnswers, verdictFromEvidence } from "./mastery/study.js";

const sessionKinds = new Set(["lf01", "little_tutor", "mastery"]);

export interface RecoveryReport {
  interruptedMessages: number;
  reconciledGradedCards: number;
  reconciledPartialCards: number;
  pendingRetryCards: number;
  abandonedDuplicateCards: number;
}

function reconcileCard(row: StoredInteraction, evidence: ReadonlyMap<string, LearningEvidence>): StoredInteraction {
  const questions = { ...row.grade?.questions };
  const leaves = questionLeaves(row.question);
  let restored = false;
  for (const question of leaves) {
    const grade = questions[question.question_id];
    if (grade?.final || grade?.voided) continue;
    const committed = evidence.get(evidenceKey(row, question));
    if (!committed) continue;
    questions[question.question_id] = partReceipt(question, verdictFromEvidence(committed));
    restored = true;
  }

  const answers = savedAnswers(row);
  const pending = leaves.some(({ question_id }) =>
    !questions[question_id]?.final && !questions[question_id]?.voided && answers[question_id]?.trim());
  const status = ready(row, questions) ? "graded" : pending ? "answered" : "awaiting_input";
  if (status === row.status && !restored) return row;
  const grade = row.grade || restored ? { ...row.grade, questions } : undefined;
  if (grade && status !== "answered") delete grade.grading_failed;
  return { ...row, status, ...(grade && { grade }) };
}

function openCardWeight(card: StoredInteraction): number {
  if (card.status === "answered") return 3;
  const answers = savedAnswers(card);
  return questionLeaves(card.question).some(({ question_id }) => {
    const grade = card.grade?.questions[question_id];
    return grade?.final || (!grade?.voided && answers[question_id]?.trim());
  }) ? 2 : 1;
}

function compareOpenCards(a: StoredInteraction, b: StoredInteraction): number {
  return openCardWeight(b) - openCardWeight(a) || b.updated_at - a.updated_at ||
    (a.interaction_id < b.interaction_id ? 1 : a.interaction_id > b.interaction_id ? -1 : 0);
}

export class RecoveryService {
  constructor(private readonly store: AppStore, private readonly clock: Clock, private readonly makeId: () => string) {}

  reconcileAll(): Promise<RecoveryReport> {
    return this.store.runInTransaction((tx) => this.reconcileInTransaction(tx));
  }

  async reconcileInTransaction(tx: AppStore): Promise<RecoveryReport> {
    const report: RecoveryReport = { interruptedMessages: 0, reconciledGradedCards: 0, reconciledPartialCards: 0,
      pendingRetryCards: 0, abandonedDuplicateCards: 0 };
    for (const session of await tx.listSessions()) {
      if (!sessionKinds.has(session.kind)) continue;
      const repairs = interruptedReplies(session, await tx.listMessages(session.session_id));
      for (const message of repairs) {
        await tx.saveMessage({ ...message, message_id: message.message_id ?? this.makeId() });
        report.interruptedMessages++;
      }
    }

    const byPath = new Map<string, StoredInteraction[]>();
    for (const card of await tx.listOpenInteractions()) {
      const cards = byPath.get(card.path_id);
      if (cards) cards.push(card);
      else byPath.set(card.path_id, [card]);
    }
    const now = this.clock.nowSeconds();
    for (const [pathId, cards] of byPath) {
      const progress = await tx.get(pathId);
      const evidence = new Map(progress?.learning_evidence?.map((entry) => [entry.evidence_id, entry]));
      const open: StoredInteraction[] = [];
      for (const card of cards) {
        const reconciled = reconcileCard(card, evidence);
        if (reconciled !== card) {
          await tx.updateInteraction(reconciled);
          if (reconciled.status === "graded") report.reconciledGradedCards++;
          else if (Object.values(reconciled.grade?.questions ?? {}).some(({ final }) => final)) report.reconciledPartialCards++;
        }
        if (reconciled.status !== "graded") open.push(reconciled);
      }
      open.sort(compareOpenCards);
      if (open[0]?.status === "answered") report.pendingRetryCards++;
      for (const duplicate of open.slice(1)) {
        await tx.abandonInteraction(duplicate.interaction_id, Math.max(now, duplicate.updated_at));
        report.abandonedDuplicateCards++;
      }
    }
    return report;
  }
}
