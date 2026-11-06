import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Description, Input, Label, ListBox, Modal, Select, TextField } from '@heroui/react';
import { registerMessages } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import type { BillingConnectionView, BillingOrganization, BillingReport, BillingSection, BillingSource, BillingView, ConsoleDetails } from 'quotern-core/quota/shared/billing';
import { request } from '@/lib/api';
import { formatUsd } from '@/lib/format';
import { isDemoMode } from '@/lib/demo-runtime';
import { FilterSelectPopover } from './FilterMenu';
import { HelpPopover } from './HelpPopover';
import { accountBillingMessages } from '../i18n/account-billing-messages';
registerMessages(accountBillingMessages);

const endpoint = '/functions/tud-claude-billing';
function errorKey(error: unknown) {
  const code = (error instanceof Error ? error.message : String(error)).match(/(?:BILLING|LOCAL_ACTION)_[A-Z_]+/)?.[0];
  if (code === 'LOCAL_ACTION_ONLY') return 'account.localOnly';
  if (code === 'LOCAL_ACTION_FORBIDDEN') return 'billing.error.BILLING_CONFLICT';
  return code && ['BILLING_AUTH', 'BILLING_CHALLENGE', 'BILLING_RATE_LIMIT', 'BILLING_CURRENCY', 'BILLING_INVALID_RESPONSE', 'BILLING_COOKIE_INVALID', 'BILLING_ORGANIZATION_INVALID', 'BILLING_CONFLICT', 'BILLING_SECRET_UNAVAILABLE', 'BILLING_STORAGE', 'BILLING_RESPONSE_TOO_LARGE'].includes(code) ? `billing.error.${code}` : 'billing.error.generic';
}
const post = <T,>(token: string, body: Record<string, unknown>) => request<T>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Billing-Action': token }, body: JSON.stringify(body) });

export function BillingPanel() {
  const { t } = useTranslation(), [open, setOpen] = useState(false);
  if (isDemoMode()) return null;
  return <Modal isOpen={open} onOpenChange={setOpen}>
    <Button size="sm" variant="ghost" className="h-7 text-xs">{t('billing.open')}</Button>
    <Modal.Backdrop><Modal.Container placement="center" scroll="inside"><Modal.Dialog className="w-full max-w-3xl" aria-label={t('billing.title')}>
      <Modal.CloseTrigger aria-label={t('billing.close')} /><Modal.Header><Modal.Heading className="flex items-center gap-2">{t('billing.title')}<HelpPopover title={t('billing.title')}><p>{t('billing.help')}</p></HelpPopover></Modal.Heading></Modal.Header>
      <Modal.Body>{open && <BillingContent />}</Modal.Body>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </Modal>;
}

