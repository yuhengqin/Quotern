/** Build-time discovery; never guess a hashed route filename at runtime. */
export function demoPreloadManifest(bundle) {
  const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
  const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
  const modules = new Set(), styles = new Set();
  function visit(chunk) {
    if (!chunk || modules.has(chunk.fileName)) return;
    modules.add(chunk.fileName);
    for (const css of chunk.viteMetadata?.importedCss ?? []) styles.add(css);
    for (const name of chunk.imports) visit(byFile.get(name));
  }
  for (const chunk of chunks.filter(chunk => chunk.isEntry)) visit(chunk);
  for (const chunk of chunks.filter(chunk => chunk.name === 'dashboard')) visit(chunk);
  return { schemaVersion: 1, modules: [...modules], styles: [...styles] };
}
export function demoPreloadPlugin() {
  return { name: 'quotern-demo-preload', apply: 'build', enforce: 'post', generateBundle(_options, bundle) {
    this.emitFile({ type: 'asset', fileName: 'demo-preload.json', source: JSON.stringify(demoPreloadManifest(bundle)) });
  } };
}
