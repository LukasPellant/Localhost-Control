# Deepsec setup for LocalhostControl

Initial project context is filled in `INFO.md`. Keep it short: this file is
injected into every AI review batch, so broad codebase summaries reduce signal.

Before adding custom matchers, install deepsec in this workspace and read:

```bash
cd .deepsec
pnpm install
```

Then open:

- `node_modules/deepsec/SKILL.md`
- `node_modules/deepsec/dist/docs/getting-started.md`
- `node_modules/deepsec/dist/docs/configuration.md`
- `node_modules/deepsec/dist/docs/writing-matchers.md`

Run scan stages from `.deepsec`:

```bash
pnpm deepsec scan --project-id LocalhostControl
pnpm deepsec process --project-id LocalhostControl
pnpm deepsec revalidate --project-id LocalhostControl
```

Add custom matchers only after a confirmed true positive exposes a
Localhost-Control-specific pattern worth keeping.