function BillingContent() {
  const { t } = useTranslation(), [view, setView] = useState<BillingView | null>(null), [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = async () => { const id = ++generation.current; setError(null); try { const next = await request<BillingView>(endpoint); if (id === generation.current) setView(next); } catch (cause) { if (id === generation.current) setError(errorKey(cause)); } };
  useEffect(() => { void load(); return () => { generation.current++; }; }, []);
  if (!view) return error ? <div role="alert" className="space-y-2 text-sm text-danger"><p>{t(error)}</p><Button size="sm" variant="secondary" onPress={() => void load()}>{t('billing.retry')}</Button></div> : <p role="status" className="text-sm text-muted">{t('billing.loading')}</p>;
  return <div className="space-y-6">{(['extra', 'console'] as const).map(source => <BillingSourcePanel key={source} source={source} initial={view.connections[source]} initialToken={view.token} />)}</div>;
}

function BillingSourcePanel({ source, initial, initialToken }: { source: BillingSource; initial: BillingConnectionView; initialToken: string }) {
  const { t } = useTranslation(), [connection, setConnection] = useState(initial), [token, setToken] = useState(initialToken);
  const [editing, setEditing] = useState(false), [cookie, setCookie] = useState(''), [organizations, setOrganizations] = useState<BillingOrganization[]>([]), [organizationId, setOrganizationId] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [feedback, setFeedback] = useState('');
  const busy = useRef(false), alive = useRef(true), attempted = useRef(false), errorId = useId();
  const connectionTrigger = useRef<HTMLButtonElement>(null), restoreFormFocus = useRef(false);
  useEffect(() => { if (!editing && !pending && restoreFormFocus.current) { restoreFormFocus.current = false; connectionTrigger.current?.focus(); } }, [editing, pending]);
  const apply = (view: BillingView) => { if (alive.current) { setConnection(view.connections[source]); setToken(view.token); } };
  const reload = async () => { apply(await request<BillingView>(endpoint)); };
  const run = async (operation: () => Promise<void>) => {
    if (busy.current) return; busy.current = true; setPending(true); setError(null); setFeedback('');
    try { await operation(); }
    catch (cause) {
      if (alive.current) setError(errorKey(cause));
      if (errorKey(cause) === 'billing.error.BILLING_CONFLICT') await reload().catch(() => {});
    } finally { busy.current = false; if (alive.current) setPending(false); }
  };
  const refresh = (current = connection, currentToken = token) => run(async () => apply(await post<BillingView>(currentToken, { action: 'refresh', source, revision: current.revision })));
  useEffect(() => {
    alive.current = true;
    if (!attempted.current && initial.organization && (!initial.report || initial.report.attemptedAt < Date.now() / 1000 - 60)) { attempted.current = true; void refresh(initial, initialToken); }
    return () => { alive.current = false; };
  }, []);
  const discover = () => run(async () => {
    const found = await post<BillingOrganization[]>(token, { action: 'discover', source, cookie });
    if (alive.current) { setOrganizations(found); setOrganizationId(found[0]?.id ?? ''); if (!found.length) setError('billing.noOrganizations'); }
  });
  const connect = () => run(async () => {
    const saved = await post<BillingView>(token, { action: 'connect', source, cookie, organizationId, revision: connection.revision });
    apply(saved); if (alive.current) { restoreFormFocus.current = true; setCookie(''); setEditing(false); setOrganizations([]); setFeedback(t('billing.connected')); }
    // Saving and reading are distinct: a reading failure must not imply the connection was not saved.
    try { apply(await post<BillingView>(saved.token, { action: 'refresh', source, revision: saved.connections[source].revision })); }
    catch (cause) { if (alive.current) setError(errorKey(cause)); }
  });
  const disconnect = () => run(async () => { apply(await post<BillingView>(token, { action: 'disconnect', source, revision: connection.revision })); if (alive.current) { restoreFormFocus.current = true; setCookie(''); setOrganizations([]); setEditing(false); setFeedback(t('billing.removed')); } });
  const resetForm = () => { restoreFormFocus.current = true; setEditing(false); setCookie(''); setOrganizations([]); setOrganizationId(''); setError(null); };
  return <section aria-label={t(`billing.${source}`)} className="min-w-0 space-y-3 rounded-xl border border-separator p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-sm font-semibold">{t(`billing.${source}`)}</h3><p className="mt-1 break-words text-xs text-muted">{connection.organization?.name ?? t('billing.notConnected')}</p></div>
      <div className="flex flex-wrap gap-1">{connection.organization && <Button size="sm" variant="secondary" isPending={pending} onPress={() => void refresh()}>{t('billing.refresh')}</Button>}
        <Button ref={connectionTrigger} size="sm" variant="ghost" isDisabled={pending || !!connection.error} onPress={() => { setEditing(true); setError(null); setFeedback(''); }}>{t(connection.organization ? 'billing.replace' : 'billing.connect')}</Button>
      </div>
    </div>
    {connection.error && <p role="alert" className="text-xs text-danger">{t(errorKey(connection.error))}</p>}
    {connection.organization && <BillingReportContent report={connection.report} source={source} />}
    {editing && <form className="space-y-3 border-t border-separator pt-3" onSubmit={event => { event.preventDefault(); if (organizations.length) void connect(); else void discover(); }}>
      <div className="flex items-center gap-2"><span className="text-xs font-medium">{t('billing.cookie')}</span><HelpPopover title={t('billing.cookie')}><p>{t('billing.credentialHelp')}</p><a href={source === 'extra' ? 'https://claude.ai/settings/usage' : 'https://console.anthropic.com/settings/billing'} target="_blank" rel="noreferrer" className="text-accent underline">{t('billing.website')}</a></HelpPopover></div>
      <TextField aria-label={t('billing.cookie')} type="password" isRequired isDisabled={pending} value={cookie} onChange={value => { setCookie(value); setOrganizations([]); setOrganizationId(''); setError(null); }} isInvalid={error === 'billing.error.BILLING_COOKIE_INVALID'}>
        <Input aria-describedby={error ? errorId : undefined} autoComplete="off" maxLength={16384} placeholder="sessionKey=…" />
        <Description>{source === 'extra' ? 'claude.ai' : 'console.anthropic.com'}</Description>
      </TextField>
      {!!organizations.length && <Select aria-label={t('billing.organization')} isDisabled={pending} value={organizationId} onChange={key => setOrganizationId(String(key ?? ''))} className="max-w-full"><Label>{t('billing.organization')}</Label><Select.Trigger className="w-full"><Select.Value className="truncate" /><Select.Indicator /></Select.Trigger><FilterSelectPopover><ListBox aria-label={t('billing.organization')}>{organizations.map(org => <ListBox.Item key={org.id} id={org.id} textValue={org.name}><span className="break-words">{org.name}</span><ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></FilterSelectPopover></Select>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" variant="secondary" isPending={pending} isDisabled={!cookie.trim() || !!organizations.length && !organizationId}>{t(organizations.length ? 'billing.connect' : 'billing.discover')}</Button><Button size="sm" variant="ghost" isDisabled={pending} onPress={resetForm}>{t('billing.cancel')}</Button>{connection.organization && <Button size="sm" variant="danger-soft" isDisabled={pending} onPress={() => void disconnect()}>{t('billing.disconnect')}</Button>}</div>
    </form>}
    {feedback && <p role="status" className="text-xs text-muted">{feedback}</p>}
    {error && <p id={errorId} role="alert" className="text-xs text-danger">{t(error)}</p>}
  </section>;
}

function Reading<T>({ section, children }: { section?: BillingSection<T>; children(data: T | null): ReactNode }) {
  const { t, i18n } = useTranslation(), locale = i18n.language;
  return <div className="min-w-0 space-y-2">{children(section?.data ?? null)}
    {section?.error && <p role="status" className="text-xs text-warning">{t(errorKey(section.error))}{section.data && ` · ${t('billing.stale')}`}</p>}
    {section?.observedAt != null && <p className="text-[11px] text-muted">{t('billing.observed', { time: new Date(section.observedAt * 1000).toLocaleString(locale) })}</p>}
  </div>;
}
function Money({ title, amount }: { title: string; amount: number | null | undefined }) {
  const { i18n } = useTranslation(), locale = i18n.language;
  return <div className="min-w-0"><dt className="text-xs text-muted">{title}</dt><dd className="mt-1 break-words font-mono text-lg font-medium tabular-nums">{formatUsd(amount, locale)}</dd></div>;
}
function BillingReportContent({ report, source }: { report: BillingReport | null; source: BillingSource }) {
  const { t, i18n } = useTranslation(), locale = i18n.language;
  if (!report) return <p className="text-xs text-muted">{t('billing.noReport')}</p>;
  if (source === 'extra') return <div className="grid gap-4 sm:grid-cols-2">
    <Reading section={report.spend}>{data => <><dl className="grid grid-cols-2 gap-3"><Money title={t('billing.used')} amount={data?.usedUsd} /><Money title={t('billing.limit')} amount={data?.limitUsd} /></dl>{data?.enabled === false && <p className="mt-2 text-xs text-muted">{t('billing.disabled')}</p>}</>}</Reading>
    <Reading section={report.grants}>{data => <dl className="grid grid-cols-2 gap-3"><Money title={t('billing.remaining')} amount={data?.remainingUsd} /><Money title={t('billing.granted')} amount={data?.grantedUsd} /></dl>}</Reading>
  </div>;
  return <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2">
    <Reading section={report.currentSpend}>{data => <><dl><Money title={t('billing.currentSpend')} amount={data?.usd} /></dl>{data?.resetsAt && <p className="mt-1 text-xs text-muted">{t('billing.reset', { time: new Date(data.resetsAt).toLocaleString(locale) })}</p>}</>}</Reading>
    <Reading section={report.prepaid}>{data => <dl><Money title={t('billing.prepaid')} amount={data?.usd} /></dl>}</Reading>
  </div><Reading section={report.details}>{data => data ? <ConsoleBreakdown data={data} /> : <p className="text-xs text-muted">{t('billing.details')} · —</p>}</Reading></div>;
}

function ConsoleBreakdown({ data }: { data: ConsoleDetails }) {
  const { t, i18n } = useTranslation(), locale = i18n.language, [group, setGroup] = useState<'day' | 'model' | 'key'>('day');
  const grouped = useMemo(() => {
    const values = new Map<string, { name: string; id: string | null; usd: number; known: boolean; partial: boolean }>();
    for (const row of data.rows) {
      const id = group === 'day' ? row.day : group === 'model' ? row.model : row.keyId;
      const old = values.get(id ?? '') ?? { name: group === 'key' ? row.keyName ?? id ?? t('billing.unknown') : id ?? t('billing.unknown'), id, usd: 0, known: false, partial: false };
      if (row.usd === null) old.partial = true; else { old.usd += row.usd; old.known = true; }
      values.set(id ?? '', old);
    }
    return [...values.values()].sort((a, b) => group === 'day' ? a.name.localeCompare(b.name) : b.usd - a.usd);
  }, [data, group, t]);
  return <details className="space-y-3 border-t border-separator pt-3">
    <summary className="cursor-pointer text-sm">{t('billing.details')} · <span className="font-mono tabular-nums">{formatUsd(data.totalUsd, locale)}</span>{!data.complete && <span className="ml-2 text-xs text-warning">{t('billing.knownSubtotal')}</span>}</summary>
    <p className="text-xs text-muted">{t('billing.range', { from: data.from, until: data.until })}</p>
    <div role="group" aria-label={t('billing.details')} className="flex flex-wrap gap-1">{(['day', 'model', 'key'] as const).map(key => <Button key={key} size="sm" variant={group === key ? 'secondary' : 'ghost'} aria-pressed={group === key} onPress={() => setGroup(key)}>{t(key === 'day' ? 'billing.byDay' : key === 'model' ? 'billing.byModel' : 'billing.byKey')}</Button>)}</div>
    {!grouped.length ? <p className="text-xs text-muted">{t('billing.empty')}</p> : <div className="max-h-72 overflow-auto rounded-lg" tabIndex={0} role="region" aria-label={t('billing.details')}><table className="w-full table-fixed text-left text-xs"><thead><tr className="border-b border-separator text-muted"><th scope="col" className="w-2/3 py-2 font-normal">{t(group === 'day' ? 'billing.byDay' : group === 'model' ? 'billing.byModel' : 'billing.byKey')}</th><th scope="col" className="py-2 text-right font-normal">{t('billing.amount')}</th></tr></thead><tbody>{grouped.map((row, i) => <tr key={row.id ?? `unknown-${i}`} className="border-b border-separator"><th scope="row" className="break-words py-2 pr-3 font-normal">{row.name}{group === 'key' && row.id && row.name !== row.id && <span className="mt-1 block break-all text-[11px] text-muted">{row.id}</span>}</th><td className="py-2 text-right font-mono tabular-nums">{formatUsd(row.known ? row.usd : null, locale)}{row.partial && <span className="mt-1 block font-sans text-[11px] text-warning">{t('billing.partial')}</span>}</td></tr>)}</tbody></table></div>}
  </details>;
}
