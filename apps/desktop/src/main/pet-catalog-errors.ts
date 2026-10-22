import { PET_ID_RE } from './pet-core';
import type { PetCatalogRequest } from '../shared/pet';
import type { NativeMessageKey } from './native-messages';

type PetCatalogPhase = 'url' | 'download' | 'archive' | 'validation' | 'install';
type PetCatalogErrorCode = 'PET_URL_INVALID' | 'PET_DOWNLOAD_NETWORK' | 'PET_DOWNLOAD_TIMEOUT' | 'PET_DOWNLOAD_HTTP' | 'PET_PACKAGE_TOO_LARGE' | 'PET_ARCHIVE_INVALID' | 'PET_PACKAGE_INVALID' | 'PET_INSTALL_FAILED';

export class PetCatalogError extends Error {
  readonly name = 'PetCatalogError';
  constructor(readonly code: PetCatalogErrorCode, readonly phase: PetCatalogPhase, message: string,
    readonly details: { cause?: unknown; httpStatus?: number; petId?: string } = {}) {
    super(message, { cause: details.cause });
  }
  get httpStatus(): number | undefined { return this.details.httpStatus; }
}

export function petCatalogMessageKey(error: unknown): NativeMessageKey | undefined {
  if (!(error instanceof PetCatalogError)) return undefined;
  const messages: Partial<Record<PetCatalogErrorCode, NativeMessageKey>> = {
    PET_DOWNLOAD_NETWORK: 'native.pet.downloadFailed',
    PET_DOWNLOAD_TIMEOUT: 'native.pet.downloadTimedOut',
    PET_DOWNLOAD_HTTP: 'native.pet.downloadHttpFailed',
    PET_PACKAGE_TOO_LARGE: 'native.pet.zipTooLarge',
    PET_INSTALL_FAILED: 'native.pet.installFailed',
  };
  return messages[error.code];
}

/** Log codes and operation context, never raw errors, URLs, headers or local file paths. */
export function petCatalogFailure(request: PetCatalogRequest, error: unknown): Record<string, unknown> {
  const actions = ['import-zip', 'install-url', 'list-codex', 'import-codex', 'remove', 'restore-builtins'];
  const action = actions.includes(request?.action) ? request.action : 'unknown';
  let current: unknown = error, diagnosticCode = 'UNKNOWN', causeType = 'Error';
  const visited = new Set<unknown>();
  for (let depth = 0; current && typeof current === 'object' && depth < 5 && !visited.has(current); depth++) {
    visited.add(current);
    const value = current as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    if (typeof value.name === 'string' && ['Error', 'TypeError', 'SyntaxError', 'AbortError', 'TimeoutError'].includes(value.name)) causeType = value.name;
    const chromiumCode = typeof value.message === 'string' ? value.message.match(/\bnet::(ERR_[A-Z0-9_]{2,64})\b/)?.[1] : undefined;
    const code = typeof value.code === 'string' && /^(?:ERR_[A-Z0-9_]{2,64}|E[A-Z][A-Z0-9_]{1,63})$/.test(value.code) ? value.code : undefined;
    if (diagnosticCode === 'UNKNOWN') diagnosticCode = chromiumCode ?? code ?? 'UNKNOWN';
    current = value.cause;
  }
  const failure = error instanceof PetCatalogError ? error : undefined;
  const ids = request?.action === 'import-codex' && Array.isArray(request.ids) ? request.ids
    : request?.action === 'remove' ? [request.id] : failure?.details.petId ? [failure.details.petId] : [];
  return {
    event: 'pet_catalog_failed', action, phase: failure?.phase ?? 'catalog',
    code: failure?.code ?? 'PET_CATALOG_FAILED', diagnosticCode, causeType,
    ...(failure?.httpStatus ? { httpStatus: failure.httpStatus } : {}),
    petIds: ids.filter((id): id is string => typeof id === 'string' && PET_ID_RE.test(id)).slice(0, 30),
  };
}
