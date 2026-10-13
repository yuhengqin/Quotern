import type { ReactNode } from 'react';

/** Title underline accent for the rank page heading. */

export function RankTitleDecor({
  aside,
  children,
}: {
  aside?: ReactNode;
  children: string;
}) {
  // Underline the second-to-last character in the rank title.
  const accentIndex = Math.max(0, children.length - 2);
  const before = children.slice(0, accentIndex);
  const accent = children.slice(accentIndex, accentIndex + 1);
  const after = children.slice(accentIndex + 1);

  return (
    <span className="inline-flex flex-wrap items-center gap-2.5 sm:gap-3">
      <span className="relative inline-flex items-baseline leading-none">
        {before}
        <span className="relative inline-block">
          {accent}
          <svg
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[calc(100%-1px)] h-2.5 w-7 -translate-x-1/2 text-[#1e80ff] sm:h-3 sm:w-9 dark:text-[#4b9cff]"
            fill="none"
            viewBox="0 0 36 12"
          >
            <path
              d="M2 7.5C8 3.5 13 2.5 18 5C23 7.5 28 8.5 34 4.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.8"
            />
          </svg>
        </span>
        {after}
      </span>
      {aside}
    </span>
  );
}
