import { useRef, useState } from 'react';
import type { QuotaPreferences, QuotaPreferencePatch, QuotaProviderState } from 'quotern-core/quota/shared/quota';
import { useTranslation } from 'quotern-i18n/react';
import { mergeQuotaOrder, moveQuotaProvider, orderQuotaProviders, type QuotaDropTarget } from '../lib/quota-layout';

export function useQuotaLayout(providers: QuotaProviderState[], preferences: QuotaPreferences | undefined, onSave: (patch: QuotaPreferencePatch) => Promise<unknown>) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<{ order: string[]; compact: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [announcement, setAnnouncement] = useState('');
  const [dropTarget, setDropTarget] = useState<QuotaDropTarget | null>(null);
  const busyRef = useRef(false), dragOwner = useRef<string | null>(null);
  const rootRef = useRef<HTMLElement>(null), triggerRef = useRef<HTMLButtonElement>(null);
  const ordered = orderQuotaProviders(providers, draft?.order ?? preferences?.providerOrder);
  const restoreFocus = () => requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  const cancel = () => { if (busyRef.current || dragOwner.current) return; setDraft(null); setError(false); restoreFocus(); };
  const move = (id: string, target: string, placement: 'before' | 'after') => {
    if (!draft || busyRef.current) return;
    const ids = ordered.map(provider => provider.id), next = moveQuotaProvider(ids, id, target, placement);
    if (next.every((value, index) => value === ids[index])) return;
    setDraft(current => current && ({ ...current, order: mergeQuotaOrder(current.order, next) }));
    setAnnouncement(t('quota.moved', { name: providers.find(provider => provider.id === id)?.label ?? id, position: next.indexOf(id) + 1, count: next.length }));
  };
  const finish = async () => {
    if (!draft || busyRef.current || dragOwner.current) return;
    busyRef.current = true; setBusy(true); setError(false);
    try {
      const fullOrder = [...draft.order, ...(preferences?.providerOrder ?? []).filter(id => !draft.order.includes(id))];
      await onSave({ providerOrder: mergeQuotaOrder(fullOrder, ordered.map(provider => provider.id)), compact: draft.compact });
      setDraft(null); setAnnouncement(t('quota.layoutSaved')); restoreFocus();
    } catch { setError(true); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return {
    editing: draft !== null, busy, error, announcement, ordered, dropTarget, setDropTarget, dragOwner, rootRef, triggerRef,
    compact: draft?.compact ?? preferences?.compact ?? false,
    start: () => {
      setError(false); setDraft({ order: mergeQuotaOrder(preferences?.providerOrder ?? [], ordered.map(provider => provider.id)), compact: preferences?.compact ?? false });
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('[data-quota-drag-handle]')?.focus({ preventScroll: true }));
    },
    setCompact: (compact: boolean) => { if (!busyRef.current) setDraft(current => current && ({ ...current, compact })); },
    cancel, finish, move,
  };
}

export type QuotaLayoutEditor = ReturnType<typeof useQuotaLayout>;
