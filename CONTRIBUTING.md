# Contributing

Thanks for your interest in contributing to `@shayc/react-built-in-ai`.

## Development

Requires Node 22+.

```bash
npm install
npx playwright install chromium  # one-time, for browser-mode tests
```

Common commands:

```bash
npm run lint        # eslint
npm run typecheck   # type-check only (noEmit via tsconfig)
npm test            # vitest run (browser mode, chromium)
npm run build       # tsdown → dist/
```

## Pull requests

Any user-facing change (new feature, bug fix, breaking change, dependency bump that affects consumers) must include a changeset:

```bash
npx changeset
```

Choose patch / minor / major and write a short summary. The changeset bot will turn this into a "Version Packages" PR on merge, and merging that PR triggers the publish.

Pure refactors, docs-only changes, and CI tweaks don't need a changeset.

## Reporting issues

Open an issue at [github.com/shayc/react-built-in-ai/issues](https://github.com/shayc/react-built-in-ai/issues). Include the browser, Chrome version, the Built-in AI API you're using (Translator / Rewriter / Proofreader / Summarizer / Writer / Language Detector / Prompt), and a minimal reproduction if possible.
