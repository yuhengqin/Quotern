import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
registerMessages({
  'zh-CN': { 'panel.pin': '固定额度面板', 'panel.unpin': '取消固定', 'panel.failed': '面板设置失败，请重试。' },
  en: { 'panel.pin': 'Pin quota panel', 'panel.unpin': 'Unpin', 'panel.failed': 'Could not update the panel. Retry.' },
  ja: { 'panel.pin': '使用枠パネルを固定', 'panel.unpin': '固定を解除', 'panel.failed': 'パネルを変更できません。再試行してください。' },
  ko: { 'panel.pin': '할당량 패널 고정', 'panel.unpin': '고정 해제', 'panel.failed': '패널을 변경하지 못했습니다. 다시 시도하세요.' },
});
export function TrayPanelControl() {
  const { t } = useTranslation(), [pinned, setPinned] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  useEffect(() => { if (!window.tud?.getTrayPanel) return; void window.tud.getTrayPanel().then(state => setPinned(state.pinned)).catch(() => setError(true)); return window.tud.onTrayPanelChanged(state => setPinned(state.pinned)); }, []);
  if (!window.tud?.setTrayPanelPinned) return null;
  const change = async () => { setBusy(true); setError(false); try { setPinned((await window.tud.setTrayPanelPinned(!pinned)).pinned); } catch { setError(true); } finally { setBusy(false); } };
  return <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant={pinned ? 'secondary' : 'tertiary'} aria-pressed={pinned} isPending={busy} onPress={() => { void change(); }}>{t(pinned ? 'panel.unpin' : 'panel.pin')}</Button>{error && <p role="alert" className="text-xs text-danger">{t('panel.failed')}</p>}</div>;
}
