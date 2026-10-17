# Quotern product localization design

## Outcome

Quotern's browser dashboard, Desktop renderer and native surfaces, pet, and CLI text output can use Simplified Chinese, English, Japanese, or Korean. Users can follow the system language or choose one explicitly. Switching languages updates visible text and accessibility labels without changing the selected date range, statistics timezone, currency, API schema, or stored usage data.

## Language contract

- Canonical locales: `zh-CN`, `en`, `ja`, `ko`. Unsupported system languages and unrecognized locale values fall back to `en`; missing translation keys fall back to `zh-CN`.
- Locale preference is `system` or one canonical locale. Browser and Desktop persist their own preference. Desktop main owns its preference and broadcasts changes to every window, the tray, notifications, and the pet. CLI uses an explicit language option when supplied, then its runtime environment.
- Translation resources ship with the app for offline use. Product copy uses i18next and React copy uses react-i18next. Dates, numbers, currency display, and relative time use the current locale through `Intl` or date-fns locale data. Calendar controls receive the same locale through React Aria's `I18nProvider`.
- Translation keys are stable identifiers. Variables and plurals are formatted as whole messages; translated strings are never used for control flow.

## Data boundaries

- Core and local API keep stable codes and semantic fields. Presentation layers map those fields to localized copy. Existing JSON and CSV property names and machine codes stay stable.
- `Asia/Shanghai` statistics boundaries, ISO date parameters, and selected currency remain separate from language preference.
- Raw upstream errors may be shown only through an explicit, localized fallback. Diagnostic logs remain diagnostic.

## Coverage and acceptance

- Browser and Desktop main window: settings, navigation, overview, sessions, charts, quotas, pricing, ranking, achievements, sharing/export, notices, tooltips, alt text, and ARIA labels.
- Desktop: tray/popover, native menus and dialogs, notifications, updates, and pet entry. CLI: help, status, errors, and human-readable reports. Product names and model identifiers remain untranslated.
- Locale selection persists, system mode resolves a supported language, and switching updates open UI. All four locales render critical flows; missing keys, variable placeholders, and untranslated visible Chinese are checked. Build and relevant tests pass in an isolated validation environment if the active main worktree service cannot safely be rebuilt.
