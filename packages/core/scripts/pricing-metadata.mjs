function validReleaseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) return false;
  const date = new Date(`${value.length === 7 ? `${value}-01` : value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, value.length) === value;
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
    const [provider, ...segments] = key.split('/');
    const date = catalog?.[provider]?.models?.[segments.join('/')]?.release_date;
    const manual = metadata.release_date && metadata.release_date_source !== 'models.dev';
    if (!manual && validReleaseDate(date)) {
      metadata.release_date = date;
      metadata.release_date_source = 'models.dev';
    }
    if (Object.keys(metadata).length) result[key] = metadata;
  }
  return result;
}
