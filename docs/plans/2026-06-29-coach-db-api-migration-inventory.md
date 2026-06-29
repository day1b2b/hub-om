# Coach DB API Migration Inventory

Goal: retire standalone coach-db and absorb its useful behavior into hub-om.

Sources:
- `coach-db/docs/user-roles-and-features.md`
- `coach-db/docs/user-guide.md`
- `coach-db/docs/data-sync-rules.md`
- `coach-db/docs/engagement-sync-rules.md`
- `coach-db/docs/notion-sync-rules.md`
- `coach-db/src/app/api/**/route.ts`

## Migrated In Current Working Branch

- Coach self-service token auth
  - `GET /api/coach/me`
  - `GET /api/coach/schedule/[yearMonth]`
  - `PUT /api/coach/schedule/[yearMonth]`
  - `/coach?token=...` schedule input page
- Coach manager APIs
  - `GET /api/coaches`
  - `POST /api/coaches`
  - `GET /api/coaches/[id]`
  - `PUT /api/coaches/[id]`
  - `PATCH /api/coaches/[id]`
  - `DELETE /api/coaches/[id]`
  - `POST /api/coaches/[id]/regenerate-token`
  - `GET /api/coaches/[id]/schedules`
- Engagement APIs
  - `GET /api/coaches/[id]/engagements`
  - `POST /api/coaches/[id]/engagements`
  - `PUT /api/engagements/[id]`
  - `PATCH /api/engagements/[id]/review`
- Schedule status APIs
  - `GET /api/schedules/[yearMonth]/status`
- Master data APIs
  - `GET/POST /api/master/fields`
  - `GET/POST /api/master/curriculums`
- Admin/delete/export/backup APIs
  - `GET/PUT/DELETE /api/admin/deleted-coaches`
  - `POST /api/coaches/export`
  - `POST /api/admin/backup`
- Sync APIs
  - `GET/POST /api/admin/sync-notion`
  - `GET/POST /api/sync/engagements`
  - `GET/POST /api/sync/samsung-schedule`
  - `GET/POST /api/sync/all`
  - `coach_sync_logs`
  - Current implementation reads Google Sheets through the Sheets values API. It does not yet inspect `.xlsx` file formatting such as strikethrough-only cancellations.
- Service schema promoted from archive
  - coach `access_token`
  - coach operational fields: status note, return date, self note, portfolio URL, availability detail, manager note, DX tag, deleted by
  - coach schedule access logs

## Remaining Migration Groups

1. Coach admin/audit
   - audit log write/read
   - coach links list, PII-gated where needed

2. Coach documents
   - document metadata table
   - upload/download/delete
   - storage integration decision

3. Notifications and push
   - manager notifications
   - coach notifications
   - unread counts
   - read status
   - push subscriptions

4. Sync and source ingestion follow-ups
   - decide whether to support Drive-downloaded `.xlsx` files and cell-format parsing again
   - add operator UI for dry-run/apply once env is stable
   - add source-specific reconciliation reports

5. Admin and role features
   - manager role model mapping to hub-om auth model
   - content moderation
   - coach applications
   - admin backup

6. Samsung/DX/metrics
   - DX coach tags
   - DX assignment
   - Samsung DS parsing
   - metric snapshots and dashboards

## Rule

Do not create a PR per small route. Batch related API/schema/UI changes into larger migration PRs to avoid notification noise.
