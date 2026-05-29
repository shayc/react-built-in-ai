---
"@shayc/react-built-in-ai": minor
---

Rename the `NoUserActivationError` class to `MissingUserActivationError`. The new name keeps the "missing thing" meaning while aligning with its sibling adjective-style names (`UnsupportedError`, `UnavailableError`).

**Breaking:** update any `import`, `instanceof`, or `catch` checks that reference `NoUserActivationError`.
