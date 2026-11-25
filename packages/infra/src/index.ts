/**
 * Infrastructure ports (SQLite, SecureStore, controllable Clock).
 */

import type { LearningProgress, PendingQuestion } from "@learn-pace/domain";

export interface Clock {
  /** Unix epoch in seconds (matches DeepTutor timestamp convention). */
  nowSeconds(): number;
}

export const systemClock: Clock = {
  nowSeconds: () => Date.now() / 1000,
};

export interface LearningProgressStore {
  get(pathId: string): Promise<LearningProgress | null>;
  save(progress: LearningProgress): Promise<void>;
  listIds(): Promise<string[]>;
}

export interface SecretStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface StoredInteraction {
  interaction_id: string;
  path_id: string;
  session_id: string;
  turn_id: string;
  status: "awaiting_input" | "answered" | "graded";
  question: PendingQuestion;
  raw_answer: string | null;
  submission_id: string | null;
  updated_at: number;
}

export interface InteractionStore {
  getOpenInteraction(pathId: string): Promise<StoredInteraction | null>;
  getInteraction(id: string): Promise<StoredInteraction | null>;
  insertInteraction(interaction: StoredInteraction): Promise<void>;
  saveAnswer(id: string, submissionId: string, rawAnswer: string, now: number): Promise<void>;
  markGraded(id: string, now: number): Promise<void>;
}
