# Production navigation latency — 2026-10-11

## Scope and release boundary

- Production baseline: `07042f851c8d0fe6b133288c088051bad6973bb5`, deployment
  `dpl_6uHo1tyU3KPR75whcmWETJDo1Anz`, alias
  `https://skillbase-alpha.vercel.app`.
- Candidate base: `e850190bb96728dd54a05186fe0de42bdf8959ea`
  (`origin/development`). The course repository was identical at both SHAs.
- Source correction commit after rebasing onto Auth PR 337:
  `b5e1c539dae33cfc974e35308463a77e1e0bc884` (base `2bd5d05`). Local
  measurements/checks below preceded that rebase; native CI validates the
  integrated source. No Auth-owned files were changed by this branch.
- Low-volume sequential ordinary navigation using Chromium / Playwright CLI,
  from the operator's Windows workstation. No load test, cache purges, forced
  cold starts, database writes, seeds, real-user login or Google consent.
- An existing authorized synthetic INSTRUCTOR account was reused. Credentials
  stayed in the private operator credential store; the temporary session was
  signed out. Normal login/logout necessarily affect that account's Auth session
  metadata; this is not a claim of zero Auth writes.

## Production observations (before changes)

Milliseconds, rounded. These are small diagnostic samples, not performance SLOs.
No p95 is inferred. Browser-cold does **not** mean Vercel-function-cold.

| Surface                                |   n | First byte after request | Remaining HTML response | DOM ready     |
| -------------------------------------- | --: | ------------------------ | ----------------------- | ------------- |
| Landing, first browser visit           |   1 | 154                      | 2,165                   | 3,520         |
| Landing, subsequent visits             |   2 | 154 / 154                | 1,918 / 1,908           | 2,407 / 2,449 |
| Catalog, same desktop context          |   2 | 155 / 156                | 1,996 / 1,910           | 2,530 / 2,439 |
| Published detail, same desktop context |   2 | 154 / 154                | 2,699 / 2,644           | 3,198 / 3,199 |
| Instructor courses, full document      |   2 | 162 / 157                | 2,123 / 2,085           | 2,832 / 2,765 |
| Instructor profile, full document      |   1 | 159                      | 2,444                   | 3,282         |

Landing's first connection: DNS 33 ms, TCP including TLS 320 ms, TLS subset
288 ms. Subsequent same-origin requests reported zero DNS/connect time. Thus
the repeated multi-second HTML wait cannot be explained by browser DNS/TLS.

Actual private ClientRouter clicks (one each): profile request first byte
2,474 ms, body 114 ms, click-to-response-complete 2,618 ms; courses first byte
2,285 ms, body 1 ms, click-to-response-complete 2,644 ms. Unlike streamed document
navigation, these fetches expose the SSR wait primarily as request TTFB. A
154 ms document TTFB alone therefore gives a misleading impression of speed.
Both private surfaces returned `Cache-Control: private, no-store`.

390×844 viewport landing (one warm request, desktop Chromium UA, **no mobile
CPU/network emulation**): first byte 155 ms, remaining HTML 1,908 ms, DOM ready
2,449 ms; responsive hero AVIF 32,663 transferred bytes / 398 ms. First desktop
hero AVIF was 97,166 bytes / 491 ms. Font requests on the initial landing took
517–532 ms. Public landing scripts were small theme/layout scripts, not a
page-sized React hydration payload. Asset work follows the larger SSR wait;
removing UI, notifications or images would not address the measured server wait.

## Infrastructure and SQL evidence

Read-only CLI metadata confirms:

- Vercel deployed `_render` lambda: `deployedTo: [iad1]` (Virginia),
  `runtime: nodejs22.x`, memory 2048 MiB. The current project setting/build output
  uses Node 24; do not silently substitute that setting for deployed metadata.
- Supabase canonical project: `sa-east-1` (São Paulo), `ACTIVE_HEALTHY`.
- Cloud inventory: 19 courses; the qualified public join returned 16 published
  rows. No rows or contact details were printed.

