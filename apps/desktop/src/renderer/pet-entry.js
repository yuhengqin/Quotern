function applyState(state) {
  if (!state) return;
  const stats = state.stats || {};
  window.__quoternPetCatalog = state.catalog || [];
  window.__ttPetStats = stats;
  window.__ttPetTokens = stats.todayTokens || 0;
  window.__ttPetCostUsd = stats.todayCostUsd || 0;
  window.__ttPetConnected = state.connected;
  window.__ttPetCurrency = { symbol: '$', rate: 1 };
  window.__ttPetLocale = state.locale || 'zh-CN';
  window.__ttPetTokenUnitSystem = 'western';
  window.__ttPetCharacter = state.settings?.character || 'clawd';
  window.__ttPetBotColor = state.settings?.botColor || 'auto';
  window.__ttPetDark = state.dark;
  window.__ttPetSyncing = state.syncing;
  window.__ttPetHover = state.hover;
  window.__ttPetMiniMode = state.miniMode;
  window.__ttPetLookDirectionIndex = state.lookDirectionIndex;
  window.__ttPetBubbleBand = state.bubbleBand;
  window.__ttPetLimits = state.limits || [];
  for (const type of ['usage', 'limits', 'connected', 'currency', 'locale', 'character', 'botColor', 'dark', 'syncing', 'hover', 'minimode', 'look', 'bubble-band', 'catalog']) {
    window.dispatchEvent(new Event(`pet:${type}`));
  }
}

async function bootstrap() {
if (window.tud?.pet) {
  window.tud.pet.onState(applyState);
  window.tud.pet.onEvent(({ type, detail }) => {
    if (type === 'pet:drag-state') window.__ttPetDragState = detail;
    if (type === 'pet:drag-end') window.__ttPetDragState = null;
    window.dispatchEvent(new CustomEvent(type, { detail }));
  });
  try { applyState(await window.tud.pet.getState()); } catch { /* renderer still loads */ }
}

// The imported renderer reads host globals during its first React render.
await import('./pet.jsx');
}
void bootstrap();
