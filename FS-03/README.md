# FS-03 · Learning Management System with Live Classes

A full-stack LMS: instructors author courses and upload videos that are transcoded to adaptive HLS; students enroll (free or via Stripe test checkout), watch with resume-where-you-left-off, take auto-graded quizzes, earn verifiable PDF certificates, and join live classes (LiveKit video + socket.io chat). Instructors see revenue in Chart.js dashboards.

**Stack:** React 18 + TypeScript + Vite · Express + Prisma + PostgreSQL · Redis + BullMQ + FFmpeg (HLS) · S3 + CloudFront signed delivery · LiveKit · socket.io · PDFKit · Stripe (test mode) · Chart.js · Vitest.

## Roles

| Role | Can do |
|---|---|
| **Student** | Browse catalog, enroll/pay, watch lessons (signed playback), track progress, take quizzes, download certificates, join live classes and chat |
| **Instructor** | Create/edit/publish own courses, sections and lessons, upload video, build quizzes, schedule/start/end live classes (publishes A/V), view revenue and payouts |
| **Admin** | Everything an instructor can do on any course, moderate (publish/unpublish) all courses, settle instructor payouts |

## Architecture

```mermaid
flowchart LR
  B[Browser<br/>React + Vite SPA] -->|REST /api| API[Express API]
  B -->|socket.io /chat| API
  B -->|WebRTC| LK[LiveKit server]
  B -->|HLS + signed cookies/URLs| CF[CloudFront]
  B -->|/media fallback| API
  API --> PG[(PostgreSQL<br/>Prisma)]
  API -->|enqueue transcode| R[(Redis)]
  R --> W[BullMQ worker<br/>FFmpeg → HLS 360p/720p]
  W --> PG
  W -->|upload HLS| S3[(S3 bucket)]
  W -->|local fallback| FS[(media volume)]
  S3 --- CF
  API -->|mint JWT| LK
  API <-->|Checkout + webhook| ST[Stripe test mode]
```

Video flow: upload → `uploads/` → BullMQ job → FFmpeg multi-rendition HLS (6 s segments) → S3 (or local `media/`) → `GET /lessons/:id/playback` returns a CloudFront signed URL/cookies (or a local URL when AWS is not configured) only to enrolled users.

## Features by milestone

| # | Milestone | Delivered |
|---|---|---|
| 1 | Auth, roles & catalog | JWT auth, bcrypt, RBAC middleware (student/instructor/admin), searchable/filterable/paginated catalog, login/register/catalog/course detail pages |
| 2 | Course authoring & video pipeline | Course → sections → lessons CRUD, publish/unpublish, multer upload, BullMQ + FFmpeg HLS transcode with status polling, `VideoUploader` + `CourseEditorPage` |
| 3 | Secure delivery | S3 upload, CloudFront signed cookies/URLs with TTL, enrollment-gated playback, local fallback, `hls.js` player |
| 4 | Progress & quizzes | Per-lesson progress with resume position, course completion %, quiz builder (single/multiple/true-false), auto-grading, pass mark & attempt limits |
| 5 | Certificates | Auto-issued on completion + required quizzes passed, PDFKit PDF, public verification page `/verify/:code` |
| 6 | Live classes | Scheduling, start/end, LiveKit tokens (host publishes, viewers subscribe), `livekit-client` room UI, authenticated socket.io chat with persistence |
| 7 | Payments & revenue | Stripe Checkout (test), signed idempotent webhook → enrollment, instructor/platform split, payouts ledger, Chart.js monthly + per-course revenue page, admin moderation |

## Frontend routes

`/` catalog · `/courses/:slug` detail/enroll/pay · `/login` `/register` · `/dashboard` (my learning, live classes, certificates) · `/learn/:courseId[/:lessonId]` player · `/quiz/:id` · `/live/:id` live room + chat · `/verify/:code` (public) · `/instructor` · `/instructor/courses/:id` editor (lessons, uploads, quizzes, live scheduling) · `/instructor/revenue` · `/admin`.

## Setup

### Docker Compose (recommended)

```bash
cd FS-03
docker compose up --build
# optional: seed demo data
docker compose exec backend npx tsx prisma/seed.ts
```

| Service | URL |
|---|---|
| Web app (nginx, proxies `/api`, `/media`, `/socket.io`) | http://localhost:8080 |
| API | http://localhost:4000 (`/health`) |
| LiveKit (dev mode) | ws://localhost:7880 |
| PostgreSQL / Redis | 5432 / 6379 |

Compose runs `prisma migrate deploy` before the API starts, and a separate `worker` container (same image, includes FFmpeg) processes video jobs. Pass optional secrets via your shell or a root `.env` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `S3_BUCKET`, `CLOUDFRONT_*`, `AWS_*`, `JWT_SECRET`).

### Local development

Prerequisites: Node 20+, PostgreSQL 16, Redis 7, FFmpeg on `PATH`, a LiveKit server (`livekit-server --dev`, or `docker compose up livekit`).

