import {
  POLL_BACKOFF_EMPTY_ROUNDS_PER_LEVEL,
  POLL_BACKOFF_LADDER_MS,
} from '../paths.js';

export interface PollBackoff {
  /** Record a finished poll round; returns the delay before the next poll. */
  noteRound(wroteAny: boolean): number;
  /** Any user/hook activity: back to the fastest interval. */
  reset(): void;
  currentDelayMs(): number;
}

/**
 * Idle backoff for the background poll loop.
 *
 * Rounds that write data (or an explicit reset) snap back to the first ladder
 * step; each `emptyRoundsPerLevel` consecutive empty rounds escalate one step
 * until the ladder cap.
 */
export function createPollBackoff(
  ladderMs: readonly number[] = POLL_BACKOFF_LADDER_MS,
  emptyRoundsPerLevel: number = POLL_BACKOFF_EMPTY_ROUNDS_PER_LEVEL,
): PollBackoff {
  const ladder = ladderMs.length > 0 ? ladderMs : [60_000];
  let level = 0;
  let emptyStreakAtLevel = 0;

  return {
    noteRound(wroteAny: boolean): number {
      if (wroteAny) {
        level = 0;
        emptyStreakAtLevel = 0;
      } else {
        emptyStreakAtLevel += 1;
        if (emptyStreakAtLevel >= emptyRoundsPerLevel && level < ladder.length - 1) {
          level += 1;
          emptyStreakAtLevel = 0;
        }
      }
      return ladder[level]!;
    },
    reset(): void {
      level = 0;
      emptyStreakAtLevel = 0;
    },
    currentDelayMs(): number {
      return ladder[level]!;
    },
  };
}
