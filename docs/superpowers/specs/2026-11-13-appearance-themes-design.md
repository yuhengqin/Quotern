# Quotern appearance themes

Approved scope: the user requested a new branch implementing the recommended shared theme system, first supporting Catppuccin, Windows 95 and retro newspaper across the main UI and tray, preserving every existing feature and the default appearance.

## Design

- Keep `system | light | dark` as the existing independent mode preference. Add `default | catppuccin | win95 | newspaper` as a separate visual style.
- Keep existing accent palette IDs and explicitly saved choices. Add `theme` (theme recommendation); absent legacy palette preferences resolve to it, and with the default style it produces the existing appearance.
- One browser-safe preset/validation module under `apps/desktop/src/shared/appearance.ts` is consumed by main/preload and the shared Dashboard UI. It imports neither Electron nor browser APIs; this avoids duplicate window/renderer colors and a new package.
- Shared React preferences/runtime and scoped CSS live under Dashboard and are directly imported by Desktop. The runtime owns all style/accent overrides and removes obsolete overrides when returning to default.
- Browser preferences use localStorage, preserve the old `quotern-palette` format, remain isolated in demo namespaces, and synchronize through storage events. Desktop preferences are authoritative in a separate userData appearance file, exposed through validated get/set/initialize/change IPC. Legacy initialization checks for missing state inside the serialized main-process queue, so a late first window cannot overwrite a newer saved preference.
- Keep business components, data contracts, navigation, formatting, quota order, details, and native window controls. Native titlebar backgrounds use the same preset colors. The tray keeps its current layout and dimensions while adopting the selected style.
- Style choice uses the existing HeroUI RadioGroup card pattern with small static previews, names and selected marks. Save immediately; preserve the current dialog/focus and surface actual save failures with retry.
- Catppuccin uses Latte/Mocha colors; Win95 uses bevels, square geometry and a blue title treatment; newspaper uses serif text, paper surfaces and print rules. Both light and dark variants are provided. No upstream usage HTML, scripts, native bridge or assets are copied.
- This first stage adds no persistent animated backgrounds or third-party dependencies. Future decoration can be added behind the preset boundary without replacing business rendering.

## Alternatives

Only adding palette entries misses material, typography and geometry. Embedding upstream HTML duplicates business/native behavior. The chosen layered theme design retains Quotern's existing React UI and allows independent styles.

## Acceptance

Default appearance and saved mode/accent remain unchanged. Each new style changes real main/tray surfaces, works in light/dark/system modes, survives reload/restart, and synchronizes between windows. Returning to default clears style overrides. Verify keyboard selection, save failure/retry, narrow viewports and supported languages, quota details and layout, native titlebar colors, and no document reload or lost filters. Actual screenshots and computed styles supplement unit/build checks.
