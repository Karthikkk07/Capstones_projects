# Full-Stack Capstones

Two full-stack projects, each in its own folder with its own README, tests, Docker setup and API/data docs.

| Folder | Project | Stack |
|--------|---------|-------|
| [FS-04](./FS-04) | Multi-Tenant SaaS Project Management Platform (Jira-like) | React, TypeScript, Node/Express, PostgreSQL, Prisma, BullMQ, Stripe (test), Vitest, Docker |
| [FS-03](./FS-03) | Learning Management System with Live Classes | React, TypeScript, Node/Express, PostgreSQL, Prisma, BullMQ + FFmpeg, CloudFront, LiveKit, Chart.js, Docker |

## Repository layout

```
FS-04/           backend/ frontend/ docs/ docker-compose.yml README.md
FS-03/           backend/ frontend/ docs/ docker-compose.yml README.md
docs/            PRESENTATION.md (10-minute outline), REFLECTION.md
.github/workflows/ci.yml   test -> build images -> deploy (Render hooks)
```

## CI/CD

[`ci.yml`](./.github/workflows/ci.yml) runs for every project/part: `npm ci`, Prisma generate/validate, `tsc --noEmit`, tests and frontend build. On `main` it builds Docker images, pushes them to GHCR and triggers Render deploy hooks (secret `RENDER_DEPLOY_HOOKS`, skipped when unset).

## Deliverables

- Working demo: add the recording/deployment link to each project README
- Architecture diagrams, API and data model docs: `FS-0x/README.md` and `FS-0x/docs/`
- Test results: table in each project README
- Presentation outline: [docs/PRESENTATION.md](./docs/PRESENTATION.md)
- Reflection: [docs/REFLECTION.md](./docs/REFLECTION.md)

## Note on the brief

The FS-04 milestones mention Django REST Framework and Celery, while the mandated stack is Node/Express. This repo follows the stack list: Express for the REST API and BullMQ in place of Celery.
