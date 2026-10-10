# Landing performance audit

## Scope and environment

Measured on 2026-10-10 UTC from `origin/development` base
`f388327`, in the isolated `perf/landing-and-runtime-quality` worktree.
No production requests, database changes, seeds, resets or stack restarts.
The existing application and local services were left running.

- Official Lighthouse CLI **13.5.0**, installed ephemerally with `npx --yes lighthouse`.
- Node **24.14.0**, Windows, Headless Chrome **155.0.0.0**.
- Production builds: `bun run build`, Astro **7.3.2**, existing Vercel adapter.
- Origin: `http://127.0.0.1:4333`, same local production-artifact host before/after.
- Routes: `/`, `/cursos`, `/cursos/demo-comprehensive-v1-future`.
- Three independent Lighthouse navigations per route/device/phase (36 reports).
- Default simulated mobile throttling: 412 × 823, DPR 1.75, 150 ms RTT,
  1638.4 Kbps throughput, 4× CPU slowdown.
- Desktop uses Lighthouse's `--preset=desktop`: 1350 × 940, DPR 1,
  simulated 40 ms RTT, 10240 Kbps throughput, 1× CPU. Configuration is retained
  in each JSON.
- Each navigation uses Lighthouse's default storage reset. No authentication state
  or tokens are included in reports.

`astro preview --host 127.0.0.1 --port 4332` exited before readiness with the
Vercel adapter. Port 4332 was also occupied by a separate development process;
it was not stopped or used for these measurements. An external, temporary Node
host serves `.vercel/output/static` and delegates non-static requests to the
actual built Vercel `entry.mjs` fetch handler on **4333**. It loads the ignored
local environment without printing values. It does not emulate Vercel's CDN,
compression, cache, serverless cold starts or network geography. These are local
production-build measurements, **not real-user or deployed-production scores**.

## Evidence and change

The existing landing already used AVIF/WebP, responsive art direction and
appropriate loading priority. Recompressing the original PNGs at lower quality
would not solve its request-time bottleneck.

Baseline hero requests went through `/_image`, encoding AVIF at runtime. The
initial diagnostic mobile request took 599 ms for a 110,099-byte AVIF body.
Static derivatives now remove that encoding work from page requests:

- Preserve all five original PNG plates and their provenance.
- Generate exactly the existing 25 responsive widths in both WebP **82** and
  AVIF **52**, with the same resize/aspect ratio behavior (50 static files).
- Preserve `picture` media breakpoints, `srcset`, `sizes`, width/height, decorative
  alt text, eager/high hero priority and lazy footer/participation loading.
- Serve fingerprinted static files rather than runtime `/_image` URLs.
- `bun scripts/generate-landing-images.ts` regenerates variants using the existing
  Astro-provided Sharp installation; no package/lock or runtime dependency added.

The mobile hero at width 960 is **byte-identical** before/after, including its
SHA-256 `d07eeb297a4c7de48f7345af0d3d9510212ef93b52977aac881c9b6ecb39ceb6`.
This is an encoding/visual-preservation check, not a claim that lossy AVIF/WebP is
identical to its original PNG. Original assets total 13,398,013 bytes; the 50
derivatives total 6,151,822 bytes. Only the selected responsive file is requested,
not all variants. Browser image-body size is deliberately unchanged; the benefit
is delivery latency and eliminated request-time encoding, not lower quality.

## Results

Median of three runs, **before → after**. FCP/LCP/TBT are Lighthouse's simulated
values in milliseconds; CLS is unitless. Total bytes are transferred bytes in
the uncompressed local host, including response headers.

| Route/device      | Score     | FCP ms      | LCP ms      | CLS                 | TBT ms   | Total bytes     |
| ----------------- | --------- | ----------- | ----------- | ------------------- | -------- | --------------- |
| Landing mobile    | 92 → 92   | 2350 → 2414 | 2881 → 2861 | 0.001630 → 0.001631 | 0 → 0    | 334804 → 331973 |
| Landing desktop   | 100 → 100 | 484 → 553   | 694 → 709   | 0.000936 → 0.000984 | 0 → 0    | 448464 → 445568 |
| Catalogue mobile  | 96 → 95   | 2263 → 2335 | 2263 → 2410 | 0.000685 → 0.002330 | 0 → 0    | 182727 → 182727 |
| Catalogue desktop | 100 → 100 | 535 → 531   | 535 → 531   | 0.002013 → 0.000827 | 0 → 0    | 182727 → 182727 |
| Course mobile     | 85 → 88   | 2862 → 2783 | 3462 → 3308 | 0.005644 → 0.005644 | 14.5 → 0 | 711122 → 711122 |
| Course desktop    | 99 → 99   | 650 → 653   | 770 → 771   | 0.003874 → 0.002409 | 0 → 0    | 711122 → 711122 |

The deterministic improvement is the **actual local hero request latency** and
eliminated encoding work, not the simulated score:

