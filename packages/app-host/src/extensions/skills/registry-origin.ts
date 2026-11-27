export const skillRegistries = {
  eduhub: { label: "EduHub", api: "https://eduhub.deeptutor.info", site: "https://eduhub.deeptutor.info" },
  skillhub: { label: "SkillHub", api: "https://api.skillhub.cn", site: "https://skillhub.cn" },
  clawhub: { label: "ClawHub", api: "https://clawhub.ai", site: "https://clawhub.ai" },
} as const;

export type SkillRegistry = keyof typeof skillRegistries;
export const defaultSkillRegistry: SkillRegistry = "eduhub";
export const registrySlugPattern = /^[a-z0-9][a-z0-9-]{0,127}$/;
export const registryPublisherPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;
export const registryVersionPattern = /^\d{1,16}\.\d{1,16}\.\d{1,16}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface RegistryIdentity {
  registry: SkillRegistry;
  publisher: string;
  slug: string;
}

export function registryLocator({ registry, publisher, slug }: RegistryIdentity): string {
  return registry + ":" + publisher + "/" + slug;
}

export function registrySkillUrl({ registry, publisher, slug }: RegistryIdentity): string {
  const prefix = registry === "clawhub" ? "/" + publisher : "";
  return skillRegistries[registry].site + prefix + "/skills/" + slug;
}

export function readRegistryLocator(locator: string): RegistryIdentity | null {
  const parts = /^(eduhub|skillhub|clawhub):([^/]+)\/([^/]+)$/.exec(locator);
  if (!parts || !registryPublisherPattern.test(parts[2]!) || !registrySlugPattern.test(parts[3]!)) return null;
  return { registry: parts[1] as SkillRegistry, publisher: parts[2]!, slug: parts[3]! };
}

export function validRegistryVersion(version: unknown): version is string {
  return typeof version === "string" && version.length <= 128 && registryVersionPattern.test(version);
}
