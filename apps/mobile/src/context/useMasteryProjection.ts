import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AppState } from "react-native";

export function onForeground(refresh: () => void): () => void {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") refresh();
  });
  return () => subscription.remove();
}

export function useMasteryProjection<T>(read: () => Promise<T>, observe: (refresh: () => void) => () => void) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  const retry = () => { setError(undefined); setAttempt((value) => value + 1); };
  useFocusEffect(useCallback(() => {
    let focused = true;
    let latest = 0;
    function refresh() {
      const request = ++latest;
      void read().then((value) => {
        if (!focused || request !== latest) return;
        setData(value);
        setError(undefined);
      }).catch((cause: unknown) => {
        if (focused && request === latest) setError(cause ?? new Error());
      });
    }
    const stopObserving = observe(refresh);
    const stopForeground = onForeground(refresh);
    refresh();
    return () => { focused = false; stopObserving(); stopForeground(); };
  }, [attempt, observe, read]));
  return { data, error, retry };
}
