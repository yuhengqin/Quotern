import { Button, Label, ListBox, Select } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { QuotaServiceStatus } from 'quotern-core/quota/shared/quota';
import { FilterSelectPopover } from './FilterMenu';

export function QuotaServiceDetails({ status, selected, saving, onSelect, onOpenExternal }: {
  status: QuotaServiceStatus; selected?: string[]; saving: boolean;
  onSelect?: (ids: string[]) => void; onOpenExternal: (url: string) => unknown;
}) {
  const { t, i18n } = useTranslation();
  const components = status.components ?? [];
  const ids = selected ?? components.map(component => component.id);
  const incidents = status.incidents ?? [];
  const followed = components.filter(component => ids.includes(component.id));
  const attention = status.stale ? [] : followed.filter(component => component.level !== 'operational');
  const secondary = followed.filter(component => !attention.includes(component));
  const rows = (items: typeof components) => items.map(component => <div key={component.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
    <span className="min-w-0 break-words">{component.name}</span><span className="text-muted">{t(`usage.quota.service.${status.stale ? 'unknown' : component.level}`)}</span>
  </div>);
  const label = status.selectionEmpty ? t('usage.quota.noServices') : t(`usage.quota.service.${status.stale ? 'unknown' : status.level}`);
  return <section data-quota-service-details tabIndex={-1} aria-label={t('usage.quota.serviceDetails')} className="flex min-w-0 flex-col gap-3 border-t border-separator pt-4 outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">{t('usage.quota.serviceDetails')}</h3>
      <Button size="sm" variant="tertiary" onPress={() => void onOpenExternal(status.url)}>{t('usage.quota.officialStatus')} ↗</Button>
    </div>
    {components.length > 0 && onSelect && <Select aria-label={t('usage.quota.followServices')} selectionMode="multiple" value={ids} isDisabled={saving}
      onChange={value => onSelect(Array.isArray(value) ? value.map(String) : [])}>
      <Label>{t('usage.quota.followServices')}</Label>
      <Select.Trigger><Select.Value>{() => ids.length ? t('usage.quota.servicesSelected', { count: ids.length }) : t('usage.quota.noServices')}</Select.Value><Select.Indicator /></Select.Trigger>
      <FilterSelectPopover><ListBox>{components.map(component => <ListBox.Item key={component.id} id={component.id} textValue={component.name}>
        <span className="min-w-0 whitespace-normal break-words">{component.name}</span><ListBox.ItemIndicator />
      </ListBox.Item>)}</ListBox></FilterSelectPopover>
    </Select>}
    <p role="status" className={`text-sm ${!status.stale && !['operational', 'unknown'].includes(status.level) ? 'text-amber-700 dark:text-amber-400' : 'text-muted'}`}>{label}</p>
    {status.stale && <p className="text-xs text-muted">{t('usage.quota.statusStale')}</p>}
    {!status.selectionEmpty && <div className="flex flex-col gap-2">
      {rows(attention)}
      {secondary.length > 0 && <details><summary className="cursor-pointer text-xs text-muted focus-visible:outline-2 focus-visible:outline-accent">{t(status.stale ? 'island.quota.serviceList' : 'island.quota.healthyServices', { count: secondary.length })}</summary><div className="mt-3 flex flex-col gap-2">{rows(secondary)}</div></details>}
    </div>}
    {incidents.map(incident => <details key={incident.id} className="rounded-lg border border-separator p-3" open>
      <summary className="cursor-pointer break-words text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent">{incident.name}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-xs text-muted">{t(`usage.quota.incident.${['investigating', 'identified', 'monitoring'].includes(incident.phase) ? incident.phase : 'update'}`)}{incident.updatedAt ? ` · ${new Date(incident.updatedAt * 1000).toLocaleString(i18n.resolvedLanguage)}` : ''}</p>
        {incident.body && <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{incident.body}</p>}
        <Button size="sm" variant="tertiary" className="w-fit" onPress={() => void onOpenExternal(incident.url)}>{t('usage.quota.incidentLink')} ↗</Button>
      </div>
    </details>)}
    {!status.stale && status.level === 'operational' && !incidents.length && <p className="text-xs text-muted">{t('usage.quota.noIncidents')}</p>}
    <p className="text-xs text-muted">{status.checkedAt ? t('usage.quota.checkedAt', { date: new Date(status.checkedAt * 1000).toLocaleString(i18n.resolvedLanguage) }) : t('usage.quota.noStatus')}</p>
  </section>;
}
