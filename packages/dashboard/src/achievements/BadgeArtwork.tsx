import { useId } from 'react';
import { Award, CalendarCheck, CalendarDays, Clock3, Coins, Compass, Flame, FolderGit2, Footprints, HeartHandshake, MessageCircle, Orbit, Sparkles, Trophy, type LucideIcon } from 'lucide-react';
import { ACHIEVEMENT_FAMILIES, type AchievementFamily } from 'quotern-core/achievements';

const icons: Record<AchievementFamily, LucideIcon> = {
  first: Sparkles, tokens: Orbit, sessions: MessageCircle, 'active-days': Footprints, streak: Flame,
  'monthly-full': CalendarCheck, 'monthly-active': CalendarDays, cost: Coins, duration: Clock3,
  'agent-loyalty': HeartHandshake, 'multi-agent': Compass, project: FolderGit2, records: Trophy, annual: Award,
};
/** Native vector artwork keeps previews and exported posters sharp and available offline. */
export function BadgeArtwork({ family, tier = 1, locked = false, size = 112, className = '' }: { family: AchievementFamily; tier?: number; locked?: boolean; size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const color = locked ? '#94a3b8' : ACHIEVEMENT_FAMILIES.find(item => item.id === family)?.color ?? '#a78bfa';
  const Glyph = icons[family];
  const gradient = 'badge-fill-' + id, light = 'badge-light-' + id;
  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 144 144" fill="none">
      <defs>
        <linearGradient id={gradient} x1="24" y1="15" x2="118" y2="130" gradientUnits="userSpaceOnUse"><stop stopColor={color}/><stop offset=".48" stopColor={locked ? '#dbe2ea' : '#f8f6ff'}/><stop offset="1" stopColor={color}/></linearGradient>
        <radialGradient id={light}><stop stopColor={color} stopOpacity=".3"/><stop offset="1" stopColor={color} stopOpacity="0"/></radialGradient>
      </defs>
      <circle cx="72" cy="72" r="71" fill={'url(#' + light + ')'}/>
      {tier > 1 && <><path d="M42 91 31 135 55 123 68 137 75 98" fill={color} opacity=".8"/><path d="m101 91 12 44-24-12-13 14-8-39" fill={color} opacity=".55"/></>}
      <path d="m72 9 16 9 18 2 9 16 15 10-1 19 6 17-12 14-6 18-19 3-16 10-17-8-19-1-10-16-15-10 1-19-6-17 12-14 6-18 19-3Z" fill={'url(#' + gradient + ')'} stroke={color} strokeWidth="1.5" opacity={locked ? '.6' : '1'}/>
      <circle cx="72" cy="70" r="45" fill={locked ? '#e2e8f0' : '#161325'} stroke={color} strokeWidth="2"/>
      <circle cx="72" cy="70" r="38" stroke={color} strokeOpacity=".45" strokeDasharray="2 6"/>
      <Glyph x="51" y="45" width="42" height="42" color={locked ? '#64748b' : color} strokeWidth="1.65"/>
      <path d="m43 101 8 3m42-3-8 3" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <text x="72" y="107" textAnchor="middle" fill={locked ? '#64748b' : '#e9dfff'} fontFamily="ui-monospace, monospace" fontSize="11" fontWeight="700" letterSpacing="2">{['I', 'II', 'III', 'IV', 'V'][Math.min(tier, 5) - 1]}</text>
      {!locked && <><path d="m114 18 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#fff1b8"/><circle cx="27" cy="109" r="2" fill={color}/></>}
    </svg>
  );
}
