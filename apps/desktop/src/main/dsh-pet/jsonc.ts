/** Strip JSONC comments while preserving strings and line positions for JSON errors. */
export function stripJsonComments(input: string): string {
  let result = '', quoted = false, escaped = false, line = false, block = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!, next = input[i + 1];
    if (line) { if (c === '\n' || c === '\r') { line = false; result += c; } else result += ' '; continue; }
    if (block) {
      if (c === '*' && next === '/') { block = false; result += '  '; i++; }
      else result += c === '\n' || c === '\r' ? c : ' ';
      continue;
    }
    if (quoted) { result += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; result += c; }
    else if (c === '/' && next === '/') { line = true; result += '  '; i++; }
    else if (c === '/' && next === '*') { block = true; result += '  '; i++; }
    else result += c;
  }
  if (block) throw new SyntaxError('JSONC: unterminated block comment');
  return result.replace(/^\uFEFF/, '');
}

export function parseJsonc(input: string): Record<string, unknown> {
  const value: unknown = JSON.parse(stripJsonComments(input));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是 JSON 对象');
  return value as Record<string, unknown>;
}
