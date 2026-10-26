export function sessionDisplayTitle(row: { sessionTitle?: string | null; sessionId: string }, unnamed: string): string {
  return row.sessionTitle?.trim() || `${unnamed} · ${row.sessionId.slice(-8)}`;
}

/** Display only: search, grouping, export and project identity retain the original label. */
export function sessionProjectDisplay(project: string): string {
  let label = project.trim();
  if (/^(https?|file):\/\//i.test(label)) {
    try {
      const url = new URL(label);
      const last = url.pathname.replace(/\/+$/, '').split('/').pop() ?? '';
      let name = last;
      try { name = decodeURIComponent(last); } catch { /* Keep malformed escapes readable. */ }
      label = url.protocol === 'file:' ? name || label : `${url.host}${name ? `/${name}` : ''}`;
    } catch { /* Invalid URLs remain ordinary labels. */ }
  } else if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(label)) {
    // A literal directory name may contain %2F; the global project normalizer decodes it.
    label = label.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || label;
  }
  const characters = [...label];
  return characters.length > 40 ? `${characters.slice(0, 24).join('')}…${characters.slice(-12).join('')}` : label;
}
