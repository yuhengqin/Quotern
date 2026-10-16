import { useState } from 'react';
import { Button, Checkbox, Description, Label, ListBox, Select } from '@heroui/react';
import { SUBSCRIPTION_CHANNELS } from '../../shared/subscription-channels';
import type { QuotaPaceModel, QuotaPreferencePatch } from '../../shared/quota';
import { useQuotaState } from '../hooks/useQuotaState';

export function QuotaSettings() {
  const { state, error, save } = useQuotaState();
  const [saving, setSaving] = useState(false);
  const apply = async (patch: QuotaPreferencePatch) => { setSaving(true); try { await save(patch); } catch { /* The hook retains and reports the persisted preferences. */ } finally { setSaving(false); } };
  if (!state) return <p role="status" className="text-sm text-muted">{error ?? '正在读取额度设置…'}</p>;
  const prefs = state.preferences;
  return <div className="flex flex-col gap-5">
    {(error || state.notice) && <p role="status" className="text-sm text-warning">{error ?? state.notice}</p>}
    <div className="flex flex-col gap-1.5"><p className="text-sm font-medium">额度提醒与分析</p><Description>提醒在后台运行；首次读取及重新开启时不会补发旧提醒。费用统计与订阅额度分别计算。</Description></div>
    <div className="flex flex-col gap-3">
      {([['thresholdAlerts', '额度接近上限时提醒'], ['resetAlerts', '额度重置恢复时提醒'], ['showSparkline', '显示最近六小时额度趋势']] as const).map(([key, label]) => <Checkbox key={key} isSelected={prefs[key]} isDisabled={saving} onChange={value => void apply({ [key]: value })}>
        <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{label}</Checkbox.Content>
      </Checkbox>)}
      <Description>5h 窗口已用 90% 时提醒；长周期窗口在 70% 和 90% 时提醒，每个周期各一次。系统勿扰模式或通知权限可能影响送达。</Description>
    </div>
    <Select className="w-full max-w-xs" value={prefs.paceModel} isDisabled={saving} onChange={value => { if (value) void apply({ paceModel: String(value) as QuotaPaceModel }); }}>
      <Label>周额度参考节奏</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover><ListBox>{([['uniform', '每天均匀使用'], ['workdays', '按工作日使用'], ['automatic', '按历史习惯']] as const).map(([id, label]) => <ListBox.Item id={id} key={id} textValue={label}><Label>{label}</Label><ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
    </Select>
    <Description>历史习惯需要至少 14 个不同日期的有效记录，记录不足时按均匀节奏。耗尽时间仅按近期速度估算；历史保留 90 天。</Description>
    <div className="flex flex-col gap-1.5"><p className="text-sm font-medium">订阅通道</p><Description>关闭后隐藏卡片，并暂停该通道的额度读取与提醒。</Description></div>
    <div className="flex gap-2">{[true, false].map(enabled => <Button key={String(enabled)} size="sm" variant="secondary" isDisabled={saving} onPress={() => void apply({ channels: Object.fromEntries(SUBSCRIPTION_CHANNELS.map(channel => [channel.id, enabled])) })}>{enabled ? '全部开启' : '全部关闭'}</Button>)}</div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{SUBSCRIPTION_CHANNELS.map(channel => <Checkbox key={channel.id} isDisabled={saving} isSelected={prefs.channels[channel.id] !== false} onChange={enabled => void apply({ channels: { [channel.id]: enabled } })}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{channel.label}</Checkbox.Content></Checkbox>)}</div>
  </div>;
}
