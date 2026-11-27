import { expect, it } from "vitest";
import { defaultReminderPreferences, planReviewReminders } from "../index.js";

const time = (value: string) => Date.parse(value) / 1000;
const prefs = defaultReminderPreferences;

it("merges the due items across paths without including later items", () => {
  const start = time("2026-11-26T19:00:00Z");
  const result = planReviewReminders([
    { pathId: "b", dueAt: time("2026-11-26T19:30:00Z") },
    { pathId: "b", dueAt: time("2026-11-26T20:00:00Z") },
    { pathId: "a", dueAt: time("2026-11-26T19:59:00Z") },
    { pathId: "c", dueAt: time("2026-11-26T20:01:00Z") },
  ], prefs, start, { horizonDays: 2 });
  expect(result).toEqual([
    { triggerAt: time("2026-11-26T20:00:00Z"), dueCount: 3, pathIds: ["a", "b"] },
    { triggerAt: time("2026-11-27T20:00:00Z"), dueCount: 4, pathIds: ["a", "b", "c"] },
  ]);
});

it("aggregates reviews due overnight and the next morning at the next preferred time", () => {
  const result = planReviewReminders([
    { pathId: "a", dueAt: time("2026-11-26T23:30:00Z") },
    { pathId: "b", dueAt: time("2026-11-27T09:00:00Z") },
  ], prefs, time("2026-11-26T18:00:00Z"), { horizonDays: 2 });
  expect(result).toEqual([{ triggerAt: time("2026-11-27T20:00:00Z"), dueCount: 2, pathIds: ["a", "b"] }]);
});

it.each([23, 3])("moves a preferred hour of %s to the end of overnight quiet hours", (hour) => {
  const start = time("2026-11-26T22:15:00Z");
  const inputs = [{ pathId: "a", dueAt: start }];
  const result = planReviewReminders(inputs, { ...prefs, preferredMinute: hour * 60 }, start, { horizonDays: 2 });
  expect(result).toEqual([{ triggerAt: time("2026-11-27T08:00:00Z"), dueCount: 1, pathIds: ["a"] }]);
});

it("uses the local day and offset when UTC is already the next day", () => {
  const start = time("2026-11-27T00:30:00Z");
  const result = planReviewReminders([{ pathId: "a", dueAt: start }], prefs, start,
    { horizonDays: 1, timezoneOffsetMinutes: 7 * 60 });
  expect(result).toEqual([{ triggerAt: time("2026-11-27T03:00:00Z"), dueCount: 1, pathIds: ["a"] }]);
});

it("bounds the schedule and never sends when switched off or no item is due in the window", () => {
  const start = time("2026-11-26T19:00:00Z");
  expect(planReviewReminders([], prefs, start)).toEqual([]);
  expect(planReviewReminders([{ pathId: "a", dueAt: start }], { ...prefs, enabled: false }, start)).toEqual([]);
  expect(planReviewReminders([{ pathId: "a", dueAt: time("2026-12-29T18:00:00Z") }], prefs, start)).toEqual([]);
  expect(planReviewReminders([{ pathId: "a", dueAt: start }], prefs, start)).toHaveLength(7);
});

it("can schedule one short test delay without bypassing quiet hours", () => {
  const now = time("2026-11-26T21:59:55Z");
  const items = [{ pathId: "a", dueAt: now }];
  expect(planReviewReminders(items, prefs, now, { shortDelaySeconds: 2 })[0]?.triggerAt).toBe(now + 2);
  expect(planReviewReminders(items, prefs, now, { shortDelaySeconds: 10 })[0]?.triggerAt)
    .toBe(time("2026-11-27T08:00:00Z"));
});
