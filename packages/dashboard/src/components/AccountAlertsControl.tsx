import { useState } from 'react';
import { Button, Input, Label, ListBox, Select, TextField } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import type { QuotaPreferences, QuotaPreferencePatch, QuotaProviderState } from 'quotern-core/quota/shared/quota';
import { FilterSelectPopover } from './FilterMenu';
import { HelpPopover } from './HelpPopover';
import { settingsMessages } from '../i18n/settings-messages';
import '../i18n/quota-experience-messages';

registerMessages(settingsMessages);

type AccountRule = NonNullable<QuotaPreferences['accountAlerts']>[string];
type SavePreferences = (patch: QuotaPreferencePatch) => Promise<unknown>;
const alertLevels = ['standard', 'critical', 'custom', 'off'] as const;

export function AccountAlertsSettings({ providers, preferences, onSave }: { providers: QuotaProviderState[]; preferences: QuotaPreferences; onSave: SavePreferences }) {
  const { t } = useTranslation();
  const accounts = new Map<string, { label: string; accountRef: string }>();
  for (const provider of providers) {
    const account = provider.provenance?.identityVerified && provider.provenance.accountRef;
    if (!account) continue;
    const key = `${provider.providerId ?? provider.id.split('@')[0]}:${account}`;
    if (!accounts.has(key)) accounts.set(key, { label: provider.label, accountRef: account });
  }
  return <section data-account-alerts-settings className="space-y-3">
    <div className="flex items-center gap-2"><h3 className="text-sm font-medium">{t('settings.accountAlerts.title')}</h3><HelpPopover title={t('settings.accountAlerts.title')}><p>{t('experience.alertHelp')}</p></HelpPopover></div>
    {accounts.size === 0 ? <p className="text-sm text-muted">{t('settings.accountAlerts.empty')}</p> : Array.from(accounts, ([key, account]) => {
      const identity = t('usage.profiles.accountId', { id: account.accountRef.slice(0, 8) });
      return <div key={key} className="space-y-2 border-t border-separator pt-3">
        <p className="text-sm">{account.label} · {identity}</p>
        <AccountAlertRule accountKey={key} rule={preferences.accountAlerts?.[key]} onSave={onSave} label={t('settings.accountAlerts.select', { provider: account.label, identity })} />
      </div>;
    })}
  </section>;
}

function AccountAlertRule({ accountKey, rule, onSave, label }: { accountKey: string; rule?: AccountRule; onSave: SavePreferences; label: string }) {
  const { t } = useTranslation(), [draft, setDraft] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (level: AccountRule['level']) => {
    if (busy) return;
    const thresholds = (draft ?? rule?.thresholds?.join(', ') ?? '75, 90').split(',').map(value => Number(value.trim()));
    if (level === 'custom' && (thresholds.length > 5 || new Set(thresholds).size !== thresholds.length || thresholds.some(value => !Number.isInteger(value) || value < 1 || value > 99))) { setError('experience.thresholdError'); return; }
    setBusy(true); setError('');
    try { await onSave({ accountAlerts: { [accountKey]: { level, ...(level === 'custom' ? { thresholds: thresholds.sort((a, b) => a - b) } : {}) } } }); setDraft(null); }
    catch { setError('usage.quota.saveFailed'); } finally { setBusy(false); }
  };
  return <div className="space-y-2">
    <Select aria-label={label} value={rule?.level ?? 'standard'} isDisabled={busy} onChange={value => {
      const level = alertLevels.find(item => item === value);
      if (level) void save(level);
    }}>
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <FilterSelectPopover><ListBox>{alertLevels.map(level => <ListBox.Item id={level} key={level} textValue={t(`experience.${level}`)}>{t(`experience.${level}`)}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></FilterSelectPopover>
    </Select>
    {rule?.level === 'custom' && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void save('custom'); }}><TextField className="min-w-0 flex-1" value={draft ?? rule.thresholds?.join(', ') ?? ''} onChange={setDraft} isReadOnly={busy}><Label>{t('experience.thresholds')}</Label><Input maxLength={30} /></TextField><Button type="submit" size="sm" aria-disabled={busy} aria-busy={busy}>{t('experience.save')}</Button></form>}
    {error && <p role="alert" className="text-xs text-danger">{t(error)}</p>}
  </div>;
}