```bash
# backend
cd backend
cp .env.example .env            # adjust DATABASE_URL etc.
npm install
npx prisma migrate deploy
npm run seed                    # optional demo data
npm run dev                     # API on :4000
npm run dev:worker              # transcoder (second terminal)

# frontend
cd ../frontend
npm install
npm run dev                     # http://localhost:5173 (proxies /api, /media, /socket.io to :4000)
```

### Environment variables (`backend/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://lms:lms@localhost:5432/lms` | Postgres |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | dev secret, `7d` | Auth tokens — **change in production** |
| `CORS_ORIGIN`, `FRONTEND_URL` | `http://localhost:5173` | CORS and Stripe redirect URLs |
| `UPLOAD_DIR`, `MEDIA_DIR`, `MAX_UPLOAD_MB` | `uploads`, `media`, `500` | Video storage |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | Transcoder binaries |
| `PUBLIC_API_URL` | empty | Base URL for local playback links |
| `S3_BUCKET`, `S3_REGION` | –, `us-east-1` | HLS output bucket (enables S3 upload) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | – | AWS credentials for S3 (standard SDK chain) |
| `KEEP_LOCAL_AFTER_S3` | `false` | Keep local HLS after S3 upload |
| `CLOUDFRONT_DOMAIN` | – | Distribution domain (enables signed delivery) |
| `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY` | – | Trusted key group ID and PEM key (`\n` allowed) |
| `CLOUDFRONT_SIGN_MODE`, `CLOUDFRONT_COOKIE_DOMAIN`, `CLOUDFRONT_URL_TTL_SECONDS` | `cookies`, –, `3600` | Signed cookies vs. URL mode and TTL |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` | `devkey`, `secretsecret…`, `ws://localhost:7880` | LiveKit (matches `--dev`; URL must be browser-reachable) |
| `STRIPE_SECRET_KEY` | – | `sk_test_…`; checkout returns 503 when unset |
| `STRIPE_WEBHOOK_SECRET` | – | `whsec_…` from `stripe listen --forward-to localhost:4000/payments/webhook` |
| `INSTRUCTOR_SHARE_PCT` | `80` | Instructor share of each sale |

Without S3/CloudFront the app serves HLS locally from `/media`; without Stripe, only free courses can be enrolled.

Stripe test card: `4242 4242 4242 4242`, any future date/CVC.

### Seed users (`npm run seed`)

| Email | Password | Role |
|---|---|---|
| `admin@lms.test` | `Admin123!` | Admin |
| `instructor1@lms.test` … `instructor3@lms.test` | `Password123!` | Instructor |
| `student1@lms.test` … `student12@lms.test` | `Password123!` | Student |

The seed creates 8 courses with sections, lessons, quizzes, enrollments, certificates, sample payments and a live class. Drop a transcoded HLS folder at `media/hls/demo` to make seeded videos playable locally.

## Testing

```bash
cd backend  && npx prisma generate && npx tsc --noEmit && npm test
cd frontend && npx tsc --noEmit && npm test && npm run build
```

| Suite | Command | Result |
|---|---|---|
| Backend type-check | `npx tsc --noEmit` | ✅ 0 errors |
| Backend unit/integration tests | `npm test` | ✅ **83 / 83 passed** (11 files: RBAC 11, payments 10, live 10, grading 9, certificates 8, ffmpeg 8, progress 8, cloudfront 4, playback 6, revenue 6, quiz schema 3) |
| Frontend type-check | `npx tsc --noEmit` | ✅ 0 errors |
| Frontend tests | `npm test` | ✅ **14 / 14 passed** (3 files: API client, lib helpers/quiz drafts/chart data, ProgressBar) |
| Frontend production build | `npm run build` | ✅ 94 modules, JS 1.63 MB (488 kB gzip), CSS 6 kB |

Backend tests run against injected fakes (no live Postgres/Redis/AWS/Stripe/LiveKit required).

### Live end-to-end run (real services)

Besides the unit tests, the API was exercised against a real PostgreSQL, Redis, the BullMQ worker and a real FFmpeg, with seed data: **38 / 38 checks passed**. They covered:

- role checks: student, anonymous and instructor blocked from restricted routes (403/401)
- course, section and lesson authoring
- video upload → BullMQ → FFmpeg → multi-rendition HLS (360p/720p); manifest served over HTTP
- enrollment-gated playback
- quiz auto-grading (single, multiple and true/false), with correct answers hidden from students
- progress to 100% → certificate issued → valid PDF → public verification
- live class scheduling, LiveKit host/viewer tokens (viewer cannot publish), non-enrolled student denied
- socket.io chat (broadcast and persistence)
- checkout returns 503 without Stripe keys; revenue summary and role guard

The UI was checked in a browser (login, catalog, dashboard, course editor, revenue charts with Chart.js). The test video could not be played because the browser used here has no H.264 decoder, so the HLS manifest and segments were verified over HTTP instead; check playback in Chrome or Edge. Real LiveKit media and Stripe/CloudFront require your own credentials.

Note: `ioredis` is an explicit dependency, because BullMQ 6 does not bundle it. Use Redis 6.2+ in production (the compose file does).

## Further docs

- [API reference](docs/API.md)
- [Data model (ER diagram)](docs/DATA_MODEL.md)
