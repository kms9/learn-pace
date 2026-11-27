import { fetch as expoFetch } from "expo/fetch";

export async function importUsbConfiguration(code: string): Promise<Record<string, string | undefined>> {
  if (!__DEV__) throw new Error("USB import requires a development build");
  const response = await expoFetch("http://127.0.0.1:18765/config", {
    method: "POST",
    headers: { "X-Learn-Pace-Pairing": code },
  });
  if (!response.ok) throw new Error("USB import was refused");
  return await response.json() as Record<string, string | undefined>;
}
