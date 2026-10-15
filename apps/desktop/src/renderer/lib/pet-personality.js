export const PET_CHARACTER_IDS = ["clawd", "bot", "sprout", "byte", "ember"];

/**
 * How a character is drawn. Explicit because it used to be inferred from the
 * absence of a sprite atlas — which meant "no atlas" was the same thing as
 * "this is Clawd". `bot` also has no atlas (it is drawn from a vector engine),
 * so that inference had to go.
 *
 *   "clawd"  — the hand-authored per-state SVGs under /clawd/
 *   "vector" — the morphing engine in lib/bot/, see BotAnimated.jsx
 *   "atlas"  — a 192x208 sprite sheet, built in or from a pet package
 */
// Prototype-free: a package id like "constructor" would otherwise resolve to Object
// and match neither "vector" nor "atlas", falling through to the Clawd branch.
const RENDERERS = Object.assign(Object.create(null), { clawd: "clawd", bot: "vector" });

/** @returns {"clawd" | "vector" | "atlas"} */
export function petRenderer(character) {
  return RENDERERS[normalizePetCharacter(character)] || "atlas";
}

export function normalizePetCharacter(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(id) ? id : "clawd";
}

/**
 * Pick an ambient scene from real usage context. Calm poses stay heavily weighted so
 * a large usage day does not leave the transparent desktop window animating at 15fps.
 */
export function pickPetAmbientState(stats = {}, random = Math.random) {
  const tokens = Number(stats.todayTokens) || 0;
  if (tokens <= 0) return "sleeping";

  const choices = ["idle-living", "idle-living", "idle-living", "idle-look"];
  if (tokens >= 200_000) choices.push("working-thinking");
  if (tokens >= 500_000) choices.push("working-juggling");
  // "working-overheated" is deliberately NOT an ambient choice: it reuses the error
  // visuals (X-eyes + red pulse), so it must only appear for the genuine rage/overheat
  // gag (see resolvePetState) — never on a healthy heavy-usage day.
  if (tokens >= 2_000_000) choices.push("working-ultrathink");
  if ((stats.topModels?.length || 0) >= 3) choices.push("working-juggling");
  if ((Number(stats.streakDays) || 0) >= 7) choices.push("working-wizard");

  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
  return choices[Math.max(0, index)];
}

/** Resolve urgent/live state. Ambient state is supplied separately to keep it calm. */
export function resolvePetState({
  rage = false,
  connected = true,
  syncing = false,
  typing = false,
  celebrating = false,
  todayTokens = 0,
  ambientState = "idle-living",
} = {}) {
  if (rage) return "working-overheated";
  if (!connected) return "disconnected";
  if (syncing || typing) return "working-typing";
  if (celebrating) return "happy";
  if ((Number(todayTokens) || 0) <= 0) return "sleeping";
  return ambientState;
}
