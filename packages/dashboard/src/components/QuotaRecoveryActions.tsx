import { useState } from 'react';
import { Button } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { QuotaPreferences, QuotaProviderState } from 'quotern-core/quota/shared/quota';

/** Read-only guidance: no background authentication or account mutation. */
export function QuotaRecoveryActions({ provider, preferences }: { provider: QuotaProviderState; preferences: QuotaPreferences }) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  if (!['expired', 'not-signed-in', 'access-denied'].includes(provider.status)) return null;
  const type = provider.providerId ?? provider.id;
  const command = type === 'codex' ? 'codex login' : type === 'claude' ? 'claude auth login' : type === 'gemini' ? 'gemini' : null;
  const profile = preferences.profiles?.find(item => `${item.provider}@${item.id}` === provider.id);
  const copy = async () => { try { if (!command || !navigator.clipboard) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(command); setCopyState('copied'); } catch { setCopyState('failed'); } };
  return <div className="flex flex-col gap-2 rounded-xl bg-surface-secondary p-3" data-quota-recovery>
    <p className="text-sm">{t(profile ? 'island.quota.loginProfile' : 'island.quota.loginThenRefresh', { provider: provider.label })}</p>
    {profile && <p className="break-all text-xs text-muted">{profile.directory}</p>}
    {type === 'gemini' && <p className="text-xs text-muted">{t('island.quota.geminiAuth')}</p>}
    {command && !profile && <div className="flex flex-wrap items-center gap-2"><code className="select-text text-xs">{command}</code><Button size="sm" variant="tertiary" onPress={() => void copy()}>{t('island.quota.copyLogin')}</Button></div>}
    {copyState !== 'idle' && <p role="status" className="text-xs text-muted">{t(`island.quota.${copyState}`)}</p>}
  </div>;
}
