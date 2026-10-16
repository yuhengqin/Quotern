import { useState } from 'react';
import { Button, Input, Label, Modal, TextField } from '@heroui/react';
import type { QuotaPreferencePatch, QuotaPreferences, QuotaProfile } from 'quotern-core/quota/shared/quota';

export function QuotaProfilesManager({ preferences, onSave }: { preferences: QuotaPreferences; onSave(patch: QuotaPreferencePatch): Promise<unknown> }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [provider, setProvider] = useState<QuotaProfile['provider']>('codex'), [label, setLabel] = useState(''), [directory, setDirectory] = useState('');
  const profiles = preferences.profiles ?? [];
  const clear = () => { setEditing(null); setLabel(''); setDirectory(''); };
  const save = async (next: QuotaProfile[]) => {
    setBusy(true); setError(null);
    try { await onSave({ profiles: next }); return true; }
    catch { setError('账号设置保存失败，请检查目录是否为完整路径并稍后重试。'); return false; }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!label.trim() || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(directory.trim())) { setError('填写账号名称和完整的本地配置目录。'); return; }
    const old = profiles.find(item => item.id === editing);
    const next: QuotaProfile = { id: old?.id ?? `profile-${crypto.randomUUID().slice(0, 8)}`, provider, label: label.trim(), directory: directory.trim(), enabled: old?.enabled ?? true, alerts: old?.alerts ?? true };
    if (await save(old ? profiles.map(item => item.id === editing ? next : item) : [...profiles, next])) clear();
  };
  return <>
    <Button size="sm" variant="ghost" className="h-7 text-xs" aria-haspopup="dialog" aria-expanded={open} onPress={() => { setOpen(true); setError(null); }}>账号管理</Button>
    <Modal.Backdrop isOpen={open} onOpenChange={setOpen}><Modal.Container placement="center" scroll="inside"><Modal.Dialog aria-label="管理额度账号" className="w-full max-w-lg">
      <Modal.CloseTrigger aria-label="关闭账号管理" /><Modal.Header><Modal.Heading>额度账号</Modal.Heading></Modal.Header>
      <Modal.Body className="flex flex-col gap-5">
        <p className="text-xs text-muted">默认账号自动读取。可添加已登录的 Codex home 或 Claude 配置目录，分别监控额度与提醒。OMP 账号会从本地额度记录中自动发现。</p>
        <div className="flex flex-col gap-3">
          {profiles.map(profile => <div key={profile.id} className="rounded-xl bg-surface-secondary p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{profile.provider === 'codex' ? 'Codex' : 'Claude'} · {profile.label}</p><div className="flex gap-1"><Button size="sm" variant="ghost" className="h-7 text-xs" isDisabled={busy} onPress={() => { setEditing(profile.id); setProvider(profile.provider); setLabel(profile.label); setDirectory(profile.directory); setError(null); }}>编辑<span className="sr-only"> {profile.label}</span></Button><Button size="sm" variant="ghost" className="h-7 text-xs" isDisabled={busy} onPress={() => void save(profiles.filter(item => item.id !== profile.id)).then(ok => { if (ok && editing === profile.id) clear(); })}>移除<span className="sr-only"> {profile.label}</span></Button></div></div>
            <p className="mt-1 break-all text-[11px] text-muted">{profile.directory}</p>
            <div className="mt-2 flex gap-5 text-xs"><label className="flex items-center gap-2"><input type="checkbox" className="accent-accent" checked={profile.enabled} disabled={busy} onChange={event => void save(profiles.map(item => item.id === profile.id ? { ...item, enabled: event.target.checked } : item))} />监控<span className="sr-only"> {profile.label}</span></label><label className="flex items-center gap-2"><input type="checkbox" className="accent-accent" checked={profile.alerts !== false} disabled={busy} onChange={event => void save(profiles.map(item => item.id === profile.id ? { ...item, alerts: event.target.checked } : item))} />提醒<span className="sr-only"> {profile.label}</span></label></div>
          </div>)}
          {!profiles.length && <p className="text-xs text-muted">尚未添加其他账号</p>}
        </div>
        <form className="flex flex-col gap-3 border-t border-separator pt-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <p className="text-sm font-medium">{editing ? '编辑账号' : '添加账号'}</p>
          <label className="flex flex-col gap-1 text-xs">服务<select aria-label="账号服务" className="rounded-xl border border-separator bg-surface-secondary px-3 py-2 text-sm outline-offset-2 focus-visible:outline-accent" value={provider} disabled={busy} onChange={event => setProvider(event.target.value as QuotaProfile['provider'])}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
          <TextField isRequired isDisabled={busy} value={label} onChange={setLabel}><Label>账号名称</Label><Input placeholder="例如：个人、工作" maxLength={60} /></TextField>
          <TextField isRequired isDisabled={busy} value={directory} onChange={setDirectory}><Label>{provider === 'codex' ? 'Codex home 目录' : 'Claude 配置目录'}</Label><Input placeholder={provider === 'codex' ? 'C:\\Users\\你\\.codex-work' : 'C:\\Users\\你\\.claude-work'} maxLength={2048} /></TextField>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2"><Button type="submit" size="sm" variant="secondary" isDisabled={busy || (!editing && profiles.length >= 20)}>{busy ? '正在保存…' : editing ? '保存修改' : '添加账号'}</Button>{editing && <Button size="sm" variant="ghost" isDisabled={busy} onPress={clear}>取消编辑</Button>}</div>
        </form>
      </Modal.Body>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </>;
}
