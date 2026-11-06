import { useEffect, useId, useState } from 'react';
import { Button, Checkbox, Description, FieldError, Input, Label, ListBox, Select, TextField } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { SUBSCRIPTION_CHANNELS } from '../../shared/subscription-channels';
import type { QuotaPaceModel, QuotaPreferencePatch } from '../../shared/quota';
import { useQuotaState } from '../hooks/useQuotaState';
import { quotaShortcutFromKey } from '../lib/quota-shortcut-input';
import { SettingsHelpPopover } from './SettingsHelpPopover';
import { QUOTA_SHORTCUT_ACCELERATOR, normalizeQuotaShortcut, resolveQuotaShortcut } from '../../shared/quota-desktop';

function displayShortcut(value: string): string {
  return (resolveQuotaShortcut(value, window.tud.platform) ?? value).replaceAll('Control', 'Ctrl').replaceAll('Command', 'Cmd')
    .replaceAll('Super', window.tud.platform === 'win32' ? 'Win' : 'Super');
}

export function QuotaSettings() {
  const { t } = useTranslation();
  const { state, error, save } = useQuotaState();
  const [saving, setSaving] = useState(false);
  const [shortcutIssue, setShortcutIssue] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState('');
  const [shortcutError, setShortcutError] = useState<'invalid' | 'unavailable' | 'saveFailed' | null>(null);
  const [shortcutSaved, setShortcutSaved] = useState(false);
  const [saveErrorSource, setSaveErrorSource] = useState<'shortcut' | 'other' | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'shown' | 'requested' | 'failed' | null>(null);
  const savedAccelerator = state?.preferences.quotaShortcutAccelerator ?? QUOTA_SHORTCUT_ACCELERATOR;
  useEffect(() => { setShortcutDraft(displayShortcut(savedAccelerator)); }, [savedAccelerator]);
  useEffect(() => {
    let active = true;
    setShortcutIssue(false);
    if (state?.preferences.quotaShortcut) void window.tud.quota.isShortcutRegistered().then(registered => { if (active) setShortcutIssue(!registered); }).catch(() => { if (active) setShortcutIssue(true); });
    return () => { active = false; };
  }, [state?.preferences.quotaShortcut, savedAccelerator]);
  const paceLabelId = useId();
  const paceTriggerId = `${paceLabelId}-trigger`;
  const editShortcut = (value: string) => {
    setShortcutDraft(value);
    setShortcutError(null);
    setShortcutSaved(false);
  };
  const apply = async (patch: QuotaPreferencePatch) => {
    setSaving(true); setSaveErrorSource('other');
    try { await save(patch); }
    catch { /* useQuotaState presents the persistence failure. */ }
    finally { setSaving(false); }
  };
  const saveShortcut = async (enabled = state?.preferences.quotaShortcut === true) => {
    setShortcutSaved(false); setShortcutError(null);
    const accelerator = normalizeQuotaShortcut(shortcutDraft);
    if (!accelerator || !resolveQuotaShortcut(accelerator, window.tud.platform)) { setShortcutError('invalid'); return; }
    setSaving(true); setSaveErrorSource('shortcut');
    try {
      await save({ quotaShortcut: enabled, quotaShortcutAccelerator: accelerator });
      setShortcutDraft(displayShortcut(accelerator)); setShortcutIssue(false); setShortcutSaved(true);
    } catch (cause) {
      setShortcutError(String(cause).includes('QUOTA_SHORTCUT_UNAVAILABLE') ? 'unavailable'
        : String(cause).includes('QUOTA_SHORTCUT_INVALID') ? 'invalid' : 'saveFailed');
    } finally { setSaving(false); }
  };
  const testNotification = async () => {
    setTesting(true); setTestResult(null);
    try { setTestResult(await window.tud.quota.testNotification()); } catch { setTestResult('failed'); }
    finally { setTesting(false); }
  };
  if (!state) return <p role="status" className="text-sm text-muted">{t(error ? 'desktop.quota.readFailed' : 'desktop.quota.loading')}</p>;
  const prefs = state.preferences;
  const showShortcutActions = shortcutDraft !== displayShortcut(savedAccelerator) || shortcutIssue || shortcutError !== null
    || (saving && saveErrorSource === 'shortcut');
  return <div className="flex flex-col gap-5">
    {(error || state.notice) && (!shortcutError || saveErrorSource !== 'shortcut') && <p role="status" className="text-sm text-warning">{t(error ? 'desktop.quota.saveFailed' : 'desktop.quota.noticeGeneric')}</p>}
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
    {import.meta.env.DEV && <div className="flex flex-col items-start gap-2">
      <Button size="sm" variant="secondary" isDisabled={testing} onPress={() => void testNotification()}>{t(testing ? 'desktop.quota.testing' : 'desktop.quota.testNotification')}</Button>
      {testResult && <p role="status" className={`text-xs ${testResult === 'failed' ? 'text-danger' : 'text-muted'}`}>{t(`desktop.quota.test.${testResult}`)}</p>}
    </div>}
    <TextField
      className="group/shortcut gap-0 border-y border-separator py-2.5"
      value={shortcutDraft}
      isDisabled={saving}
      isInvalid={shortcutError !== null}
      validationBehavior="aria"
      onChange={editShortcut}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Checkbox className="min-w-0" isSelected={prefs.quotaShortcut === true} isDisabled={saving} onChange={value => {
          setShortcutError(null); setShortcutSaved(false);
          if (value) void saveShortcut(true); else void apply({ quotaShortcut: false });
        }}>
          <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t('desktop.quota.shortcut')}</Checkbox.Content>
        </Checkbox>
        <Label className="sr-only">{t('desktop.quota.shortcutKeys')}</Label>
        <Input
          className="ms-auto h-7 w-auto min-w-16 max-w-full field-sizing-content rounded-md border border-muted px-2 py-0 text-center text-xs shadow-none focus:border-accent data-[invalid=true]:border-danger"
          variant="secondary"
          size={16}
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          onKeyDown={event => {
            if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            const accelerator = quotaShortcutFromKey(event.nativeEvent, window.tud.platform);
            if (accelerator) {
              event.preventDefault();
              if (!event.repeat) editShortcut(displayShortcut(accelerator));
            } else if (event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.metaKey) {
              event.preventDefault();
              if (!event.repeat) void saveShortcut();
            }
          }}
        />
      </div>
      <div className={`mt-2 flex-wrap items-center justify-end gap-2 ${showShortcutActions ? 'flex' : 'hidden group-focus-within/shortcut:flex'}`}>
        <Description className="min-w-0 flex-1 basis-48 px-0">{t('desktop.quota.shortcutHint', { keys: displayShortcut(QUOTA_SHORTCUT_ACCELERATOR) })}</Description>
        <Button size="sm" variant="secondary" isDisabled={saving} onPress={() => void saveShortcut()}>{t(saving ? 'desktop.quota.shortcutSaving' : 'desktop.quota.shortcutSave')}</Button>
      </div>
      <div role="status">
        <FieldError className="mt-2">{shortcutError && t(`desktop.quota.shortcutError.${shortcutError}`)}</FieldError>
        {shortcutSaved && <p className="mt-2 text-xs text-muted">{t('desktop.quota.shortcutSaved')}</p>}
        {shortcutIssue && !shortcutError && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t('desktop.quota.shortcutUnavailable')}</p>}
      </div>
    </TextField>
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
