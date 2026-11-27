import { createURL } from "expo-linking";

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  if (path === "learnpace://review-reminder" || path === "learnpace:///review-reminder") return "/review-reminder";
  const devLaunch = __DEV__ && /^[\w+.-]+:\/\/expo-development-client(?:[/?]|$)/.test(path);
  if (initial && (path === "/" || path === createURL("/") || devLaunch)) return "/chat";
  return path;
}
