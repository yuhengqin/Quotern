function validReleaseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) return false;
  const date = new Date(`${value.length === 7 ? `${value}-01` : value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, value.length) === value;
}

function validContextWindow(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/** Upstream supplies dates; Quotern alone supplies its current flagship selection. */
export function mergePricingModelMetadata(current, catalog, exact) {
  const result = {};
  for (const key of Object.keys(exact)) {
    const previous = current?.[key];
    const metadata = {};
    if (typeof previous?.featured === 'boolean') metadata.featured = previous.featured;
    if (validReleaseDate(previous?.release_date)) {
      metadata.release_date = previous.release_date;
      if (typeof previous.release_date_source === 'string') metadata.release_date_source = previous.release_date_source;
    }
    if (validContextWindow(previous?.context_window)) {
      metadata.context_window = previous.context_window;
      if (typeof previous.context_window_source === 'string') metadata.context_window_source = previous.context_window_source;
    }
    const [provider, ...segments] = key.split('/');
    const model = segments.join('/');
    const upstreamModel = catalog?.[provider]?.models?.[model];
    const date = upstreamModel?.release_date;
    const manual = metadata.release_date && metadata.release_date_source !== 'models.dev';
    if (!manual && validReleaseDate(date)) {
      metadata.release_date = date;
      metadata.release_date_source = 'models.dev';
    }
    const contextWindow = upstreamModel?.limit?.context;
    const manualContextWindow = metadata.context_window && metadata.context_window_source !== 'models.dev';
    if (!manualContextWindow && validContextWindow(contextWindow)) {
      metadata.context_window = contextWindow;
      metadata.context_window_source = 'models.dev';
    }
    if (Object.keys(metadata).length) result[key] = metadata;
  }
  return result;
}
