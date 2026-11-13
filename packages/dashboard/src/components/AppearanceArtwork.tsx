import type { CSSProperties, ReactNode } from 'react';
import type { DecoratedAppearanceStyle } from '../../../../apps/desktop/src/shared/appearance';

function Scene({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <svg className={`appearance-motif ${className}`} viewBox="0 0 280 160" fill="none" focusable="false">{children}</svg>;
}

/** Original, bounded decorative drawings. They do not read quota or usage state. */
export default function AppearanceArtwork({ style }: { style: DecoratedAppearanceStyle }) {
  switch (style) {
    case 'matrix': return <>{[2, 8, 14, 86, 92, 98].map((left, index) => <span key={left} className="appearance-code-column" style={{ left: `${left}%`, '--delay': `${-index * 2.7}s`, '--duration': `${16 + index * 1.4}s` } as CSSProperties}>{['01 QUOTERN 0101', '101 001 110', '0 1 01 10 11'][index % 3]}</span>)}</>;
    case 'cloud_observation': return <Scene className="appearance-motif--cloud">
      <g className="appearance-cloud-back" fill="currentColor" fillOpacity=".45"><path d="M14 91c-13-25 8-48 31-40 3-36 59-39 70-8 20-18 52-2 52 22 24-3 43 12 40 26Z" /></g>
      <g className="appearance-cloud-front" fill="currentColor"><path d="M71 129c-14-26 8-47 30-41 5-31 52-38 68-13 20-18 53-4 54 20 27-5 49 12 43 34Z" /></g>
      <path d="M0 145h265M32 153h206" stroke="currentColor" strokeOpacity=".5" />
    </Scene>;
    case 'aquarium': return <Scene>
      <g className="appearance-jelly"><path d="M125 67c0-61 94-61 94 0-25 12-69 12-94 0Z" fill="currentColor" fillOpacity=".65" stroke="currentColor" strokeWidth="2" />
        <path d="M137 73c-15 16 10 24-3 43m27-43c-9 18 13 30 1 58m21-58c-10 23 16 26 4 49m22-49c12 16-11 30 1 45" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </g>
      {[{ x: 46, y: 140, r: 7 }, { x: 77, y: 110, r: 4 }, { x: 247, y: 151, r: 5 }].map((bubble, index) => <circle className="appearance-bubble" key={bubble.x} cx={bubble.x} cy={bubble.y} r={bubble.r} stroke="currentColor" strokeWidth="1.5" style={{ '--delay': `${-index * 4}s` } as CSSProperties} />)}
    </Scene>;
    case 'prism_arcade': return <Scene>
      <g className="appearance-prism"><path d="m54 55 34-35 35 35-35 36Z" fill="currentColor" fillOpacity=".2" stroke="currentColor" strokeWidth="2" /><path d="m88 20 1 70m-35-35h69" stroke="currentColor" /></g>
      <g className="appearance-prism appearance-prism--second"><path d="m192 50 51 80-89-8Z" fill="#64c8d4" fillOpacity=".25" stroke="#64c8d4" strokeWidth="2" /><path d="m192 50 6 64 45 16m-45-16-44 8" stroke="#64c8d4" /></g>
      <path d="m17 132 6-6 6 6-6 6Zm215-110 5-5 5 5-5 5Z" fill="currentColor" />
    </Scene>;
    case 'stained_glass': return <Scene className="appearance-motif--glass">
      <g stroke="currentColor" strokeWidth="2"><path d="M64 144V78a76 76 0 0 1 152 0v66Z" /><path d="m65 66 75 77 75-77M140 2v141M65 66h150M87 23l106 99M193 23 87 122" />
        <path d="m140 1-53 22 53 43Z" fill="#ab9bde" fillOpacity=".5" /><path d="m140 66 53-43 22 43Z" fill="#cf91aa" fillOpacity=".5" /><path d="m140 143 53-21-53-56Z" fill="#7bbfbe" fillOpacity=".5" /><path d="m65 66 22 56 53-56Z" fill="#d9ba81" fillOpacity=".5" />
      </g>
      <path className="appearance-glass-light" d="m25 3 24-8 164 165-24 8Z" fill="currentColor" fillOpacity=".45" />
    </Scene>;
    case 'migration': return <Scene className="appearance-motif--birds">
      <path d="M5 144c60-55 137 18 258-113" stroke="currentColor" strokeDasharray="4 7" strokeOpacity=".5" />
      <g className="appearance-flock" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {[[43, 62], [85, 39], [128, 25], [167, 47], [206, 70]].map(([x, y]) => <path className="appearance-bird" key={x} d={`M${x} ${y}q10-12 20 0q10-12 20 0`} />)}
      </g>
    </Scene>;
    case 'heart_monitor': return <Scene className="appearance-motif--ecg">
      <g className="appearance-ecg" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        {[0, 280].map(x => <path key={x} transform={`translate(${x} 0)`} d="M0 90h51l9-9 11 15 14-17 13 42 13-89 18 72 15-14h29l12-12 10 12h85" />)}
      </g>
      <path d="M0 138h280" stroke="currentColor" strokeOpacity=".3" strokeDasharray="1 9" />
    </Scene>;
    case 'origami': return <Scene className="appearance-motif--paper">
      <g className="appearance-paper-fold" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5">
        <path d="m32 44 221-25-77 119-44-49-39 23 7-47Z" fill="currentColor" fillOpacity=".13" />
        <path d="m32 44 68 21 153-46-121 70 44 49M100 65l-7 47 39-23" />
        <path d="m100 65 32 24 121-70Z" fill="currentColor" fillOpacity=".3" />
      </g>
    </Scene>;
    case 'black_hole': return <Scene className="appearance-motif--orbit">
      <ellipse cx="140" cy="80" rx="116" ry="34" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="140" cy="80" rx="103" ry="25" stroke="currentColor" strokeOpacity=".5" />
      <circle cx="140" cy="80" r="33" fill="var(--background)" stroke="currentColor" strokeWidth="3" />
      <g className="appearance-orbit"><ellipse cx="140" cy="80" rx="69" ry="60" stroke="currentColor" strokeOpacity=".25" /><circle cx="209" cy="80" r="4" fill="currentColor" /><circle cx="71" cy="80" r="2" fill="currentColor" /></g>
      <path d="M42 18h4m-2-2v4m180 107h5m-2-2v4" stroke="currentColor" />
    </Scene>;
    case 'lepidoptera': return <Scene className="appearance-motif--butterfly">
      <g className="appearance-specimen" stroke="currentColor" strokeWidth="1.5">
        <g className="appearance-butterfly-wing"><path d="M140 76c-75-91-97 6-15 18-68 29-30 68 15 9" fill="currentColor" fillOpacity=".25" /><path d="M140 76c75-91 97 6 15 18 68 29 30 68-15 9" fill="currentColor" fillOpacity=".25" /><path d="m96 51 38 34m50-34-38 34m-25 24 15-15m23 15-15-15" /></g>
        <path d="M140 71v40m0-40-10-13m10 13 10-13" strokeWidth="3" strokeLinecap="round" />
      </g>
      <path d="M34 34V20h14m184 0h14v14M34 130v14h14m184 0h14v-14" stroke="currentColor" strokeDasharray="3 3" />
    </Scene>;
    case 'world_cup': return <Scene className="appearance-motif--football">
      <g stroke="currentColor" strokeOpacity=".5"><path d="M10 20h260v120H10Zm130 0v120M10 52h35v56H10m260-56h-35v56h35" /><circle cx="140" cy="80" r="30" /></g>
      <g className="appearance-ball-travel"><g className="appearance-ball"><circle cx="70" cy="83" r="16" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /><path d="m70 75 8 6-3 9H65l-3-9Zm-9-7 4 5-9 5m30 0-9-5 4-5m-11 31v-9m-15 1 10-1m20 1-10-1" fill="currentColor" stroke="currentColor" strokeLinejoin="round" /></g></g>
    </Scene>;
  }
}
