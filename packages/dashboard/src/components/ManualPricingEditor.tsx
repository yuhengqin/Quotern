import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ComboBox, Description, FieldError, Input, Label, ListBox, Modal, TextField } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { ManualPricingAdminState, PricingRecalculationJob } from 'quotern-core';
import { request } from '@/lib/api';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';
import { HelpPopover } from './HelpPopover';
import { FilterComboBoxPopover } from './FilterMenu';
import { PricingRate, type PriceDisplay } from './PricingDetails';
import type { PricingCatalogRow } from '../lib/pricing-data';
import { emptyManualRateDraft, manualRateDraft, manualRateFields as fields, validateManualRateDraft } from '../lib/manual-pricing-form';
import '../i18n/data-management-messages';
import '../i18n/insights-messages';

const route = '/functions/tud-local-admin/pricing';
const synced = () => window.dispatchEvent(new CustomEvent(DATA_SYNCED_EVENT));
type Props = { initialModel: string; catalog: PricingCatalogRow[] } & PriceDisplay;

function Editor({ initialModel, catalog, currency, exchangeRate }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<ManualPricingAdminState | null>(null), [reload, setReload] = useState(0);
  const [model, setModel] = useState(initialModel), [values, setValues] = useState(emptyManualRateDraft);
  const [busy, setBusy] = useState(false), [readError, setReadError] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<ReturnType<typeof validateManualRateDraft>['errors']>({});
  const [preview, setPreview] = useState<{ model: string; data: ManualPricingAdminState } | null>(null), [previewError, setPreviewError] = useState(false), [previewRetry, setPreviewRetry] = useState(0);
  const [job, setJob] = useState<PricingRecalculationJob | null>(null), [pollError, setPollError] = useState(false), [pollRetry, setPollRetry] = useState(0);
  const initialized = useRef(false), form = useRef<HTMLFormElement>(null), saveButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const savingDisabled = busy || job?.status === 'running';
  useEffect(() => { if (!savingDisabled && restoreFocus.current) { restoreFocus.current = false; saveButton.current?.focus(); } }, [savingDisabled]);

  const select = (id: string) => {
    setModel(id); setErrors({}); setError(''); setNotice('');
    setJob(current => current?.status === 'succeeded' ? null : current);
    setValues(manualRateDraft(state?.document.models[id]));
  };
  useEffect(() => {
    const controller = new AbortController(); setReadError(false);
    void request<ManualPricingAdminState>(route, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setState(result); setJob(result.job ?? null); setPollError(false); setPollRetry(value => value + 1); setError('');
      // Reloading a conflicted revision must preserve the user's unsaved fields.
      if (!initialized.current) { initialized.current = true; setValues(manualRateDraft(result.document.models[initialModel])); }
    }).catch(() => { if (!controller.signal.aborted) setReadError(true); });
    return () => controller.abort();
  }, [reload, initialModel]);

  useEffect(() => {
    const controller = new AbortController(); setPreview(null); setPreviewError(false);
    if (!state || !model.trim() || model.trim().length > 200) return () => controller.abort();
    const id = model.trim();
    const timer = window.setTimeout(() => {
      void request<ManualPricingAdminState>(route + '?model=' + encodeURIComponent(id), { signal: controller.signal }).then(data => {
        if (!controller.signal.aborted) setPreview({ model: id, data });
      }).catch(() => { if (!controller.signal.aborted) setPreviewError(true); });
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [model, state?.revision, previewRetry]);

  useEffect(() => {
    if (job?.status !== 'running') return;
    const controller = new AbortController(); let timer = 0;
    setPollError(false);
    const poll = async () => {
      try {
        const result = await request<{ job: PricingRecalculationJob | null }>(route + '/recalculation?id=' + encodeURIComponent(job.id), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
        if (controller.signal.aborted) return;
        if (!result.job || result.job.id !== job.id) { setPollError(true); return; }
        setJob(result.job); setPollError(false);
        if (result.job.status === 'running') timer = window.setTimeout(() => void poll(), 600);
        else synced();
      } catch { if (!controller.signal.aborted) setPollError(true); }
    };
    timer = window.setTimeout(() => void poll(), 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [job?.id, job?.status, pollRetry]);

  const options = useMemo(() => {
    const rows = new Map(catalog.filter(row => row.billingMode !== 'subscription').map(row => [row.model, { id: row.model, name: row.displayName ?? '', canonical: row.canonicalModelId ?? '' }]));
    for (const id of Object.keys(state?.document.models ?? {})) if (!rows.has(id)) rows.set(id, { id, name: '', canonical: '' });
    const q = model.trim().toLocaleLowerCase();
    return [...rows.values()].filter(row => row.id.length <= 200 && (row.id + ' ' + row.name + ' ' + row.canonical).toLocaleLowerCase().includes(q)).slice(0, 60);
  }, [catalog, model, state?.document]);
  const draft = validateManualRateDraft(model, values);
  const previewData = preview?.model === model.trim() ? preview.data : null;
  const nextRates = { ...previewData?.reference, ...draft.rates };
  const requestHeaders = { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': state?.token ?? '' };
  const save = async (remove = false) => {
    if (!state || savingDisabled) return;
    const validated = validateManualRateDraft(model, values, remove);
    setErrors(validated.errors); setError(''); setNotice('');
    if (!validated.valid) {
      const field = validated.errors.model ? 'model' : fields.find(field => validated.errors[field]) ?? 'input';
      requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('input[name="' + field + '"]')?.focus());
      return;
    }
    restoreFocus.current = true; setBusy(true);
    try {
      const result = await request<ManualPricingAdminState>(route, { method: 'POST', headers: requestHeaders, body: JSON.stringify({ revision: state.revision, model: validated.id, rates: remove ? null : validated.rates, ...(state.capabilities?.backgroundRecalculation ? { background: true } : {}) }) });
      setState(result); setModel(validated.id); setValues(manualRateDraft(result.document.models[validated.id])); setJob(result.job ?? null); setPollError(false); setPreviewRetry(value => value + 1);
      setNotice(result.job ? '' : result.recalculated === false ? 'admin.pending' : 'admin.saved');
      synced();
    } catch (error) {
      setError(error instanceof Error && error.message === 'PRICING_CONFLICT' ? 'admin.conflict' : error instanceof Error && error.message === 'PRICING_UPDATE_BUSY' ? 'admin.updateBusy' : 'admin.saveUnconfirmed');
    } finally { setBusy(false); }
  };
  const retryRecalculation = async () => {
    if (!state || busy) return;
    restoreFocus.current = true; setBusy(true); setError('');
    try {
      const result = await request<{ job: PricingRecalculationJob }>(route + '/recalculation', { method: 'POST', headers: requestHeaders, body: JSON.stringify({ revision: state.revision }) });
      setJob(result.job); setPollError(false);
    } catch (error) { setError(error instanceof Error && error.message === 'PRICING_CONFLICT' ? 'admin.conflict' : 'admin.failed'); }
    finally { setBusy(false); }
  };
  return <form ref={form} noValidate onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
    <div className="flex items-center gap-2"><p className="text-sm text-muted">{t('admin.unit')}</p><HelpPopover title={t('admin.pricing')}><p>{t('admin.priceHelp')}</p></HelpPopover></div>
    {!state && !readError && <p role="status" className="text-sm text-muted">{t('insights.loading')}</p>}
    {state && <>
      <ComboBox name="model" allowsCustomValue menuTrigger="input" inputValue={model} onInputChange={select} value={options.some(row => row.id === model) ? model : null} onChange={key => { if (key !== null) select(String(key)); }} items={options} isDisabled={savingDisabled} isInvalid={Boolean(errors.model)} validationBehavior="aria">
        <Label>{t('admin.model')}</Label><ComboBox.InputGroup><Input name="model" maxLength={200} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="openai/gpt-5" /><ComboBox.Trigger /></ComboBox.InputGroup>
        <Description>{t('admin.modelHint')}</Description><FieldError>{errors.model && t(errors.model)}</FieldError>
        <FilterComboBoxPopover className="w-[var(--trigger-width)]"><ListBox items={options} aria-label={t('admin.model')}>{row => <ListBox.Item id={row.id} textValue={row.id}><div className="min-w-0"><Label className="break-all text-xs">{row.id}</Label>{row.name && <Description className="break-words">{row.name}</Description>}</div><ListBox.ItemIndicator /></ListBox.Item>}</ListBox></FilterComboBoxPopover>
      </ComboBox>
      {Object.keys(state.document.models).length > 0 && <details className="text-xs"><summary className="cursor-pointer py-1 text-muted">{t('admin.overrides')}</summary><div className="mt-2 flex max-h-32 flex-wrap gap-1 overflow-auto">{Object.keys(state.document.models).map(id => <Button key={id} size="sm" variant={id === model ? 'secondary' : 'tertiary'} isDisabled={savingDisabled} onPress={() => select(id)} className="h-auto min-h-8 max-w-full px-2 py-1"><span className="break-all text-xs">{id}</span></Button>)}</div></details>}
      <div className="grid gap-3 sm:grid-cols-2">{fields.map(field => <TextField key={field} name={field} value={values[field]} onChange={value => { setValues(current => ({ ...current, [field]: value })); setErrors(current => ({ ...current, [field]: undefined, rates: undefined })); setError(''); setNotice(''); setJob(current => current?.status === 'succeeded' ? null : current); }} isDisabled={savingDisabled} isInvalid={Boolean(errors[field])} validationBehavior="aria"><Label>{t('admin.' + field)}</Label><Input name={field} inputMode="decimal" placeholder={t('admin.inherit')} /><FieldError>{errors[field] && t(errors[field]!)}</FieldError></TextField>)}</div>
      {errors.rates && <p role="alert" className="text-sm text-danger">{t(errors.rates)}</p>}
      {model.trim() && <div className="space-y-2">
        <p className="text-xs text-muted">{t('admin.previewUnit', { currency })}</p>
        {previewError ? <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-warning">{t('admin.previewFailed')}<Button size="sm" variant="tertiary" onPress={() => setPreviewRetry(value => value + 1)}>{t('insights.retry')}</Button></div>
          : !previewData ? <p role="status" className="text-xs text-muted">{t('insights.loading')}</p>
            : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="py-2 pr-3" scope="col">{t('admin.rate')}</th>{['reference', 'effective', 'preview'].map(key => <th key={key} scope="col" className="px-2 py-2 text-right font-medium">{t('admin.' + key)}</th>)}</tr></thead><tbody>{fields.map(field => <tr key={field} className="border-t border-separator"><th scope="row" className="py-2 pr-3 font-normal text-muted">{t('admin.' + field)}</th>{[previewData.reference?.[field], previewData.effective?.[field], draft.errors[field] ? undefined : nextRates[field]].map((rate, index) => <td key={index} className="px-2 py-2 text-right"><PricingRate value={rate ?? null} currency={currency} exchangeRate={exchangeRate} /></td>)}</tr>)}</tbody></table></div>}
      </div>}
      <div className="text-xs text-muted"><p>{t('admin.impact')}</p>{state.scope && <p className="mt-1">{state.scope.days ? t('admin.scope', { start: state.scope.fromDate, end: state.scope.toDate, count: state.scope.days }) : t('admin.noHistory')}</p>}</div>
      <div className="flex flex-wrap gap-2"><Button type="submit" ref={saveButton} isDisabled={savingDisabled}>{t(busy ? 'admin.saving' : 'admin.save')}</Button><Button variant="secondary" onPress={() => void save(true)} isDisabled={savingDisabled || !Object.hasOwn(state.document.models, model.trim())}>{t('admin.revert')}</Button></div>
    </>}
    {(readError || error) && <div role="alert" className="space-y-2"><p className="text-sm text-danger">{t(readError ? 'admin.localOnly' : error)}</p><Button size="sm" variant="secondary" isDisabled={busy} onPress={() => setReload(value => value + 1)}>{t(state ? 'admin.reloadDraft' : 'insights.retry')}</Button></div>}
    {job && <div role="status" className={'space-y-2 text-sm ' + (job.status === 'failed' || pollError ? 'text-warning' : job.status === 'succeeded' ? 'text-success' : 'text-muted')}>
      <p>{t(pollError ? 'admin.statusUnknown' : job.status === 'running' ? 'admin.updating' : job.status === 'succeeded' ? 'admin.saved' : 'admin.pending')}</p>
      {job.status === 'failed' && state?.capabilities?.backgroundRecalculation && <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void retryRecalculation()}>{t('admin.retryUpdate')}</Button>}
      {pollError && <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onPress={() => setPollRetry(value => value + 1)}>{t('insights.retry')}</Button><Button size="sm" variant="tertiary" onPress={() => setReload(value => value + 1)}>{t('admin.reloadDraft')}</Button></div>}
    </div>}
    {notice && <p role="status" className={'text-sm ' + (notice === 'admin.pending' ? 'text-warning' : 'text-success')}>{t(notice)}</p>}
  </form>;
}

export function ManualPricingEditor({ model, onClose, ...props }: { model: string | null; onClose(): void; catalog: PricingCatalogRow[] } & PriceDisplay) {
  const { t } = useTranslation();
  return <Modal.Backdrop isOpen={model !== null} onOpenChange={open => { if (!open) onClose(); }}><Modal.Container placement="center" scroll="inside"><Modal.Dialog className="w-full max-w-xl"><Modal.CloseTrigger /><Modal.Header><Modal.Heading>{t('admin.pricing')}</Modal.Heading></Modal.Header><Modal.Body>{model !== null && <Editor key={model} initialModel={model} {...props} />}</Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop>;
}
