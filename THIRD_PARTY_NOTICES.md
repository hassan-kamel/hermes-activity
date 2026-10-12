# Third-Party Notices

This project contains code adapted from the **Quota** Hermes plugin.

## Quota plugin — MIT License

Portions of the provider-history backend are copied or adapted from the Quota
plugin's provider scripts:

- `scripts/provider-usage.ts` — copied (provider source adapters: CommandCode,
  Codex, OpenCode, Ollama, and the `mergeDaily` helper).
- `scripts/provider-breakdown.ts` — copied (per-source daily breakdown).
- `scripts/provider-history.ts` — adapted (the credential/auth flow for the live
  provider fetch, and the refresh/merge/cache logic).

Upstream license:

```
MIT License

Copyright (c) 2026 rarf

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The Activity-specific schema, CLI wiring (`commands.py`), and the surrounding
scripts are original work for the Hermes Activity plugin.
