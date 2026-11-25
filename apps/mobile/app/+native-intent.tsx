import { createURL } from "expo-linking";

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  const devLaunch = __DEV__ && /^[\w+.-]+:\/\/expo-development-client(?:[/?]|$)/.test(path);
  if (initial && (path === "/" || path === createURL("/") || devLaunch)) return "/chat";
  return path;
}
