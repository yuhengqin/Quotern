export type QuotaDropTarget = { id: string; placement: 'before' | 'after'; axis: 'x' | 'y' };
export type QuotaCardRect = { id: string; left: number; top: number; width: number; height: number; group?: string };

export function orderQuotaProviders<T extends { id: string }>(providers: readonly T[], order: readonly string[] = []): T[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...providers].sort((a, b) => (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length));
}

export function moveQuotaProvider(ids: readonly string[], source: string, target: string, placement: 'before' | 'after'): string[] {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return [...ids];
  const next = ids.filter(id => id !== source);
  next.splice(next.indexOf(target) + (placement === 'after' ? 1 : 0), 0, source);
  return next;
}

/** Replace visible slots without forgetting accounts temporarily absent from the runtime. */
export function mergeQuotaOrder(saved: readonly string[], visible: readonly string[]): string[] {
  const remaining = [...visible], visibleSet = new Set(visible);
  return [...saved.map(id => visibleSet.has(id) ? remaining.shift()! : id), ...remaining];
}

/** Consecutive status entries share a compact surface without changing the saved order. */
export function quotaLayoutGroups<T extends { id: string }>(providers: readonly T[], isStatus: (provider: T) => boolean) {
  const groups: { key: string; statusOnly: boolean; providers: T[] }[] = [];
  let anchor = 'start';
  for (const provider of providers) {
    if (isStatus(provider)) {
      const previous = groups.at(-1);
      if (previous?.statusOnly) previous.providers.push(provider);
      else groups.push({ key: `status:${anchor}`, statusOnly: true, providers: [provider] });
    } else {
      anchor = provider.id;
      groups.push({ key: `provider:${provider.id}`, statusOnly: false, providers: [provider] });
    }
  }
  return groups;
}

/** Stable layout rectangles, rather than the translated drag preview, determine the destination. */
export function quotaDropTarget(rects: readonly QuotaCardRect[], x: number, y: number): QuotaDropTarget | null {
  if (!rects.length) return null;
  const distance = (rect: QuotaCardRect) => Math.max(rect.left - x, 0, x - rect.left - rect.width) ** 2
    + Math.max(rect.top - y, 0, y - rect.top - rect.height) ** 2;
  const target = rects.reduce((best, rect) => distance(rect) < distance(best) ? rect : best);
  const peers = target.group === undefined ? rects : rects.filter(rect => rect.group === target.group);
  const axis = peers.some((rect, index) => peers.slice(index + 1).some(other => Math.abs(rect.top - other.top) < 2)) ? 'x' : 'y';
  const before = axis === 'x' ? x < target.left + target.width / 2 : y < target.top + target.height / 2;
  return { id: target.id, placement: before ? 'before' : 'after', axis };
}
