import { createHash } from 'node:crypto';

/** A stable, non-reversible local join key. Never use credentials as identity. */
export function accountReference(service: string, identity: string | readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([service, identity])).digest('hex');
}
