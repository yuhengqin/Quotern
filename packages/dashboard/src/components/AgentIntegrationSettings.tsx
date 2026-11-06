import { useEffect, useState } from 'react';
import { Button, Checkbox, Surface } from '@heroui/react';
import type { AgentFeature, AgentPreferences } from 'quotern-core';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import { request } from '@/lib/api';
import { isDemoMode } from '@/lib/demo-runtime';
import { agentMessages } from '../i18n/agent-messages';
registerMessages(agentMessages);

export interface AgentSettingsState { token: string; preferences: AgentPreferences; agents: Record<'claude' | 'codex', { installed: boolean; target: string }>; isolated: boolean }
export function agentAction<T>(token: string, body: Record<string, unknown>): Promise<T> {
  return request<T>('/functions/tud-agent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Agent-Action': token }, body: JSON.stringify(body) });
}
export function AgentIntegrationSettings() {
  const { t } = useTranslation();
  const [state, setState] = useState<AgentSettingsState | null>(null), [pending, setPending] = useState(false), [error, setError] = useState(false), [feedback, setFeedback] = useState('');
  const [plugin, setPlugin] = useState<{ command: string } | null>(null);
  const load = async () => { setError(false); try { setState(await request<AgentSettingsState>('/functions/tud-agent')); } catch { setError(true); } };
  useEffect(() => { if (!isDemoMode()) void load(); }, []);
  if (isDemoMode()) return null;
  const change = async (body: Record<string, unknown>) => {
    if (!state || pending) return;
    setPending(true); setError(false); setFeedback('');
    try { setState(await agentAction<AgentSettingsState>(state.token, body)); setFeedback(t('agent.saved')); } catch { setError(true); } finally { setPending(false); }
  };
  const prepare = async () => {
    if (!state || pending) return; setPending(true); setError(false);
    try { setPlugin(await agentAction(state.token, { action: 'plugin' })); } catch { setError(true); } finally { setPending(false); }
  };
  const check = (key: AgentFeature) => <Checkbox key={key} isSelected={state?.preferences[key] ?? false} isDisabled={!state} isReadOnly={pending} onChange={selected => { void change({ action: 'preferences', patch: { [key]: selected } }); }}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t(`agent.${key}`)}</Checkbox.Content></Checkbox>;
  return <Surface variant="secondary" className="space-y-4 rounded-xl p-4" data-agent-settings>
    <h3 className="font-medium">{t('agent.title')}</h3>
    {!state && !error && <p role="status" className="text-sm text-muted">{t('agent.load')}</p>}
    <div className="flex flex-col gap-3">{(['quotaHints', 'tokenSaver', 'beginner', 'handoff', 'claudePane', 'glossary'] as const).map(check)}</div>
    <details className="text-sm text-muted"><summary className="cursor-pointer">{t('agent.details')}</summary><div className="space-y-2 pt-2"><p>{t('agent.optional')}</p><p>{t('agent.pluginHelp')}</p></div></details>
    <div className="space-y-3 border-t border-separator pt-3"><h4 className="text-sm font-medium">{t('agent.hooks')}</h4>
      {state && (['claude', 'codex'] as const).map(agent => <div key={agent} className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-20">{agent === 'claude' ? 'Claude Code' : 'Codex'}</span><span className="flex-1 text-muted">{t(state.agents[agent].installed ? 'agent.installed' : 'agent.notInstalled')}</span><Button size="sm" variant="secondary" isPending={pending} onPress={() => { void change({ action: 'installation', agent, installed: !state.agents[agent].installed }); }}>{t(state.agents[agent].installed ? 'agent.remove' : 'agent.install')}</Button></div>)}
      <p className="text-xs text-muted">{t('agent.trust')}</p>{state?.isolated && <p className="text-xs text-muted">{t('agent.isolated')}</p>}
      <Button size="sm" variant="secondary" isDisabled={!state} isPending={pending} onPress={() => { void prepare(); }}>{t('agent.preparePlugin')}</Button>
      {plugin && <div className="space-y-2 text-sm"><p>{t('agent.pluginReady')}</p><pre className="whitespace-pre-wrap break-all rounded-lg bg-default p-2 text-xs">{plugin.command}</pre><Button size="sm" variant="tertiary" onPress={() => { void navigator.clipboard.writeText(plugin.command).then(() => setFeedback(t('agent.copied'))).catch(() => setError(true)); }}>{t('agent.copy')}</Button></div>}
    </div>
    <details className="space-y-3 border-t border-separator pt-3 text-sm"><summary className="cursor-pointer">{t('agent.claudeWindowStart')} / Codex</summary><p className="mt-3 text-muted">{t('agent.windowHelp')}</p><div className="mt-3 flex flex-col gap-3">{check('claudeWindowStart')}{check('codexWindowStart')}</div></details>
    {feedback && <p role="status" className="text-sm text-success">{feedback}</p>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger"><span>{t('agent.failed')}</span><Button size="sm" variant="tertiary" onPress={() => { void load(); }}>{t('agent.retry')}</Button></div>}
  </Surface>;
}
