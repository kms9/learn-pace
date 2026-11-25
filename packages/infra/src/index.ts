/**
 * Infrastructure ports (SQLite, SecureStore, controllable Clock).
 * M1 S1 will implement Expo adapters (`expo-sqlite` WAL + `expo-secure-store`).
 */

import type { LearningProgress } from "@learn-pace/domain";

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
