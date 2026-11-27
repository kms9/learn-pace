import type { AppStore, DatabaseSnapshot } from "./index.js";

export async function insertSnapshot(tx: AppStore, snapshot: DatabaseSnapshot): Promise<void> {
  for (const { name, value } of snapshot.settings) await tx.writeSetting(name, value);
  for (const { progress, status } of snapshot.learning_progress) await tx.saveWithCas(progress, null, status);
  for (const session of snapshot.sessions) await tx.saveSession(session);
  for (const message of snapshot.messages) await tx.saveMessage(message);
  for (const thread of snapshot.session_threads) await tx.saveThread(thread);
  for (const interaction of snapshot.interactions) await tx.insertInteraction(interaction);
  for (const event of snapshot.domain_events) await tx.appendDomainEvent(event);
  for (const card of snapshot.knowledge_cards) await tx.saveKnowledgeCard(card);
  for (const skill of snapshot.skills) await tx.saveSkill(skill);
  for (const revision of snapshot.skill_revisions) await tx.saveSkillRevision(revision);
  for (const binding of snapshot.skill_bindings) await tx.saveSkillBinding(binding);
  for (const connection of snapshot.provider_connections) await tx.saveProviderConnection(connection);
  for (const binding of snapshot.source_bindings) await tx.saveSourceBinding(binding);
}
