import type { AppStore, Clock, SecretStore, StoredProviderConnection, StoredSourceBinding } from "@learn-pace/infra";
import { restoreGateFor } from "../../restore-gate.js";
import { decodeImaRetiredRefs, imaCredentialPrefix, imaRetiredCredentialSetting,
  isImaCredentialRef, normalizeImaCredentials, type ImaCredentials } from "./ima-credentials.js";
import { ImaProvider } from "./ima-provider.js";
import { ImaTransport } from "./ima-transport.js";
import {
  hasKnowledgeValue, knowledgeFailure, ready, type KnowledgeLibrary, type KnowledgeProvider, type KnowledgeResult,
} from "./provider.js";

export type PublicKnowledgeConnection = Omit<StoredProviderConnection, "credential_ref">;
export type KnowledgeChoice = { bindingId: string; mode: "kb_only" | "kb_assisted" };
type ConnectionInput = ImaCredentials & { connectionId?: string; displayName: string };

export interface AuthorizedKnowledge {
  readonly binding: StoredSourceBinding;
  readonly credentialRef: string;
  readonly restoreVersion: number;
}

const publicConnection = ({ credential_ref: _ref, ...connection }: StoredProviderConnection): PublicKnowledgeConnection => connection;

export class KnowledgeService {
  private readonly gate;
  private readonly client: ImaTransport;
  private readonly provider: ImaProvider;
  private readonly active = new Set<{ connectionId: string; bindingId?: string; controller: AbortController }>();
  private readonly discoveries = new Map<string, { revision: number; ref: string; libraries: Map<string, KnowledgeLibrary> }>();

  constructor(private readonly store: AppStore, private readonly secrets: SecretStore, private readonly clock: Clock,
    private readonly makeId: () => string, private readonly request?: typeof fetch) {
    this.gate = restoreGateFor(store);
    this.client = new ImaTransport(secrets, async (id) => (await store.getProviderConnection(id))?.credential_ref ?? null, request);
    this.provider = new ImaProvider(this.client);
  }

  async listConnections(): Promise<PublicKnowledgeConnection[]> {
    return (await this.store.listProviderConnections()).map(publicConnection);
  }

  listBindings(connectionId?: string): Promise<StoredSourceBinding[]> {
    return this.store.listSourceBindings(connectionId);
  }

  async listAvailableBindings(): Promise<StoredSourceBinding[]> {
    const [connections, bindings] = await Promise.all([this.store.listProviderConnections(), this.store.listSourceBindings()]);
    const readyConnections = new Set<string>();
    await Promise.all(connections.map(async (connection) => {
      if (connection.status === "ready" && await this.client.hasCredentials(connection.connection_id)) readyConnections.add(connection.connection_id);
    }));
    return bindings.filter(binding => binding.enabled && readyConnections.has(binding.connection_id));
  }

  private async retire(tx: AppStore, ref: string | null | undefined): Promise<void> {
    if (!isImaCredentialRef(ref)) return;
    const refs = decodeImaRetiredRefs(await tx.readSetting(imaRetiredCredentialSetting));
    if (!refs.includes(ref)) await tx.writeSetting(imaRetiredCredentialSetting, JSON.stringify([...refs, ref]));
  }

  private async cleanRetired(): Promise<void> {
    await this.gate.write(async () => {
      const refs = decodeImaRetiredRefs(await this.store.readSetting(imaRetiredCredentialSetting));
      const live = new Set((await this.store.listProviderConnections()).map(connection => connection.credential_ref));
      const deleted = new Set<string>();
      for (const ref of refs) {
        if (live.has(ref)) continue;
        try { await this.secrets.deleteItem(ref); deleted.add(ref); } catch { /* 保留失败槽位供下次重试。 */ }
      }
      if (deleted.size) await this.store.runInTransaction(async tx => {
        const current = decodeImaRetiredRefs(await tx.readSetting(imaRetiredCredentialSetting));
        await tx.writeSetting(imaRetiredCredentialSetting, JSON.stringify(current.filter(ref => !deleted.has(ref))));
      });
    }).catch(() => {});
  }

  private invalidate(connectionId: string, bindingId?: string): void {
    if (!bindingId) this.discoveries.delete(connectionId);
    for (const active of this.active) {
      if (active.connectionId === connectionId && (!bindingId || active.bindingId === bindingId)) active.controller.abort();
    }
  }

  invalidateAll(): void {
    this.discoveries.clear();
    for (const active of this.active) active.controller.abort();
  }

