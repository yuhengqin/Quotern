import { useState } from 'react';
import { Button, Checkbox, Description, Label, ListBox, Select } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { SUBSCRIPTION_CHANNELS } from '../../shared/subscription-channels';
import type { QuotaPaceModel, QuotaPreferencePatch } from '../../shared/quota';
import { useQuotaState } from '../hooks/useQuotaState';

export function QuotaSettings() {
  const { t } = useTranslation();
  const { state, error, save } = useQuotaState();
  const [saving, setSaving] = useState(false);
  const apply = async (patch: QuotaPreferencePatch) => { setSaving(true); try { await save(patch); } catch { /* The hook retains and reports the persisted preferences. */ } finally { setSaving(false); } };
  if (!state) return <p role="status" className="text-sm text-muted">{t(error ? 'desktop.quota.readFailed' : 'desktop.quota.loading')}</p>;
  const prefs = state.preferences;
  return <div className="flex flex-col gap-5">
    {(error || state.notice) && <p role="status" className="text-sm text-warning">{t(error ? 'desktop.quota.saveFailed' : 'desktop.quota.noticeGeneric')}</p>}
    <div className="flex flex-col gap-1.5"><p className="text-sm font-medium">{t('desktop.quota.title')}</p><Description>{t('desktop.quota.description')}</Description></div>
    <div className="flex flex-col gap-3">
      {([['thresholdAlerts', 'desktop.quota.thresholdAlerts'], ['resetAlerts', 'desktop.quota.resetAlerts'], ['showSparkline', 'desktop.quota.sparkline']] as const).map(([key, labelKey]) => <Checkbox key={key} isSelected={prefs[key]} isDisabled={saving} onChange={value => void apply({ [key]: value })}>
        <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t(labelKey)}</Checkbox.Content>
      </Checkbox>)}
      <Description>{t('desktop.quota.thresholdHint')}</Description>
    </div>
    <Select className="w-full max-w-xs" value={prefs.paceModel} isDisabled={saving} onChange={value => { if (value) void apply({ paceModel: String(value) as QuotaPaceModel }); }}>
      <Label>{t('desktop.quota.pace')}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover><ListBox>{([['uniform', 'desktop.quota.pace.uniform'], ['workdays', 'desktop.quota.pace.workdays'], ['automatic', 'desktop.quota.pace.automatic']] as const).map(([id, labelKey]) => <ListBox.Item id={id} key={id} textValue={t(labelKey)}><Label>{t(labelKey)}</Label><ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
    </Select>
    <Description>{t('desktop.quota.historyHint')}</Description>
    <div className="flex flex-col gap-1.5"><p className="text-sm font-medium">{t('desktop.quota.channels')}</p><Description>{t('desktop.quota.channelsHint')}</Description></div>
    <div className="flex gap-2">{[true, false].map(enabled => <Button key={String(enabled)} size="sm" variant="secondary" isDisabled={saving} onPress={() => void apply({ channels: Object.fromEntries(SUBSCRIPTION_CHANNELS.map(channel => [channel.id, enabled])) })}>{t(enabled ? 'desktop.quota.enableAll' : 'desktop.quota.disableAll')}</Button>)}</div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{SUBSCRIPTION_CHANNELS.map(channel => <Checkbox key={channel.id} isDisabled={saving} isSelected={prefs.channels[channel.id] !== false} onChange={enabled => void apply({ channels: { [channel.id]: enabled } })}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{channel.label}</Checkbox.Content></Checkbox>)}</div>
  </div>;
}
