# Final Presentation Outline (10 minutes)

| Time | Section | FS-04 (SaaS PM) | FS-03 (LMS) |
|------|---------|-----------------|-------------|
| 0:00-1:00 | Problem | Teams need isolated, billable workspaces for work tracking | Online schools need video, live classes, grading, certificates, payouts |
| 1:00-3:30 | Design | Shared schema + `workspaceId`, RBAC, workflow engine, BullMQ webhooks, Stripe plans | Roles, FFmpeg HLS pipeline via BullMQ, CloudFront, LiveKit, 80/20 revenue split |
| 3:30-6:00 | Demo | Kanban drag-and-drop, workflow rule rejection, plan limit, audit log | Upload, quiz auto-grade, live room + chat, certificate PDF, revenue chart |
| 6:00-7:30 | Challenges | Tenant isolation leaks, workflow validation on moves, webhook retries | Async transcoding, signed URLs, grading edge cases |
| 7:30-9:00 | Results | Test counts and coverage (see each project README) | Test counts and coverage (see each project README) |
| 9:00-10:00 | Next steps | SSO, email provider, row-level security in Postgres | Adaptive bitrate tuning, S3 uploads from browser, refunds/payouts |

Record the demo with the screen recorder of your choice and add the link to the README.
