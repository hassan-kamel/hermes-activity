# Changelog

## 0.2.0

- Added a Providers tab with a fixed annual heatmap, combined dated usage, provider filters, usage summaries, token mix and source-period model breakdowns.
- Added Activity-owned provider collection for CommandCode period totals, Codex daily token buckets, OpenCode daily usage exports and Ollama activity-period summaries. No Quota installation is required.
- Passive reads are cache-only. Explicit refresh uses existing credentials, stores normalized aggregates in a profile-local cache, and never signs in or changes credentials.
- Missing metrics stay unknown, partial coverage is disclosed, and summary-only totals are never converted into daily history.
- Provider collection requires Node.js 22.18 or newer. The desktop UI is shipped as a single compiled bundle.

## 0.1.1

- Fixed the 12-month Activity page failing when its full JSON response exceeded Hermes Desktop's `cli.exec` output limit. The desktop request now trims breakdowns to the rows the page displays; standalone CLI output remains complete.
