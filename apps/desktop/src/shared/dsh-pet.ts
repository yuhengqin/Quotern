export type MergedConfig = Record<string, Record<string, unknown>>;
export type WorkStatusState = 'thinking' | 'working' | 'result' | 'waiting' | 'success' | 'error';
export interface RpcRequest { id: number; method: string; url: string; body?: string }
export interface RpcResponse { status: number; contentType?: string; body?: string; file?: string }
export interface ModelRef { provider: string; model: string }
export interface ProviderPatch { id: string; name: string; baseUrl: string; models: string[]; apiKey?: string }
export interface ModelSettings { providers: Array<Omit<ProviderPatch, 'apiKey'> & { apiKeyConfigured: boolean }>; defaultModel: ModelRef | null }
export interface ModelResult { ok: boolean; text?: string; image?: string; reason?: string; message?: string; provider?: string; model?: string; fallback: boolean }
export interface SourceCapabilities { source: string; states: WorkStatusState[]; reason: string | null; lastEventAt: string | null }
export interface ActivityEvent { id: string; source: string; sessionId: string; turnId?: string; timestamp: string; state: WorkStatusState | null; evidence: string; terminal?: boolean }
export interface DshPetState { enabled: boolean; status: 'disabled' | 'starting' | 'running' | 'error'; error: string | null; config: MergedConfig; models: ModelSettings; quotaSource: string | null; sources: SourceCapabilities[] }
export type DshPetAction =
  | { type: 'set-enabled'; enabled: boolean } | { type: 'retry' }
  | { type: 'read-config' } | { type: 'save-config'; text: string } | { type: 'reset-config' }
  | { type: 'patch-config'; patch: Record<string, unknown> }
  | { type: 'save-provider'; provider: ProviderPatch } | { type: 'remove-provider'; id: string }
  | { type: 'set-default-model'; model: ModelRef | null } | { type: 'set-quota-source'; source: string | null }
  | { type: 'clear-memory'; petId: string } | { type: 'open-directory' }
  | { type: 'request'; method: 'GET' | 'POST'; path: string; body?: string };
export const DSH_PET_GET = 'dsh-pet:get';
export const DSH_PET_ACTION = 'dsh-pet:action';
export const DSH_PET_CHANGED = 'dsh-pet:changed';
