import { reminderNotificationKind, type NotificationSchedulerPort, type ScheduledNotification } from "@learn-pace/app-host";
import { expoSecretStore } from "@learn-pace/infra/expo";
import {
  addNotificationResponseReceivedListener, AndroidImportance, cancelScheduledNotificationAsync,
  clearLastNotificationResponse, DEFAULT_ACTION_IDENTIFIER, getAllScheduledNotificationsAsync,
  getLastNotificationResponse, getPermissionsAsync, requestPermissionsAsync, scheduleNotificationAsync,
  SchedulableTriggerInputTypes, setNotificationChannelAsync, setNotificationHandler,
  type NotificationResponse,
} from "expo-notifications";
import { Platform } from "react-native";

const channelId = "review-reminders";
const permissionAttemptKey = "review-reminder-permission-attempt";
const supported = Platform.OS === "android" || Platform.OS === "ios";
let channel: Promise<unknown> | undefined;
let scheduleTail = Promise.resolve();

if (supported) setNotificationHandler({
  async handleNotification(notification) {
    const review = notification.request.content.data?.kind === reminderNotificationKind;
    return { shouldShowBanner: review, shouldShowList: review, shouldPlaySound: review, shouldSetBadge: false };
  },
});

function ensureChannel(): Promise<unknown> {
  if (Platform.OS !== "android") return Promise.resolve();
  return channel ??= setNotificationChannelAsync(channelId, {
    name: "复习提醒", importance: AndroidImportance.DEFAULT,
  }).catch((error: unknown) => {
    channel = undefined;
    throw error;
  });
}

function updateSchedule(items: readonly ScheduledNotification[]): Promise<void> {
  if (!supported) return Promise.resolve();
  const next = scheduleTail.then(async () => {
    const existing = (await getAllScheduledNotificationsAsync()).filter(({ content }) =>
      content.data?.kind === reminderNotificationKind);
    if (items.length) await ensureChannel();
    const now = Date.now();
    for (const { id, title, body, data, delaySeconds } of items) {
      await scheduleNotificationAsync({
        identifier: id,
        content: { title, body, data, sound: "default" },
        trigger: { type: SchedulableTriggerInputTypes.DATE, date: now + delaySeconds * 1000, channelId },
      });
    }
    const required = new Set(items.map(({ id }) => id));
    await Promise.all(existing.filter(({ identifier }) => !required.has(identifier))
      .map(({ identifier }) => cancelScheduledNotificationAsync(identifier)));
  });
  scheduleTail = next.catch(() => {});
  return next;
}

export const reviewNotifications: NotificationSchedulerPort = {
  async getPermissionStatus() {
    if (!supported) return "denied";
    const permission = await getPermissionsAsync();
    if (permission.granted) return "granted";
    // Android 13 在首次询问之前也可能报告 denied。
    if (Platform.OS === "android" && Number(Platform.Version) >= 33 && permission.canAskAgain &&
        !await expoSecretStore.getItem(permissionAttemptKey)) return "undetermined";
    return permission.status === "undetermined" && permission.canAskAgain ? "undetermined" : "denied";
  },
  async requestPermission() {
    if (!supported) return "denied";
    await ensureChannel();
    if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
      await expoSecretStore.setItem(permissionAttemptKey, "1");
    }
    return (await requestPermissionsAsync()).granted ? "granted" : "denied";
  },
  replaceScheduled: updateSchedule,
  cancelAll: () => updateSchedule([]),
};

const handled = new Set<string>();

export function observeReviewNotificationTaps(open: (id: string) => void): () => void {
  if (!supported) return () => {};
  const handle = (response: NotificationResponse | null) => {
    if (response?.actionIdentifier !== DEFAULT_ACTION_IDENTIFIER) return;
    const { identifier, content } = response.notification.request;
    if (content.data?.kind !== reminderNotificationKind || handled.has(identifier)) return;
    handled.add(identifier);
    open(identifier);
  };
  const subscription = addNotificationResponseReceivedListener(handle);
  handle(getLastNotificationResponse());
  return () => subscription.remove();
}

export function acknowledgeReviewNotification(id: string | undefined): void {
  if (supported && id && getLastNotificationResponse()?.notification.request.identifier === id) {
    clearLastNotificationResponse();
  }
}
