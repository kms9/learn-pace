import {
  defaultReminderPreferences, dueReviews, planReviewReminders, reviewableTasks,
  type LearningProgress, type ReminderPreferences,
} from "@learn-pace/domain";
import type { AppStore, Clock } from "@learn-pace/infra";
import { restoreGateFor } from "./restore-gate.js";

export type NotificationPermission = "granted" | "denied" | "undetermined";
export type ScheduledNotification = {
  id: string;
  delaySeconds: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export interface NotificationSchedulerPort {
  getPermissionStatus(): Promise<NotificationPermission>;
  requestPermission(): Promise<"granted" | "denied">;
  replaceScheduled(items: readonly ScheduledNotification[]): Promise<void>;
  cancelAll(): Promise<void>;
}

export const reminderSetting = "review-reminder-settings";
export const reminderNotificationKind = "review-reminder";
export type ReviewNotificationTarget =
  | { kind: "home"; notice?: string }
  | { kind: "session"; pathId: string; sessionId: string }
  | { kind: "new_review"; pathId: string };

type ReminderSyncOptions = {
  requestPermissionIfNeeded?: boolean;
  onlyWithReviews?: boolean;
  shortDelaySeconds?: number;
};

function validMinute(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1440;
}

function readPreferences(raw: string | null): ReminderPreferences {
  try {
    const value: Partial<ReminderPreferences> | null = raw ? JSON.parse(raw) : null;
    if (value && typeof value.enabled === "boolean" && validMinute(value.preferredMinute) &&
        validMinute(value.quietStartMinute) && validMinute(value.quietEndMinute)) {
      return { enabled: value.enabled, preferredMinute: value.preferredMinute,
        quietStartMinute: value.quietStartMinute, quietEndMinute: value.quietEndMinute };
    }
  } catch { /* 使用默认设置。 */ }
  return { ...defaultReminderPreferences };
}

export class ReviewReminderService {
  private pendingSchedule = Promise.resolve();
  private permissionRequested = false;
  private opening?: Promise<Exclude<ReviewNotificationTarget, { kind: "new_review" }>>;

  constructor(
    private readonly store: AppStore,
    private readonly clock: Clock,
    private readonly platform: NotificationSchedulerPort,
    private readonly timezoneOffset = (timestamp: number) => new Date(timestamp * 1000).getTimezoneOffset(),
  ) {}

  async preferences(): Promise<ReminderPreferences> {
    return readPreferences(await this.store.readSetting(reminderSetting));
  }

  permissionStatus(): Promise<NotificationPermission> {
    return this.platform.getPermissionStatus().catch(() => "denied");
  }

  async savePreferences(preferences: ReminderPreferences, requestPermissionIfNeeded = false): Promise<void> {
    if (!validMinute(preferences.preferredMinute) || !validMinute(preferences.quietStartMinute) ||
        !validMinute(preferences.quietEndMinute)) throw new RangeError("请输入有效的提醒时间。");
    await restoreGateFor(this.store).write(() => this.store.writeSetting(reminderSetting, JSON.stringify(preferences)));
    await this.reschedule({ requestPermissionIfNeeded });
  }

  reschedule(options: ReminderSyncOptions = {}): Promise<void> {
    const next = this.pendingSchedule.then(() => this.sync(options));
    this.pendingSchedule = next.catch(() => {});
    return this.pendingSchedule;
  }

  private async paths(): Promise<LearningProgress[]> {
    const paths = await Promise.all((await this.store.listIds()).map((id) => this.store.get(id)));
    return paths.filter((path): path is LearningProgress => path !== null);
  }

  private async sync({ requestPermissionIfNeeded, onlyWithReviews, shortDelaySeconds }: ReminderSyncOptions): Promise<void> {
    const { preferences, inputs } = await restoreGateFor(this.store).writeAfterRestore(async () => {
      const preferences = await this.preferences();
      const inputs = preferences.enabled ? (await this.paths()).flatMap((path) => reviewableTasks(path)
        .map(({ due_at }) => ({ pathId: path.book_id, dueAt: due_at }))) : [];
      return { preferences, inputs };
    });
    if (!preferences.enabled) return this.platform.cancelAll();
    const now = this.clock.nowSeconds();
    const plan = planReviewReminders(inputs, preferences, now, {
      timezoneOffsetMinutes: this.timezoneOffset(now), shortDelaySeconds,
    });
    let permission = await this.platform.getPermissionStatus();
    if (permission === "undetermined" && requestPermissionIfNeeded && !this.permissionRequested &&
        (!onlyWithReviews || plan.length)) {
      this.permissionRequested = true;
      permission = await this.platform.requestPermission();
    }
    if (permission !== "granted" || !plan.length) return this.platform.cancelAll();
    await this.platform.replaceScheduled(plan.map(({ triggerAt, dueCount, pathIds }) => ({
      id: `${reminderNotificationKind}-${triggerAt}`,
      delaySeconds: Math.max(1, Math.round(triggerAt - this.clock.nowSeconds())),
      title: "复习提醒",
      body: `有 ${dueCount} 项复习已到期`,
      data: { kind: reminderNotificationKind, dueCount, pathIds, url: "learnpace:///review-reminder" },
    })));
  }

  afterLearningChange(requestPermissionIfNeeded: boolean): void {
    void this.reschedule({ requestPermissionIfNeeded, onlyWithReviews: true });
  }

  resolveNotificationTarget(): Promise<ReviewNotificationTarget> {
    return restoreGateFor(this.store).writeAfterRestore(() => this.resolveTarget());
  }

  private async resolveTarget(): Promise<ReviewNotificationTarget> {
    const now = this.clock.nowSeconds();
    const due = (await this.paths()).filter((path) => dueReviews(path, now).length > 0);
    if (!due.length) return { kind: "home", notice: "当前暂无到期复习" };
    if (due.length > 1) return { kind: "home" };
    const pathId = due[0]!.book_id;
    const [sessions, openCard] = await Promise.all([
      this.store.listSessionsByPath(pathId), this.store.getOpenInteraction(pathId),
    ]);
    const reviews = sessions.filter(({ kind, mode }) => kind === "mastery" && mode === "review")
      .sort((a, b) => b.updated_at - a.updated_at || b.created_at - a.created_at);
    // 刚建好但尚未发出开场的复习也可继续，避免通知处理期间强停后重复建会话。
    const resume = reviews.find((session) => session.session_id === openCard?.session_id) ?? reviews[0];
    if (resume) return { kind: "session", pathId, sessionId: resume.session_id };
    return { kind: "new_review", pathId };
  }

  openNotificationTarget(startReview: (pathId: string) => Promise<string>) {
    return this.opening ??= restoreGateFor(this.store).writeAfterRestore(async () => {
      const target = await this.resolveTarget();
      if (target.kind !== "new_review") return target;
      const sessionId = await startReview(target.pathId);
      return { kind: "session" as const, pathId: target.pathId, sessionId };
    }).finally(() => { this.opening = undefined; });
  }
}
