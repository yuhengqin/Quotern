import antigravity from '@lobehub/icons-static-svg/icons/antigravity-color.svg';
import claude from '@lobehub/icons-static-svg/icons/claude-color.svg';
import codex from '@lobehub/icons-static-svg/icons/codex-color.svg';
import copilot from '@lobehub/icons-static-svg/icons/copilot.svg';
import cursor from '@lobehub/icons-static-svg/icons/cursor.svg';
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg';
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg';
import grok from '@lobehub/icons-static-svg/icons/grok.svg';
import kimi from '@lobehub/icons-static-svg/icons/kimi.svg';
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg';
import opencode from '@lobehub/icons-static-svg/icons/opencode.svg';
import qoder from '@lobehub/icons-static-svg/icons/qoder-color.svg';
import zcode from '@lobehub/icons-static-svg/icons/zai.svg';

const icons: Record<string, string> = { antigravity, claude, codex, copilot, cursor, deepseek, gemini, grok, kimi, minimax, opencode, qoder, zcode };
const monochrome = new Set(['copilot', 'cursor', 'grok', 'kimi', 'opencode', 'zcode']);
export function SubscriptionBrandIcon({ brand }: { brand: string }) {
  const src = icons[brand];
  if (!src) return null;
  return <img alt="" aria-hidden src={src} width={24} height={24}
    className={`size-6 shrink-0 object-contain ${monochrome.has(brand) ? 'dark:invert' : ''}`} />;
}
