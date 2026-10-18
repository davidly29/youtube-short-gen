## Ticket

Closes #<issue> · <ticket id and title>

## Intent

<one sentence, restated from the ticket>

## What changed

- <files / modules touched, all inside the ticket's Touches list>

## Test output

```
<paste the ticket's Test command output and the full suite summary>
```

## Definition of done

- [ ] Every acceptance box is covered by an automated test that passes in CI
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; no new `any`
- [ ] External calls go through `packages/providers` with a fake used in tests; no real API keys in tests
- [ ] Schema changes come with a Drizzle migration and updated Zod contract
- [ ] Edits stay inside the ticket's _Touches_ list; anything else became a new issue
- [ ] No media fetched from third-party platforms; no secrets committed

## Questions for the reviewer

<decisions you made that the owner should confirm, or "none">
