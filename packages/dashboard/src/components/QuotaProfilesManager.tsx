import { useState } from 'react';
import { Button, Input, Label, Modal, TextField } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { QuotaPreferencePatch, QuotaPreferences, QuotaProfile, QuotaProviderState } from 'quotern-core/quota/shared/quota';

export function QuotaProfilesManager({ preferences, providers, onSave }: { preferences: QuotaPreferences; providers: QuotaProviderState[]; onSave(patch: QuotaPreferencePatch): Promise<unknown> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [provider, setProvider] = useState<QuotaProfile['provider']>('codex'), [label, setLabel] = useState(''), [directory, setDirectory] = useState('');
  const profiles = preferences.profiles ?? [];
  const clear = () => { setEditing(null); setLabel(''); setDirectory(''); };
  const save = async (next: QuotaProfile[]) => {
    setBusy(true); setError(null);
    try { await onSave({ profiles: next }); return true; }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(message.includes('QUOTA_DEFAULT_DIRECTORY') ? 'usage.profiles.errorDefault' : message.includes('QUOTA_DUPLICATE_DIRECTORY') ? 'usage.profiles.errorDuplicate' : 'usage.profiles.errorSave');
      return false;
    }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!label.trim() || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(directory.trim())) { setError('usage.profiles.errorInput'); return; }
    const old = profiles.find(item => item.id === editing);
    const next: QuotaProfile = { id: old?.id ?? `profile-${crypto.randomUUID().slice(0, 8)}`, provider, label: label.trim(), directory: directory.trim(), enabled: old?.enabled ?? true, alerts: old?.alerts ?? true };
    if (await save(old ? profiles.map(item => item.id === editing ? next : item) : [...profiles, next])) clear();
  };
  return <>
    <Button size="sm" variant="ghost" className="h-7 text-xs" aria-haspopup="dialog" aria-expanded={open} onPress={() => { setOpen(true); setError(null); }}>{t('usage.profiles.open')}</Button>
    <Modal.Backdrop isOpen={open} onOpenChange={setOpen}><Modal.Container placement="center" scroll="inside"><Modal.Dialog aria-label={t('usage.profiles.title')} className="w-full max-w-lg">
      <Modal.CloseTrigger aria-label={t('usage.quota.closeDetails')} /><Modal.Header><Modal.Heading>{t('usage.profiles.title')}</Modal.Heading></Modal.Header>
      <Modal.Body className="flex flex-col gap-5">
        <p className="text-xs text-muted">{t('usage.profiles.defaultHint')}</p>
        <p className="text-xs text-muted">{t('usage.profiles.duplicateHint')}</p>
        <div className="flex flex-col gap-3">
          {profiles.map(profile => <div key={profile.id} className="rounded-xl bg-surface-secondary p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{profile.provider === 'codex' ? 'Codex' : 'Claude'} · {profile.label}</p><div className="flex gap-1"><Button size="sm" variant="ghost" className="h-7 text-xs" isDisabled={busy} onPress={() => { setEditing(profile.id); setProvider(profile.provider); setLabel(profile.label); setDirectory(profile.directory); setError(null); }}>{t('usage.profiles.edit')}<span className="sr-only"> {profile.label}</span></Button><Button size="sm" variant="ghost" className="h-7 text-xs" isDisabled={busy} onPress={() => void save(profiles.filter(item => item.id !== profile.id)).then(ok => { if (ok && editing === profile.id) clear(); })}>{t('usage.profiles.remove')}<span className="sr-only"> {profile.label}</span></Button></div></div>
            <p className="mt-1 break-all text-[11px] text-muted">{profile.directory}</p>
            <ProfileIdentity profile={profile} providers={providers} />
            <div className="mt-2 flex gap-5 text-xs"><label className="flex items-center gap-2"><input type="checkbox" className="accent-accent" checked={profile.enabled} disabled={busy} onChange={event => void save(profiles.map(item => item.id === profile.id ? { ...item, enabled: event.target.checked } : item))} />{t('usage.profiles.monitor')}<span className="sr-only"> {profile.label}</span></label><label className="flex items-center gap-2"><input type="checkbox" className="accent-accent" checked={profile.alerts !== false} disabled={busy} onChange={event => void save(profiles.map(item => item.id === profile.id ? { ...item, alerts: event.target.checked } : item))} />{t('usage.profiles.alerts')}<span className="sr-only"> {profile.label}</span></label></div>
          </div>)}
          {!profiles.length && <p className="text-xs text-muted">{t('usage.profiles.empty')}</p>}
        </div>
        <form className="flex flex-col gap-3 border-t border-separator pt-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <p className="text-sm font-medium">{t(editing ? 'usage.profiles.editFolder' : 'usage.profiles.addSignedIn')}</p>
          <label className="flex flex-col gap-1 text-xs">{t('usage.profiles.service')}<select aria-label={t('usage.profiles.folderService')} className="rounded-xl border border-separator bg-surface-secondary px-3 py-2 text-sm outline-offset-2 focus-visible:outline-accent" value={provider} disabled={busy} onChange={event => setProvider(event.target.value as QuotaProfile['provider'])}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
          <TextField isRequired isDisabled={busy} value={label} onChange={setLabel}><Label>{t('usage.profiles.label')}</Label><Input placeholder={t('usage.profiles.labelExample')} maxLength={60} /></TextField>
          <TextField isRequired isDisabled={busy} value={directory} onChange={setDirectory}><Label>{t(provider === 'codex' ? 'usage.profiles.codexHome' : 'usage.profiles.claudeConfig')}</Label><Input placeholder={t('usage.profiles.pathExample')} maxLength={2048} /></TextField>
          {error && <p role="alert" className="text-xs text-danger">{t(error)}</p>}
          <div className="flex gap-2"><Button type="submit" size="sm" variant="secondary" isDisabled={busy || (!editing && profiles.length >= 20)}>{t(busy ? 'usage.profiles.saving' : editing ? 'usage.profiles.save' : 'usage.profiles.add')}</Button>{editing && <Button size="sm" variant="ghost" isDisabled={busy} onPress={clear}>{t('usage.profiles.cancel')}</Button>}</div>
        </form>
      </Modal.Body>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </>;
}

function ProfileIdentity({ profile, providers }: { profile: QuotaProfile; providers: QuotaProviderState[] }) {
  const { t } = useTranslation();
  const state = providers.find(row => row.id === `${profile.provider}@${profile.id}`);
  const reference = state?.provenance?.identityVerified ? state.provenance.accountRef : undefined;
  const duplicates = reference ? providers.filter(row => row.id !== state?.id && (row.providerId ?? row.id) === profile.provider && row.provenance?.identityVerified && row.provenance.accountRef === reference) : [];
  const status = !profile.enabled ? 'usage.profiles.paused' : !state ? 'usage.profiles.waiting' : state.status === 'ready' ? state.stale ? 'usage.profiles.old' : 'usage.profiles.ready' : state.status === 'expired' ? 'usage.profiles.expired' : state.status === 'not-configured' ? 'usage.profiles.notConfigured' : 'usage.profiles.unavailable';
  return <div className="mt-2 text-[11px] text-muted"><p>{t(status)} · {reference ? t('usage.profiles.accountId', { id: reference.slice(0, 8) }) : t('usage.profiles.identityUnknown')}</p>{duplicates.length > 0 && <p className="mt-1 text-warning">{t('usage.profiles.sameAccount', { folders: duplicates.map(row => row.profileLabel ?? t(row.provenance?.source === 'omp' ? 'usage.profiles.ompSource' : 'usage.profiles.defaultFolder')).join('、') })}</p>}</div>;
}
