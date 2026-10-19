import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Button, Switch } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { DshPetAction, DshPetState, ModelRef, ProviderPatch } from '../../shared/dsh-pet';
import type { QuotaState } from '../../shared/quota';

type Item = Record<string, unknown>;
type ActionSource = DshPetAction | ((state: DshPetState) => DshPetAction);
const inputClass = 'w-full min-w-0 rounded-lg border border-default-200 bg-content1 px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const obj = (value: unknown): Item => value && typeof value === 'object' ? value as Item : {};
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1 text-xs text-muted">{label}{children}</label>; }
function Group({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) { return <details open={open || undefined} className="rounded-lg border border-default-200 p-3"><summary className="cursor-pointer text-sm font-medium text-foreground">{title}</summary><div className="mt-3 space-y-3">{children}</div></details>; }
type SavedFieldProps = { value: string | number; revision: number; onSave: (value: string) => Promise<unknown> };
function useSavedDraft({ value, revision, onSave }: SavedFieldProps) {
  const incoming = String(value), [draft, setDraft] = useState(incoming);
  const [acknowledged, setAcknowledged] = useState(0);
  const current = useRef(incoming), dirty = useRef(false), editGeneration = useRef(0), previousRevision = useRef(revision);
  useEffect(() => {
    const force = previousRevision.current !== revision;
    previousRevision.current = revision;
    // An older blur acknowledgement must not replace a newer local edit.
    // Explicit JSONC saves and resets deliberately refresh all fields.
    if (force || !dirty.current) {
      if (force) editGeneration.current++;
      dirty.current = false; current.current = incoming; setDraft(incoming);
    }
  }, [incoming, revision, acknowledged]);
  return {
    value: draft,
    onChange: (event: { target: { value: string } }) => { current.current = event.target.value; dirty.current = true; editGeneration.current++; setDraft(event.target.value); },
    onBlur: () => {
      if (!dirty.current) return;
      const savedGeneration = editGeneration.current;
      void onSave(current.current).then(result => {
        if (result !== undefined && savedGeneration === editGeneration.current) { dirty.current = false; setAcknowledged(value => value + 1); }
      });
    },
  };
}
function SavedInput({ value, revision, onSave, ...props }: SavedFieldProps & Omit<ComponentProps<'input'>, 'value' | 'defaultValue' | 'onChange' | 'onBlur'>) {
  return <input {...props} {...useSavedDraft({ value, revision, onSave })} />;
}
function SavedTextarea({ value, revision, onSave, ...props }: SavedFieldProps & Omit<ComponentProps<'textarea'>, 'value' | 'defaultValue' | 'onChange' | 'onBlur'>) {
  return <textarea {...props} {...useSavedDraft({ value, revision, onSave })} />;
}
export function DshPetSettingsCard() {
  const { t } = useTranslation(); const text = (key: string) => t(`desktop.dshPet.${key}`);
  const [state, setState] = useState<DshPetState | null>(null), [quota, setQuota] = useState<QuotaState | null>(null);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(''), [failed, setFailed] = useState(false);
  const [raw, setRaw] = useState(''), [selected, setSelected] = useState('main'), [chat, setChat] = useState(''), [animation, setAnimation] = useState('');
  const [provider, setProvider] = useState<ProviderPatch>({ id: '', name: '', baseUrl: '', models: [] }), [key, setKey] = useState('');
  const [configRevision, setConfigRevision] = useState(0);
  const [pending, setPending] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve()), foreground = useRef(0);
  useEffect(() => { let live = true; const off = window.tud.dshPet.onState(next => { if (live) setState(next); }); const offQuota = window.tud.quota.onChanged(next => { if (live) setQuota(next); }); void window.tud.dshPet.getState().then(next => { if (live) setState(next); }).catch(() => { if (live) { setFailed(true); setFeedback(text('unavailable')); } }); void window.tud.quota.getState().then(next => { if (live) setQuota(next); }); return () => { live = false; off(); offQuota(); }; }, []);
  const run = (source: ActionSource, background = false): Promise<unknown> => {
    // Blur commits must not disable the button receiving that same pointer click.
    // Resolve edits against fresh state after earlier commits, including pet arrays.
    setPending(value => value + 1);
    if (!background) { foreground.current++; setBusy(true); }
    const operation = queue.current.then(async () => {
      setFeedback(''); setFailed(false);
      try {
        const action = typeof source === 'function' ? source(await window.tud.dshPet.getState()) : source;
        const result = await window.tud.dshPet.dispatch(action);
        if (action.type === 'request') {
          const response = result as { status: number; body?: string };
          const value = JSON.parse(response.body ?? '{}') as { ok?: boolean; reason?: string; message?: string; provider?: string; model?: string; fallback?: boolean };
          if (response.status >= 400 || value.ok === false) throw new Error(value.message ?? value.reason ?? text('operationFailed'));
          setFeedback(value.provider ? `${value.provider} / ${value.model}${value.fallback ? ` · ${text('fallback')}` : ''}` : text('saved'));
        } else setFeedback(text('saved'));
        setState(await window.tud.dshPet.getState());
        if (action.type === 'save-config' || action.type === 'reset-config') setConfigRevision(value => value + 1);
        return result;
      } catch (error) {
        setFailed(true); setFeedback((error instanceof Error ? error.message : text('operationFailed')).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
        return undefined;
      } finally { setPending(value => value - 1); if (!background) { foreground.current--; setBusy(foreground.current > 0); } }
    });
    queue.current = operation.catch(() => {});
    return operation;
  };
  const patch = (value: Item | ((main: Item) => Item), background = false) => run(current => ({ type: 'patch-config', patch: typeof value === 'function' ? value(current.config.main ?? {}) : value }), background);
  const request = (route: string, body?: unknown) => run({ type: 'request', method: 'POST', path: route, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!state) return <p className="text-xs text-muted" role="status">{feedback || text('loading')}</p>;
  const main = state.config.main ?? {}, pets = Array.isArray(main.pets) ? main.pets as Item[] : [];
  const allPets: Item[] = Object.entries(state.config).flatMap(([entry, conf]) => Array.isArray(conf.pets) ? (conf.pets as Item[]).map(pet => ({ ...pet, entry })) : []);
  const chosen = allPets.find(pet => pet.id === selected) ?? allPets[0], chosenId = String(chosen?.id ?? ''), conf = state.config[String(chosen?.entry ?? 'main')] ?? main;
  const models = state.models.providers.flatMap(p => p.models.map(model => ({ provider: p.id, model, label: `${p.name} / ${model}` })));
  const modelValue = (ref: unknown) => { const value = obj(ref); return value.provider && value.model ? JSON.stringify({ provider: value.provider, model: value.model }) : ''; };
  const modelSelect = (label: string, value: unknown, change: (value: ModelRef | null) => void) => <Field label={label}><select className={inputClass} disabled={busy} value={modelValue(value)} onChange={event => change(event.target.value ? JSON.parse(event.target.value) as ModelRef : null)}><option value="">{text('followDefault')}</option>{models.map(model => <option key={model.label} value={JSON.stringify({ provider: model.provider, model: model.model })}>{model.label}</option>)}</select></Field>;
  const toggle = (label: string, checked: boolean, change: (value: boolean) => void) => <label className="flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={checked} disabled={busy} onChange={event => change(event.target.checked)} />{label}</label>;
  const updatePet = (index: number, value: Item, background = false) => {
    const id = pets[index]?.id;
    return patch(main => ({ pets: (main.pets as Item[]).map(pet => pet.id === id ? { ...pet, ...value, ...(value.position ? { position: { ...obj(pet.position), ...obj(value.position) } } : {}) } : pet) }), background);
  };
  const animations = new Set<string>(); const visit = (value: unknown) => { if (typeof value === 'string') animations.add(value); else if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') { const item = value as Item; if (typeof item.name === 'string') animations.add(item.name); for (const [k, v] of Object.entries(item)) if (!['params', 'default', 'name'].includes(k)) visit(v); } }; visit(conf.animations);
  return <section className="space-y-4 rounded-xl border border-default-200 bg-content1 p-4 text-left" aria-label={text('title')} aria-busy={pending > 0}>
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{text('title')}</h3><p className="mt-1 text-xs text-muted">{text('description')}</p></div><Switch className="shrink-0" aria-label={text('enable')} isSelected={state.enabled} isDisabled={busy} onChange={enabled => { void run({ type: 'set-enabled', enabled }); }}><Switch.Content className="gap-2 text-xs"><Switch.Control><Switch.Thumb /></Switch.Control>{text('enable')}</Switch.Content></Switch></div>
    <div className="flex items-center gap-3 text-xs"><span>{text(`status.${state.status}`)}</span>{state.status === 'error' && <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void run({ type: 'retry' }); }}>{text('retry')}</Button>}</div>
    {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    {feedback && <p role={failed ? 'alert' : 'status'} className={`break-words text-xs ${failed ? 'text-danger' : 'text-success'}`}>{feedback}</p>}
    <Group title={text('instances')}>
      {pets.map((pet, index) => <div key={String(pet.id)} className="space-y-3 rounded-lg bg-default-100/40 p-3"><div className="grid grid-cols-2 gap-3"><Field label={text('name')}><SavedInput revision={configRevision} className={inputClass} value={String(pet.name ?? pet.id)} maxLength={100} disabled={busy} onSave={value => { return updatePet(index, { name: value }, true); }} /></Field><Field label={text('size')}><SavedInput revision={configRevision} className={inputClass} type="number" value={Number(pet.size)} min={64} max={2000} disabled={busy} onSave={value => { return updatePet(index, { size: Number(value) }, true); }} /></Field></div>
        <div className="flex flex-wrap gap-3">{(['balanceEnabled', 'whisperEnabled', 'workStatusEnabled', 'fixedEnabled'] as const).map(field => <span key={field}>{toggle(text(field), Boolean(pet[field]), value => { void updatePet(index, { [field]: value }); })}</span>)}</div>
        <div className="grid grid-cols-3 gap-2"><Field label={text('display')}><select className={inputClass} value={String(pet.display)} disabled={busy} onChange={e => { void updatePet(index, { display: e.target.value }); }}>{['desktop', 'none', 'both', 'web'].map(value => <option key={value} value={value}>{text(`display.${value}`)}</option>)}</select></Field><Field label={text('corner')}><select className={inputClass} value={String(obj(pet.position).corner)} disabled={busy} onChange={e => { void updatePet(index, { position: { corner: e.target.value } }); }}>{['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(value => <option key={value} value={value}>{text(`corner.${value}`)}</option>)}</select></Field>{['marginX', 'marginY'].map(field => <Field key={field} label={text(field)}><SavedInput revision={configRevision} className={inputClass} type="number" value={Number(obj(pet.position)[field])} disabled={busy} onSave={value => { return updatePet(index, { position: { [field]: Number(value) } }, true); }} /></Field>)}</div>
        <p className="text-xs text-muted">ID: {String(pet.id)}</p><Button size="sm" variant="danger-soft" isDisabled={busy || pets.length <= 1} onPress={() => { void patch(main => ({ pets: (main.pets as Item[]).filter(item => item.id !== pet.id) })); }}>{text('remove')}</Button>
      </div>)}
      <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { const id = `pet-${Date.now().toString(36)}`; void patch(main => ({ pets: [...main.pets as Item[], { ...(main.pets as Item[])[0], id, name: text('newPet'), position: { corner: 'bottom-right', marginX: 24, marginY: 80 } }] })); }}>{text('add')}</Button><p className="text-xs text-muted">{text('packHelp')}</p>
    </Group>
    <Group title={text('behavior')}><div className="flex flex-wrap gap-3">{toggle(text('confine'), Boolean(main.confineToScreen), value => { void patch({ confineToScreen: value }); })}{toggle(text('notifications'), Boolean(main.notificationsEnabled), value => { void patch({ notificationsEnabled: value }); })}{toggle(text('collision'), Boolean(obj(main.physics).petCollision), value => { void patch(current => ({ physics: { ...obj(current.physics), petCollision: value } })); })}{toggle(text('ceiling'), Boolean(obj(main.physics).ceilingBounce), value => { void patch(current => ({ physics: { ...obj(current.physics), ceilingBounce: value } })); })}</div>
      <div className="grid grid-cols-2 gap-3">{['gravity', 'restitution', 'groundFriction', 'throwPower'].map(field => <Field key={field} label={text(field)}><SavedInput revision={configRevision} className={inputClass} type="number" step="any" value={Number(obj(main.physics)[field])} disabled={busy} onSave={text => { const value = Number(text); return patch(current => ({ physics: { ...obj(current.physics), [field]: value } }), true); }} /></Field>)}<Field label={text('font')}><select className={inputClass} value={String(obj(main.font).family)} disabled={busy} onChange={e => { const value = e.target.value; void patch(current => ({ font: { ...obj(current.font), family: value } })); }}>{['system', 'yahei', 'youyuan', 'kaiti', 'simsun', 'comic', 'candy'].map(value => <option key={value} value={value}>{text(`font.${value}`)}</option>)}</select></Field><Field label={text('fontSize')}><SavedInput revision={configRevision} className={inputClass} type="number" value={Number(obj(main.font).size)} min={4} max={200} disabled={busy} onSave={text => { const value = Number(text); return patch(current => ({ font: { ...obj(current.font), size: value } }), true); }} /></Field></div>{toggle(text('followPet'), Boolean(obj(main.font).followPet), value => { void patch(current => ({ font: { ...obj(current.font), followPet: value } })); })}<p className="text-xs text-muted">{text('fontHelp')}</p>
      <Field label={text('quota')}><select className={inputClass} value={state.quotaSource ?? ''} disabled={busy} onChange={e => { void run({ type: 'set-quota-source', source: e.target.value || null }); }}><option value="">{text('noQuota')}</option>{quota?.providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
    </Group>
    <Group title={text('models')}><p className="text-xs text-muted">{text('modelHelp')}</p>
      {state.models.providers.map(p => <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{p.name} · {p.apiKeyConfigured ? text('keySaved') : text('noKey')}</span><div className="flex gap-2"><Button size="sm" variant="secondary" onPress={() => { setProvider({ id: p.id, name: p.name, baseUrl: p.baseUrl, models: p.models }); setKey(''); }}>{text('edit')}</Button><Button size="sm" variant="danger-soft" isDisabled={busy} onPress={() => { void run({ type: 'remove-provider', id: p.id }); }}>{text('remove')}</Button></div></div>)}
      <form method="post" onSubmit={e => { e.preventDefault(); void run({ type: 'save-provider', provider: { ...provider, ...(key ? { apiKey: key } : {}) } }).then(result => { if (result) setKey(''); }); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">{(['id', 'name', 'baseUrl'] as const).map(field => <Field key={field} label={text(`provider.${field}`)}><input name={field} className={inputClass} value={provider[field]} required maxLength={field === 'baseUrl' ? 2000 : 100} pattern={field === 'id' ? '[a-z0-9][a-z0-9-]{0,63}' : undefined} type={field === 'baseUrl' ? 'url' : 'text'} spellCheck={false} onChange={e => setProvider({ ...provider, [field]: e.target.value })} /></Field>)}<Field label={text('provider.models')}><input name="models" className={inputClass} value={provider.models.join(',')} required onChange={e => setProvider({ ...provider, models: e.target.value.split(',') })} /></Field></div>
        <Field label={text('apiKey')}><input name="apiKey" className={inputClass} type="password" autoComplete="new-password" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} /></Field><Button size="sm" type="submit" isDisabled={busy}>{text('saveProvider')}</Button>
      </form>
      {modelSelect(text('defaultModel'), state.models.defaultModel, model => { void run({ type: 'set-default-model', model }); })}
      <div className="grid grid-cols-2 gap-3">{modelSelect(text('chatModel'), main.chatModel, model => { void patch({ chatModel: model ?? { provider: '', model: '' } }); })}{modelSelect(text('whisperModel'), main.whisperModel, model => { void patch({ whisperModel: model ?? { provider: '', model: '' } }); })}</div>
      <div className="flex flex-wrap gap-3">{toggle(text('chatImages'), Boolean(main.chatImageEnabled), value => { void patch({ chatImageEnabled: value }); })}{toggle(text('whisperImages'), Boolean(main.whisperImageEnabled), value => { void patch({ whisperImageEnabled: value }); })}</div>
      <div className="grid grid-cols-2 gap-3">{['chatMemoryRounds', 'chatImageLimit'].map(field => <Field key={field} label={text(field)}><SavedInput revision={configRevision} className={inputClass} type="number" min={0} value={Number(main[field])} disabled={busy} onSave={value => { return patch({ [field]: Number(value) }, true); }} /></Field>)}{['balance', 'whisper'].map(field => <Field key={field} label={text(`interval.${field}`)}><SavedInput revision={configRevision} className={inputClass} type="number" min={1} value={Number(obj(main.eventsRefreshSec)[field])} disabled={busy} onSave={text => { const value = Number(text); return patch(current => ({ eventsRefreshSec: { ...obj(current.eventsRefreshSec), [field]: value } }), true); }} /></Field>)}</div>
      <Field label={text('persona')}><SavedTextarea revision={configRevision} className={inputClass} rows={3} value={String(main.whisperPrompt)} disabled={busy} onSave={value => { return patch({ whisperPrompt: value }, true); }} /></Field>
    </Group>
    <Group title={text('controls')}><Field label={text('instance')}><select className={inputClass} value={chosenId} onChange={e => setSelected(e.target.value)}>{allPets.map(pet => <option key={String(pet.id)} value={String(pet.id)}>{String(pet.name ?? pet.id)} · {String(pet.entry)}</option>)}</select></Field><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" isDisabled={busy || state.status !== 'running'} onPress={() => { void request('/balance'); }}>{text('balance')}</Button><Button size="sm" variant="secondary" isDisabled={busy || state.status !== 'running'} onPress={() => { void request(`/whisper?pet=${encodeURIComponent(chosenId)}`); }}>{text('whisper')}</Button><Button size="sm" variant="danger-soft" isDisabled={busy} onPress={() => { void run({ type: 'clear-memory', petId: chosenId }); }}>{text('clearMemory')}</Button></div>
      <form method="post" className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); void request(`/anim?pet=${encodeURIComponent(chosenId)}`, { name: animation }); }}><div className="min-w-0 flex-1"><Field label={text('animation')}><select name="animation" className={inputClass} value={animation} onChange={e => setAnimation(e.target.value)} required><option value="">{text('chooseAnimation')}</option>{[...animations].map(name => <option key={name}>{name}</option>)}</select></Field></div><Button size="sm" type="submit" isDisabled={busy || state.status !== 'running'}>{text('play')}</Button></form>
      <form method="post" className="space-y-2" onSubmit={e => { e.preventDefault(); void request(`/chat?pet=${encodeURIComponent(chosenId)}`, { text: chat }); }}><Field label={text('chat')}><textarea name="chat" className={inputClass} rows={2} value={chat} onChange={e => setChat(e.target.value)} maxLength={2000} required /></Field><Button size="sm" type="submit" isDisabled={busy || state.status !== 'running'}>{text('send')}</Button></form><p className="text-xs text-muted">{text('replyHelp')}</p>
    </Group>
    <Group title={text('activity')}><p className="text-xs text-muted">{text('activityHelp')}</p>{state.sources.map(source => <div key={source.source} className="text-xs"><strong>{source.source}</strong><span> · {source.states.join(', ') || text('unconnected')}</span><p className="mt-1 text-muted">{source.reason}{source.lastEventAt ? ` · ${new Date(source.lastEventAt).toLocaleTimeString()}` : ''}</p></div>)}</Group>
    <Group title={text('advanced')}><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void run({ type: 'read-config' }).then(value => { if (typeof value === 'string') setRaw(value); }); }}>{text('loadConfig')}</Button><Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void run({ type: 'open-directory' }); }}>{text('openDirectory')}</Button><Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void run({ type: 'reset-config' }).then(result => { if (result) setRaw(''); }); }}>{text('reset')}</Button></div><p className="text-xs text-muted">{text('advancedHelp')}</p>{raw && <form method="post" onSubmit={e => { e.preventDefault(); void run({ type: 'save-config', text: raw }); }} className="space-y-2"><Field label="JSONC"><textarea name="jsonc" className={`${inputClass} font-mono text-xs`} rows={14} value={raw} spellCheck={false} onChange={e => setRaw(e.target.value)} /></Field><Button size="sm" type="submit" isDisabled={busy}>{text('saveConfig')}</Button></form>}</Group>
    <p className="text-xs text-muted"><button className="underline" onClick={() => { void window.tud.openExternal('https://github.com/PC2005-cloud/dsh-pet'); }}>dsh-pet · PC2005-cloud</button> · {text('license')}</p>
  </section>;
}
