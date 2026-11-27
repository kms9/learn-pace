export interface ReminderPreferences {
  enabled: boolean;
  preferredMinute: number;
  quietStartMinute: number;
  quietEndMinute: number;
}

export interface ReminderDueItem {
  pathId: string;
  dueAt: number;
}

export interface PlannedReminder {
  triggerAt: number;
  dueCount: number;
  pathIds: string[];
}

interface ReminderPlanOptions {
  horizonDays?: number;
  /** 与 Date#getTimezoneOffset 一致，UTC 以西为正。 */
  timezoneOffsetMinutes?: number;
  shortDelaySeconds?: number;
}

const minutesPerDay = 24 * 60;
const secondsPerDay = minutesPerDay * 60;
const defaultHorizon = 7;

export const defaultReminderPreferences: Readonly<ReminderPreferences> = {
  enabled: true,
  preferredMinute: 20 * 60,
  quietStartMinute: 22 * 60,
  quietEndMinute: 8 * 60,
};

function afterQuietHours(time: number, { quietStartMinute, quietEndMinute }: ReminderPreferences): number {
  const dayStart = Math.floor(time / secondsPerDay) * secondsPerDay;
  const minute = (time - dayStart) / 60;
  if (quietStartMinute < quietEndMinute && minute >= quietStartMinute && minute < quietEndMinute) {
    return dayStart + quietEndMinute * 60;
  }
  if (quietStartMinute > quietEndMinute) {
    if (minute >= quietStartMinute) return dayStart + secondsPerDay + quietEndMinute * 60;
    if (minute < quietEndMinute) return dayStart + quietEndMinute * 60;
  }
  return time;
}

export function planReviewReminders(
  inputs: readonly ReminderDueItem[],
  preferences: ReminderPreferences,
  nowSeconds: number,
  { horizonDays = defaultHorizon, timezoneOffsetMinutes = 0, shortDelaySeconds }: ReminderPlanOptions = {},
): PlannedReminder[] {
  if (!preferences.enabled || !inputs.length) return [];
  const offset = timezoneOffsetMinutes * 60;
  const localNow = nowSeconds - offset;
  const firstDay = Math.floor(localNow / secondsPerDay);
  const days = Math.min(defaultHorizon, Math.floor(horizonDays));
  const lastDay = firstDay + days;
  const reminders: PlannedReminder[] = [];
  const scheduledDays = new Set<number>();

  for (let day = firstDay; day < lastDay; day++) {
    const requested = shortDelaySeconds === undefined
      ? day * secondsPerDay + preferences.preferredMinute * 60
      : localNow + Math.max(1, shortDelaySeconds);
    const localTrigger = afterQuietHours(requested, preferences);
    const triggerDay = Math.floor(localTrigger / secondsPerDay);
    if (localTrigger > localNow && triggerDay < lastDay && !scheduledDays.has(triggerDay)) {
      const triggerAt = localTrigger + offset;
      const due = inputs.filter(({ dueAt }) => dueAt <= triggerAt);
      if (due.length) {
        reminders.push({ triggerAt, dueCount: due.length, pathIds: [...new Set(due.map(({ pathId }) => pathId))].sort() });
        scheduledDays.add(triggerDay);
      }
    }
    if (shortDelaySeconds !== undefined) break;
  }
  return reminders;
}
