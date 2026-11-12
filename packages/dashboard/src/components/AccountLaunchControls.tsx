import { useEffect, useRef, useState } from 'react';
import { Button, Label, Switch } from '@heroui/react';
import { registerMessages } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import type { AccountLaunchView } from 'quotern-core/quota/shared/account-launch';
import type { QuotaProfile } from 'quotern-core/quota/shared/quota';
import { request } from '@/lib/api';
import { HelpPopover } from './HelpPopover';
import { accountBillingMessages } from '../i18n/account-billing-messages';
import '../i18n/quota-experience-messages';
registerMessages(accountBillingMessages);

function messageKey(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('LOCAL_ACTION_ONLY')) return 'account.localOnly';
  if (message.includes('LAUNCH_CONFLICT') || message.includes('LOCAL_ACTION_FORBIDDEN')) return 'account.conflict';
  if (message.includes('CLI_UNAVAILABLE')) return 'account.cliMissing';
  if (message.includes('IDENTITY_REQUIRED')) return 'account.identityRequired';
  if (message.includes('DIRECTORY') || message.includes('PROFILE_UNAVAILABLE')) return 'account.directoryMissing';
  return 'account.failed';
}

export function useAccountLaunch(open: boolean, profiles: QuotaProfile[]) {
  const { t } = useTranslation();
  const [state, setState] = useState<AccountLaunchView | null>(null), [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ profileId?: string; error?: string; text?: string } | null>(null);
  const generation = useRef(0), busy = useRef(false);
  const profileKey = JSON.stringify(profiles);
  const load = async () => {
    const id = ++generation.current;
    try { const next = await request<AccountLaunchView>('/functions/tud-account-launch'); if (generation.current === id) setState(next); }
    catch (cause) { if (generation.current === id) setFeedback({ error: messageKey(cause) }); }
  };
  useEffect(() => { if (open) { setFeedback(null); void load(); } return () => { generation.current++; }; }, [open, profileKey]);
  const action = async (body: Record<string, unknown>, profile?: QuotaProfile) => {
    if (!state || busy.current) return;
    const id = ++generation.current; busy.current = true; setPending(true); setFeedback(null);
    try {
      const next = await request<AccountLaunchView>('/functions/tud-account-launch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Account-Action': state.token }, body: JSON.stringify({ ...body, ...(body.action === 'launch' ? {} : { revision: state.preferences.revision }) }) });
      if (generation.current === id) { setState(next); setFeedback({ profileId: profile?.id, text: t(body.action === 'launch' ? 'account.launched' : 'account.saved', { name: profile?.label ?? '' }) }); }
    } catch (cause) { if (generation.current === id) { setFeedback({ profileId: profile?.id, error: messageKey(cause) }); await load(); } }
    finally { busy.current = false; setPending(false); }
  };
  return { state, pending, feedback, action, reload: load };
}
type Controller = ReturnType<typeof useAccountLaunch>;

export function AccountLaunchControls({ profile, controller, disabled = false }: { profile: QuotaProfile; controller: Controller; disabled?: boolean }) {
  const { t } = useTranslation(), { state, pending, action, feedback } = controller;
  const selected = state?.selected[profile.provider] === profile.id;
  return <div className="mt-3 space-y-2 border-t border-separator pt-2">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" isDisabled={disabled || pending || !state || !profile.enabled} onPress={() => void action({ action: 'launch', provider: profile.provider, profileId: profile.id }, profile)}>{t('account.launch')}<span className="sr-only"> {profile.label}</span></Button>
      {selected && <span className="text-xs text-accent">{t('account.selected')}</span>}
      <Button size="sm" variant="ghost" isDisabled={disabled || pending || !state || !profile.enabled} onPress={() => void action({ action: 'default', provider: profile.provider, profileId: selected ? null : profile.id }, profile)}>{t(selected ? 'account.clear' : 'account.default')}<span className="sr-only"> {profile.label}</span></Button>
    </div>
    {feedback?.profileId === profile.id && <p role={feedback.error ? 'alert' : 'status'} className={`text-xs ${feedback.error ? 'text-danger' : 'text-muted'}`}>{feedback.error ? t(feedback.error) : feedback.text}</p>}
  </div>;
}

export function AccountLaunchSettings({ controller }: { controller: Controller }) {
  const { t, i18n } = useTranslation(), locale = i18n.language, { state, pending, feedback } = controller;
  const last = state?.preferences.lastSwitch;
  return <div className="space-y-3 border-b border-separator pb-4">
    <div className="flex items-center gap-2"><h3 className="text-sm font-medium">{t('account.title')}</h3><HelpPopover title={t('account.title')}><p>{t('usage.profiles.defaultHint')}</p><p>{t('usage.profiles.duplicateHint')}</p><p>{t('account.help')}</p><p>{t('account.autoHelp')}</p></HelpPopover></div>
    {!state && !feedback?.error && <p role="status" className="text-xs text-muted">{t('billing.loading')}</p>}
    <p className="text-xs text-muted">{t('experience.launchScope')}</p>
    {!!state?.unavailableDefaults.length && <p role="status" className="text-xs text-warning">{t('account.unavailable')}</p>}
    <Switch className="flex flex-row items-center gap-3" isSelected={state?.preferences.autoSwitchClaude ?? false} isDisabled={!state || pending || !state.preferences.defaults.claude || state.isolated} onChange={enabled => void controller.action({ action: 'auto-switch', enabled })}>
      <Switch.Control><Switch.Thumb /></Switch.Control><Switch.Content><Label className="text-xs">{t('account.auto')}</Label></Switch.Content>
    </Switch>
    {state && !state.preferences.defaults.claude && <p className="text-xs text-muted">{t('account.needDefault')}</p>}
    {state?.isolated && <p className="text-xs text-muted">{t('account.isolated')}</p>}
    {last?.reason === 'exhausted' && <p className="text-xs text-muted">{t('account.lastSwitch', { time: new Date(last.at * 1000).toLocaleString(locale), from: last.from ?? '—', to: last.to ?? '—' })}</p>}
    {feedback && !feedback.profileId && <div role={feedback.error ? 'alert' : 'status'} className={`flex flex-wrap items-center gap-2 text-xs ${feedback.error ? 'text-danger' : 'text-muted'}`}><span>{feedback.error ? t(feedback.error) : feedback.text}</span>{feedback.error && <Button size="sm" variant="ghost" onPress={() => void controller.reload()}>{t('billing.retry')}</Button>}</div>}
  </div>;
}
