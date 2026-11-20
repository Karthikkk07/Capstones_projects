# API Reference

Base URL: `http://localhost:4000/api` (also proxied by the frontend nginx at `/api`).
All JSON. Everything except the *Public* rows requires `Authorization: Bearer <jwt>`. The tenant (workspace) is taken from the token — never from the request.

Error shape: `{ "error": { "code": "…", "message": "…", "details"?: … } }`. Common codes: `400 BAD_REQUEST/VALIDATION`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT` (and specific codes below), `402 PLAN_LIMIT_EXCEEDED`, `413/415` uploads, `429 RATE_LIMITED` (login/register: 30 per 15 min).

Permissions → roles are listed in the [README](../README.md#roles--permissions).

## Health & auth

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/health` (also `/api/health`) | Public | Liveness probe |
| POST | `/auth/register` | Public | Body `{email, password(8+), name, workspaceName}`. Creates user, workspace (OWNER, FREE plan); returns `{token, user, workspace, role}` (201) |
| POST | `/auth/login` | Public | Body `{email, password, workspaceId?}`; defaults to the oldest membership |
| GET | `/auth/me` | any authenticated | User, current workspace, role, permissions, plan, all workspaces |
| POST | `/auth/switch-workspace` | any authenticated | Body `{workspaceId}` → new token for that workspace |

## Workspace & members

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/workspace` | workspace:read | Current workspace, role, plan |
| GET | `/workspace/members` | workspace:read | List members with roles |
| POST | `/workspace/members` | member:manage | Body `{email, role?: ADMIN\|MEMBER\|VIEWER, name?}`. Creates account with `temporaryPassword` if the email is unknown. Plan member limit enforced (402). 409 `ALREADY_MEMBER` |
| PATCH | `/workspace/members/:userId` | member:manage | Body `{role}`. Owner is immutable; only OWNER can grant/modify ADMIN |
| DELETE | `/workspace/members/:userId` | member:manage | 204. Cannot remove yourself or the owner |

## Projects

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/projects` | project:read | List projects |
| POST | `/projects` | project:write | Body `{key (2-10 A-Z0-9), name, description?}`; creates default board. 402 on plan limit, 409 `PROJECT_KEY_TAKEN` |
| GET | `/projects/:id` | project:read | Project detail |
| PATCH | `/projects/:id` | project:write | `{name?, description?}` |
| DELETE | `/projects/:id` | project:write | 204 (cascades) |

## Boards, columns & workflow

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/projects/:projectId/boards` | project:read | Boards of a project |
| GET | `/boards/:id` | project:read | Board with ordered columns |
| POST | `/boards/:id/columns` | board:write | `{name, category?: TODO\|IN_PROGRESS\|DONE}` (201) |
| PUT | `/boards/:id/columns/order` | board:write | `{columnIds: []}` — must list every column once |
| PATCH | `/boards/:id/columns/:columnId` | board:write | `{name?, category?}` |
| DELETE | `/boards/:id/columns/:columnId` | board:write | 204; 409 `COLUMN_NOT_EMPTY` |
| GET | `/boards/:id/transitions` | project:read | `{items, restricted}` |
| PUT | `/boards/:id/transitions` | board:write | `{transitions: [{fromColumnId, toColumnId}]}` replaces the set; empty = any move allowed |

## Issues

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/issues` | issue:read | Query: `projectId, boardId, statusId, assigneeId (id\|me\|none), sprintId (id\|none), type, priority, q, limit(≤500, 200), offset` → `{items, total}` |
| POST | `/issues` | issue:write | `{projectId, title, boardId?, statusId?, description?, type?, priority?, assigneeId?, sprintId?, storyPoints?}` (201); key `PROJ-n` auto-assigned |
| GET | `/issues/:id` | issue:read | `:id` may be the id or the key (e.g. `WEB-3`) |
| PATCH | `/issues/:id` | issue:write | `{title?, description?, type?, priority?, assigneeId?, storyPoints?}` |
| DELETE | `/issues/:id` | issue:delete | 204 |
| POST | `/issues/:id/move` | issue:write | `{toColumnId, position?}`; 409 `WORKFLOW_TRANSITION_NOT_ALLOWED` |
| PUT | `/issues/:id/sprint` | issue:write | `{sprintId: string\|null}` (null → backlog) |
| GET | `/issues/:id/activity` | issue:read | Audit trail of the issue |
| GET | `/issues/:id/comments` | issue:read | List comments |
| POST | `/issues/:id/comments` | comment:write | `{body}` (201); notifies assignee/reporter |
| DELETE | `/comments/:id` | comment:write | 204; author or `issue:delete` holders only |
| GET | `/issues/:id/attachments` | issue:read | List attachments |
| POST | `/issues/:id/attachments` | attachment:write | `multipart/form-data`, field `file` (≤ `MAX_UPLOAD_MB`; png, jpeg, gif, webp, pdf, txt, csv, json, zip) (201) |
| GET | `/attachments/:id/download` | issue:read | File download |
| DELETE | `/attachments/:id` | attachment:write | 204 |

## Sprints & reports

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/projects/:projectId/sprints` | sprint:read | Sprints with issue counts |
| POST | `/projects/:projectId/sprints` | sprint:write | `{name, goal?, startDate?, endDate?}` (201) |
| PATCH | `/sprints/:id` | sprint:write | Edit; 409 `SPRINT_COMPLETED` if completed |
| POST | `/sprints/:id/start` | sprint:write | PLANNED → ACTIVE; 409 `SPRINT_ALREADY_ACTIVE` / `INVALID_SPRINT_STATE` |
| POST | `/sprints/:id/complete` | sprint:write | `{moveIncompleteTo?: plannedSprintId}` → `{sprint, movedIssues, report}`; queues a report job |
| GET | `/reports/sprints/:id` | report:read | Totals, completion %, by-status counts, burndown |
| POST | `/reports/sprints/:id/send` | sprint:write | 202 — queue report notification to owners/admins |

## Audit log

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/audit-logs` | audit:read | Query: `entity, action (prefix), limit(≤200, 50), offset` → `{items, total}` |

## Webhooks

Deliveries are `POST`ed by the worker with headers `X-Signature: sha256=<hmac of body>`, `X-Webhook-Event`, `X-Webhook-Delivery`; body `{id, event, workspaceId, createdAt, data}`. Non-2xx → retried up to 6 attempts with exponential backoff (2s base).

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/webhooks/events` | webhook:manage | Supported events: `issue.created`, `issue.updated`, `issue.moved`, `issue.deleted`, `comment.created`, `sprint.started`, `sprint.completed` |
| GET | `/webhooks` | webhook:manage | List (secret masked) |
| POST | `/webhooks` | webhook:manage | `{url, events[], active?, secret?}`; full secret returned only here (201) |
| PATCH | `/webhooks/:id` | webhook:manage | `{url?, events?, active?}` |
| DELETE | `/webhooks/:id` | webhook:manage | 204 |

## Billing (Stripe test mode)

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/billing` | billing:read | Plan, status, limits, usage, plan catalogue, `stripeConfigured` |
| POST | `/billing/checkout` | billing:manage | `{plan: PRO\|BUSINESS}` → `{id, url}` Stripe Checkout session; 503 `BILLING_NOT_CONFIGURED` without a price id |
| POST | `/billing/portal` | billing:manage | → `{url}` Customer Portal; 400 if no billing account |
| POST | `/billing/webhook` | Public (Stripe signature) | Raw body; handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` |
