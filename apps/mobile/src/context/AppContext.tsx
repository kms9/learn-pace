import { AppBootstrapService, LearningHomeService, type BackupRestoreService, type BootstrapSnapshot, type Lf01ChatService, type MasterySessionService } from "@learn-pace/app-host";
import { systemClock, type Clock } from "@learn-pace/infra";
import { ExpoLearningStore, expoSecretStore } from "@learn-pace/infra/expo";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";
import mobileConfig from "../../app.json";
import { sha256Backup } from "../backup-io";

type AppContextValue = {
  service: AppBootstrapService;
  chat: Lf01ChatService;
  mastery: MasterySessionService;
  learningHome: LearningHomeService;
  backup: BackupRestoreService;
  clock: Clock;
  devClock?: { days: number; setDays: (days: number) => void };
  snapshot: BootstrapSnapshot;
  reload: () => Promise<void>;
  restart: () => void;
  inspectDatabase: () => ReturnType<ExpoLearningStore["inspect"]>;
};

const AppContext = createContext<AppContextValue | null>(null);

let storage: Promise<ExpoLearningStore> | undefined;

function openStorage(): Promise<ExpoLearningStore> {
  return storage ??= ExpoLearningStore.open().catch((error: unknown) => {
    storage = undefined;
    throw error;
  });
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Omit<AppContextValue, "clock" | "devClock" | "restart"> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const offset = useRef(0);
  const [days, setDays] = useState(0);
  const [clock] = useState<Clock>(() => __DEV__
    ? { nowSeconds: () => systemClock.nowSeconds() + offset.current * 86_400 }
    : systemClock);
  const restart = useCallback(() => {
    setData(null);
    setFailed(false);
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function open() {
      const store = await openStorage();
      const service = new AppBootstrapService(store, expoSecretStore, {
        makeId: randomUUID,
        fetch: expoFetch as unknown as typeof globalThis.fetch,
      });
      await service.recoverOnStartup(clock);
      const chat = service.createLf01ChatService(clock);
      const mastery = service.createMasterySessionService(clock);
      const learningHome = new LearningHomeService(store, clock);
      const backup = service.createBackupRestoreService(Constants.expoConfig?.version ?? mobileConfig.expo.version, sha256Backup);
      const snapshot = await service.snapshot();
      if (!mounted) return;
      const reload = async () => {
        const latest = await service.snapshot();
        if (mounted) setData((current) => current?.service === service ? { ...current, snapshot: latest } : current);
      };
      setData({ service, chat, mastery, learningHome, backup, snapshot, reload, inspectDatabase: () => store.inspect() });
    }
    void open().catch(() => {
      if (mounted) setFailed(true);
    });
    return () => { mounted = false; };
  }, [attempt, clock]);

  if (!data) {
    return (
      <View style={styles.loading}>
        {failed ? (
          <>
            <Text style={styles.label}>无法打开本地学习数据</Text>
            <Button title="重试" onPress={restart} />
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.label}>正在读取本地数据</Text>
          </>
        )}
      </View>
    );
  }

  const devClock = __DEV__ ? { days, setDays: (next: number) => { offset.current = next; setDays(next); } } : undefined;
  return <AppContext.Provider value={{ ...data, clock, devClock, restart }}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppProvider is missing");
  return value;
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.background, justifyContent: "center", alignItems: "center", gap: spacing.sm },
  label: { color: colors.text, fontSize: 16 },
});
