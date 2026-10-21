import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import { Button, Switch } from '@heroui/react';
import dshPetLogo from '../../../vendor/dsh-pet/assets/logo.png';
import { DshPetSettingsCard } from './DshPetSettingsCard';
import type { PetCatalogEntry } from '../../main/pet-core';
import type { PetActivationState, PetCatalogRequest, PetSelection, PetSettingPatch, PetState } from '../../shared/pet';
import type { DshPetState } from '../../shared/dsh-pet';
// These two renderers are shared with the standalone pet page copied from TokenTracker.
// @ts-expect-error The upstream JSX module has no TypeScript declarations.
import { BotAnimated } from '../ui/foundation/BotAnimated.jsx';
// @ts-expect-error The upstream JSX module has no TypeScript declarations.
import { PetAtlasAnimated } from '../ui/foundation/PetAtlasAnimated.jsx';

const PREVIEW_STATES = [
  { id: 'idle-living', labelKey: 'desktop.pet.preview.calm', clawd: 'idle/living.svg' },
  { id: 'working-thinking', labelKey: 'desktop.pet.preview.thinking', clawd: 'working/thinking.svg' },
  { id: 'working-juggling', labelKey: 'desktop.pet.preview.multitask', clawd: 'working/juggling.svg' },
  { id: 'working-wizard', labelKey: 'desktop.pet.preview.continuous', clawd: 'working/wizard.svg' },
  { id: 'happy', labelKey: 'desktop.pet.preview.celebrate', clawd: 'happy.svg' },
  { id: 'sleeping', labelKey: 'desktop.pet.preview.rest', clawd: 'sleep/sleeping.svg' },
] as const;

const COLORS = [
  ['auto', 'desktop.pet.color.auto', 'linear-gradient(135deg, #1e293b 50%, #f8fafc 50%)'],
  ['bleu', 'desktop.pet.color.blue', '#4889d8'],
  ['turquoise', 'desktop.pet.color.cyan', '#36b8b1'],
  ['vert', 'desktop.pet.color.green', '#61b682'],
  ['ambre', 'desktop.pet.color.amber', '#e1a654'],
  ['rose', 'desktop.pet.color.pink', '#dc7ba6'],
  ['violet', 'desktop.pet.color.purple', '#9b79ce'],
] as const;

type PetFeedback = { key: string; options?: Record<string, string> };

function spriteUrl(path: string): string {
  return `quotern-pet://builtin/${path}`;
}

function ClawdSprite({ path, size, label, preview = false }: { path: string; size: number; label?: string; preview?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={preview ? '0 -5 15 24' : '0 0 15 16'}
      className="shrink-0 overflow-visible"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {/* Use a fixed character frame, with headroom for preview props. Keep the
          original animation isolated and its effects visible beyond the frame. */}
      <image href={spriteUrl(`clawd/${path}`)} x={-15} y={-25} width={45} height={45} />
    </svg>
  );
}

