import { createHash } from "node:crypto";
import {
  applyGrade, createKnowledgePoint, createLearningModule, createLearningProgress, createPendingQuestion,
  defaultReminderPreferences, schedulerForProgress,
} from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore, type Clock } from "@learn-pace/infra";
import { expect, it, vi } from "vitest";
import { completion, modelConfig, text } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { AppBootstrapService, ReviewReminderService, type NotificationPermission, type ScheduledNotification } from "../index.js";
import { restoreGateFor } from "../restore-gate.js";

const epoch = Date.parse("2026-11-26T19:00:00Z") / 1000;
const reply = () => completion([text("继续复习。")]);
const sha256 = async (value: string) => createHash("sha256").update(value).digest("hex");

class FakeClock implements Clock {
  time = epoch;
  nowSeconds() { return this.time; }
}

function platform(initial: NotificationPermission = "granted") {
  let permission = initial;
  let scheduled: readonly ScheduledNotification[] = [];
  return {
    getPermissionStatus: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => { permission = "denied"; return "denied" as const; }),
    replaceScheduled: vi.fn(async (items: readonly ScheduledNotification[]) => { scheduled = items; }),
    cancelAll: vi.fn(async () => { scheduled = []; }),
    scheduled: () => scheduled,
  };
}

function learned(pathId: string, due: number) {
  const point = createKnowledgePoint({ id: "point", name: "约分", type: "procedure", module_id: "module" });
  let progress = createLearningProgress({ book_id: pathId, name: pathId, modules: [createLearningModule({
    id: "module", name: "分数", objective: "化简", order: 0, knowledge_points: [point],
  })] });
  const scheduler = schedulerForProgress(progress);
  for (let index = 0; index < 3; index++) {
    progress = applyGrade(progress, { evidence_id: `seed-${index}`, question_id: `seed-${index}`,
      knowledge_point_id: point.id, learner_answer: "1/2", session_id: "past", turn_id: "past",
      verdict: { result: "correct", confidence: 1, feedback: "正确" } }, scheduler, due - 4 * 86_400);
  }
  progress.repetition_states.point!.next_review_at = due;
  progress.review_queue = scheduler.buildReviewQueue(progress, due);
  return progress;
}

function setup(permission: NotificationPermission = "granted") {
  const store = new MemoryAppStore();
  const clock = new FakeClock();
  const native = platform(permission);
  let identifier = 0;
  const app = new AppBootstrapService(store, new MemorySecretStore(), {
    makeId: () => `m-${++identifier}`, fetch: async () => reply(),
  });
  const reminders = app.createReviewReminderService(native, clock);
  const mastery = app.createMasterySessionService(clock);
  return { store, clock, native, app, reminders, mastery };
}

it("keeps cold startup silent and stops requesting after a real denial", async () => {
  const { store, clock, native, reminders } = setup("undetermined");
  await store.save(learned("路径 A", clock.time - 60));
  await reminders.reschedule();
  expect(native.requestPermission).not.toHaveBeenCalled();
  await reminders.savePreferences({ ...defaultReminderPreferences, enabled: false });
  await reminders.savePreferences({ ...defaultReminderPreferences }, true);
  await reminders.savePreferences({ ...defaultReminderPreferences }, true);
  expect(native.requestPermission).toHaveBeenCalledTimes(1);
  expect(await reminders.permissionStatus()).toBe("denied");
  expect(native.scheduled()).toEqual([]);
});

it("replaces the foreground plan after committed grading, reset and deletion", async () => {
  const { app, store, clock, native, reminders, mastery } = setup();
  await app.saveModelSettings(modelConfig);
  await store.save(learned("a", clock.time - 60));
  await reminders.reschedule();
  expect(native.scheduled()[0]?.data.dueCount).toBe(1);
  const oldSchedule = native.scheduled();
  const session = await mastery.createSession("a", "review");
  const question = createPendingQuestion({ question_id: "q", knowledge_point_id: "point", module_id: "module",
    question_type: "choice", expected_answer: "A", options: [{ label: "A", body: "1/2" }, { label: "B", body: "1/4" }] });
  await store.insertInteraction({ interaction_id: "card", session_id: session.session_id, path_id: "a", turn_id: "turn",
    status: "awaiting_input", raw_answer: null, submission_id: null, updated_at: clock.time, question });
  await mastery.submitAnswer("a", session.session_id, "card", { q: "A" }, "submission");
  await vi.waitFor(() => expect(native.scheduled()).not.toEqual(oldSchedule));

  await store.save(learned("b", clock.time - 30));
  await reminders.reschedule();
  expect(native.scheduled()[0]?.data.pathIds).toContain("b");
  await mastery.resetTopic("b");
  await vi.waitFor(() => expect(native.scheduled().every((item) => !(item.data.pathIds as string[]).includes("b"))).toBe(true));

  await store.save(learned("c", clock.time - 30));
  await reminders.reschedule();
  expect(native.scheduled()[0]?.data.pathIds).toContain("c");
  await mastery.deleteTopic("c");
  await vi.waitFor(() => expect(native.scheduled().every((item) => !(item.data.pathIds as string[]).includes("c"))).toBe(true));
});