A single read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` of a public
course/revision/instructor-name join reported execution **0.298 ms**, planning
1.167 ms, existing status/PK index scans, in-memory sort, zero shared reads or
temp blocks. This narrow representative projection is not a timing of every
application query, but provides no evidence that this lookup needs a new index.
No migration, `ANALYZE` maintenance command, statistics reset or production DDL
was performed.

The source previously fetched courses, immutable format revisions and assigned
instructor names in **three sequential SQL statements**. Runtime deliberately
uses one connection with `max_pipeline: 1`, and per-request connection disposal
after a historical stale-socket/504 incident. Inter-region connection setup and
serial round trips are plausible contributors; exact attribution of every
millisecond requires server-side phase timings after release. Cold-start duration,
Auth latency and pooler handshake duration were not independently measured. Do
not claim the region mismatch alone explains all observed time.

The detail also calls the interest-form loader, whose transaction/lock and
deadline semantics remain intact. Private pages still validate Auth/internal user
and their own authorized loaders. The public repository optimization does not
pretend to fix every private loader or eliminate that detail transaction.

## Source correction

`src/server/db/repositories/course-repository.ts` now fetches public courses,
format revisions and the **name-only** instructor projection in one statement
with joins. Both list and detail preserve:

- `PUBLISHED` filtering, normalized slug/404 behavior and ordering;
- explicit public DTO allowlist and time-derived registration availability;
- legacy instructor text only when no instructor ID is assigned;
- null name for a missing assigned profile, and failure for a missing revision;
- private guards, ownership, historical revision semantics and mutation paths.

`vercel.json` also pins the single function region to `gru1` (São Paulo,
Vercel's mapping to `sa-east-1`). Owner API metadata confirmed the team is
`hobby`, billing status `active`. Official Vercel docs allow a single region on
Hobby and identify it as a free plan without usage-based overage billing. This
does not provision a paid resource, upgrade the plan, add regions, increase
memory or move Supabase. Existing Hobby limits and non-commercial-use restrictions
still apply; regional pricing must be reconsidered if the plan changes.

References: [Function region configuration](https://vercel.com/docs/functions/configuring-functions/region),
[region codes](https://vercel.com/docs/regions),
[Hobby billing and limits](https://vercel.com/docs/plans/hobby).
The configuration is a source-only change for the normal coordinated release;
the current deployed function remains in `iad1` until that release.

No shared Auth/client/profile files, styling, Sileo patch, seed services,
dependencies, database schema or caching policy changed. There is no shared-CDN
cache for authenticated data and no authorization shortcut.

## Local production-build comparison (not production after)

The actual Vercel production-build entrypoint was served by a private temporary
Node HTTP bridge on `127.0.0.1:4347`, with static build assets and the existing
local PostgreSQL database. Node 24 / Bun 1.4.3; same workstation, browser,
configuration and unchanged local dataset of 10 courses. This is not Vercel or
the cloud dataset. The original app on 4321 and its configuration were not
restarted or edited. No public/private benchmark was directed at a new cloud
deployment.

Comparable warm full-document TTFB samples, n=2 per route per build:

| Surface                | Before      | After       | Before median | After median |
| ---------------------- | ----------- | ----------- | ------------: | -----------: |
| Landing                | 48.0 / 38.8 | 56.1 / 50.4 |          43.4 |         53.3 |
| Catalog                | 55.0 / 37.3 | 62.4 / 55.8 |          46.2 |         59.1 |
| Local published detail | 54.3 / 42.4 | 58.6 / 61.4 |          48.4 |         60.0 |

Local warm samples **do not show a wall-clock improvement**. Loopback round trips,
small n, startup/module loading and workstation variance do not model the cloud
distance. The defensible improvement is the source's three-to-one DB statement
reduction, not an invented latency percentage. Local process-first requests took
several seconds in both builds and are not equivalent to controlled Vercel cold
starts; they are excluded from warm medians. An initial nonexistent local demo
slug was also excluded; the valid local detail was used for the comparison.

## Verification and follow-up

- Frozen install, lint, formatter, typecheck (0 errors / 0 warnings), build and
  464 unit tests / 4,036 assertions passed. No new tests/specs/cases were added.
- Official Vercel JSON schema confirms the top-level `regions` array; source
  validation confirmed exactly one region, `gru1`. Current-plan availability
  and region names were independently verified through owner metadata and docs.
- The first full local integration attempt exceeded the outer 120-second command
  budget after an unrelated first Auth-admin lock test hit its 5-second timeout.
  It is **not** a passing integration gate. Its owned temporary stack was stopped;
  no other agent's stack or the canonical stack was stopped. A separate focused
  run uses the existing public-projection/instructor coverage, not changed tests
  or a retry of that failed admin case. Final results are recorded below.
- Focused managed-stack integration passed **14 tests / 81 assertions**, 0
  failures, 163 filtered out, using existing public-projection/instructor cases.
- Focused existing E2E (`public-courses.spec.ts` and `public-interest.spec.ts`,
  Chromium, owned port 4347 and managed temporary stack) passed **14/14** in
  2.4 minutes, without retries or test changes. It verifies publication/withdrawal,
  assigned public names, artwork, public DTO presentation, interest forms,
  deadline changes, progressive enhancement, keyboard/responsive surfaces and
  fallback without JavaScript. The public-query source was unchanged throughout;
  the branch was rebased onto Auth PR 337 during this local run, so native CI
  remains the authoritative integrated-head gate.
- Native PR CI must pass quality, integration and both isolated E2E shards before
  merge. The normal master release remains the orchestrator's responsibility.
- Region alignment is encoded in Git only after confirming the active free Hobby
  plan and its single-region support. No live region/capacity/billing setting was
  changed by this block. Do not add replicas, paid pooling or larger instances
  without approval. Keep the request-scoped socket safeguard unless a separately
  verified lifecycle solution replaces it.
- After the coordinated master release, repeat the same small public/private
  navigation cohort and inspect the deployed lambda region. Until then,
  **production-after latency is pending**, and private navigation is not declared
  fixed by the public-query change alone.
