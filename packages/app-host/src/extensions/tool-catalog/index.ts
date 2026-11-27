import type { SkillScope } from "@learn-pace/infra";

export type ToolRef = "list_local_skills" | "load_skill" | "list_skill_files" | "read_skill_file" |
  "mastery_topics" | "mastery_sessions" | "mastery_open_session" | "mastery_new_session" |
  "knowledge_list" | "knowledge_search" | "knowledge_read";

export interface ToolDescriptor {
  name: ToolRef;
  scopes: readonly SkillScope[];
}

const chatScopes = ["lf01", "little_tutor"] as const;
const navigationScope = ["lf01"] as const;
const descriptors: readonly ToolDescriptor[] = [
  { name: "list_local_skills", scopes: chatScopes },
  { name: "load_skill", scopes: chatScopes },
  { name: "list_skill_files", scopes: chatScopes },
  { name: "read_skill_file", scopes: chatScopes },
  { name: "knowledge_list", scopes: chatScopes },
  { name: "knowledge_search", scopes: chatScopes },
  { name: "knowledge_read", scopes: chatScopes },
  { name: "mastery_topics", scopes: navigationScope },
  { name: "mastery_sessions", scopes: navigationScope },
  { name: "mastery_open_session", scopes: navigationScope },
  { name: "mastery_new_session", scopes: navigationScope },
];

export function resolveTrustedTool(name: string, scope?: SkillScope): ToolDescriptor | undefined {
  return descriptors.find((entry) => entry.name === name && (scope === undefined || entry.scopes.includes(scope)));
}