  private watch(connectionId: string, signal: AbortSignal, bindingId?: string) {
    const operation = { connectionId, bindingId, controller: new AbortController() };
    this.active.add(operation);
    return {
      signal: AbortSignal.any([signal, operation.controller.signal]),
      close: () => { this.active.delete(operation); },
    };
  }

  async connect(input: ConnectionInput, signal: AbortSignal = new AbortController().signal):
    Promise<KnowledgeResult<PublicKnowledgeConnection & { elapsedMs: number }>> {
    const credentials = normalizeImaCredentials(input);
    const displayName = input.displayName.trim().slice(0, 80);
    if (!credentials || !displayName) return knowledgeFailure("invalid_request");
    const revision = this.gate.revision;
    const id = input.connectionId ?? this.makeId();
    const previous = await this.store.getProviderConnection(id);
    if (input.connectionId && !previous) return knowledgeFailure("not_configured");
    const ref = imaCredentialPrefix + this.makeId();
    if (!isImaCredentialRef(ref)) return knowledgeFailure("invalid_request");
    const pending = this.watch(id, signal);
    let committed = false;
    try {
      if (pending.signal.aborted) return knowledgeFailure("cancelled");
      await this.secrets.setItem(ref, JSON.stringify(credentials));
      const test = new ImaProvider(new ImaTransport(this.secrets, async () => ref, this.request));
      const probe = await test.probe({ connectionId: id, signal: pending.signal });
      if (!hasKnowledgeValue(probe)) return probe;
      const connection = await this.gate.write(() => this.store.runInTransaction(async tx => {
        const current = await tx.getProviderConnection(id);
        if (this.gate.revision !== revision || pending.signal.aborted ||
            current?.credential_ref !== previous?.credential_ref || current?.status !== previous?.status) return null;
        const now = this.clock.nowSeconds();
        const next: StoredProviderConnection = {
          connection_id: id, provider: "ima", status: "ready", display_name: displayName, credential_ref: ref,
          last_error: null, created_at: current?.created_at ?? now, updated_at: now,
        };
        await tx.saveProviderConnection(next);
        await this.retire(tx, current?.credential_ref);
        // 重新配置可能切换账号。逐库确认后才恢复旧绑定的授权。
        for (const binding of await tx.listSourceBindings(id)) {
          if (binding.enabled) await tx.saveSourceBinding({ ...binding, enabled: 0, updated_at: now });
        }
        return next;
      }));
      if (!connection) return knowledgeFailure("cancelled");
      committed = true;
      pending.close();
      this.invalidate(id);
      await this.cleanRetired();
      return ready({ ...publicConnection(connection), elapsedMs: probe.value.elapsedMs });
    } catch {
      return knowledgeFailure(signal.aborted || this.gate.revision !== revision ? "cancelled" : "network_error");
    } finally {
      pending.close();
      if (!committed) await this.secrets.deleteItem(ref).catch(() => {});
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.removeConnection(connectionId, false);
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.removeConnection(connectionId, true);
    await this.cleanRetired();
  }

  private async removeConnection(id: string, remove: boolean): Promise<void> {
    await this.gate.write(() => this.store.runInTransaction(async tx => {
      const connection = await tx.getProviderConnection(id);
      if (!connection) return;
      await this.retire(tx, connection.credential_ref);
      if (remove) await tx.deleteProviderConnection(id);
      else await tx.saveProviderConnection({ ...connection, credential_ref: null, status: "disconnected",
        last_error: null, updated_at: this.clock.nowSeconds() });
    }));
    this.invalidate(id);
  }

  async discover(connectionId: string, query = "", cursor?: string, signal: AbortSignal = new AbortController().signal) {
    const version = this.gate.revision;
    const connection = await this.store.getProviderConnection(connectionId);
    const ref = connection?.credential_ref;
    if (connection?.status !== "ready" || !ref) return knowledgeFailure(connection?.status === "auth_denied" ? "auth_denied" : "not_configured");
    const watched = this.watch(connectionId, signal);
    try {
      const result = await this.provider.discover({ connectionId, signal: watched.signal, query, cursor });
      if (watched.signal.aborted || this.gate.revision !== version ||
          (await this.store.getProviderConnection(connectionId))?.credential_ref !== ref) return knowledgeFailure("cancelled");
      if (hasKnowledgeValue(result)) {
        const previous = this.discoveries.get(connectionId);
        const libraries = previous?.ref === ref && previous.revision === version ? previous.libraries : new Map<string, KnowledgeLibrary>();
        for (const library of result.value.items) libraries.set(library.id, library);
        this.discoveries.set(connectionId, { revision: version, ref, libraries });
      }
      return result;
    } finally {
      watched.close();
    }
  }

  async bind(connectionId: string, libraryId: string): Promise<KnowledgeResult<StoredSourceBinding>> {
    const discovered = this.discoveries.get(connectionId);
    const library = discovered?.libraries.get(libraryId);
    if (!discovered || !library) return knowledgeFailure("invalid_request");
    return this.gate.write(() => this.store.runInTransaction(async tx => {
      const connection = await tx.getProviderConnection(connectionId);
      if (this.gate.revision !== discovered.revision || connection?.status !== "ready" || connection.credential_ref !== discovered.ref) {
        return knowledgeFailure("cancelled");
      }
      const current = (await tx.listSourceBindings(connectionId)).find(item => item.remote_kb_id === libraryId);
      const now = this.clock.nowSeconds();
      const binding: StoredSourceBinding = {
        binding_id: current?.binding_id ?? this.makeId(), remote_kb_id: libraryId, provider: "ima", connection_id: connectionId,
        name: library.name, description: library.description, base_type: library.baseType, role_type: library.roleType,
        writable: 0, enabled: 1, created_at: current?.created_at ?? now, updated_at: now,
      };
      await tx.saveSourceBinding(binding);
      return ready(binding);
    }));
  }

  async unbind(bindingId: string): Promise<void> {
    const binding = await this.gate.write(() => this.store.runInTransaction(async tx => {
      const current = await tx.getSourceBinding(bindingId);
      await tx.deleteSourceBinding(bindingId);
      return current;
    }));
    if (binding) this.invalidate(binding.connection_id, bindingId);
  }

  async authorize(bindingId: string): Promise<KnowledgeResult<AuthorizedKnowledge>> {
    const restoreVersion = this.gate.revision;
    const binding = await this.store.getSourceBinding(bindingId);
    if (!binding?.enabled) return knowledgeFailure("no_matches");
    const connection = await this.store.getProviderConnection(binding.connection_id);
    if (connection?.status === "auth_denied") return knowledgeFailure("auth_denied");
    if (connection?.status !== "ready" || !connection.credential_ref || !(await this.client.hasCredentials(binding.connection_id))) {
      return knowledgeFailure("not_configured");
    }
    const scope: AuthorizedKnowledge = { binding, credentialRef: connection.credential_ref, restoreVersion };
    return await this.current(scope) ? ready(scope) : knowledgeFailure("not_configured");
  }

  async current(scope: AuthorizedKnowledge): Promise<boolean> {
    if (this.gate.revision !== scope.restoreVersion) return false;
    const { binding, credentialRef } = scope;
    const [saved, connection] = await Promise.all([
      this.store.getSourceBinding(binding.binding_id), this.store.getProviderConnection(binding.connection_id),
    ]);
    return Boolean(saved?.enabled && saved.remote_kb_id === binding.remote_kb_id && saved.connection_id === binding.connection_id &&
      connection?.status === "ready" && connection.credential_ref === credentialRef && this.gate.revision === scope.restoreVersion);
  }

  watchAuthorization(scope: AuthorizedKnowledge, signal: AbortSignal) {
    return this.watch(scope.binding.connection_id, signal, scope.binding.binding_id);
  }

  async withSource<T>(scope: AuthorizedKnowledge, signal: AbortSignal,
    action: (provider: KnowledgeProvider, signal: AbortSignal) => Promise<KnowledgeResult<T>>): Promise<KnowledgeResult<T>> {
    const watched = this.watchAuthorization(scope, signal);
    try {
      if (watched.signal.aborted || !(await this.current(scope))) return knowledgeFailure("cancelled");
      const result = await action(this.provider, watched.signal);
      return watched.signal.aborted || !(await this.current(scope)) ? knowledgeFailure("cancelled") : result;
    } finally {
      watched.close();
    }
  }

  async browse(bindingId: string, folderId?: string, cursor?: string, signal: AbortSignal = new AbortController().signal) {
    const authorization = await this.authorize(bindingId);
    if (!hasKnowledgeValue(authorization)) return authorization;
    return this.withSource(authorization.value, signal,
      (provider, signal) => provider.browse({ binding: authorization.value.binding, folderId, cursor, signal }));
  }
}
