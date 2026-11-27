import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { LoadingCard, Page } from "../src/components/Shell";
import { useApp } from "../src/context/AppContext";
import { acknowledgeReviewNotification } from "../src/notifications";

export default function ReviewReminder() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { reminders, mastery } = useApp();
  const router = useRouter();
  useEffect(() => {
    let mounted = true;
    void reminders.openNotificationTarget(async (pathId) => (await mastery.startReview(pathId)).session.session_id)
      .then((target) => {
        if (!mounted) return;
        acknowledgeReviewNotification(id);
        if (target.kind === "session") {
          router.replace({ pathname: "/mastery/[pathId]/session/[sessionId]",
            params: { pathId: target.pathId, sessionId: target.sessionId } });
        } else {
          router.replace({ pathname: "/", params: target.notice ? { reminder: "none", noticeId: id ?? String(Date.now()) } : {} });
        }
      }).catch(() => {
        if (!mounted) return;
        acknowledgeReviewNotification(id);
        router.replace({ pathname: "/", params: { reminder: "failed", noticeId: id ?? String(Date.now()) } });
      });
    return () => { mounted = false; };
  }, [id, mastery, reminders, router]);
  return <Page title="复习提醒"><LoadingCard label="正在查看到期复习…" /></Page>;
}
