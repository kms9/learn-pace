import { getRandomValues, randomUUID } from "expo-crypto";

if (typeof globalThis.crypto?.getRandomValues !== "function") {
  Object.defineProperty(globalThis, "crypto", { value: { getRandomValues, randomUUID }, configurable: true });
}
