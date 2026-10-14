import { mergeLocalMetrics, type LocalUsageMetrics } from 'quotern-core/local-metrics';

/** A known subset must never be presented as the complete token breakdown. */
export function mergeCompleteLocalMetrics(
  parts: readonly (LocalUsageMetrics | undefined)[],
): LocalUsageMetrics | undefined {
  const known = parts.filter((part) => part !== undefined);
  return known.length > 0 && known.length === parts.length
    ? mergeLocalMetrics(known)
    : undefined;
}
