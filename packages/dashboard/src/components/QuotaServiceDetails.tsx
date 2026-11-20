import { useEffect, useRef } from 'react';
import { Button, Label, ListBox, Select } from '@heroui/react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { QuotaServiceStatus } from 'quotern-core/quota/shared/quota';
import { FilterSelectPopover } from './FilterMenu';

// status.openai.com lists these under APIs and ChatGPT, but its v2 summary omits the groups.
const openAiGroups = new Map([
  ['01JSM5RTJWHRWDTS6Q604VEW3B', 'APIs'],
  ['01JMXBNJXG1S2D9V65P1ZZTD94', 'ChatGPT'],
]);

function serviceLabels(status: QuotaServiceStatus) {
  const components = status.components ?? [];
  const names = new Map<string, number>();
  for (const component of components) names.set(component.name, (names.get(component.name) ?? 0) + 1);
  const isOpenAi = status.url === 'https://status.openai.com' || status.url === 'https://status.openai.com/';
  const labels = new Map<string, string>(), labelCounts = new Map<string, number>();
  for (const component of components) {
    const group = component.groupName || (isOpenAi && openAiGroups.get(component.id));
    const label = group && names.get(component.name)! > 1 ? `${group} · ${component.name}` : component.name;
    labels.set(component.id, label);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  for (const [id, label] of labels) {
    if (labelCounts.get(label)! > 1) labels.set(id, `${label} · ${id}`);
  }
  return labels;
}

export function QuotaServiceDetails({ status, statusLabel, openAtService, selected, saving, onSelect, onOpenExternal }: {
  status: QuotaServiceStatus; statusLabel: string; openAtService: boolean; selected?: string[]; saving: boolean;
  onSelect?: (ids: string[]) => void; onOpenExternal: (url: string) => unknown;
}) {
  const { t, i18n } = useTranslation();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const components = status.components ?? [];
  const ids = selected ?? components.map(component => component.id);
  const incidents = status.incidents ?? [];
  const followed = components.filter(component => ids.includes(component.id));
  const attention = status.stale ? [] : followed.filter(component => component.level !== 'operational');
  const secondary = followed.filter(component => !attention.includes(component));
  const healthy = !status.selectionEmpty && !status.stale && status.level === 'operational' && !attention.length && !incidents.length;
  useEffect(() => {
    if (openAtService && disclosure.current) disclosure.current.open = true;
  }, [openAtService, healthy]);
  const labels = serviceLabels(status);
  const rows = (items: typeof components, showLevel: boolean) => items.length > 0 && <ul className={`grid gap-x-4 gap-y-2 ${showLevel ? '' : 'sm:grid-cols-2'}`}>
    {items.map(component => <li key={component.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
      <span className="min-w-0 break-words">{labels.get(component.id)}</span>
      {showLevel && <span className="text-muted">{t(`usage.quota.service.${status.stale ? 'unknown' : component.level}`)}</span>}
    </li>)}
  </ul>;
  const controls = <div className="flex flex-wrap items-end justify-between gap-2">
      {components.length > 0 && onSelect && <Select className="min-w-0 flex-1 basis-52" aria-label={t('usage.quota.followServices')} selectionMode="multiple" value={ids} isDisabled={saving}
        onChange={value => onSelect(Array.isArray(value) ? value.map(String) : [])}>
        <Label>{t('usage.quota.followServices')}</Label>
        <Select.Trigger><Select.Value>{() => ids.length ? t('usage.quota.servicesSelected', { count: ids.length }) : t('usage.quota.noServices')}</Select.Value><Select.Indicator /></Select.Trigger>
        <FilterSelectPopover><ListBox>{components.map(component => <ListBox.Item key={component.id} id={component.id} textValue={labels.get(component.id)}>
          <span className="min-w-0 whitespace-normal break-words">{labels.get(component.id)}</span><ListBox.ItemIndicator />
        </ListBox.Item>)}</ListBox></FilterSelectPopover>
      </Select>}
      <Button size="sm" variant="tertiary" onPress={() => void onOpenExternal(status.url)}>{t('usage.quota.officialStatus')} ↗</Button>
  </div>;
  return <section data-quota-service-details tabIndex={-1} aria-label={t('usage.quota.serviceDetails')} className="flex min-w-0 flex-col gap-3 border-t border-separator pt-3 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent">
    {healthy ? <details ref={disclosure} className="group/services">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-accent">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />
        {followed.length ? t('usage.quota.servicesHealthy', { count: followed.length }) : t('usage.quota.service.operational')}
        <ChevronRight aria-hidden="true" className="ml-auto size-4 text-muted group-open/services:rotate-90" />
      </summary>
      <div className="mt-3 flex flex-col gap-3">{controls}{rows(followed, false)}</div>
    </details> : <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{t('usage.quota.serviceDetails')}</h3>
        <p role="status" className={`text-sm ${attention.length || incidents.length ? 'text-warning' : 'text-muted'}`}>
          {statusLabel}
        </p>
      </div>
      {status.stale && <p className="text-xs text-muted">{t('usage.quota.statusStale')}</p>}
      {rows(attention, true)}
      {incidents.map(incident => <details key={incident.id} className="rounded-lg border border-separator p-3" open>
        <summary className="cursor-pointer break-words text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent">{incident.name}</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-muted">{t(`usage.quota.incident.${['investigating', 'identified', 'monitoring'].includes(incident.phase) ? incident.phase : 'update'}`)}{incident.updatedAt ? ` · ${new Date(incident.updatedAt * 1000).toLocaleString(i18n.resolvedLanguage)}` : ''}</p>
          {incident.body && <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{incident.body}</p>}
          <Button size="sm" variant="tertiary" className="w-fit" onPress={() => void onOpenExternal(incident.url)}>{t('usage.quota.incidentLink')} ↗</Button>
        </div>
      </details>)}
      {controls}
      {secondary.length > 0 && <details><summary className="cursor-pointer text-xs text-muted focus-visible:outline-2 focus-visible:outline-accent">{t(status.stale ? 'island.quota.serviceList' : 'island.quota.healthyServices', { count: secondary.length })}</summary><div className="mt-3">{rows(secondary, status.stale)}</div></details>}
    </>}
  </section>;
}
