import { useEffect, useState } from 'react';
import { Button, Label, ListBox, Select, Surface } from '@heroui/react';
import { registerMessages } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import { notificationMessages } from '../../shared/notification-messages';
import { DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_CATEGORIES, type NotificationPreferencePatch, type NotificationSettingsState, type NotificationSound } from '../../shared/notifications';
import { FilterSelectPopover } from './FilterMenu';
import { SettingsHelpPopover } from './SettingsHelpPopover';
import { agentAction, type AgentSettingsState } from '../../../../../packages/dashboard/src/components/AgentIntegrationSettings';
import { request } from '@/lib/api';

registerMessages(notificationMessages);
type Connections = AgentSettingsState & { agents: Record<'codex' | 'claude', { installed: boolean; notificationsReady?: boolean; target: string }> };

function PreferenceSelect({ label, value, choices, disabled, onChange }: { label: string; value: string; choices: { id: string; label: string }[]; disabled: boolean; onChange(value: string): void }) {
  return <Select aria-label={label} selectedKey={value} onSelectionChange={key => { if (typeof key === 'string' && choices.some(choice => choice.id === key)) onChange(key); }} isDisabled={disabled} variant="secondary" className="w-full sm:max-w-60">
    <Label>{label}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
    <FilterSelectPopover><ListBox>{choices.map(choice => <ListBox.Item key={choice.id} id={choice.id} textValue={choice.label}><Label>{choice.label}</Label><ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></FilterSelectPopover>
  </Select>;
}

export function NotificationSettings() {
  const { t } = useTranslation();
  const [state, setState] = useState<NotificationSettingsState | null>(null);
  const [agents, setAgents] = useState<Connections | null>(null);
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState(false), [connectionError, setConnectionError] = useState(false), [feedback, setFeedback] = useState('');
  const load = async () => { setError(false); try { setState(await window.tud.notifications.getState()); } catch { setError(true); } };
  const loadAgents = async () => { setConnectionError(false); try { setAgents(await request<Connections>('/functions/tud-agent')); } catch { setConnectionError(true); } };
  useEffect(() => {
    let active = true;
    void window.tud.notifications.getState().then(value => { if (active) setState(value); }).catch(() => { if (active) setError(true); });
    void request<Connections>('/functions/tud-agent').then(value => { if (active) setAgents(value); }).catch(() => { if (active) setConnectionError(true); });
    const unsubscribe = window.tud.notifications.onChanged(value => { if (active) setState(value); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const apply = async (patch: NotificationPreferencePatch) => {
    if (pending) return; setPending('save'); setError(false); setFeedback('');
    try { setState(await window.tud.notifications.setPreferences(patch)); } catch { setError(true); } finally { setPending(null); }
  };
  const test = async () => {
    if (pending) return; setPending('test'); setError(false); setFeedback('');
    try { const result = await window.tud.notifications.test(); if (result === 'suppressed') throw new Error('suppressed'); setFeedback(t(`notifications.${result}`)); } catch { setError(true); } finally { setPending(null); }
  };
  const preview = async () => {
    if (!state || pending) return; setPending('sound'); setError(false); setFeedback('');
    try { await window.tud.notifications.previewSound(state.preferences.sound); } catch { setError(true); } finally { setPending(null); }
  };
  const connect = async (agent: 'claude' | 'codex') => {
    if (!agents || pending) return; setPending(agent); setConnectionError(false);
    try {
      const installed = await agentAction<Connections>(agents.token, { action: 'installation', agent, installed: true });
      setAgents(await agentAction<Connections>(installed.token, { action: 'preferences', patch: { desktopNotifications: true } }));
    } catch { setConnectionError(true); } finally { setPending(null); }
  };
  const modes = ['off', 'background', 'always'].map(id => ({ id, label: t(`notifications.${id}`) }));
  const sounds = ['none', 'soft', 'bell'].map(id => ({ id, label: t(`notifications.${id}`) }));
  const disabled = !state || pending !== null;
  return <div className="space-y-5" data-notification-settings>
    {!state && !error && <p role="status" className="text-sm text-muted">{t('agent.load')}</p>}
    {state && <>
      <Surface variant="secondary" className="space-y-4 rounded-xl p-4">
        <div className="flex items-center gap-1"><h3 className="font-medium">{t('notifications.title')}</h3><SettingsHelpPopover title={t('notifications.title')}><p>{t('notifications.policyHelp')}</p></SettingsHelpPopover></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{NOTIFICATION_CATEGORIES.map(category => <PreferenceSelect key={category} label={t(`notifications.${category}`)} value={state.preferences.modes[category]} choices={modes} disabled={disabled} onChange={mode => void apply({ modes: { [category]: mode } } as NotificationPreferencePatch)} />)}</div>
      </Surface>
      <Surface variant="secondary" className="space-y-4 rounded-xl p-4">
        <div className="flex flex-wrap items-end gap-3"><PreferenceSelect label={t('notifications.sound')} value={state.preferences.sound} choices={sounds} disabled={disabled} onChange={sound => void apply({ sound: sound as NotificationSound })} /><Button variant="secondary" size="sm" isDisabled={disabled || state.preferences.sound === 'none'} isPending={pending === 'sound'} onPress={() => void preview()}>{t('notifications.preview')}</Button></div>
        <Button variant="secondary" size="sm" isDisabled={disabled || !state.supported} isPending={pending === 'test'} onPress={() => void test()}>{t('notifications.test')}</Button>
        {!state.supported && <p role="status" className="text-sm text-muted">{t('notifications.unsupported')}</p>}
        {feedback && <p role="status" className="text-sm text-success">{feedback}</p>}
      </Surface>
      {state.issue && <div role="alert" className="space-y-2 text-sm text-danger"><p>{t(`notifications.${state.issue === 'load' ? 'loadIssue' : state.issue === 'sound' ? 'soundIssue' : 'deliveryIssue'}`)}</p>{state.issue === 'load' && <Button variant="secondary" size="sm" isDisabled={disabled} onPress={() => void apply(DEFAULT_NOTIFICATION_PREFERENCES)}>{t('notifications.restore')}</Button>}</div>}
    </>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger"><p>{t('notifications.failed')}</p>{!state && <Button size="sm" variant="tertiary" onPress={() => void load()}>{t('notifications.retry')}</Button>}</div>}
    <Surface variant="secondary" className="space-y-3 rounded-xl p-4">
      <div className="flex items-center gap-1"><h3 className="font-medium">{t('notifications.connections')}</h3><SettingsHelpPopover title={t('notifications.connections')}><p>{t('notifications.connectionHelp')}</p></SettingsHelpPopover></div>
      {(['codex', 'claude'] as const).map(agent => { const connected = agents?.preferences.desktopNotifications && agents.agents[agent].notificationsReady; return <div key={agent} className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-24">{agent === 'codex' ? 'Codex' : 'Claude Code'}</span><span className="flex-1 text-muted">{t(connected ? 'notifications.connected' : 'notifications.notConnected')}</span><Button size="sm" variant="secondary" aria-label={`${t(connected ? 'notifications.update' : 'notifications.connect')} ${agent === 'codex' ? 'Codex' : 'Claude Code'}`} isDisabled={!agents || !!agents.isolated || pending !== null} isPending={pending === agent} onPress={() => void connect(agent)}>{t(connected ? 'notifications.update' : 'notifications.connect')}</Button></div>; })}
      {agents?.isolated && <p className="text-xs text-muted">{t('notifications.isolated')}</p>}
      {connectionError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger"><p>{t('notifications.failed')}</p><Button size="sm" variant="tertiary" isDisabled={pending !== null} onPress={() => void loadAgents()}>{t('notifications.retry')}</Button></div>}
    </Surface>
  </div>;
}
