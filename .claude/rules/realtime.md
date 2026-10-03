---
paths:
  - "src/services/socket*"
  - "src/middlewares/socketAuthenticate.ts"
  - "src/index.ts"
  - "SOCKET_KEYS.md"
---

# Real-time (Socket.IO)

Wired up in `src/index.ts` alongside the HTTP server (see "Request pipeline" in CLAUDE.md). `src/middlewares/socketAuthenticate.ts` runs as `io.use(...)` before any connection is accepted — it reads the access token from `socket.handshake.auth.token` (not a header, not a query string) and verifies it with the same `verifyAccessToken` REST's `authenticate.ts` uses, rejecting with `next(new Error(...))` on a missing/invalid/expired token (Socket.IO's rejection path has no HTTP response to attach `AppError`'s status code to, so a plain `Error` is correct here, not a mismatch). Every authenticated connection auto-joins a room named `user:{userId}` — one per account, keyed on the same id space (`users.id` / the JWT's `sub`) shared by riders, drivers, and admins, not a role-specific room, so nothing needs renaming if a rider or admin app later needs the same events.

`src/services/socket.service.ts` is the only place anything should reach the `io` instance — controllers never import `socket.io` directly, the same way they never call Cloudinary or the DB directly. `initSocketService(io)` is called once from `index.ts`; `emitToUser(userId, event, payload)` is what controllers call afterward (fire-and-forget, same convention as `logActivity` — call it after `sendSuccess`, never let a broadcast failure affect the response). It's a safe no-op wherever `io` was never initialized, which is always true in tests (`src/index.ts` never runs — tests only ever import `app.ts`), so `tests/setup.ts` mocks the whole module the same way it mocks SMS/email/storage, and assertions check `emitToUser` was called with the right args rather than exercising a real socket.

Events are emitted from controllers with `emitToUser` / `emitToSafetyDesk` / `emitToReportsDesk` (grep for them). Staff desks are rooms an admin joins at connect time by permission: `admin:safety` for `sos: read`, `admin:reports` for `reports: read` (`joinSocketRooms`). What each event carries, for API consumers, is in `SOCKET_KEYS.md` and the mobile guide's "Real-Time Events" section: keep both in step when you add one.

No CORS config exists for the socket server (`new Server(httpServer)`, no options) — fine for the React Native driver app (CORS is browser-enforced, RN doesn't apply it), but the moment a browser-based client needs to connect, `{ cors: { origin: [...] } }` will need adding to that `new Server(...)` call — `app.use(cors())` in `app.ts` does not cover it, since Socket.IO's engine handles its own request listener separately from Express's middleware chain.
