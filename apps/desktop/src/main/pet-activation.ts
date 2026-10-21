/** Serialize activation across the two independent pet controllers. Disabling
 * stays inside each controller so the coordinator never recursively locks itself. */
export class PetActivation {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly disable: Record<'builtin' | 'dsh', () => Promise<unknown>>) {}

  run<T>(kind: 'builtin' | 'dsh', enabled: boolean, apply: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      if (enabled) await this.disable[kind === 'builtin' ? 'dsh' : 'builtin']();
      return apply();
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
