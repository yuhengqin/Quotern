export type MergedConfig = Record<string, Record<string, unknown>>;
export type WorkStatusState = 'thinking' | 'working' | 'result' | 'waiting' | 'success' | 'error';
export interface RpcRequest { id: number; method: string; url: string; body?: string }
export interface RpcResponse { status: number; contentType?: string; body?: string; file?: string }
export interface SourceCapabilities { source: string; states: WorkStatusState[]; reason: string | null; lastEventAt: string | null }
export interface ActivityEvent { id: string; source: string; sessionId: string; turnId?: string; timestamp: string; state: WorkStatusState | null; evidence: string; terminal?: boolean; task?: string | null; taskOnly?: boolean }
export interface SessionNavigationTarget { source: 'codex' | 'claude' | 'dsh'; sessionId: string }
export interface SessionNavigation extends SessionNavigationTarget { navigationId: string }
export interface DshPetState { enabled: boolean; status: 'disabled' | 'starting' | 'running' | 'error'; error: string | null; config: MergedConfig; quotaSource: string | null; sources: SourceCapabilities[] }
export type DshPetAction =
  | { type: 'set-enabled'; enabled: boolean } | { type: 'retry' }
  | { type: 'read-config' } | { type: 'save-config'; text: string } | { type: 'reset-config' }
  | { type: 'patch-config'; patch: Record<string, unknown> }
  | { type: 'patch-pet'; petId: string; patch: Record<string, unknown> }
  | { type: 'set-desktop-visible'; petId: string; visible: boolean }
  | { type: 'set-quota-source'; source: string | null } | { type: 'open-directory' }
  | { type: 'request'; method: 'GET' | 'POST'; path: string; body?: string };
export const DSH_PET_GET = 'dsh-pet:get';
export const DSH_PET_ACTION = 'dsh-pet:action';
export const DSH_PET_CHANGED = 'dsh-pet:changed';
export const DSH_PET_NAVIGATION = 'dsh-pet:navigation';
export const DSH_PET_NAVIGATION_GET = 'dsh-pet:navigation-get';
export const DSH_PET_NAVIGATION_ACK = 'dsh-pet:navigation-ack';
