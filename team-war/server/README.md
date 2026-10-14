# Human vs AI game server

A Cloudflare Worker with one Durable Object class (`GameRoom`). Each room (`/room/1` … `/room/20`) runs the game
on the server about 30 times a second, so the game keeps going when a player's tab is in the background, and players
connect to Cloudflare instead of to each other (nobody sees anyone's IP address).

- `worker.js` – the Worker and the `GameRoom` Durable Object
- `../engine.js` – the game rules, shared with the page (the page uses them for offline play and the PeerJS fallback)
- `test.mjs` – end-to-end test against a running server (`node test.mjs`, needs Node 22+)

The page (`../index.html`) connects to `SERVER_URL` first. If that is empty or does not answer within 5 seconds it
uses the old PeerJS room, and if that fails too, offline bots.

## Run it locally (no account needed)

```
cd team-war/server
npm install
npx wrangler dev --local
node test.mjs
```

To try the page against it, set `const SERVER_URL = 'ws://127.0.0.1:8787';` in `index.html` (remember to change it back).

## Deploy (free)

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up (the Workers Free plan is enough; no card needed).
2. In a terminal:
   ```
   cd team-war/server
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   The first deploy asks you to pick a `workers.dev` subdomain if you have none yet. At the end it prints an address
   like `https://human-vs-ai.YOUR-NAME.workers.dev`.
3. Check it: open that address in a browser. It should say "Human vs AI game server".
4. In `team-war/index.html`, find `const SERVER_URL = '';` and paste the address with `wss://` instead of `https://`:
   ```
   const SERVER_URL = 'wss://human-vs-ai.YOUR-NAME.workers.dev';
   ```
5. Commit and push the page as usual. `engine.js` must be published next to `index.html`.

## Free plan limits that matter

From developers.cloudflare.com (Durable Objects pricing and limits pages):

- 100,000 Durable Object requests a day. Incoming WebSocket messages count 20 to 1 request; messages the server sends
  are free. A player dragging to aim sends up to 20 messages a second, which is about 1 request a second.
- 13,000 GB-seconds of Durable Object time a day, billed at 128 MB per room while it is awake. A room with players in
  it is always awake, so that is roughly 28 room-hours a day. An empty room stops its loop and costs nothing.
- 100,000 Worker requests a day (each player joining a room is one).
- Free plan Durable Objects must use SQLite storage (`new_sqlite_classes` in `wrangler.toml`, already set).
- When a daily limit runs out, new requests fail until 00:00 UTC; the page then falls back to PeerJS / bots.

## Human vs AI 2.0 rooms (`/v2/room/1` … `/v2/room/20`)

The same Worker also runs the 2.0 hero arena: a second Durable Object class, `GameRoomV2` (`room-v2.js`), runs
`../v2/js/match.js` (the same rules file the page imports) about 30 times a second. Players send only inputs; the room
sends a snapshot about 15 times a second and the player list about once a second. 12 players per room (a 13th is told
"full" and the page tries the next room); bot heroes ("Bot · Nova" …) fill a side that has fewer players. A match ends
when a base falls or after 8 minutes, shows the scoreboard for 8 seconds, then a new match starts. An empty room
forgets its match and costs nothing. v1 rooms (`/room/N`) are unchanged.

### Deploy the 2.0 rooms (exact steps)

```
cd team-war/server
npm install
npx wrangler deploy
```

That is all: `wrangler.toml` already has the `GAME_ROOM_V2` binding and the new migration tag `v2`
(`new_sqlite_classes = ["GameRoomV2"]`). Keep the old `v1` migration exactly as it is. Redeploy whenever
`room-v2.js` or anything in `../v2/js/` that the server imports changes (`match.js`, `sim.js`, `bot.js`, `config.js`).

Check it: `node test-v2.mjs wss://human-vs-ai.tirupathi-podugu.workers.dev` (Node 22+). Checks that need the
local test switch are skipped against the live server.

The page (`../v2/index.html`) connects to `wss://human-vs-ai.tirupathi-podugu.workers.dev/v2/room/1` by default (see
`DEFAULT_SERVER` in `../v2/js/net.js`). If it does not answer within 5 seconds, the team buttons start the offline solo
run against bots. Add `?server=local` to the page address to use a local `wrangler dev` instead, or `?server=off` to
force offline.

### Test 2.0 locally

```
cd team-war/server
npx wrangler dev --local --var V2_TEST:1
node test-v2.mjs
```

`V2_TEST` turns on test-only messages (fast-forward the match clock, clear bots, set base HP) that `test-v2.mjs` uses.
It is never set on the deployed Worker, so the live server ignores those messages.
