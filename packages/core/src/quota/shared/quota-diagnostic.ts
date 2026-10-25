/** Closed vocabulary: never persist upstream errors, URLs, paths or credentials. */
export const QUOTA_DIAGNOSTIC_CODES = ['NOT_SIGNED_IN', 'AUTH_EXPIRED', 'ACCESS_DENIED', 'UNSUPPORTED_AUTH', 'NOT_INSTALLED', 'INVALID_CREDENTIALS', 'INVALID_RESPONSE', 'MISSING_PROJECT', 'RATE_LIMITED', 'HTTP_ERROR', 'TIMEOUT', 'NETWORK_ERROR', 'COMMAND_FAILED', 'OUTPUT_LIMIT', 'UNAVAILABLE'] as const;
export type QuotaDiagnosticCode = typeof QUOTA_DIAGNOSTIC_CODES[number];
export const QUOTA_DIAGNOSTIC_STAGES = ['credentials', 'http', 'parse', 'cli', 'cache', 'observation'] as const;
export interface QuotaDiagnosticAttempt {
  stage: typeof QUOTA_DIAGNOSTIC_STAGES[number];
  outcome: 'success' | 'failure' | 'retained';
  code: QuotaDiagnosticCode | null;
  httpStatus?: number;
}
export interface QuotaReadDiagnostic {
  source: 'native' | 'omp';
  code: QuotaDiagnosticCode | null;
  queriedAt: number;
  durationMs: number;
  retainedFrom: 'cache' | 'omp' | null;
  retryAt: number | null;
  attempts: QuotaDiagnosticAttempt[];
}