| Landing metric                       | Before median (min–max) | After median (min–max) |
| ------------------------------------ | ----------------------- | ---------------------- |
| Mobile hero request ms               | 604 (552–766)           | 11 (8–11)              |
| Desktop hero request ms              | 795 (765–811)           | 9 (9–15)               |
| Mobile observed, unthrottled LCP ms  | 991 (777–1287)          | 314 (255–340)          |
| Desktop observed, unthrottled LCP ms | 974 (920–1026)          | 330 (287–461)          |
| Mobile transferred image bytes       | 110335                  | 110270                 |
| Desktop transferred image bytes      | 223995                  | 223865                 |

The small transferred-image-byte difference is response headers; the encoded
hero body was verified identical. Shorter static URLs also reduce HTML payload.
The simulator estimates network/CPU costs; this simulated run does not show a
matching improvement from eliminating the observed encoder delay. The score
and simulated LCP are essentially unchanged, and simulated FCP is slightly worse.
No mobile CWV or score improvement is claimed from this run. Even the unchanged
control routes vary: catalogue mobile scores 95–96 before and 95 after; course
mobile 85–86 before and 84–91 after. Its apparent improvement is **not caused or
claimed by this branch**. Desktop 100 is a bounded local lab result, not a
guarantee of deployed-production or real-device performance. Full per-metric
ranges are retained in `summary.json`.

## Other findings and boundaries

The unchanged course detail loads approximately 711 KB without local compression.
Baseline chunks include React client (209,373 transferred bytes) and notifications
(145,167 bytes; Lighthouse reports 122,196 unused during initial navigation).
This does not establish that the notification code is unnecessary during later
interaction. Shared notification/layout changes belong to the Sileo workstream;
none were made here. Catalogue/detail results serve as controls, not improvements
attributed to this landing-only change.

No measured evidence warranted changing domain rules, database queries, indexes,
pooling or Supabase configuration. Those changes were not made. Authenticated
routes were not audited: no legitimate session was injected into this public
artifact host, and changing authentication origins/configuration solely for a
landing audit was outside this disjoint scope. Private performance remains a gap.

Lighthouse TBT is an **INP proxy**, not an INP field measurement. Scores alone do
not establish user-perceived performance; timing ranges and unchanged controls
matter. Concurrent work on the same machine introduces measurement noise. No
automated tests/specs/suites were added and no existing coverage was suppressed.

## Reproduction and artifacts

```powershell
bun install --frozen-lockfile
bun run build
# Start the external production-artifact host on 4333.
npx --yes lighthouse http://127.0.0.1:4333/ --only-categories=performance --output=json --output-path=landing-mobile.json --chrome-flags="--headless --no-sandbox" --quiet
# Add --preset=desktop for desktop; repeat each route/device three times.
bun scripts/generate-landing-images.ts
bun run build
# Restart only the isolated artifact host, then repeat identical commands.
```

External evidence directory:
`C:/Users/Steve/AppData/Local/Temp/opencode/perf-evidence/`.
Includes `before-<route>-<device>-<1..3>.json`, equivalent `after-*.json`,
`probe.json`, aggregate `summary.json`, original encoded `before-hero.avif`,
and before/after screenshots at 390/768/1440 pixels. The host, measurement and
aggregation scripts are outside Git in the same parent temporary directory.
Official Lighthouse HTML renderings of the JSON are also retained beside each
report. Raw JSON retains Lighthouse configuration, Chrome version, network timings,
bytes and filmstrips. Reports are public/synthetic content only, without cookies
or authenticated state. Temporary evidence is not a permanent CI benchmark.

Browser inspection uses the named Playwright CLI session `perf`. Full-page
captures during normal motion can show in-progress reveal transitions; confirmation
captures use reduced motion so all content can be inspected. No CSS or animation
was changed. Images load at mobile/tablet/desktop and there is no horizontal
overflow at 390, 768 or 1440 px.

WebP fallback was also checked in-browser by removing AVIF sources: hero,
participation and footer all decoded their corresponding static WebP files.
Dark theme preserves the same image plates; no browser console errors/warnings
were observed. Visual inspection confirmed preserved composition and artwork.

## Validation

- Frozen-lockfile install: PASS; manifest and lockfile unchanged.
- ESLint: PASS.
- Global Prettier check: PASS; added documentation formatted separately.
- Astro typecheck: PASS, 0 errors, 0 warnings, 354 existing hints.
- Existing focused unit tests (`course-poster-rows`, `public-course-loader`):
  11 PASS, 0 FAIL, 44 assertions.
- Production build before and after: PASS.
- `git diff --check`: PASS.
- Browser checks and Lighthouse: described above; no new automated suites added.
- Managed integration/full E2E were not rerun locally: this image-only change
  makes no database/contract changes, and the canonical application port remains
  occupied by the existing application. Required remote CI is still a separate gate.
