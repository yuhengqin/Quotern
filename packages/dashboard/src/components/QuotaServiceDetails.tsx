import { Button, Label, ListBox, Select } from '@heroui/react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { QuotaServiceStatus } from 'quotern-core/quota/shared/quota';
import { FilterSelectPopover } from './FilterMenu';
import { SideDrawer } from './SideDrawer';

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

type ServiceContentProps = {
  status: QuotaServiceStatus; statusLabel: string; dotClassName: string;
  selected?: string[]; saving: boolean; saveError?: string;
  onSelect?: (ids: string[]) => void; onOpenExternal: (url: string) => unknown;
};

export function QuotaServiceDetails({ providerLabel, showSummary, isOpen, onOpenChange, ...content }: ServiceContentProps & {
  providerLabel: string; showSummary: boolean; isOpen: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return <>
    {showSummary && <ServiceContent {...content} summaryTrigger={{ expanded: isOpen, onPress: () => onOpenChange(true) }} />}
    <SideDrawer isOpen={isOpen} onOpenChange={onOpenChange} title={t('usage.quota.providerServiceDetails', { provider: providerLabel })}
      footer={<Button size="sm" variant="tertiary" onPress={() => void content.onOpenExternal(content.status.url)}>{t('usage.quota.officialStatus')} ↗</Button>}>
      <ServiceContent {...content} />
    </SideDrawer>
  </>;
}

function ServiceContent({ status, statusLabel, dotClassName, selected, saving, saveError, onSelect, onOpenExternal, summaryTrigger }: ServiceContentProps & {
  summaryTrigger?: { expanded: boolean; onPress: () => void };
}) {
  const { t, i18n } = useTranslation();
  const components = status.components ?? [];
  const incidents = status.incidents ?? [];
  const selectedIds = selected && new Set(selected);
  const followed = selectedIds ? components.filter(component => selectedIds.has(component.id)) : components;
  const attention = status.stale ? [] : followed.filter(component => component.level !== 'operational');
  const healthy = !status.selectionEmpty && !status.stale && status.level === 'operational' && !attention.length && !incidents.length;
  const summary = healthy && followed.length ? t('usage.quota.servicesHealthy', { count: followed.length }) : statusLabel;
  const labels = serviceLabels(status);
  const rows = (items: typeof components, showLevel: boolean) => items.length > 0 && <ul className={`grid gap-x-5 gap-y-2 ${showLevel ? '' : 'min-[380px]:grid-cols-2'}`}>
    {items.map(component => <li key={component.id} className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
      <span className="min-w-0 break-words">{labels.get(component.id)}</span>
      {showLevel && <span className="text-muted">{t(`usage.quota.service.${status.stale ? 'unknown' : component.level}`)}</span>}
    </li>)}
  </ul>;
  const alerts = !healthy && <>
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
  </>;
  const dot = <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dotClassName}`} />;
  if (summaryTrigger) return <section data-quota-service-details aria-label={t('usage.quota.serviceDetails')} className="flex min-w-0 flex-col gap-3 border-t border-separator pt-3">
    <div role="status" className="flex">
      <Button data-quota-service-summary aria-haspopup="dialog" aria-expanded={summaryTrigger.expanded} variant="ghost" size="sm"
        className="h-auto min-h-9 w-full justify-start gap-2 rounded-md px-1 text-sm font-normal text-muted"
        onPress={summaryTrigger.onPress}>
        {dot}{summary}<ChevronRight aria-hidden="true" className="ml-auto size-4" />
      </Button>
    </div>
    {alerts}
  </section>;
  const ids = selected ?? components.map(component => component.id);
  const secondary = status.stale ? followed : followed.filter(component => component.level === 'operational');
  return <div className="flex min-w-0 flex-col gap-4">
    <p role="status" className="flex items-center gap-2 text-sm">{dot}{summary}</p>
    {alerts}
    {components.length > 0 && onSelect && <Select className="min-w-0" selectionMode="multiple" value={ids} isDisabled={saving}
      onChange={value => onSelect(Array.isArray(value) ? value.map(String) : [])}>
      <Label>{t('usage.quota.followServices')}</Label>
      <Select.Trigger><Select.Value>{() => ids.length ? t('usage.quota.servicesSelected', { count: ids.length }) : t('usage.quota.noServices')}</Select.Value><Select.Indicator /></Select.Trigger>
      <FilterSelectPopover><ListBox>{components.map(component => <ListBox.Item key={component.id} id={component.id} textValue={labels.get(component.id)}>
        <span className="min-w-0 whitespace-normal break-words">{labels.get(component.id)}</span><ListBox.ItemIndicator />
      </ListBox.Item>)}</ListBox></FilterSelectPopover>
    </Select>}
    {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
    {healthy ? rows(followed, false) : secondary.length > 0 && <details><summary className="cursor-pointer text-sm text-muted focus-visible:outline-2 focus-visible:outline-accent">{t(status.stale ? 'island.quota.serviceList' : 'island.quota.healthyServices', { count: secondary.length })}</summary><div className="mt-3">{rows(secondary, status.stale)}</div></details>}
  </div>;
}
