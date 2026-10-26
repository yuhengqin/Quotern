type AgentIdentity = { agentNickname?: string | null; agentRole?: string | null };
type SessionIdentity = { sessionTitle?: string | null; sessionId: string; relation?: AgentIdentity; insights?: AgentIdentity };

export function sessionDisplayIdentity(row: SessionIdentity, unnamed: string): { name: string; role: string | null; shortId: string | null } {
  const title = row.sessionTitle?.trim();
  const nickname = (row.relation?.agentNickname ?? row.insights?.agentNickname)?.trim();
  const rawRole = (row.relation?.agentRole ?? row.insights?.agentRole)?.trim();
  const role = rawRole && !['default', 'unknown'].includes(rawRole.toLowerCase()) ? rawRole : null;
  const name = title || nickname || role || unnamed;
  return { name, role: role !== name ? role : null, shortId: title ? null : row.sessionId.slice(-8) };
}

export function sessionDisplayTitle(row: SessionIdentity, unnamed: string): string {
  const identity = sessionDisplayIdentity(row, unnamed);
  return identity.shortId ? `${identity.name} · ${identity.shortId}` : identity.name;
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
