import { Label, ListBox, Select } from '@heroui/react';
import { FilterSelectPopover } from './FilterMenu';

/** Labeled single-value filters for analysis pages and detail panels. */
export function InsightSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ id: string; label: string }>; onChange(value: string): void }) {
  return <Select aria-label={label} value={value} onChange={key => { if (key !== null) onChange(String(key)); }} className="min-w-36 max-w-full">
    <Label className="text-xs text-muted">{label}</Label>
    <Select.Trigger className="h-9 min-h-9 max-w-64"><Select.Value className="truncate text-sm leading-5" /><Select.Indicator /></Select.Trigger>
    <FilterSelectPopover className="w-72"><ListBox aria-label={label}>{options.map(option => <ListBox.Item key={option.id} id={option.id} textValue={option.label}>{option.label}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></FilterSelectPopover>
  </Select>;
}
