import { useId } from 'react';
import { Award, Building2, CalendarCheck, CalendarDays, Clock3, Coins, Compass, Flag, Flame, FolderGit2, Footprints, HeartHandshake, Hourglass, Infinity as InfinityIcon, Landmark, MessageCircle, MessagesSquare, Mountain, Network, Orbit, Radio, Route, ShieldCheck, Sparkle, Sparkles, Trophy, Wallet, type LucideIcon } from 'lucide-react';
import { ACHIEVEMENT_FAMILIES, type AchievementFamily } from 'quotern-core/achievements';

const motifs: Record<AchievementFamily, readonly LucideIcon[]> = {
  first: [Sparkles], tokens: [Sparkle, Radio, Orbit, Sparkles], sessions: [MessageCircle, MessagesSquare, Network],
  'active-days': [Footprints, Route, Flag, Mountain], streak: [Flame],
  'monthly-full': [CalendarCheck], 'monthly-active': [CalendarDays], cost: [Coins, Wallet, Landmark],
  duration: [Clock3, Hourglass, InfinityIcon], 'agent-loyalty': [HeartHandshake, ShieldCheck],
  'multi-agent': [Compass], project: [FolderGit2, Building2], records: [Trophy], annual: [Award],
};

// Each level has a distinct silhouette, including when its colors are muted.
const frames = [
  'M72 12a56 56 0 1 1 0 112 56 56 0 1 1 0-112Z',
  'M72 8 125 29v40c0 29-23 51-53 66C42 120 19 98 19 69V29Z',
  'M72 7 128 39v62l-56 32-56-32V39Z',
  'm72 6 17 10 19 1 9 17 17 10-1 20 7 18-13 15-7 18-20 3-17 11-18-9-20-1-10-17-16-11 1-20-7-18 13-15 7-18 20-3Z',
];

function StreakMotif({ level, color, highlight }: { level: number; color: string; highlight: string }) {
  if (level === 1) return <path d="M75 46c1 13 14 20 14 32a17 17 0 0 1-34 0c0-8 4-15 11-20-1 8 2 12 5 13 5-6 6-14 4-25Z" fill={color}/>;
  if (level === 2) return <>
    <path d="M75 32c3 18 24 26 24 45a27 27 0 0 1-54 0c0-13 7-22 17-30-2 11 1 17 7 20 9-10 10-22 6-35Z" fill={color}/>
    <path d="M74 68c1 9 10 13 10 21a12 12 0 0 1-24 0c0-7 5-14 9-18-1 5 1 9 3 10 3-4 3-8 2-13Z" fill={highlight}/>
  </>;
  return <>
    {level >= 4 && <g stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M55 101C34 91 31 66 42 47m47 54c21-10 24-35 13-54"/>
      <path d="m38 59-7-7m7 21-10-4m14 17-10 1m75-28 6-7m-6 21 10-4m-14 17 10 1"/>
    </g>}
    <path d="M66 79h12l-2 21h-8Z" fill={color}/>
    <path d="M55 72h34l-7 12H62Z" fill={color}/>
    <path d="M74 27c2 13 16 19 16 32a18 18 0 0 1-36 0c0-8 5-15 11-20-1 8 2 12 6 14 5-8 6-17 3-26Z" fill={color}/>
    <path d="M73 49c0 6 8 10 8 16a9 9 0 0 1-18 0c0-5 3-9 6-12 0 4 1 6 3 8 2-4 2-8 1-12Z" fill={highlight}/>
    {level === 3 && <ellipse cx="72" cy="74" rx="29" ry="8" stroke={color} strokeWidth="2.5"/>}
  </>;
}

function MultiAgentMotif({ level, color, background }: { level: number; color: string; background: string }) {
  const nodes = level === 1 ? [[52, 68], [92, 68]] : level === 2 ? [[72, 40], [46, 86], [98, 86]] : [[72, 34], [106, 59], [93, 96], [51, 96], [38, 59]];
  return <g stroke={color} strokeWidth="4" strokeLinejoin="round">
    {level === 1 ? <path d="M52 68h40"/> : <polygon points={nodes.map(node => node.join(',')).join(' ')} fill="none"/>}
    {level >= 3 && <path d="m72 34 21 62-55-37h68L51 96Z" strokeWidth="2" strokeOpacity=".5"/>}
    {nodes.map(([x, y], index) => <circle key={index} cx={x} cy={y} r={level === 1 ? 11 : 8} fill={background}/>)}
  </g>;
}

/** Native vector artwork keeps previews and exported posters sharp and available offline. */
export function BadgeArtwork({ family, tier = 1, locked = false, size = 112, className = '' }: { family: AchievementFamily; tier?: number; locked?: boolean; size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const level = Math.max(1, Math.min(frames.length, Math.trunc(tier)));
  const color = locked ? '#94a3b8' : ACHIEVEMENT_FAMILIES.find(item => item.id === family)?.color ?? '#a78bfa';
  const ink = locked ? '#64748b' : color, background = locked ? '#e2e8f0' : '#161325';
  const variants = motifs[family], Glyph = variants[Math.min(level - 1, variants.length - 1)]!;
  const gradient = 'badge-fill-' + id, light = 'badge-light-' + id;
  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 144 144" fill="none">
      <defs>
        <linearGradient id={gradient} x1="24" y1="15" x2="118" y2="130" gradientUnits="userSpaceOnUse"><stop stopColor={color}/><stop offset=".48" stopColor={locked ? '#dbe2ea' : '#f8f6ff'}/><stop offset="1" stopColor={color}/></linearGradient>
        <radialGradient id={light}><stop stopColor={color} stopOpacity=".3"/><stop offset="1" stopColor={color} stopOpacity="0"/></radialGradient>
      </defs>
      <circle cx="72" cy="72" r="71" fill={'url(#' + light + ')'}/>
      {level === 3 && <><path d="m38 94-9 44 25-14 18 14 1-40" fill={color} opacity=".8"/><path d="m106 94 9 44-25-14-18 14-1-40" fill={color} opacity=".55"/></>}
      <path d={frames[level - 1]} fill={'url(#' + gradient + ')'} stroke={color} strokeWidth="2" opacity={locked ? '.65' : '1'}/>
      <circle cx="72" cy="68" r="46" fill={background} stroke={color} strokeWidth="2"/>
      {level >= 2 && <circle cx="72" cy="68" r="40" stroke={color} strokeOpacity=".35" strokeDasharray={level >= 3 ? '2 6' : undefined}/>}
      {family === 'streak' ? <StreakMotif level={level} color={ink} highlight={background}/> : family === 'multi-agent' ? <MultiAgentMotif level={level} color={ink} background={background}/> : <Glyph x="48" y="43" width="48" height="48" color={ink} strokeWidth="1.8"/>}
      <text x="72" y="109" textAnchor="middle" fill={locked ? '#64748b' : '#e9dfff'} fontFamily="ui-monospace, monospace" fontSize="11" fontWeight="700" letterSpacing="2">{['I', 'II', 'III', 'IV'][level - 1]}</text>
      {!locked && <><path d="m114 18 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#fff1b8"/><circle cx="27" cy="109" r="2" fill={color}/></>}
    </svg>
  );
}
