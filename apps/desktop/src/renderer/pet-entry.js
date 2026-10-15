let previousState = null;

function sameContent(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyState(state) {
  if (!state) return;
  const previous = previousState;
  previousState = state;
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
  // The cursor changes look direction frequently. TokenTracker only pushes the
  // affected signal; broadcasting every signal here restarted Clawd's SVG idle
  // animation as if the usage and character had changed on each cursor update.
  const changed = [
    ['usage', !previous || !sameContent(previous.stats, state.stats)],
    ['limits', !previous || !sameContent(previous.limits, state.limits)],
    ['connected', !previous || previous.connected !== state.connected],
    ['currency', !previous],
    ['locale', !previous || previous.locale !== state.locale],
    ['character', !previous || previous.settings?.character !== state.settings?.character],
    ['botColor', !previous || previous.settings?.botColor !== state.settings?.botColor],
    ['dark', !previous || previous.dark !== state.dark],
    ['syncing', !previous || previous.syncing !== state.syncing],
    ['hover', !previous || previous.hover !== state.hover],
    ['minimode', !previous || previous.miniMode !== state.miniMode],
    ['look', !previous || previous.lookDirectionIndex !== state.lookDirectionIndex],
    ['bubble-band', !previous || previous.bubbleBand !== state.bubbleBand],
    ['catalog', !previous || !sameContent(previous.catalog, state.catalog)],
  ];
  for (const [type, didChange] of changed) {
    if (didChange) window.dispatchEvent(new Event(`pet:${type}`));
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
