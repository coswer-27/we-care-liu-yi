# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

「頂琉計畫：琉意健康 綠行琉客」— a low-carbon travel site for 小琉球 (Xiaoliuqiu). UI copy, seed data, comments and API error messages are all Traditional Chinese; keep new user-facing strings in Traditional Chinese.

## Commands

```bash
npm run dev            # backend on :4000 — also serves the frontend, so this alone runs the whole app
npm run dev:frontend   # optional static-only frontend on :5173 for split development
npm run seed           # run the seeder standalone
```

No build step, bundler, linter, or test suite — the frontend is hand-written HTML/CSS/ES-module JS served as-is. Verify changes by starting the server and loading the page.

Node >= 24 is required (built-in `node:sqlite`), and there are **zero npm dependencies** — no `node_modules`, no lockfile. Keep it that way unless asked otherwise. The only third-party runtime code is Leaflet, loaded from a CDN by the frontend and only when no Google Maps browser key is configured.

## Architecture

Two servers, both plain `node:http`, no framework:

- `backend/src/server.mjs` — one `handle()` function with an if-chain of `method + pathname` checks. It serves the JSON API **and** falls through to serving `frontend/public/` statically, with unknown paths rewritten to `index.html` for the hash-router SPA. Port 4000 alone runs everything; this is the production/Railway mode.
- `frontend/server.mjs` — dev-only static server on :5173. `app.js` targets `http://localhost:4000/api` when served from port 5173 and same-origin `/api` otherwise; any new deployment topology must keep that branch true.

All API calls use `credentials: "include"`, and CORS echoes the request Origin with `Allow-Credentials: true` so the split-port setup keeps the session cookie.

### Data layer

`backend/src/db.mjs` opens `backend/data/app.db` (override with `DB_PATH`; gitignored, auto-created) in WAL mode and exports `migrate()` plus `all`/`get`/`run` helpers over named parameters (`:id`).

Schema changes to the **content** tables (`places`, `transport_modes`, `sustainable_shops`, `plastic_actions`, `articles`) are handled by bumping `CONTENT_SCHEMA_VERSION` in `db.mjs`: on startup those tables are dropped and re-seeded. User tables (`users`, `sessions`, `turtle_progress`, `trip_logs`, `action_logs`) are never dropped and only get plain `CREATE TABLE IF NOT EXISTS`, so changes there must be additive or need a hand-written migration. `seed.mjs` inserts per table only when that table is empty, so editing seed rows without bumping the version has no effect.

### Auth

`backend/src/auth.mjs` — scrypt password hashing with a per-user salt, opaque session tokens in a `sessions` table, delivered as an HttpOnly `liuyi_session` cookie (30 days, `SameSite=Lax`, `Secure` when `x-forwarded-proto` is https). `currentUser(req)` returns the user or null and cleans up expired sessions. Any endpoint under `/api/turtle` requires a session; everything else works logged-out.

### Routing / distance (the core domain logic)

`backend/src/routing.mjs` resolves distances through a provider cascade, all returning the same shape (`{source, legs, distanceKm, durationMin, polyline}`) so callers never branch: **Google Routes API v2** → **legacy Directions API** (both need `GOOGLE_MAPS_API_KEY`) → **OpenRouteService** (`ORS_API_KEY`) → **OSRM public server** (no key, the default) → **haversine × 1.3**. `ROUTING_PROVIDER` pins one provider; `routingMode()` reports which is active and is surfaced in `/api/config` and the startup log.

The OSRM public demo only runs the car profile, so its road distance is used but duration is recomputed from `SPEED_KMH` per mode. Only the haversine tier attaches a `notice` string, which the UI surfaces on the result card. Navigation links are plain `google.com/maps/dir/?api=1` URLs and need no key at any tier.

`backend/src/env.mjs` loads a root `.env` (Node's `process.loadEnvFile`) and must stay the **first** import in `server.mjs`, because `db.mjs` reads `DB_PATH` at module-evaluation time. Pre-existing platform env vars win over `.env`.

`frontend/public/map.js` mirrors this on the client: Google Maps JS API when `GOOGLE_MAPS_BROWSER_KEY` is set, otherwise Leaflet + OpenStreetMap from a CDN. Both expose `create(container).render({markers, path, fit})`, so page code is provider-agnostic.

### Carbon and turtle model

Carbon is computed in `server.mjs`: `savedKg` is the reduction against a scooter baseline (`BASELINE_KG_PER_KM = 0.075`, duplicated as the `scooter` mode's `kg_co2_per_km` in the seed — change both together), and points are `savedKg * mode.points_per_kg_saved`.

`backend/src/turtle.mjs` owns progression: life = `min(100, floor(total_points / 5))`, staged 龜蛋 / 破殼 / 幼龜(20) / 青龜(50) / 成龜(80). Progress is **persisted per user** and only exists for logged-in users — trips save automatically on `/api/carbon/calculate`, route plans save only when the client passes `save: true`, and each 減塑 action can be checked in once per calendar day (`actionDoneToday`).

### Frontend

`frontend/public/app.js` is a hash-router SPA: a `ROUTES` map of route → template function, re-rendered into `#view`, with per-route `bind*()` functions attaching listeners after each render. All interpolated data goes through `esc()`. Coordinates in `seed.mjs` are approximate reference values, flagged as such in the UI footer and README.

## Open product questions

`README.md` lists what is still undecided (official CO2 coefficient source, who maintains shop data, Postgres migration, whether 減塑 check-ins need proof). Prefer asking over inventing answers to these.
