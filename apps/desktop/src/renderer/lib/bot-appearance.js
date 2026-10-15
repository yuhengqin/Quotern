/**
 * Our layer on top of the vendored `bot/` engine — default look and the mapping
 * from our pet state vocabulary to the engine's 15 `StateId`s.
 *
 * Kept OUT of `lib/bot/` so that directory stays an unmodified vendor copy
 * (see lib/bot/README.md). This module is the single source of truth shared by
 * the web renderer and `scripts/gen-bot-frames.cjs`, which pre-renders the same
 * scenes for macOS — so a change here must be followed by re-running that script.
 */

export const BOT_DEFAULT_SHAPE = "cercle";
export const BOT_DEFAULT_EXPRESSION = "neutre";

/**
 * The default body colour follows the theme instead of being one fixed hue: ink
 * on light surfaces, cream on dark, so the silhouette never sinks into its own
 * background. Users can pin any palette entry instead — see BOT_COLOR_CHOICES.
 */
export const BOT_DEFAULT_COLOR_LIGHT = "encre";
export const BOT_DEFAULT_COLOR_DARK = "creme";

/**
 * What the eye holes reveal. They are holes punched in the body, so this is the
 * visible "eye white" — every host must use the same values or the eyes differ
 * between the desktop pet and the dashboard preview.
 */
export const BOT_PAPER = { light: "#f8fafc", dark: "#0f172a" };

/** @param {boolean} dark */
export function botDefaultColor(dark) {
  return dark ? BOT_DEFAULT_COLOR_DARK : BOT_DEFAULT_COLOR_LIGHT;
}

/**
 * The palette offered in the picker. Ink and cream are deliberately NOT here:
 * they are the two ends of "auto", so offering them as fixed choices would only
 * let someone pin the colour that disappears into the other theme.
 */
export const BOT_COLOR_CHOICES = ["auto", "bleu", "turquoise", "vert", "ambre", "rose", "violet"];

/** Resolve a stored preference (possibly "auto" or stale) to a palette id. */
export function resolveBotColor(preference, dark) {
  const id = String(preference || "auto");
  if (id === "auto" || !BOT_COLOR_CHOICES.includes(id)) return botDefaultColor(dark);
  return id;
}

/**
 * Only `idle` carries a replaceable face (`baseFace` in the engine's states.ts);
 * every other state has an expression measured off the reference video, which is
 * precisely what the animation is. So an expression here only ever applies to idle.
 */
const SCENES = {
  // Rest
  "idle-living": { state: "idle", expression: "neutre" },
  "idle-look": { state: "idle", expression: "curieux" },
  "idle-follow": { state: "idle", expression: "attentif" },
  "idle-yawn": { state: "idle", expression: "somnolent" },
  "static-base": { state: "idle", expression: "neutre" },

  // Sleep
  sleeping: { state: "sleep" },
  "idle-doze": { state: "sleep" },
  "idle-collapse": { state: "sleep" },
  "collapse-sleep": { state: "sleep" },
  "mini-enter-sleep": { state: "sleep" },
  "mini-sleep": { state: "sleep" },
  waiting: { state: "sleep" },

  // Working — token burn intensity climbs through thinking -> orbit -> swirl
  "working-typing": { state: "thinking" },
  "working-thinking": { state: "thinking" },
  "working-building": { state: "thinking" },
  "working-debugger": { state: "thinking" },
  running: { state: "thinking" },
  review: { state: "thinking" },
  "working-juggling": { state: "orbit" },
  "working-wizard": { state: "orbit" },
  "working-carrying": { state: "orbit" },
  "working-conducting": { state: "orbit" },
  "working-ultrathink": { state: "swirl" },

  // Trouble
  "working-overheated": { state: "burst" },
  "working-confused": { state: "wide" },
  error: { state: "alert" },
  disconnected: { state: "alert" },

  // Reactions
  happy: { state: "play" },
  jumping: { state: "play" },
  "mini-happy": { state: "play" },
  waking: { state: "play" },
  wake: { state: "play" },
  "react-double": { state: "play" },
  notification: { state: "notify" },
  "mini-alert": { state: "notify" },
  "mini-peek": { state: "wink" },
  waving: { state: "wink" },
  "mini-idle": { state: "idle", expression: "neutre" },
  "mini-enter": { state: "wink" },

  // Dragged across the desktop
  "running-left": { state: "comet" },
  "running-right": { state: "comet" },
  "react-drag": { state: "comet" },
};

const FALLBACK_SCENE = { state: "idle", expression: BOT_DEFAULT_EXPRESSION };

/**
 * Resolve one of our pet states to an engine scene.
 * Unknown states fall back to idle rather than throwing — pet packages and the
 * native hosts both push state names we do not control.
 */
export function botSceneForPetState(petState) {
  return SCENES[petState] || FALLBACK_SCENE;
}

/**
 * The menu bar animator has its own four-state vocabulary (idle / active / sleeping /
 * disconnected), so it gets its own table rather than borrowing pet state names.
 *
 * `active` uses burst, NOT orbit: orbit's body morphs out of a spinning triangle and
 * back (that is the upstream animation, see its pose in bot/states.ts), which at 18pt
 * reads as the icon glitching rather than working. burst also loops cleanly — orbit's
 * first and last frames are 171 units apart, so looping it visibly snaps.
 */
export const BOT_MENUBAR_CLIPS = {
  idle: "idle",
  active: "burst",
  sleeping: "sleep",
  disconnected: "alert",
};

/** Every engine state we actually reference, for the macOS pre-render to enumerate. */
export function botReachableStates() {
  const ids = new Set([FALLBACK_SCENE.state]);
  for (const scene of Object.values(SCENES)) ids.add(scene.state);
  for (const id of Object.values(BOT_MENUBAR_CLIPS)) ids.add(id);
  return [...ids];
}

/** Every pet state we map, so parity tests can assert the hosts agree. */
export function botMappedPetStates() {
  return Object.keys(SCENES);
}
