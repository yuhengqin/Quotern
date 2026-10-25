import type { QueueBucket } from '../types.js';
import type { CollectedSessionMessage } from '../session-sources.js';
import type { SessionTimingEvent } from '../task-timing.js';
import type { SessionObservation } from '../session-observation.js';
import type { SessionTitle } from '../session-titles.js';
import type { AchievementSnapshot } from '../achievements/types.js';
import type { PricingSnapshot } from '../pricing/index.js';
import type { SessionEvidence } from '../session-insights.js';

export interface DemoMetadata {
  schemaVersion: 1;
  exportedAt: string;
  referenceTime: string;
  readOnly: true;
}
export interface DemoHistory {
  /** Absent in snapshots exported before session insights were introduced. */
  evidence?: SessionEvidence[];
  messages: CollectedSessionMessage[];
  timingEvents: SessionTimingEvent[];
  observations: SessionObservation[];
  titles: Array<[string, SessionTitle]>;
  codexParents: Array<[string, string]>;
  missingSources: string[];
}
export interface DemoSnapshot extends DemoMetadata {
  collectSince: string;
  lastSyncAt: string | null;
  buckets: QueueBucket[];
  history: DemoHistory;
  achievements: AchievementSnapshot;
  pricing: PricingSnapshot;
}
export function demoMetadata(snapshot: DemoMetadata): DemoMetadata {
  return { schemaVersion: 1, exportedAt: snapshot.exportedAt, referenceTime: snapshot.referenceTime, readOnly: true };
}
