# Changelog

## 0.2.2

- Fixed the stripped Node child environment on Windows by preserving a case-insensitive allowlist of runtime essentials, without inheriting arbitrary environment variables or exposing child stderr.
- Added Ollama's current range/totals/buckets response format and requested its maximum 30-day window. Genuine dated buckets now contribute to history; legacy summaries remain supported.
- Preserved tiny numeric dollar amounts without fixed-decimal rounding, cached-input counts and unknown metrics. No model or quota data is invented.
- Added regression tests for both reports and a contributor guide covering setup, validation, privacy and pull requests.
- Verification uses synthetic provider fixtures and a mocked Windows environment on macOS, not a native Windows host or a live authenticated Ollama request.

## 0.2.1

- Replaced private credential discovery with Hermes public credential routes: the Codex provider request broker and optional declared plugin secrets.
- Removed reads of private auth files, profile environment files, credential pools and other CLIs' token files, plus custom Codex authentication headers.
- Isolated the collector's child environment. Passive reads resolve no secrets and make no provider requests.
- Moved the usage cache under `plugin-data/hermes-activity/` with private directory and file permissions; legacy aggregate caches remain readable.
- Documented exact credential routes, provider hosts, optional quota-cache reads and the minimum Hermes version, 0.21.7.

## 0.2.0

- Added a Providers tab with a fixed annual heatmap, combined dated usage, provider filters, usage summaries, token mix and source-period model breakdowns.
- Added Activity-owned provider collection for CommandCode period totals, Codex daily token buckets, OpenCode daily usage exports and Ollama activity-period summaries. No Quota installation is required.
- Passive reads are cache-only. Explicit refresh uses existing credentials, stores normalized aggregates in a profile-local cache, and never signs in or changes credentials.
- Missing metrics stay unknown, partial coverage is disclosed, and summary-only totals are never converted into daily history.
- Provider collection requires Node.js 22.18 or newer. The desktop UI is shipped as a single compiled bundle.

## 0.1.1

- Fixed the 12-month Activity page failing when its full JSON response exceeded Hermes Desktop's `cli.exec` output limit. The desktop request now trims breakdowns to the rows the page displays; standalone CLI output remains complete.
