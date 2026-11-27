import type { AppStore, DatabaseSnapshot } from "../index.js";

const writes = [
  "writeSetting", "save", "saveWithCas", "delete", "insertInteraction", "saveAnswer", "markGraded",
  "abandonInteraction", "deleteInteractionsByPath", "updateInteraction", "saveSession", "updateSession",
  "deleteSessionsByPath", "saveMessage", "deleteMessages", "saveThread", "updateThread", "deleteThread",
  "appendDomainEvent", "deleteDomainEventsByPath",
  "replaceSnapshot",
] as const satisfies readonly (keyof AppStore)[];
const writeMethods = new Set<string>(writes);
type FaultOperation = (typeof writes)[number] | "commitTransaction";
type FaultTiming = "before" | "after";

export class InjectedCrashError extends Error {
  constructor(readonly operation: FaultOperation, readonly timing: FaultTiming) {
    super(`${timing} ${operation}`);
    this.name = "InjectedCrashError";
  }
}

export class FaultInjectingAppStore {
  readonly store: AppStore;
  private fault?: { operation: FaultOperation; timing: FaultTiming; matches?: (args: readonly unknown[]) => boolean };

  constructor(store: AppStore) {
    this.store = this.wrap(store, false);
  }

  injectNext(operation: FaultOperation, timing: FaultTiming, matches?: (args: readonly unknown[]) => boolean): void {
    this.fault = { operation, timing, matches };
  }

  private check(operation: FaultOperation, timing: FaultTiming, args: readonly unknown[] = []): void {
    const fault = this.fault;
    if (fault?.operation !== operation || fault.timing !== timing || fault.matches?.(args) === false) return;
    this.fault = undefined;
    throw new InjectedCrashError(operation, timing);
  }

  private wrap(store: AppStore, inTransaction: boolean): AppStore {
    return new Proxy(store, {
      get: (target, key, receiver) => {
        if (key === "runInTransaction") {
          return async <T>(work: (tx: AppStore) => Promise<T>): Promise<T> => {
            const result = await target.runInTransaction(async (tx) => {
              const result = await work(this.wrap(tx, true));
              if (!inTransaction) this.check("commitTransaction", "before");
              return result;
            });
            if (!inTransaction) this.check("commitTransaction", "after");
            return result;
          };
        }
        if (key === "replaceSnapshot") {
          return async (snapshot: DatabaseSnapshot, afterReplace?: (tx: AppStore) => Promise<void>) => {
            this.check(key, "before", [snapshot]);
            await target.replaceSnapshot(snapshot, afterReplace && ((tx) => afterReplace(this.wrap(tx, true))));
            this.check(key, "after", [snapshot]);
          };
        }
        const method: unknown = Reflect.get(target, key, receiver);
        if (typeof method !== "function") return method;
        if (typeof key !== "string" || !writeMethods.has(key)) return method.bind(target);
        return async (...args: unknown[]) => {
          const operation = key as FaultOperation;
          this.check(operation, "before", args);
          const result: unknown = await Reflect.apply(method, target, args);
          this.check(operation, "after", args);
          return result;
        };
      },
    });
  }
}
