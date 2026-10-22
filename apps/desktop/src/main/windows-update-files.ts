type UpdateFiles = {
  files?: { url: string; sha512: string }[];
  path?: string;
  sha512?: string;
};

/** Narrow the shared manifest before the private provider replaces filenames with asset API URLs. */
export function restrictWindowsUpdateFiles(info: UpdateFiles, architecture: string): void {
  const architectureOf = (url: string) => /-win-(x64|arm64)-setup\.exe(?:[?#].*)?$/i.exec(url)?.[1].toLowerCase();
  const named = info.files?.filter(file => architectureOf(file.url));
  if (!named?.length) return; // Preserve pre-existing universal/legacy installer metadata.
  const matching = named.filter(file => architectureOf(file.url) === architecture);
  if (matching.length !== 1) throw new Error(`Expected one Windows ${architecture} update installer; found ${matching.length}`);
  info.files = matching;
  info.path = matching[0].url;
  info.sha512 = matching[0].sha512;
}
