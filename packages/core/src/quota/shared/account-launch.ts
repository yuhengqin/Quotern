import type { QuotaProfile } from './quota.js';

export type LaunchProvider = 'claude' | 'codex';
export interface LaunchSelection {
  profileId: string;
  label: string;
  directory: string;
  quotaDirectory: string;
  accountRef: string | null;
}
export interface LaunchPreferences {
  revision: string;
  defaults: Partial<Record<LaunchProvider, LaunchSelection>>;
  autoSwitchClaude: boolean;
  lastSwitch: { from: string | null; to: string | null; at: number; reason: 'manual' | 'exhausted' } | null;
}
export interface AccountLaunchView {
  token: string;
  preferences: LaunchPreferences;
  profiles: QuotaProfile[];
  selected: Partial<Record<LaunchProvider, string>>;
  unavailableDefaults: LaunchProvider[];
  isolated: boolean;
}
