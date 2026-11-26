import type { AppStore, DatabaseSnapshot } from "./index.js";

export async function insertSnapshot(tx: AppStore, snapshot: DatabaseSnapshot): Promise<void> {
  for (const { name, value } of snapshot.settings) await tx.writeSetting(name, value);
  for (const { progress, status } of snapshot.learning_progress) await tx.saveWithCas(progress, null, status);
  for (const session of snapshot.sessions) await tx.saveSession(session);
  for (const message of snapshot.messages) await tx.saveMessage(message);
  for (const thread of snapshot.session_threads) await tx.saveThread(thread);
  for (const interaction of snapshot.interactions) await tx.insertInteraction(interaction);
  for (const event of snapshot.domain_events) await tx.appendDomainEvent(event);
}
