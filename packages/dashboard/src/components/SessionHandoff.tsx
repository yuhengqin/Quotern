import { useState } from 'react';
import { Button, Label, TextArea, TextField } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { request } from '@/lib/api';
import { isDemoMode } from '@/lib/demo-runtime';
import { agentAction, type AgentSettingsState } from './AgentIntegrationSettings';

export function SessionHandoff({ source, sessionId }: { source: string; sessionId: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null), [pending, setPending] = useState(false), [feedback, setFeedback] = useState(''), [error, setError] = useState(false);
  if (isDemoMode() || !['claude', 'codex'].includes(source)) return null;
  const run = async (action: 'preview' | 'handoff', value = text) => {
    if (pending) return;
    setPending(true); setError(false); setFeedback('');
    try {
      const state = await request<AgentSettingsState>('/functions/tud-agent');
      const result = await agentAction<{ text: string }>(state.token, { action, source, sessionId, ...(action === 'handoff' ? { text: value } : {}) });
      if (action === 'preview') setText(result.text); else setFeedback(t('agent.saved'));
    } catch { setError(true); } finally { setPending(false); }
  };
  return <details className="border-t border-separator pt-3 text-sm" data-session-handoff><summary className="cursor-pointer font-medium">{t('agent.handoffTitle')}</summary><div className="mt-3 space-y-3">
    <p className="text-muted">{t('agent.handoffHelp')}</p>
    <Button size="sm" variant="secondary" isPending={pending} onPress={() => { void run('preview'); }}>{t('agent.preview')}</Button>
    {text !== null && <><TextField value={text} onChange={setText}><Label>{t('agent.handoffTitle')}</Label><TextArea rows={12} maxLength={8000} className="w-full font-mono text-xs" /></TextField><div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" isPending={pending} onPress={() => { void navigator.clipboard.writeText(text).then(() => setFeedback(t('agent.copied'))).catch(() => setError(true)); }}>{t('agent.copy')}</Button>
      <Button size="sm" isPending={pending} onPress={() => { void run('handoff'); }}>{t('agent.save')}</Button>
      <Button size="sm" variant="tertiary" isPending={pending} onPress={() => { void run('handoff', ''); }}>{t('agent.clear')}</Button>
    </div></>}
    {feedback && <p role="status">{feedback}</p>}{error && <p role="alert" className="text-danger">{t('agent.failed')}</p>}
  </div></details>;
}
