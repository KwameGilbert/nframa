---
paths:
  - "src/**/support*"
  - "src/config/supportAttachments.ts"
  - "tests/support*"
  - "tests/pushSupport*"
  - "tests/helpers/support.ts"
---

# Support tickets & chat

A rider or driver opens a ticket (category, subject, first message or files, optionally linking their own trip, transaction, payout or earlier ticket) and chats with staff, who triage it in a searchable queue, assign it, keep internal notes and resolve it; the raiser can rate the help.

## Permissions and ownership

- **Module `support`**: `read` = queue, search, detail (with phones), history, assignees, categories list, the `admin:support` socket room, marking read; `update` = replies, notes, assign / take over / unassign, PATCH, deleting own staff messages, PATCH categories; `create` = open on a user's behalf, create categories; `delete` = remove any message (moderation), delete unused categories.
- Raisers need no permission; **ownership is the filter** (`userId = caller AND detachedAt IS NULL`), so anyone else gets 404. Admins calling the raiser routes get 403 ("Only riders and drivers can use support tickets").
- An assignee must be an active admin with `support: update` (`rolePermissionModel.adminUserIdsWithPermission`), else 400.
- `supportRouter` is mounted **before `adminUserRouter`** (whose `/admin/:userId` would swallow `/admin/support`). Staff routes have no limiter; raiser routes do (`supportTicketLimit` 10, `supportMessageLimit` 120, `supportBrowseLimit` 300, per account, before `uploadAttachments`).

## Status machine (`supportTicket.model.ts`)

`open | inProgress | awaitingUser | resolved | closed` (closed is final). Priorities `low | normal | high | urgent`, staff-only; a new ticket takes its category's `defaultPriority` (a raiser's body `priority` is ignored).

