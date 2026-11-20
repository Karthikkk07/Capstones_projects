# Individual Reflection

**Name:** Karthik Reddy

## What I owned
- **FS-04 (Multi-Tenant SaaS Project Management):** the whole stack. That covers the shared-schema tenant isolation (`workspaceId` on every tenant table, enforced through a scoped Prisma helper), role-based permissions, the Prisma data model and migration, and the REST API for projects, boards, issues, sprints, comments, attachments and the audit log. It also covers the configurable workflow engine, BullMQ background jobs for webhooks, notifications and sprint reports, Stripe test-mode billing with plan limits, the React Kanban board with drag-and-drop, the Docker setup and the CI pipeline.
- **FS-03 (LMS with Live Classes):** the student, instructor and admin roles and the course/lesson/enrollment schema. I also owned the FFmpeg-to-HLS pipeline in a BullMQ job, CloudFront signed delivery, quizzes with auto-grading and progress tracking, LiveKit live classes with chat, PDF certificates, the instructor revenue dashboard with Chart.js, test-mode payments and the React frontend.

## What I learned
- Shared-schema multi-tenancy is simple to build but easy to get wrong. A single query that forgets the tenant filter leaks data, so the filter belongs in one central helper, backed by tests that try to cross tenants.
- Workflow rules have to be enforced on the server for every status change, including drag-and-drop moves. The UI should only apply a move optimistically and revert it when the API rejects it.
- Background jobs need retries with backoff and signed payloads. Webhook delivery and video transcoding both fail in ways that HTTP handlers never see.
- Payment and media integrations should sit behind thin service modules. That let me unit-test grading, revenue splits, FFmpeg arguments and CloudFront URL signing without calling AWS or Stripe.
- A single CI workflow can test, build and ship several projects with a matrix. Building the images only after the tests pass keeps broken builds out of the registry.

## Hardest problem and how I solved it
Keeping tenant isolation and role permissions correct across many endpoints. I kept the permission table in one file and scoped every query by workspace. I then wrote API tests that act as a member of one workspace and try to read or change another workspace's data. A similar problem in FS-03 was access to paid video. I handled it by checking enrollment before issuing any signed playback URL.

## What I would do next
- FS-04: Postgres row-level security as a second layer of isolation, SSO, and real email delivery for notifications.
- FS-03: adaptive-bitrate tuning, direct-to-S3 browser uploads, and refunds and instructor payouts.
- Add end-to-end browser tests (Playwright) for both frontends, and record the demo videos.
