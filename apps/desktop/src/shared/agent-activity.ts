export type WorkStatusState = 'thinking' | 'working' | 'result' | 'waiting' | 'success' | 'error';
export interface SourceCapabilities { source: string; states: WorkStatusState[]; reason: string | null; lastEventAt: string | null }
export interface ActivityEvent {
  id: string; source: string; sessionId: string; turnId?: string; timestamp: string;
  state: WorkStatusState | null; evidence: string; terminal?: boolean; task?: string | null; taskOnly?: boolean;
  /** Response completion does not claim verified goal success. */
  notice?: 'complete' | 'confirmation' | 'error'; requestId?: string; resolvedRequestId?: string; resolvedRequestKey?: string; newTurn?: boolean;
}
export interface SessionNavigationTarget { source: 'codex' | 'claude' | 'dsh'; sessionId: string }
export interface SessionNavigation extends SessionNavigationTarget { navigationId: string }
export interface ActivitySubscription {
  subscribe(listener: (event: ActivityEvent) => void): () => void;
  capabilities(): SourceCapabilities[];
}
