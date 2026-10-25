import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SUBSCRIPTION_CHANNELS } from 'quotern-core/quota/shared/subscription-channels';
import { filterQuotaReport } from 'quotern-core/quota/report';
import { readQuotaReport } from 'quotern-core/quota/snapshot';
import type { QuotaCommandOptions, QuotaView } from './quota-command.js';
import { quotaView } from './quota-command.js';

export async function startQuotaMcp(options: QuotaCommandOptions): Promise<() => Promise<void>> {
  const server = new McpServer({ name: 'quotern-quota', version: '1.0.0' }, {
    instructions: 'Read-only local quota snapshots. Check availability, stale and source before using a value. Missing forecasts do not imply sufficient quota. Refresh through the existing Quotern UI or CLI outside MCP.',
  });
  const inputSchema = z.object({ provider: z.enum(SUBSCRIPTION_CHANNELS.map(c => c.id)).optional() }).strict();
  for (const view of ['status', 'forecast', 'diagnostics'] as QuotaView[]) {
    server.registerTool(`quota_${view}`, {
      description: `Read persisted quota ${view}; no network, login, refresh or settings changes. Unknown and stale data remain explicit.`,
      inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ provider }) => {
      const report = filterQuotaReport(await readQuotaReport(options.directory, { runtime: options.runtime }), provider);
      const data = quotaView(report, view);
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    });
  }
  let closed = false;
  const close = async () => { if (closed) return; closed = true; process.stdin.off('end', eof); await server.close(); };
  const eof = () => { void close().catch(() => { process.exitCode = 1; }); };
  process.stdin.once('end', eof);
  await server.connect(new StdioServerTransport());
  if (process.stdin.readableEnded) await close();
  return close;
}
