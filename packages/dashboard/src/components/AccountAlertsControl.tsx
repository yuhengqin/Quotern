import { useState } from 'react';
import { Button, Input, Label, ListBox, Select, TextField } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { QuotaPreferences, QuotaPreferencePatch, QuotaProviderState } from 'quotern-core/quota/shared/quota';
import { FilterSelectPopover } from './FilterMenu';
import { HelpPopover } from './HelpPopover';
import '../i18n/quota-experience-messages';

export function AccountAlertsControl({ provider, preferences, onSave }: { provider: QuotaProviderState; preferences: QuotaPreferences; onSave(patch: QuotaPreferencePatch): Promise<unknown> }) {
  const { t } = useTranslation(), [draft, setDraft] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const account = provider.provenance?.identityVerified && provider.provenance.accountRef;
  if (!account) return null;
  const key = `${provider.providerId ?? provider.id.split('@')[0]}:${account}`, rule = preferences.accountAlerts?.[key];
  const save = async (level: 'standard' | 'critical' | 'custom' | 'off') => {
    if (busy) return;
    const thresholds = (draft ?? rule?.thresholds?.join(', ') ?? '75, 90').split(',').map(value => Number(value.trim()));
    if (level === 'custom' && (thresholds.length > 5 || new Set(thresholds).size !== thresholds.length || thresholds.some(value => !Number.isInteger(value) || value < 1 || value > 99))) { setError('experience.thresholdError'); return; }
    setBusy(true); setError('');
    try { await onSave({ accountAlerts: { [key]: { level, ...(level === 'custom' ? { thresholds: thresholds.sort((a, b) => a - b) } : {}) } } }); setDraft(null); }
    catch { setError('usage.quota.saveFailed'); } finally { setBusy(false); }
  };
  return <div className="space-y-2 border-t border-separator pt-3">
    <div className="flex items-center gap-2"><span className="text-sm font-medium">{t('experience.alerts')}</span><HelpPopover title={t('experience.alerts')}><p>{t('experience.alertHelp')}</p></HelpPopover></div>
    <Select aria-label={t('experience.alerts')} value={rule?.level ?? 'standard'} isDisabled={busy} onChange={value => { if (value) void save(String(value) as 'standard'); }}><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><FilterSelectPopover><ListBox>{(['standard','critical','custom','off'] as const).map(level => <ListBox.Item id={level} key={level} textValue={t(`experience.${level}`)}>{t(`experience.${level}`)}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></FilterSelectPopover></Select>
    {rule?.level === 'custom' && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void save('custom'); }}><TextField className="min-w-0 flex-1" value={draft ?? rule.thresholds?.join(', ') ?? ''} onChange={setDraft} isReadOnly={busy}><Label>{t('experience.thresholds')}</Label><Input maxLength={30} /></TextField><Button type="submit" size="sm" aria-disabled={busy} aria-busy={busy}>{t('experience.save')}</Button></form>}
    {error && <p role="alert" className="text-xs text-danger">{t(error)}</p>}
  </div>;
}
