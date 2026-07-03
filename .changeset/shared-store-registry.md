---
"@shayc/react-built-in-ai": minor
---

Hooks with equal options — same namespace, same options by value — now share one underlying model instance and one `status`/`progress`/`error`, instead of each hook call creating its own private instance. The instance is created on the first mount that needs it and torn down when the last component using those options unmounts; a `prepare()` retry from `error` restarts the shared instance for every component using it, not just the caller. See the new "Instance sharing" section in the README.

Also: `{ foo: undefined }` and omitting `foo` are now treated as the same options for sharing/re-render purposes (option-key comparison drops undefined-valued properties, matching `JSON.stringify`).

**Note for test suites**: if your tests assert per-hook `create()` call counts, components sharing equal options will now produce fewer `create()` calls than before — update the counts, not the behavior.
