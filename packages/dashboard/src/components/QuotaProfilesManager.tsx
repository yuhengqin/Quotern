import { useState } from 'react';
import { Button, Input, Label, Modal, TextField } from '@heroui/react';
import type { QuotaPreferencePatch, QuotaPreferences, QuotaProfile, QuotaProviderState } from 'quotern-core/quota/shared/quota';

export function QuotaProfilesManager({ preferences, providers, onSave }: { preferences: QuotaPreferences; providers: QuotaProviderState[]; onSave(patch: QuotaPreferencePatch): Promise<unknown> }) {
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
      setError(message.includes('QUOTA_DEFAULT_DIRECTORY') ? '默认目录已自动监控，无需重复添加。' : message.includes('QUOTA_DUPLICATE_DIRECTORY') ? '这个目录已经添加，请编辑已有条目。' : '监控目录保存失败，请检查完整路径并稍后重试。');
      return false;
    }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!label.trim() || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(directory.trim())) { setError('填写目录备注和完整的本地配置目录。'); return; }
    const old = profiles.find(item => item.id === editing);
    const next: QuotaProfile = { id: old?.id ?? `profile-${crypto.randomUUID().slice(0, 8)}`, provider, label: label.trim(), directory: directory.trim(), enabled: old?.enabled ?? true, alerts: old?.alerts ?? true };
    if (await save(old ? profiles.map(item => item.id === editing ? next : item) : [...profiles, next])) clear();
  };
  return <>
    <Button size="sm" variant="ghost" className="h-7 text-xs" aria-haspopup="dialog" aria-expanded={open} onPress={() => { setOpen(true); setError(null); }}>监控目录</Button>
    <Modal.Backdrop isOpen={open} onOpenChange={setOpen}><Modal.Container placement="center" scroll="inside"><Modal.Dialog aria-label="额度监控目录" className="w-full max-w-lg">
      <Modal.CloseTrigger aria-label="关闭监控目录" /><Modal.Header><Modal.Heading>额度监控目录</Modal.Heading></Modal.Header>
      <Modal.Body className="flex flex-col gap-5">
        <p className="text-xs text-muted">默认目录自动读取。多个账号需要分别在独立的 Codex home 或 Claude 配置目录中完成登录，再添加到这里监控。此处只读取登录状态与额度，不执行登录或切换账号。</p>
        <p className="text-xs text-muted">同一目录切换登录后，后续读数会跟随当前账号。不同目录识别到同一账号时，成功读取的额度卡片合并展示；OMP 来源会自动发现。</p>
        <div className="flex flex-col gap-3">
          {profiles.map(profile => <div key={profile.id} className="rounded-xl bg-surface-secondary p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{profile.provider === 'codex' ? 'Codex' : 'Claude'} · {profile.label}</p><div className="flex gap-1"><Button size="sm" variant="ghost" className="h-7 text-xs" isDisabled={busy} onPress={() => { setEditing(profile.id); setProvider(profile.provider); setLabel(profile.label); setDirectory(profile.directory); setError(null); }}>编辑<span className="sr-only"> {profile.label}</span></Button><Button size="sm" variant="ghost" className="h-7 text-xs" isDisabled={busy} onPress={() => void save(profiles.filter(item => item.id !== profile.id)).then(ok => { if (ok && editing === profile.id) clear(); })}>移除<span className="sr-only"> {profile.label}</span></Button></div></div>
            <p className="mt-1 break-all text-[11px] text-muted">{profile.directory}</p>
            <ProfileIdentity profile={profile} providers={providers} />
            <div className="mt-2 flex gap-5 text-xs"><label className="flex items-center gap-2"><input type="checkbox" className="accent-accent" checked={profile.enabled} disabled={busy} onChange={event => void save(profiles.map(item => item.id === profile.id ? { ...item, enabled: event.target.checked } : item))} />监控<span className="sr-only"> {profile.label}</span></label><label className="flex items-center gap-2"><input type="checkbox" className="accent-accent" checked={profile.alerts !== false} disabled={busy} onChange={event => void save(profiles.map(item => item.id === profile.id ? { ...item, alerts: event.target.checked } : item))} />提醒<span className="sr-only"> {profile.label}</span></label></div>
          </div>)}
          {!profiles.length && <p className="text-xs text-muted">尚未添加其他监控目录</p>}
        </div>
        <form className="flex flex-col gap-3 border-t border-separator pt-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <p className="text-sm font-medium">{editing ? '编辑目录' : '添加已登录目录'}</p>
          <label className="flex flex-col gap-1 text-xs">服务<select aria-label="目录服务" className="rounded-xl border border-separator bg-surface-secondary px-3 py-2 text-sm outline-offset-2 focus-visible:outline-accent" value={provider} disabled={busy} onChange={event => setProvider(event.target.value as QuotaProfile['provider'])}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
          <TextField isRequired isDisabled={busy} value={label} onChange={setLabel}><Label>目录备注</Label><Input placeholder="例如：个人、工作" maxLength={60} /></TextField>
          <TextField isRequired isDisabled={busy} value={directory} onChange={setDirectory}><Label>{provider === 'codex' ? 'Codex home 目录' : 'Claude 配置目录'}</Label><Input placeholder={provider === 'codex' ? 'C:\\Users\\你\\.codex-work' : 'C:\\Users\\你\\.claude-work'} maxLength={2048} /></TextField>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2"><Button type="submit" size="sm" variant="secondary" isDisabled={busy || (!editing && profiles.length >= 20)}>{busy ? '正在保存…' : editing ? '保存修改' : '添加目录'}</Button>{editing && <Button size="sm" variant="ghost" isDisabled={busy} onPress={clear}>取消编辑</Button>}</div>
        </form>
      </Modal.Body>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </>;
}

function ProfileIdentity({ profile, providers }: { profile: QuotaProfile; providers: QuotaProviderState[] }) {
  const state = providers.find(row => row.id === `${profile.provider}@${profile.id}`);
  const reference = state?.provenance?.identityVerified ? state.provenance.accountRef : undefined;
  const duplicates = reference ? providers.filter(row => row.id !== state?.id && (row.providerId ?? row.id) === profile.provider && row.provenance?.identityVerified && row.provenance.accountRef === reference) : [];
  const status = !profile.enabled ? '已暂停监控' : !state ? '等待首次读取' : state.status === 'ready' ? state.stale ? '读数较早' : '读取正常' : state.status === 'expired' ? '登录已过期' : state.status === 'not-configured' ? '未发现登录信息' : '暂时无法读取';
  return <div className="mt-2 text-[11px] text-muted"><p>{status} · {reference ? `账号标识 ${reference.slice(0, 8)}` : '账号身份未确认'}</p>{duplicates.length > 0 && <p className="mt-1 text-warning">与{duplicates.map(row => row.profileLabel ?? (row.provenance?.source === 'omp' ? 'OMP 来源' : '默认目录')).join('、')}识别为同一账号。</p>}</div>;
}
