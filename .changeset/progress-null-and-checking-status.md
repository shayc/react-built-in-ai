---
"@shayc/react-built-in-ai": minor
---

- `progress` is now `number | null` instead of always `number` — `null` when no download is in flight, `0..1` while downloading. Previously it was `0` both before a download started and while idle, indistinguishable from "just started." Consumers computing `progress * 100` will get a type error pointing at exactly the spot that needs a `?? 0` or a `progress === null` check.
- The `"idle"` status is renamed to `"checking"`. It always meant "probing availability, or quietly creating an already-downloaded model" — the old name read as "nothing happening," which it isn't. Exhaustive `switch` statements over `Status` (including the `satisfies never` pattern) will get a compile error at every site that needs updating.
- Dropped `engines` from the published `package.json`; the Node version requirement is enforced in CI, not at install time.
