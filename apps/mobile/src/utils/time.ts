export function formatRelativeTime(timestampSeconds: number, nowSeconds = Date.now() / 1_000): string {
  const elapsed = Math.max(0, nowSeconds - timestampSeconds);
  if (elapsed < 60) return "刚刚";
  if (elapsed < 3_600) return `${Math.floor(elapsed / 60)} 分钟前`;
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3_600)} 小时前`;

  const timestamp = new Date(timestampSeconds * 1_000);
  const now = new Date(nowSeconds * 1_000);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (timestamp.toDateString() === yesterday.toDateString()) {
    const hours = String(timestamp.getHours()).padStart(2, "0");
    const minutes = String(timestamp.getMinutes()).padStart(2, "0");
    return `昨天 ${hours}:${minutes}`;
  }
  const day = `${timestamp.getMonth() + 1} 月 ${timestamp.getDate()} 日`;
  return timestamp.getFullYear() === now.getFullYear() ? day : `${timestamp.getFullYear()} 年 ${day}`;
}