it("restores portable preferences and builds a fresh native schedule after the transaction", async () => {
  const { app, store, clock, native, reminders } = setup();
  await store.save(learned("a", clock.time - 30));
  await reminders.savePreferences({ ...defaultReminderPreferences, preferredMinute: 19 * 60 });
  const backup = app.createBackupRestoreService("0.1.0", sha256, clock);
  const snapshot = await backup.exportBackup();
  expect(snapshot.payload.settings).toHaveLength(1);
  expect(snapshot.payload.settings[0]?.name).toBe("review-reminder-settings");
  await reminders.savePreferences({ ...defaultReminderPreferences, enabled: false });
  expect(native.scheduled()).toEqual([]);
  await backup.restoreBackup(JSON.stringify(snapshot));
  await vi.waitFor(() => expect(native.scheduled()[0]?.data.dueCount).toBe(1));
  expect(await reminders.preferences()).toMatchObject({ enabled: true, preferredMinute: 19 * 60 });
});

it("waits for restoration, resolves live due paths and coalesces concurrent opens", async () => {
  const { store, clock, reminders, mastery, native } = setup();
  await store.save(learned("a", clock.time - 30));
  const open = vi.fn(async (id: string) => (await mastery.startReview(id)).session.session_id);
  const [a, b] = await Promise.all([reminders.openNotificationTarget(open), reminders.openNotificationTarget(open)]);
  expect(a).toMatchObject({ kind: "session", pathId: "a" });
  expect(a).toEqual(b);
  expect(await reminders.openNotificationTarget(open)).toEqual(a);
  expect(await new ReviewReminderService(store, clock, native).openNotificationTarget(open)).toEqual(a);
  expect(open).toHaveBeenCalledTimes(1);
  expect(await store.listSessionsByPath("a")).toHaveLength(1);

  await store.save(learned("b", clock.time - 20));
  expect(await reminders.resolveNotificationTarget()).toEqual({ kind: "home" });
  let finishRestore!: () => void;
  const restore = new Promise<void>((resolve) => { finishRestore = resolve; });
  const replacing = restoreGateFor(store).restore(async () => {
    await restore;
    await store.delete("a");
    await store.delete("b");
  });
  const routed = vi.fn();
  const target = reminders.resolveNotificationTarget().then(routed);
  await Promise.resolve();
  expect(routed).not.toHaveBeenCalled();
  finishRestore();
  await Promise.all([replacing, target]);
  expect(routed).toHaveBeenCalledWith({ kind: "home", notice: "当前暂无到期复习" });
});

it("prefers an open review card and otherwise reuses a nonempty review", async () => {
  const { store, clock, mastery, reminders } = setup();
  await store.save(learned("a", clock.time - 30));
  const review = await mastery.createSession("a", "review");
  await store.saveMessage({ session_id: review.session_id, message_id: "existing", role: "user", status: "committed",
    content: "上次没复习完", turn_id: "existing", metadata: null, created_at: clock.time });
  expect(await reminders.resolveNotificationTarget()).toEqual({ kind: "session", pathId: "a", sessionId: review.session_id });
});

it("calculates the native delay relative to the injected clock", async () => {
  const clock = new FakeClock();
  const native = platform();
  const store = new MemoryAppStore();
  const reminders = new ReviewReminderService(store, clock, native, () => 0);
  await store.save(learned("a", clock.time - 100));
  await reminders.reschedule({ shortDelaySeconds: 10 });
  expect(native.scheduled()[0]?.delaySeconds).toBe(10);
});