- Staff public reply: `open/inProgress/awaitingUser → awaitingUser`; an unassigned ticket becomes the replier's (internal `assigned` event); `firstResponseAt ??= now`.
- User reply: `awaitingUser → inProgress` (assigned) or `open`; on `resolved` (still inside the window) it **reopens**, clearing `resolvedAt` and the rating, with a public `statusChanged {reason: userReplied}`.
- Notes never change status or `lastMessageAt`/`lastMessageSide` (they'd reset the idle clock); allowed on closed tickets. Public messages on closed → 409.
- Assign: `open → inProgress`; unassign: `inProgress → open`; same assignee / already unassigned is a 200 no-op with no event. Closed → 409.
- Staff PATCH: status from closed → 409 (details can still be corrected); `→ resolved` sets `resolvedAt`; resolved back to an active status clears it and the rating; `→ closed` sets `closedAt`. Status change = public event, details = one internal `detailsChanged`.
- Raiser `POST /resolve` (active only) and `POST /rate` (resolved/closed, once per resolution).
- **Lazy sweeps, no cron** (`sweep(scope)`, before every raiser/staff read and inside every post): `awaitingUser` idle ≥ `support.autoResolveDays` → resolved; `resolved` older than `support.reopenWindowDays` → closed. One `WITH … UPDATE … RETURNING` + `INSERT` per rule, `now() - (? * interval '1 day')`. No push for sweep transitions.

## ACID

- Every write is one transaction that **locks the ticket row** (`FOR UPDATE`) first: create (ticket + `opened` event + first message, the whole transaction retried on a code collision), post, assign, unassign, PATCH, resolve, rate. A refusal found under the lock is **returned** (`{ ok: false, reason }`), not thrown, so the sweep's close still commits; the service throws after.
- **`seq`** (`GENERATED ALWAYS AS IDENTITY`) orders the timeline, cursors, read markers and unread counts: inserts hold the ticket lock, so seq follows commit order; events are inserted before the message they cause. `createdAt` is display only.
- Message delete locks the message (`FOR NO KEY UPDATE`), keeps body and files (staff evidence), sets `deletedAt/ByUserId/BySide`. Own message within `MESSAGE_DELETE_WINDOW_MINUTES` (15); `support: delete` can remove anything any time.
- Read markers (`userLastReadSeq`, `staffLastReadSeq`) move with `greatest(...)`, never backwards, and don't touch `updatedAt`. A sender's own marker moves to their message.
- Category delete: the FK `RESTRICT` is the judge; the count only words the 409.
- Files upload **before** the transaction (`storeAttachments`) and are deleted (`allSettled`) if it throws or refuses. Post-commit only: socket emits and pushes.

## Visibility (`supportViews.ts`)

- User ticket view never has priority, assignee, `createdByAdminId`, `detachedAt`. User message view: agents by **first name**, events with `from/to/reason/rating` only, a deleted message as `{ deleted: true, removedBy }` with no body or files, never notes or internal events.
- Staff see everything (deleted originals flagged, `internal`), except `storageKey`/`resourceType`, which no view ever shows.
- **Recycled phone numbers**: `userModel.reactivate` calls `detachForUser` in its transaction (closes and sets `detachedAt`); raiser queries filter it out, staff still see it, nothing is sent to the new owner.

## Search (`supportSearch.ts`, pure)

`searchTerms(q)` → code (`ST-XXXXXX`, `xxxxxx`, `st xxxxxx`), phone (drop `+233`/`0`), escaped LIKE, and a tsquery: websearch syntax when quotes/OR/`-word` are used (then **only** full-text applies, so fuzzy can't resurrect an excluded ticket), otherwise prefix tokens matched both `english` (stemmed) and `simple` (as typed: the stemmer turns a prefix ending in y into i). `searchClauses` gives each match its relevance weight (code 100, subject FTS 40, substring/fuzzy/person 10, message 5) and both the WHERE and the score come from it. Messages match through an uncorrelated `t.id IN (SELECT ...)` on the GIN index; raisers only match public, undeleted messages; fuzzy (`word_similarity ≥ 0.5`) from 4 characters. `matchedMessages` adds a plain `ts_headline` snippet + seq per result.

## Media (`config/supportAttachments.ts`)

Images 10 MB (HEIC stored as JPEG), video 50 MB, audio 16 MB, documents 10 MB, up to 5 per message under `attachments`. `uploadAttachments` uses `multer.diskStorage` (temp files removed on `res` close), checks per-kind caps after parsing; JSON passes through. Cloudinary type is explicit (`image`/`video`/`raw`, audio is `video`), and deletes pass the stored `resourceType`. Folder `support/<ticketId>`.

## Realtime and pushes

- Room `admin:support` (joined with `support: read`). Server → client: `support:ticketCreated`, `support:ticketUpdated`, `support:message`, `support:messageDeleted`, `support:read`, `support:typing`; the raiser gets user views and public events only.
- **Client → server** (`supportSocket.service.ts`): `support:send` (text or a staff note), `support:read` (both with acks `{ ok, data } | { ok: false, error, status }`), `support:typing` (no ack, throttled 1 per ticket per 3 s per socket, "stopped" only after a relayed "typing"). Permissions and ownership are re-checked per event; per-account limits (send 120, read 300 per 15 min). Handlers never reject (an unhandled rejection exits the process). Files and deletes stay HTTP (deletes are audited).
- Pushes (`notifySupport`, `notifySupportDesk`): `support.reply` / `support.userReplied` only for the **first unread message of a run** (decided under the lock), `support.statusChanged` on staff resolve/close and `support.openedForYou` (both inbox), `support.assigned` when someone else assigns you, `support.deskAlert` for new high/urgent tickets. Only the ticket id travels.

## Audit and logs

Audited: ticket create / create on behalf / PATCH / assign / unassign / resolve / rate / staff detail view (`support.ticket.view`), message delete / removal, category CRUD, with `redact: ["subject", "message", "body", "comment"]` and `ticketAuditView` (ids, code, status, priority). Not audited: posts (the messages table is the record), lists, reads, typing. `httpLogger` blanks those keys in support request bodies and replaces `data` with `[REDACTED]` in support responses.

## Tests

Seed tickets and messages straight to the DB (`tests/helpers/support.ts`: `seedCategory`, `seedTicket`, `seedMessage`, `uniqueWord`); every create through the API counts against the raiser's limit of 10. Scope searches with `userId` and a `uniqueWord()`. `supportRealtime.test.ts` drives the socket handlers through a fake socket.
