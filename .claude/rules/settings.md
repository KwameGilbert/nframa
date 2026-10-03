---
paths:
  - "src/**/setting*"
  - "tests/settings*"
---

# Settings

`/settings` is an admin-managed key/value store (`settings` table, guarded by the `settings` module's permissions). Each row has a dotted camelCase `key` (`fares.baseFare`), a `type` (`string`/`number`/`boolean`/`json`, where json means an object or array) and a jsonb `value` that every create and update is checked against the type. The key and type can't change after creation — delete and recreate instead. `updatedBy` records the admin who last wrote it.

`GET /settings/:key` returns the setting with a `history` array — its recent changes, newest first, each with the action, who made it, the setting before and after, and `changedFields`. There is no `settingHistory` table: history is read straight from `activityLogs` (`targetType: "setting"`, `targetId`: the key, successful entries only) via `activityLogModel.historyFor()`, since `logActivity` already records exactly that for every settings write. So history starts where activity logging did, and a setting changed by anything other than these routes has none. `historyLimit` (1-100, default 20) caps it; the list endpoint `GET /settings` has no history, to keep it to one query. Entries carry a trimmed actor (`id`, `fullName`, `role`) — `settings: read` is enough to see the history, and it shouldn't also hand out an admin's email and phone number, which stay behind `activityLogs: read`.
