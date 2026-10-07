---
paths:
  - "src/**/broadcast*"
  - "src/utils/sms.ts"
  - "tests/broadcasts*"
---

# Broadcasts (Broadcast Studio)

Staff announcements to riders, drivers or everyone, over any of `inApp`, `push`, `sms` and `email`. Operational notices only (diversions, outages, policy changes): there is deliberately **no opt-out** yet; marketing-style broadcasts wait for notification preferences.

- **Permission module `broadcasts`**: `read` (history, detail, audience preview), `create` (draft), `update` (edit, schedule, cancel), `delete` (remove a draft). The router is registered **before `adminUserRouter`**, whose `/admin/:userId` would swallow `/admin/broadcasts`; inside it, `/admin/broadcasts/audience-preview` is registered before `/admin/broadcasts/:id`.
- **Status machine**: `POST /admin/broadcasts` always makes a `draft`. `draft`/`scheduled` (`EDITABLE_STATUSES`) can be edited and (re)scheduled; `scheduled` can be cancelled (→ `cancelled`); only a `draft` can be deleted. `sending`/`sent`/`failed` belong to the delivery worker; `sending`, `sent`, `cancelled` and `failed` are final. Every change goes through `broadcastModel.updateWhile(id, statuses, ...)`, a conditional update, so a screen that's a moment stale can't edit or cancel what the worker has just started sending: zero rows → 409 naming the status it's in now. A scheduled time must be 1 minute to 90 days ahead, with a timezone.
- **Audience**: `audienceUsers(audience)` (active, non-deleted riders and/or drivers, never staff) is the one definition. The preview counts with it and delivery must send with it, so they agree. Push reach counts people with a device seen within `push.deviceStaleDays`.
- **SMS cost cap**: the SMS text is `smsText ?? "title: body"` (`smsTextOf`), and with `sms` as a channel it must fit `SMS_MAX_SEGMENTS` (3) by `smsSegments` (`src/utils/sms.ts`: GSM-7 is 160/153 per part, with ^{}\[~]|€ counting double; anything else is UCS-2 at 70/67 by UTF-16 units). It's checked on create and on every edit against what the broadcast becomes; responses carry `smsSegments`.
- **SMS balance**: `GET /admin/broadcasts/sms-balance` asks Arkesel (`getSmsBalance` in `sms.service.ts`) each call; 503 without `ARKESEL_API_KEY`, 502 when Arkesel fails. Sign-in codes share these units. Tests mock it in `tests/setup.ts` (4820 units).
- **Audit**: create, update, schedule, cancel and delete are logged under the `broadcasts` activity module with before/after views. Reads aren't logged (no personal data).
