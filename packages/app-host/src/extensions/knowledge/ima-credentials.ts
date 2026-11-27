export const imaCredentialPrefix = "ima-credentials.";
export const imaRetiredCredentialSetting = "ima-retired-credential-refs";

export type ImaCredentials = { clientId: string; apiKey: string };

export function isImaCredentialRef(value: unknown): value is string {
  return typeof value === "string" && /^ima-credentials\.[\w-]+$/.test(value);
}

export function decodeImaRetiredRefs(raw: string | null): string[] {
  try {
    const rows: unknown = raw && JSON.parse(raw);
    return Array.isArray(rows) ? [...new Set(rows.filter(isImaCredentialRef))] : [];
  } catch {
    return [];
  }
}

export function normalizeImaCredentials(raw: unknown): ImaCredentials | null {
  if (!raw || typeof raw !== "object") return null;
  const { clientId, apiKey } = raw as Partial<ImaCredentials>;
  if (typeof clientId !== "string" || typeof apiKey !== "string") return null;
  const valid = (value: string) => /^[!-~]{1,512}$/.test(value);
  return valid(clientId.trim()) && valid(apiKey.trim()) ? { clientId: clientId.trim(), apiKey: apiKey.trim() } : null;
}

export function decodeImaCredentials(raw: string | null): ImaCredentials | null {
  try { return raw ? normalizeImaCredentials(JSON.parse(raw)) : null; }
  catch { return null; }
}
