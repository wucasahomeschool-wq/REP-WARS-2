# Player identity contract

> **Current:** One persisted world per opaque `playerId`. Authentication
> is not a gameplay-state concept. Account creation must keep the same
> game identity so the Level 1 empire is not replaced.

This is the authoritative answer to:

> A player has reached Level 2 using an anonymous Level 1 identity.
> How does that same empire become associated with the player's
> persistent account?

**Keep the same Rep Wars `playerId`.** Do not mint a second game identity
after login. The backend does not migrate, merge, or claim worlds.

## What the game considers the player

| Layer | Identity | Lives on |
| --- | --- | --- |
| Durable game identity | `playerId` (opaque string) | Persistence envelope (`PersistedWorldRecord.playerId`) and command `CommandRequest.playerId` |
| In-world faction | `GameState.playerFactionId` | GameState (authored, e.g. `f_player`) |
| Authentication account | email / OAuth / provider user id | **Outside** Rep Wars GameState |

`playerId` is **not** stored on GameState. Anonymous play and a later
authenticated account are **not** separate gameplay identities. They are
the same `playerId` with different client-side login state.

`ensurePlayerWorld({ playerId, store })` is the session boot API:

1. If that `playerId` already has a row → load it (`created: false`).
2. If not → create Level 1 once (`created: true`).
3. Never overwrite, merge, or copy another player's row.

`initializePlayerWorld` is **create-only**. With a `store`, a second
create for the same `playerId` throws `persistence.already_exists`.

## Responsibility split

### Backend / game layer

- Keys exactly one world row per `playerId`.
- Loads and saves that row with optimistic concurrency (`stateVersion`).
- Refuses to initialize over an existing row.
- `syncPlayerWorld` default does **not** create a world when the id is
  missing (`createIfMissing` defaults to false).
- Does **not** change `playerId`, rewrite GameState for login, or link
  two ids.

### Frontend / authentication layer

On first launch, generate or receive a durable `playerId` and persist it
on the device (or equivalent client storage).

Call `ensurePlayerWorld` (then `syncPlayerWorld` / commands) with **that
id** for the whole Level 1 run.

When the player later creates or logs into an account:

1. Associate the **existing** `playerId` with the auth account.
2. Continue calling the backend with that same `playerId`.
3. Do **not** derive a new Rep Wars `playerId` from the auth user id.
4. Do **not** call `initializePlayerWorld` again for a new id.
5. Do **not** invent a merge or overwrite of two worlds.

Login is account metadata. It is not a new game.

### Failure cases (frontend must not guess)

| Situation | Backend behavior | Frontend must |
| --- | --- | --- |
| Returning session, same `playerId` | `ensurePlayerWorld` loads the existing empire | Continue that game |
| First launch, unknown `playerId` | `ensurePlayerWorld` creates Level 1 once | Keep that `playerId` |
| `initializePlayerWorld` on an id that already has a world | `persistence.already_exists` — stored row unchanged | Do not create a second game |
| `store.load` / `syncPlayerWorld` for a missing id | `persistence.not_found` (unless `createIfMissing`) | Do not invent a replacement empire |
| Stale save (`expectedVersion` mismatch) | `persistence.conflict` — stored row unchanged | Reload, do not overwrite blindly |
| A **different** `playerId` | Separate world row | Never treat it as the first player's empire |
| Auth account already mapped to game id A, client sends id B | Two independent worlds | Use the mapped id A; do not merge A and B |

There is no backend merge. Two `playerId`s are two empires.

## What is preserved

The full authoritative `GameState` for that `playerId`: territories,
resources, Troops, tutorial stamps, fitness/workout session, economy,
invasions, anchors, and envelope `stateVersion`. Workout history is the
sibling store keyed by the same `playerId`.

Nothing is reconstructed field-by-field for “account creation.” Login
does not write GameState.

## What this phase does not do

- No auth-provider integration (Supabase Auth, Clerk, etc.).
- No `isAnonymous` / provider fields on GameState.
- No `CLAIM_*` / identity-migration command.
- No Level 1 → Level 2 world change.
- No schema bump (schema remains 12).

Level 2 campaign transition is a later phase. This contract is what that
phase will use so account creation cannot destroy the Level 1 empire.