function PetPreview({ pet, state, color }: { pet: PetCatalogEntry; state: string; color: string }) {
  const { t } = useTranslation();
  const [lookDirectionIndex, setLookDirectionIndex] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const clawdPath = PREVIEW_STATES.find(item => item.id === state)?.clawd ?? 'idle/living.svg';
  return (
    <div
      className="flex h-48 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800"
      onPointerMove={(event) => {
        if (pet.spriteVersionNumber !== 2 || !boxRef.current) return;
        const bounds = boxRef.current.getBoundingClientRect();
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = event.clientY - (bounds.top + bounds.height / 2);
        setLookDirectionIndex(Math.round(((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360) / 22.5) % 16);
      }}
      onPointerLeave={() => setLookDirectionIndex(null)}
    >
      <div ref={boxRef} className="flex h-36 w-36 items-center justify-center">
        {pet.id === 'clawd' ? (
          <ClawdSprite path={clawdPath} size={160} label={t('desktop.pet.clawdPreview')} preview />
        ) : pet.id === 'bot' ? (
          <BotAnimated state={state} color={color} size={164} />
        ) : (
          <PetAtlasAnimated character={pet.id} pet={pet} state={state} size={144} lookDirectionIndex={lookDirectionIndex} />
        )}
      </div>
    </div>
  );
}

function PetCardSprite({ pet, color }: { pet: PetCatalogEntry; color: string }) {
  if (pet.id === 'clawd') return <ClawdSprite path="idle/living.svg" size={44} />;
  if (pet.id === 'bot') return <BotAnimated state="idle-living" color={color} size={44} />;
  return <PetAtlasAnimated character={pet.id} pet={pet} state="idle-living" size={44} />;
}

export function PetSettingsCard() {
  const { t } = useTranslation();
  const [state, setState] = useState<PetState | null>(null);
  const [activation, setActivation] = useState<PetActivationState | null>(null);
  const [previewState, setPreviewState] = useState<string>('idle-living');
  const [autoRotatePreview, setAutoRotatePreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PetFeedback | null>(null);
  const [notice, setNotice] = useState<PetFeedback | null>(null);
  const [url, setUrl] = useState('');
  const [codexPets, setCodexPets] = useState<PetCatalogEntry[] | null>(null);
  const [selectedCodex, setSelectedCodex] = useState<string[]>([]);
  const [previewTarget, setPreviewTarget] = useState<PetSelection | null>(null);
  const [dshState, setDshState] = useState<DshPetState | null>(null);
  const showDshSettings = previewTarget?.kind === 'dsh';

  useEffect(() => {
    let live = true;
    const unsubscribe = window.tud.pet.onState(next => { if (live) setState(next); });
    void window.tud.pet.getState().then(next => { if (live) setState(next); }).catch(() => {
      if (live) setError({ key: 'desktop.pet.unavailable' });
    });
    return () => { live = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    let live = true;
    const unsubscribe = window.tud.pet.onSelection(next => { if (live) setActivation(next); });
    void window.tud.pet.getSelection().then(next => { if (live) setActivation(next); }).catch(() => {
      if (live) setError({ key: 'desktop.pet.unavailable' });
    });
    return () => { live = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    let live = true;
    const unsubscribe = window.tud.dshPet.onState(next => { if (live) setDshState(next); });
    void window.tud.dshPet.getState().then(next => { if (live) setDshState(next); }).catch(() => {
      if (live) setError({ key: 'desktop.pet.unavailable' });
    });
    return () => { live = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (activation && (state || activation.currentKind === 'dsh')) setPreviewTarget(current => current ?? (activation.currentKind === 'dsh' ? { kind: 'dsh' } : { kind: 'builtin', character: state!.settings.character }));
  }, [state, activation]);

  useEffect(() => {
    if (!autoRotatePreview || showDshSettings) return;
    const timer = window.setInterval(() => {
      setPreviewState(current => {
        const index = PREVIEW_STATES.findIndex(item => item.id === current);
        return PREVIEW_STATES[(index + 1) % PREVIEW_STATES.length]!.id;
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRotatePreview, showDshSettings]);

  const selected = useMemo(() => state?.catalog.find(pet => previewTarget?.kind === 'builtin' && pet.id === previewTarget.character)
    ?? state?.catalog.find(pet => pet.id === state.settings.character) ?? state?.catalog[0], [state, previewTarget]);
  const currentName = activation?.currentKind === 'dsh' ? t('desktop.dshPet.title') : state?.catalog.find(pet => pet.id === state.settings.character)?.displayName;
  const enabled = activation?.enabled ?? false;
  const currentAvailable = activation?.currentKind === 'dsh' ? Boolean(dshState) : Boolean(state);
  const previewIsCurrent = activation?.currentKind === (showDshSettings ? 'dsh' : 'builtin') && (showDshSettings || state?.settings.character === selected?.id);

  const applySelection = async (target: PetSelection) => {
    setBusy(true); setError(null); setNotice(null);
    try { setActivation(await window.tud.pet.select(target)); setNotice({ key: 'desktop.pet.selectedNotice' }); }
    catch { setError({ key: 'desktop.pet.saveFailed' }); }
    finally { setBusy(false); }
  };

  const setEnabled = async (value: boolean) => {
    setBusy(true); setError(null); setNotice(null);
    try { setActivation(await window.tud.pet.setEnabled(value)); }
    catch { setError({ key: 'desktop.pet.saveFailed' }); }
    finally { setBusy(false); }
  };

  const selectionAction = (target: PetSelection) => previewIsCurrent
    ? <span className="shrink-0 rounded-md bg-accent/10 px-2 py-1.5 text-xs font-medium text-foreground">✓ {t('desktop.pet.current')}</span>
    : <Button size="sm" variant="secondary" isDisabled={busy || !activation || !(target.kind === 'dsh' ? dshState : state)} onPress={() => { void applySelection(target); }}>{t('desktop.pet.setCurrent')}</Button>;

  const update = async (patch: PetSettingPatch) => {
    setBusy(true); setError(null); setNotice(null);
    try { setState(await window.tud.pet.setSettings(patch)); }
    catch { setError({ key: 'desktop.pet.saveFailed' }); }
    finally { setBusy(false); }
  };

  const catalog = async (request: PetCatalogRequest, success: PetFeedback) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await window.tud.pet.catalog(request);
      if (!result.ok) throw new Error(result.error || 'Pet action failed');
      if (request.action === 'list-codex') {
        setCodexPets(Array.isArray(result.data) ? result.data as PetCatalogEntry[] : []);
        setSelectedCodex([]);
      } else if (!(result.data && typeof result.data === 'object' && 'canceled' in result.data)) {
        setNotice(success);
        setCodexPets(null);
        setSelectedCodex([]);
        const imported = result.data && typeof result.data === 'object' && 'pet' in result.data
          ? result.data.pet as PetCatalogEntry | undefined
          : undefined;
        setState(await window.tud.pet.getState());
        if (imported?.id) { setUrl(''); setPreviewTarget({ kind: 'builtin', character: imported.id }); }
      }
    } catch { setError({ key: 'desktop.pet.operationFailed' }); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-default-200 bg-content1 p-4 text-left dark:border-default-100/20" aria-label={t('desktop.pet.settings')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{t('desktop.pet.title')}</h3>
        <Switch aria-label={t('desktop.pet.enable')} isSelected={enabled} isDisabled={busy || !activation || (!enabled && !currentAvailable)} onChange={value => { void setEnabled(value); }}>
          <Switch.Content className="gap-2 text-xs"><Switch.Control><Switch.Thumb /></Switch.Control>{t('desktop.pet.enable')}</Switch.Content>
        </Switch>
      </div>
      {currentName && <p role="status" className="mt-2 text-xs text-foreground">{t('desktop.pet.currentName', { name: currentName })}<span className="text-muted"> · {t(enabled ? 'desktop.pet.enabled' : 'desktop.pet.disabled')}</span></p>}
      <p className="mt-1 text-xs text-muted">{t('desktop.pet.pickerDescription')}</p>
      {error && <p role="alert" className="mt-3 text-xs text-danger">{t(error.key, error.options)}</p>}
      {notice && <p role="status" className="mt-3 text-xs text-success">{t(notice.key, notice.options)}</p>}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {state?.catalog.map(pet => (
          <div key={pet.id} className="relative">
            <button
              type="button"
              disabled={busy}
              aria-pressed={!showDshSettings && selected?.id === pet.id}
              onClick={() => setPreviewTarget({ kind: 'builtin', character: pet.id })}
              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent ${!showDshSettings && selected?.id === pet.id ? 'border-accent bg-accent/10 font-semibold' : 'border-default-200 hover:bg-default-100 dark:border-default-100/20'}`}
            >
              <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden"><PetCardSprite pet={pet} color={state.settings.botColor} /></span>
              <span className="min-w-0"><span className="block truncate">{pet.displayName}</span>{activation?.currentKind === 'builtin' && state.settings.character === pet.id && <span className="mt-0.5 block text-[10px] font-normal text-muted">✓ {t('desktop.pet.current')}</span>}</span>
              {pet.spriteVersionNumber === 2 && <span className="ml-auto text-[9px] opacity-60">V2</span>}
            </button>
            {(pet.custom || ['sprout', 'byte', 'ember'].includes(pet.id)) && (
              <button
                type="button"
                disabled={busy}
                aria-label={t('desktop.pet.remove', { name: pet.displayName })}
                title={t('desktop.pet.remove', { name: pet.displayName })}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border bg-content1 text-xs text-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => void catalog({ action: 'remove', id: pet.id }, { key: 'desktop.pet.removed', options: { name: pet.displayName } })}
              >×</button>
            )}
          </div>
        ))}
        <button
          type="button"
          disabled={busy}
          aria-pressed={showDshSettings}
          onClick={() => setPreviewTarget({ kind: 'dsh' })}
          className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent ${showDshSettings ? 'border-accent bg-accent/10 font-semibold' : 'border-default-200 hover:bg-default-100 dark:border-default-100/20'}`}
        >
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center"><img src={dshPetLogo} alt="" width={44} height={44} className="size-11 object-contain" /></span>
          <span className="min-w-0"><span className="block truncate">{t('desktop.dshPet.title')}</span><span className="mt-0.5 block text-[10px] font-normal text-muted">dsh-pet</span>{activation?.currentKind === 'dsh' && <span className="block text-[10px] font-normal text-muted">✓ {t('desktop.pet.current')}</span>}</span>
        </button>
      </div>

      {/* Keep both editors mounted so changing the selected tile preserves drafts. */}
      <div hidden={showDshSettings} className="mt-4 border-t border-default-200 pt-4 dark:border-default-100/20">
      {!state ? (
        error ? <p role="alert" className="text-xs text-danger">{t(error.key, error.options)}</p> : <p role="status" className="text-xs text-muted">{t('desktop.pet.loading')}</p>
      ) : <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">{selected?.displayName}<span className="text-xs font-normal text-muted">{t('desktop.pet.previewing')}</span></h4>
          <p className="mt-1 text-xs text-muted">{t('desktop.pet.description')}</p>
        </div>
        {selected && selectionAction({ kind: 'builtin', character: selected.id })}
      </div>

      {selected && !showDshSettings && (
        <div className="mt-4">
          <PetPreview pet={selected} state={previewState} color={state.settings.botColor} />
          <div className="mt-2 grid grid-cols-3 gap-1 sm:grid-cols-6" aria-label={t('desktop.pet.previewActions')}>
            {PREVIEW_STATES.map(item => (
              <button type="button" key={item.id} aria-pressed={previewState === item.id} onClick={() => { setAutoRotatePreview(false); setPreviewState(item.id); }}
                className={`rounded-md px-1 py-1.5 text-[11px] focus-visible:outline-2 focus-visible:outline-accent ${previewState === item.id ? 'bg-accent/15 font-semibold text-foreground' : 'text-muted hover:bg-default-100'}`}>
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="mr-1 text-muted">{t('desktop.pet.size')}</span>
        {([['small', 'desktop.pet.size.small'], ['medium', 'desktop.pet.size.medium'], ['large', 'desktop.pet.size.large']] as const).map(([value, labelKey]) => (
          <button type="button" key={value} disabled={busy} aria-pressed={state.settings.size === value} onClick={() => void update({ size: value })}
            className={`rounded-md border px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-accent ${state.settings.size === value ? 'border-accent bg-accent/10' : 'border-default-200 dark:border-default-100/20'}`}>{t(labelKey)}</button>
        ))}
      </div>

      {selected?.id === 'bot' && (
        <div className="mt-4 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('desktop.pet.botColor')}>
          <span className="mr-1 text-xs text-muted">{t('desktop.pet.botColor')}</span>
          {COLORS.map(([value, labelKey, background]) => (
            <button type="button" role="radio" key={value} aria-label={t(labelKey)} aria-checked={state.settings.botColor === value} title={t(labelKey)} disabled={busy}
              onClick={() => void update({ botColor: value })}
              className={`h-6 w-6 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-accent ${state.settings.botColor === value ? 'border-foreground scale-110' : 'border-transparent'}`}
              style={{ background }} />
          ))}
        </div>
      )}

      <div className="mt-5 border-t border-default-200 pt-4 dark:border-default-100/20">
        <h4 className="text-xs font-semibold text-foreground">{t('desktop.pet.importTitle')}</h4>
        <p className="mt-1 text-xs text-muted">{t('desktop.pet.importBeforeSite')}<button type="button" className="underline" onClick={() => void window.tud.openExternal('https://codex-pets.net')}>codex-pets.net</button>{t('desktop.pet.importAfterSite')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void catalog({ action: 'import-zip' }, { key: 'desktop.pet.imported' })} className="rounded-md border border-default-200 px-3 py-1.5 text-xs hover:bg-default-100 focus-visible:outline-2 focus-visible:outline-accent dark:border-default-100/20">{t('desktop.pet.importZip')}</button>
          <button type="button" disabled={busy} onClick={() => void catalog({ action: 'list-codex' }, { key: 'desktop.pet.codexImported' })} className="rounded-md border border-default-200 px-3 py-1.5 text-xs hover:bg-default-100 focus-visible:outline-2 focus-visible:outline-accent dark:border-default-100/20">{t('desktop.pet.importCodex')}</button>
          <button type="button" disabled={busy} onClick={() => void catalog({ action: 'restore-builtins' }, { key: 'desktop.pet.restored' })} className="rounded-md border border-default-200 px-3 py-1.5 text-xs hover:bg-default-100 focus-visible:outline-2 focus-visible:outline-accent dark:border-default-100/20">{t('desktop.pet.restore')}</button>
        </div>
        <form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); if (url.trim()) void catalog({ action: 'install-url', url: url.trim() }, { key: 'desktop.pet.imported' }); }}>
          <input type="text" aria-label={t('desktop.pet.url')} placeholder={t('desktop.pet.url')} value={url} disabled={busy} onChange={event => setUrl(event.target.value)} className="min-w-0 flex-1 rounded-md border border-default-200 bg-content1 px-2 py-1.5 text-xs dark:border-default-100/20" />
          <button type="submit" disabled={busy || !url.trim()} className="rounded-md border border-default-200 px-3 py-1.5 text-xs hover:bg-default-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 dark:border-default-100/20">{t('desktop.pet.importLink')}</button>
        </form>
        {codexPets && (
          <div className="mt-3 rounded-lg border border-default-200 p-3 text-xs dark:border-default-100/20">
            <p className="font-medium">{t('desktop.pet.localCodex')}</p>
            {codexPets.length === 0 ? <p className="mt-2 text-muted">{t('desktop.pet.noneFound')}</p> : (
              <>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {codexPets.map(pet => (
                    <label key={pet.id} className="flex items-center gap-2 rounded-lg border border-default-200 p-2 dark:border-default-100/20">
                      <input type="checkbox" checked={selectedCodex.includes(pet.id)} disabled={busy} onChange={() => setSelectedCodex(current => current.includes(pet.id) ? current.filter(id => id !== pet.id) : [...current, pet.id])} />
                      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden"><PetCardSprite pet={pet} color={state.settings.botColor} /></span>
                      <span className="truncate">{pet.displayName}</span>
                    </label>
                  ))}
                </div>
                <button type="button" disabled={busy || selectedCodex.length === 0} onClick={() => void catalog({ action: 'import-codex', ids: selectedCodex }, { key: 'desktop.pet.codexImported' })} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-accent-foreground disabled:opacity-50">{t('desktop.pet.importSelected')}</button>
              </>
            )}
          </div>
        )}
      </div>
      </>}
      </div>
      <div hidden={!showDshSettings} className="mt-4 border-t border-default-200 pt-4 dark:border-default-100/20">
        <DshPetSettingsCard active={showDshSettings} headerAction={selectionAction({ kind: 'dsh' })} />
      </div>
    </section>
  );
}
