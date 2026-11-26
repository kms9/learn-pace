export class RestoreGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreGateError";
  }
}

export class RestoreGate {
  private pendingRestore?: Promise<void>;
  private activeWrites = 0;

  private assertWritable(): void {
    if (this.pendingRestore) throw new RestoreGateError("正在恢复备份，请等待恢复完成。");
  }

  async write<T>(work: () => Promise<T>): Promise<T> {
    this.assertWritable();
    this.activeWrites++;
    try {
      return await work();
    } finally {
      this.activeWrites--;
    }
  }

  async restore<T>(work: () => Promise<T>): Promise<T> {
    this.assertWritable();
    if (this.activeWrites) throw new RestoreGateError("请等待进行中的会话或保存操作结束，再恢复备份。");
    let release!: () => void;
    this.pendingRestore = new Promise<void>((resolve) => { release = resolve; });
    try {
      return await work();
    } finally {
      this.pendingRestore = undefined;
      release();
    }
  }

  async writeAfterRestore<T>(work: () => Promise<T>): Promise<T> {
    while (this.pendingRestore) await this.pendingRestore;
    return this.write(work);
  }
}

const gates = new WeakMap<object, RestoreGate>();

export function restoreGateFor(store: object): RestoreGate {
  const existing = gates.get(store);
  if (existing) return existing;
  const gate = new RestoreGate();
  gates.set(store, gate);
  return gate;
}
