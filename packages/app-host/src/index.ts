/**
 * Local Application Host contract.
 *
 * Per decision D3:
 * - M2-A (rapid main flow): sequential persistence without SQLite transaction/CAS locks.
 * - M2-B (hardening): wraps critical commands (e.g. CommitAssessment) in short SQLite
 *   transactions with Revision CAS and submission_id idempotency.
 */

import type { ApplicationCommand, DomainEvent } from "@learn-pace/domain";
import type { AgentRuntime } from "@learn-pace/runtime";

export interface CommandReceipt {
  ok: boolean;
  events: DomainEvent[];
  error?: string;
}

export interface ApplicationHost {
  readonly runtime: AgentRuntime;
  dispatch(command: ApplicationCommand): Promise<CommandReceipt>;
}

export { StudyWorkbench, type StudySnapshot } from "./study-workbench.js";
export { Lf01ChatError, Lf01ChatService, messageQuotes, type ChatSelection, type ChatQuote } from "./lf01-chat.js";
export { renderedChatSelections } from "./chat-selection.js";
export { chatTitleFromPrompt } from "./chat-turns.js";
export { MasterySessionError, MasterySessionService, masteryToolStatusLabel, type TopicMaterial } from "./mastery/session-service.js";
export type { Answers, StudyCard } from "./mastery/study.js";
export { masteryModeLabels, masteryModeNotes, masteryNextLabels, masteryStarters } from "./mastery/copy.js";
export { LearningHomeService, summarizePath, type LearningAttention, type LearningRecord } from "./learning-home.js";
export { messageHandoffs, type MasteryHandoff } from "./mastery/nav-tools.js";

export {
  AppBootstrapService, ModelSettingsError, type BootstrapSnapshot,
} from "./app-bootstrap.js";
