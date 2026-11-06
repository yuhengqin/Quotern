import { useEffect, useRef, useState } from 'react';
import { Button, Description, FieldError, Input, Label, Modal, TextField } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { ManualPricingState, ModelPricingRates } from 'quotern-core';
import { request } from '@/lib/api';
import { isDemoMode } from '@/lib/demo-runtime';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';
import { HelpPopover } from './HelpPopover';
import '../i18n/data-management-messages';
import '../i18n/insights-messages';

type State = ManualPricingState & { token: string; recalculated?: boolean };
const fields = ['input', 'output', 'cache_read', 'cache_write'] as const;
const empty = () => ({ input: '', output: '', cache_read: '', cache_write: '' });
const route = '/functions/tud-local-admin/pricing';

function Editor() {
  const { t } = useTranslation();
  const [state, setState] = useState<State | null>(null), [reload, setReload] = useState(0);
  const [model, setModel] = useState(''), [values, setValues] = useState(empty);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!busy && restoreFocus.current) {
      restoreFocus.current = false;
      saveButton.current?.focus();
    }
  }, [busy]);
  const select = (id: string, current = state) => {
    setModel(id); setSubmitted(false); setError(''); setNotice('');
    setValues(Object.fromEntries(fields.map(field => [field, current?.document.models[id]?.[field]?.toString() ?? ''])) as ReturnType<typeof empty>);
  };
  useEffect(() => {
    const controller = new AbortController(); setError('');
    void request<State>(route, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setState(result); select(model, result); }
    }).catch(() => { if (!controller.signal.aborted) setError('admin.localOnly'); });
    return () => controller.abort();
  }, [reload]);
  const invalidField = (field: typeof fields[number]) => values[field].trim() !== '' && (!Number.isFinite(Number(values[field])) || Number(values[field]) < 0 || Number(values[field]) > 1_000_000);
  const save = async (remove = false) => {
    setSubmitted(true); setError(''); setNotice('');
    const rates: ModelPricingRates = Object.fromEntries(fields.filter(field => values[field].trim() !== '').map(field => [field, Number(values[field])]));
    if (!state || !model.trim() || model.trim().length > 200 || (!remove && (fields.some(invalidField) || !Object.keys(rates).length))) { setError('admin.invalid'); return; }
    restoreFocus.current = true; setBusy(true);
    try {
      const result = await request<State>(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': state.token }, body: JSON.stringify({ revision: state.revision, model: model.trim(), rates: remove ? null : rates }) });
      setState(result); select(model.trim(), result); setNotice(result.recalculated === false ? 'admin.pending' : 'admin.saved');
      window.dispatchEvent(new CustomEvent(DATA_SYNCED_EVENT));
    } catch (error) { setError(error instanceof Error && error.message === 'PRICING_CONFLICT' ? 'admin.conflict' : 'admin.failed'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    <div className="flex items-center gap-2"><p className="text-sm text-muted">{t('admin.unit')}</p><HelpPopover title={t('admin.pricing')}><p>{t('admin.priceHelp')}</p></HelpPopover></div>
    {!state && !error && <p role="status" className="text-sm text-muted">{t('insights.loading')}</p>}
    {state && <>
      {Object.keys(state.document.models).length > 0 && <div><p className="mb-2 text-xs text-muted">{t('admin.overrides')}</p><div className="flex max-h-32 flex-wrap gap-1 overflow-auto">{Object.keys(state.document.models).map(id => <Button key={id} size="sm" variant={id === model ? 'secondary' : 'tertiary'} isDisabled={busy} onPress={() => select(id)} className="h-auto min-h-8 max-w-full px-2 py-1"><span className="break-all text-xs">{id}</span></Button>)}</div></div>}
      <TextField value={model} onChange={select} isDisabled={busy} isInvalid={submitted && !model.trim()}><Label>{t('admin.model')}</Label><Input maxLength={200} placeholder="openai/gpt-5" /><Description>{t('admin.modelHint')}</Description></TextField>
      <div className="grid gap-3 sm:grid-cols-2">{fields.map(field => <TextField key={field} value={values[field]} onChange={value => { setValues(current => ({ ...current, [field]: value })); setError(''); setNotice(''); }} isDisabled={busy} isInvalid={submitted && invalidField(field)}><Label>{t(`admin.${field}`)}</Label><Input inputMode="decimal" placeholder={t('admin.inherit')} /><FieldError>{t('admin.invalid')}</FieldError></TextField>)}</div>
      <p className="text-xs text-muted">{t('admin.impact')}</p>
      <div className="flex flex-wrap gap-2"><Button ref={saveButton} onPress={() => void save()} isDisabled={busy}>{t(busy ? 'admin.saving' : 'admin.save')}</Button><Button variant="secondary" onPress={() => void save(true)} isDisabled={busy || !Object.hasOwn(state.document.models, model.trim())}>{t('admin.revert')}</Button></div>
    </>}
    {error && <div role="alert" className="space-y-2"><p className="text-sm text-danger">{t(error)}</p><Button size="sm" variant="secondary" isDisabled={busy} onPress={() => setReload(value => value + 1)}>{t('insights.retry')}</Button></div>}
    {notice && <p role="status" className="text-sm text-success">{t(notice)}</p>}
  </div>;
}

export function ManualPricingEditor() {
  const { t } = useTranslation();
  if (isDemoMode()) return null;
  return <Modal><Button size="sm" variant="secondary" className="h-8 min-h-8 text-xs">{t('admin.pricing')}</Button><Modal.Backdrop><Modal.Container placement="center" scroll="inside"><Modal.Dialog className="w-full max-w-lg"><Modal.CloseTrigger /><Modal.Header><Modal.Heading>{t('admin.pricing')}</Modal.Heading></Modal.Header><Modal.Body><Editor /></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}
