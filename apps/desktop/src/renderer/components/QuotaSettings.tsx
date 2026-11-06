import { useEffect, useId, useState } from 'react';
import { Button, Checkbox, Label, ListBox, Select } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { SUBSCRIPTION_CHANNELS } from '../../shared/subscription-channels';
import type { QuotaPaceModel, QuotaPreferencePatch } from '../../shared/quota';
import { useQuotaState } from '../hooks/useQuotaState';
import { SettingsHelpPopover } from './SettingsHelpPopover';

export function QuotaSettings() {
  const { t } = useTranslation();
  const { state, error, save } = useQuotaState();
  const [saving, setSaving] = useState(false);
  const [shortcutIssue, setShortcutIssue] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'shown' | 'requested' | 'failed' | null>(null);
  useEffect(() => {
    let active = true;
    if (state?.preferences.quotaShortcut) void window.tud.quota.isShortcutRegistered().then(registered => { if (active) setShortcutIssue(!registered); }).catch(() => { if (active) setShortcutIssue(true); });
    return () => { active = false; };
  }, [state?.preferences.quotaShortcut]);
  const paceLabelId = useId();
  const paceTriggerId = `${paceLabelId}-trigger`;
  const apply = async (patch: QuotaPreferencePatch) => {
    setSaving(true); setShortcutIssue(false);
    try { await save(patch); }
    catch (cause) { if (String(cause).includes('QUOTA_SHORTCUT_UNAVAILABLE')) setShortcutIssue(true); }
    finally { setSaving(false); }
  };
  const testNotification = async () => {
    setTesting(true); setTestResult(null);
    try { setTestResult(await window.tud.quota.testNotification()); } catch { setTestResult('failed'); }
    finally { setTesting(false); }
  };
  if (!state) return <p role="status" className="text-sm text-muted">{t(error ? 'desktop.quota.readFailed' : 'desktop.quota.loading')}</p>;
  const prefs = state.preferences;
  return <div className="flex flex-col gap-5">
    {(error || state.notice) && !shortcutIssue && <p role="status" className="text-sm text-warning">{t(error ? 'desktop.quota.saveFailed' : 'desktop.quota.noticeGeneric')}</p>}
    <div className="flex items-center gap-1">
      <p className="text-sm font-medium">{t('desktop.quota.title')}</p>
      <SettingsHelpPopover title={t('desktop.quota.title')}>
        <p>{t('desktop.quota.description')}</p>
        <ul className="list-disc space-y-1.5 pl-4">
          <li>{t('desktop.quota.threshold5h')}</li>
          <li>{t('desktop.quota.thresholdLong')}</li>
          <li>{t('desktop.quota.thresholdFrequency')}</li>
        </ul>
        <p className="border-t border-separator pt-3">{t('desktop.quota.deliveryHint')}</p>
      </SettingsHelpPopover>
    </div>
    <div className="flex flex-col gap-3">
      {([['thresholdAlerts', 'desktop.quota.thresholdAlerts'], ['resetAlerts', 'desktop.quota.resetAlerts'], ['serviceAlerts', 'desktop.quota.serviceAlerts'], ['showSparkline', 'desktop.quota.sparkline']] as const).map(([key, labelKey]) => <Checkbox key={key} isSelected={prefs[key] === true} isDisabled={saving} onChange={value => void apply({ [key]: value })}>
        <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t(labelKey)}</Checkbox.Content>
      </Checkbox>)}
    </div>
    <div className="flex flex-col items-start gap-2">
      <Button size="sm" variant="secondary" isDisabled={testing} onPress={() => void testNotification()}>{t(testing ? 'desktop.quota.testing' : 'desktop.quota.testNotification')}</Button>
      {testResult && <p role="status" className={`text-xs ${testResult === 'failed' ? 'text-danger' : 'text-muted'}`}>{t(`desktop.quota.test.${testResult}`)}</p>}
    </div>
    <div className="flex flex-col gap-2">
      <Checkbox isSelected={prefs.quotaShortcut === true} isDisabled={saving} onChange={value => void apply({ quotaShortcut: value })}>
        <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t('desktop.quota.shortcut', { keys: window.tud.platform === 'darwin' ? '⌘⇧U' : 'Ctrl+Shift+U' })}</Checkbox.Content>
      </Checkbox>
      {shortcutIssue && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{t('desktop.quota.shortcutUnavailable')}</p>}
    </div>
    <div className="flex w-full max-w-xs flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <Label id={paceLabelId} htmlFor={paceTriggerId}>{t('desktop.quota.pace')}</Label>
        <SettingsHelpPopover title={t('desktop.quota.pace')}>
          <p>{t('desktop.quota.historyRequirement')}</p>
          <p>{t('desktop.quota.forecastHint')}</p>
          <p>{t('desktop.quota.historyRetention')}</p>
        </SettingsHelpPopover>
      </div>
      <Select aria-labelledby={paceLabelId} className="w-full" value={prefs.paceModel} isDisabled={saving} onChange={value => { if (value) void apply({ paceModel: String(value) as QuotaPaceModel }); }}>
        <Select.Trigger id={paceTriggerId}><Select.Value /><Select.Indicator /></Select.Trigger>
        <Select.Popover><ListBox>{([['uniform', 'desktop.quota.pace.uniform'], ['workdays', 'desktop.quota.pace.workdays'], ['automatic', 'desktop.quota.pace.automatic']] as const).map(([id, labelKey]) => <ListBox.Item id={id} key={id} textValue={t(labelKey)}><Label>{t(labelKey)}</Label><ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
      </Select>
    </div>
    <div className="flex items-center gap-1">
      <p className="text-sm font-medium">{t('desktop.quota.channels')}</p>
      <SettingsHelpPopover title={t('desktop.quota.channels')}>
        <p>{t('desktop.quota.channelsHint')}</p>
      </SettingsHelpPopover>
    </div>
    <div className="flex gap-2">{[true, false].map(enabled => <Button key={String(enabled)} size="sm" variant="secondary" isDisabled={saving} onPress={() => void apply({ channels: Object.fromEntries(SUBSCRIPTION_CHANNELS.map(channel => [channel.id, enabled])) })}>{t(enabled ? 'desktop.quota.enableAll' : 'desktop.quota.disableAll')}</Button>)}</div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{SUBSCRIPTION_CHANNELS.map(channel => <Checkbox key={channel.id} isDisabled={saving} isSelected={prefs.channels[channel.id] !== false} onChange={enabled => void apply({ channels: { [channel.id]: enabled } })}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{channel.label}</Checkbox.Content></Checkbox>)}</div>
  </div>;
}
