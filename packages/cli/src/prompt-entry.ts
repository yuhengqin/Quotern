import { runQuotaPrompt } from './quota-command.js';
import { extractCliLanguage, systemCliLocale, cliT, CliUserError } from './i18n/locale.js';
/** Prompt fast path does not import the server, parsers, database or runtime. */
export async function runPromptEntry(): Promise<void> {
  let locale = systemCliLocale();
  try { const parsed = extractCliLanguage(process.argv.slice(2)); locale = parsed.lang ?? locale; await runQuotaPrompt(parsed.args.slice(1), locale); }
  catch (error) { console.error(error instanceof CliUserError ? error.message : cliT(locale, 'common.failed')); process.exitCode = 1; }
}
