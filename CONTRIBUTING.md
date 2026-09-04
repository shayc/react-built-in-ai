# Contributing

## Reporting issues

Open an issue at [github.com/shayc/react-built-in-ai/issues](https://github.com/shayc/react-built-in-ai/issues). Built-in AI behavior varies by browser, release channel, device, and model state, so include:

- **Browser, version, and channel** (stable, beta, dev, or canary)
- **Operating system and relevant device hardware**
- **The Built-in AI API** (Writer, Rewriter, Summarizer, Proofreader, Translator, Language Detector, or Prompt)
- **API options and lifecycle status** when the problem occurs
- **The thrown error and `error.cause`**, when present
- **Flags, origin-trial tokens, or enterprise policies** affecting the API
- **Whether the model was cached or downloading for the first time**
- **A minimal reproduction** (CodeSandbox, StackBlitz, or a small repository), when possible

## Development

Requires Node 22.12+.

```bash
npm ci
npx playwright install chromium  # one-time, for browser-mode tests
```

Run the same local validation expected from a pull request:

```bash
npm run check
```

Individual commands:

```bash
npm run dev            # rebuild dist/ while source files change
npm run format:check   # verify Oxfmt formatting
npm run lint           # Oxlint
npm run typecheck      # type-check only (noEmit via tsconfig)
npm test               # vitest run (browser mode, chromium)
npm run test:coverage  # vitest run with V8 coverage + threshold gate
npm run build          # tsdown → dist/
```

## Pull requests

Any user-facing change (new feature, bug fix, breaking change, dependency bump that affects consumers) must include a changeset:

```bash
npx changeset
```

Choose patch, minor, or major and write a short summary. The changeset bot will turn this into a "Version Packages" PR on merge, and merging that PR triggers the publish.

Pure refactors, docs-only changes, and CI tweaks don't need a changeset.
