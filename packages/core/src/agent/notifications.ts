export interface AgentNotificationEvent {
  id: string; source: 'claude' | 'codex'; sessionId: string; turnId?: string; requestId?: string; requestKey?: string;
  at: number; kind: 'complete' | 'confirmation' | 'error' | 'resolved' | 'started'; event: string;
}

/** Self-contained for embedding in the generated hook. Never retain tool/message payloads. */
export function notificationHookEvent(input: Record<string, unknown>, source: string, now: number): Omit<AgentNotificationEvent, 'id'> | null {
  const safe = (value: unknown, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value : undefined;
  const sessionId = safe(input.session_id), turnId = safe(input.turn_id), event = safe(input.hook_event_name, 80), tool = safe(input.tool_name, 80);
  if (!sessionId || !event || !['claude', 'codex'].includes(source) || !Number.isFinite(now)) return null;
  let kind: AgentNotificationEvent['kind'];
  if (event === 'Stop') kind = 'complete';
  else if (event === 'StopFailure' && source === 'claude') kind = 'error';
  else if (event === 'PermissionRequest' || event === 'PreToolUse' && /(^|\.)(AskUserQuestion|request_user_input(?:_async)?|request_permissions)$/.test(tool ?? '')) kind = 'confirmation';
  // PermissionRequest already covers permission_prompt; idle_prompt is not a question.
  else if (event === 'Notification' && source === 'claude' && input.notification_type === 'elicitation_dialog') kind = 'confirmation';
  else if (event === 'PostToolUseFailure' && source === 'claude') { if (input.is_interrupt === true) return null; kind = 'error'; }
  else if (event === 'PostToolUse') {
    const response = input.tool_response;
    kind = response && typeof response === 'object' && (response as Record<string, unknown>).isError === true ? 'error' : 'resolved';
  } else if (['SessionStart', 'UserPromptSubmit'].includes(event)) kind = 'started';
  else if (['Interrupt', 'SessionEnd'].includes(event)) kind = 'resolved';
  else return null;
  const requestKey = `${tool ?? 'request'}:${turnId ?? ''}`.slice(0, 256);
  const requestId = safe(input.tool_use_id) ?? safe(input.tool_call_id) ?? requestKey;
  return { source: source as AgentNotificationEvent['source'], sessionId, at: now, kind, event, ...(turnId ? { turnId } : {}), ...(['confirmation', 'resolved', 'error'].includes(kind) ? { requestId, requestKey } : {}) };
}
