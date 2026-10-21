import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Button, Switch } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { DshPetAction, DshPetState } from '../../shared/dsh-pet';
import { DSH_PET_WIDTHS, dshPetSize } from '../../shared/dsh-pet-size';
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
export function DshPetSettingsCard() {
  const { t } = useTranslation(); const text = (key: string) => t(`desktop.dshPet.${key}`);
  const [state, setState] = useState<DshPetState | null>(null), [quota, setQuota] = useState<QuotaState | null>(null);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(''), [failed, setFailed] = useState(false);
  const [raw, setRaw] = useState(''), [animation, setAnimation] = useState('');
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
          const value = JSON.parse(response.body ?? '{}') as { ok?: boolean; reason?: string; message?: string };
          if (response.status >= 400 || value.ok === false) throw new Error(value.message ?? value.reason ?? text('operationFailed'));
          setFeedback(text('saved'));
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
  const main = state.config.main ?? {};
  const allPets: Item[] = Object.entries(state.config).flatMap(([entry, conf]) => Array.isArray(conf.pets) ? (conf.pets as Item[]).map(pet => ({ ...pet, entry })) : []);
  const chosen = allPets[0], chosenId = String(chosen?.id ?? ''), conf = state.config[String(chosen?.entry ?? 'main')] ?? main;
  const pets = chosen ? [chosen] : [];
  const toggle = (label: string, checked: boolean, change: (value: boolean) => void) => <label className="flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={checked} disabled={busy} onChange={event => change(event.target.checked)} />{label}</label>;
  const updatePet = (index: number, value: Item, background = false) => {
    const id = pets[index]?.id;
    return run({ type: 'patch-pet', petId: String(id), patch: value }, background);
  };
  const animations = new Set<string>(); const visit = (value: unknown) => { if (typeof value === 'string') animations.add(value); else if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') { const item = value as Item; if (typeof item.name === 'string') animations.add(item.name); for (const [k, v] of Object.entries(item)) if (!['params', 'default', 'name'].includes(k)) visit(v); } }; visit(conf.animations);
  return <div className="space-y-4 text-left" role="group" data-pet-settings="dsh" aria-label={text('title')} aria-busy={pending > 0}>
    <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold">{text('title')}</h4><p className="mt-1 text-xs text-muted">{text('description')}</p></div><Switch className="shrink-0" aria-label={text('enable')} isSelected={state.enabled} isDisabled={busy} onChange={enabled => { void run({ type: 'set-enabled', enabled }); }}><Switch.Content className="gap-2 text-xs"><Switch.Control><Switch.Thumb /></Switch.Control>{text('enable')}</Switch.Content></Switch></div>
    <div className="flex items-center gap-3 text-xs"><span>{text(`status.${state.status}`)}</span>{state.status === 'error' && <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void run({ type: 'retry' }); }}>{text('retry')}</Button>}</div>
    {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    {feedback && <p role={failed ? 'alert' : 'status'} className={`break-words text-xs ${failed ? 'text-danger' : 'text-success'}`}>{feedback}</p>}
    <Group title={text('instances')}>
      {pets.map((pet, index) => <div key={String(pet.id)} className="space-y-3 rounded-lg bg-default-100/40 p-3"><Field label={text('name')}><SavedInput revision={configRevision} className={inputClass} value={String(pet.name ?? pet.id)} maxLength={100} disabled={busy} onSave={value => { return updatePet(index, { name: value }, true); }} /></Field>
        <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label={t('desktop.pet.size')}>
          <span className="mr-1 text-muted">{t('desktop.pet.size')}</span>
          {(['small', 'medium', 'large'] as const).map(size => <button type="button" key={size} disabled={busy} aria-pressed={dshPetSize(pet.size) === size} onClick={() => { void updatePet(index, { size: DSH_PET_WIDTHS[size] }); }} className={`rounded-md border px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-accent ${dshPetSize(pet.size) === size ? 'border-accent bg-accent/10' : 'border-default-200 dark:border-default-100/20'}`}>{t(`desktop.pet.size.${size}`)}</button>)}
        </div>
        <div className="flex flex-wrap gap-3">{(['balanceEnabled', 'workStatusEnabled', 'fixedEnabled'] as const).map(field => <span key={field}>{toggle(text(field), Boolean(pet[field]), value => { void updatePet(index, { [field]: value }); })}</span>)}</div>
      </div>)}
    </Group>
    <Group title={text('behavior')}><div className="flex flex-wrap gap-3">{toggle(text('confine'), Boolean(main.confineToScreen), value => { void patch({ confineToScreen: value }); })}{toggle(text('notifications'), Boolean(main.notificationsEnabled), value => { void patch({ notificationsEnabled: value }); })}{toggle(text('ceiling'), Boolean(obj(main.physics).ceilingBounce), value => { void patch(current => ({ physics: { ...obj(current.physics), ceilingBounce: value } })); })}</div>
      <div className="grid grid-cols-2 gap-3">{['gravity', 'restitution', 'groundFriction', 'throwPower'].map(field => <Field key={field} label={text(field)}><SavedInput revision={configRevision} className={inputClass} type="number" step="any" value={Number(obj(main.physics)[field])} disabled={busy} onSave={text => { const value = Number(text); return patch(current => ({ physics: { ...obj(current.physics), [field]: value } }), true); }} /></Field>)}<Field label={text('font')}><select className={inputClass} value={String(obj(main.font).family)} disabled={busy} onChange={e => { const value = e.target.value; void patch(current => ({ font: { ...obj(current.font), family: value } })); }}>{['system', 'yahei', 'youyuan', 'kaiti', 'simsun', 'comic', 'candy'].map(value => <option key={value} value={value}>{text(`font.${value}`)}</option>)}</select></Field><Field label={text('fontSize')}><SavedInput revision={configRevision} className={inputClass} type="number" value={Number(obj(main.font).size)} min={4} max={200} disabled={busy} onSave={text => { const value = Number(text); return patch(current => ({ font: { ...obj(current.font), size: value } }), true); }} /></Field></div>{toggle(text('followPet'), Boolean(obj(main.font).followPet), value => { void patch(current => ({ font: { ...obj(current.font), followPet: value } })); })}<p className="text-xs text-muted">{text('fontHelp')}</p>
      <Field label={text('quota')}><select className={inputClass} value={state.quotaSource ?? ''} disabled={busy} onChange={e => { void run({ type: 'set-quota-source', source: e.target.value || null }); }}><option value="">{text('noQuota')}</option>{quota?.providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
      <Field label={text('interval.balance')}><SavedInput revision={configRevision} className={inputClass} type="number" min={1} value={Number(obj(main.eventsRefreshSec).balance)} disabled={busy} onSave={text => { const value = Number(text); return patch(current => ({ eventsRefreshSec: { ...obj(current.eventsRefreshSec), balance: value } }), true); }} /></Field>
    </Group>
    <Group title={text('controls')}><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" isDisabled={busy || state.status !== 'running'} onPress={() => { void request('/balance'); }}>{text('balance')}</Button></div>
      <form method="post" className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); void request(`/anim?pet=${encodeURIComponent(chosenId)}`, { name: animation }); }}><div className="min-w-0 flex-1"><Field label={text('animation')}><select name="animation" className={inputClass} value={animation} onChange={e => setAnimation(e.target.value)} required><option value="">{text('chooseAnimation')}</option>{[...animations].map(name => <option key={name}>{name}</option>)}</select></Field></div><Button size="sm" type="submit" isDisabled={busy || state.status !== 'running'}>{text('play')}</Button></form>
    </Group>
    <Group title={text('activity')}><p className="text-xs text-muted">{text('activityHelp')}</p>{state.sources.map(source => <div key={source.source} className="text-xs"><strong>{source.source}</strong><span> · {source.states.join(', ') || text('unconnected')}</span><p className="mt-1 text-muted">{source.reason}{source.lastEventAt ? ` · ${new Date(source.lastEventAt).toLocaleTimeString()}` : ''}</p></div>)}</Group>
    <Group title={text('advanced')}><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void run({ type: 'read-config' }).then(value => { if (typeof value === 'string') setRaw(value); }); }}>{text('loadConfig')}</Button><Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void run({ type: 'open-directory' }); }}>{text('openDirectory')}</Button><Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void run({ type: 'reset-config' }).then(result => { if (result) setRaw(''); }); }}>{text('reset')}</Button></div><p className="text-xs text-muted">{text('advancedHelp')}</p>{raw && <form method="post" onSubmit={e => { e.preventDefault(); void run({ type: 'save-config', text: raw }); }} className="space-y-2"><Field label="JSONC"><textarea name="jsonc" className={`${inputClass} font-mono text-xs`} rows={14} value={raw} spellCheck={false} onChange={e => setRaw(e.target.value)} /></Field><Button size="sm" type="submit" isDisabled={busy}>{text('saveConfig')}</Button></form>}</Group>
    <p className="text-xs text-muted"><button className="underline" onClick={() => { void window.tud.openExternal('https://github.com/PC2005-cloud/dsh-pet'); }}>dsh-pet · PC2005-cloud</button> · {text('license')}</p>
  </div>;
}
