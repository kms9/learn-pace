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
