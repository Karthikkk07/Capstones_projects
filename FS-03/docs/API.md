# API Reference

Base URL: `http://localhost:4000` (the frontend proxies it as `/api/*`, stripping the `/api` prefix). JSON in/out. Authenticated endpoints need `Authorization: Bearer <jwt>` (from `/auth/login` or `/auth/register`). Errors are returned as `{ "error": "message" }` with an appropriate status (400 validation, 401 unauthenticated, 403 forbidden, 404, 409, 429 rate limited, 503 not configured).

Legend: 🔓 public, 🔑 any logged-in user, 🎓 INSTRUCTOR/ADMIN (instructors only act on their own courses), 🛡 ADMIN.

## Health and media
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | 🔓 | Liveness probe |
| GET | `/media/*` | 🔓 | Locally transcoded HLS (used when S3/CloudFront is not configured) |

## Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | 🔓 | `{ email, password, name, role: STUDENT\|INSTRUCTOR }` → `{ token, user }` |
| POST | `/auth/login` | 🔓 | `{ email, password }` → `{ token, user }` |
| GET | `/auth/me` | 🔑 | Current user |

## Catalog, courses, structure
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/courses` | 🔓 | Published catalog. Query: `q`, `category`, `page`, `pageSize`, `sort`, `free` → paged list |
| GET | `/courses/categories` | 🔓 | Categories with counts |
| GET | `/courses/:idOrSlug` | 🔓 (optional token) | Course detail with sections, lessons, quizzes, `enrolled`, `canManage` |
| GET | `/instructor/courses` | 🎓 | Own courses (all statuses) |
| GET | `/admin/courses` | 🛡 | All courses for moderation |
| POST | `/courses` | 🎓 | Create draft `{ title, description, priceCents, category }` |
| PATCH | `/courses/:id` | 🎓 | Update course |
| DELETE | `/courses/:id` | 🎓 | Delete course |
| POST | `/courses/:id/publish` · `/unpublish` | 🎓 | Change status |
| POST | `/courses/:id/sections` | 🎓 | Add section `{ title }` |
| PATCH / DELETE | `/sections/:id` | 🎓 | Rename / delete section |
| POST | `/courses/:id/enroll` | 🔑 | Enroll in a free course (paid courses need checkout) |
| GET | `/courses/:id/progress` | 🔑 | `{ totalLessons, completedLessons, percent, resumeLessonId }` |
| GET | `/me/enrollments` | 🔑 | Enrolled courses with progress |

## Lessons and video
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/sections/:id/lessons` | 🎓 | `{ title, type: VIDEO\|TEXT, content? }` |
| PATCH / DELETE | `/lessons/:id` | 🎓 | Update / delete lesson |
| GET | `/lessons/:id` | 🔑 | Lesson (enrolled students, owner, admin) incl. own progress |
| POST | `/lessons/:id/video` | 🎓 | Multipart field `video`; stores the file and enqueues the BullMQ FFmpeg HLS job |
| GET | `/lessons/:id/video-status` | 🎓 | `{ lessonId, videoStatus: PENDING\|PROCESSING\|READY\|FAILED, hlsPath, durationSec }` |
| GET | `/lessons/:id/playback` | 🔑 | `{ url, strategy, expiresAt? }` — CloudFront signed URL/cookies, or local `/media` URL fallback; requires enrollment |
| POST | `/lessons/:id/progress` | 🔑 | `{ positionSec?, completed? }` → `{ course, certificate }` (certificate issued when everything required is done) |

## Quizzes
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/courses/:id/quizzes` | 🎓 | Create quiz `{ title, passMarkPct, maxAttempts, required, lessonId?, questions[] }` |
| GET | `/courses/:id/quizzes` | 🔑 | List with attempts used / remaining, best score, passed |
| GET | `/quizzes/:id` | 🔑 | Quiz; correct answers only visible to managers |
| PUT / DELETE | `/quizzes/:id` | 🎓 | Replace / delete |
| POST | `/quizzes/:id/attempts` | 🔑 | `{ answers: { [questionId]: string[] } }` → auto-graded result (+ certificate when eligible) |
| GET | `/quizzes/:id/attempts` | 🔑 | Own attempt history |

## Certificates
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/certificates` | 🔑 | My certificates |
| GET | `/certificates/verify/:code` | 🔓 | Public verification `{ valid, studentName, courseTitle, issuedAt }` |
| GET | `/certificates/:id/pdf` | 🔑 | PDF download (owner/admin) |
| POST | `/courses/:id/certificate` | 🔑 | Issue certificate if the student is eligible |

## Live classes
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/courses/:id/live-classes` | 🎓 | Schedule `{ title, scheduledAt }` |
| GET | `/courses/:id/live-classes` | 🔑 | Classes of a course (enrolled / owner) |
| GET | `/me/live-classes` | 🔑 | Upcoming classes for me |
| GET | `/live-classes/:id` | 🔑 | Detail incl. `isHost` |
| POST | `/live-classes/:id/start` · `/end` | 🎓 | Go live / finish |
| GET | `/live-classes/:id/token` | 🔑 | LiveKit JWT `{ token, url, roomName, role: host\|viewer }` — hosts publish, viewers subscribe only |
| GET | `/live-classes/:id/messages` | 🔑 | Persisted chat history |

### Chat (socket.io, namespace `/chat`)
Connect with `io('/chat', { auth: { token } })` (path `/socket.io`). Events:
- `join` `{ liveClassId }` (ack `{ ok, error? }`) — access is checked server-side.
- `message` `{ liveClassId, content (1–1000 chars) }` — persisted, then broadcast as `message` `{ id, liveClassId, content, createdAt, user }` to the room.

## Payments and revenue (Stripe test mode)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/checkout` | 🔑 | `{ courseId }` → 201 `{ sessionId, url }` Stripe Checkout for paid, published courses (503 if no `STRIPE_SECRET_KEY`, 409 if already enrolled) |
| POST | `/payments/webhook` | Stripe signature | `checkout.session.completed` marks the payment `COMPLETED` and enrolls the student (idempotent) |
| GET | `/instructor/revenue/summary` | 🎓 | `{ totalCents, last30DaysCents, perCourse[], monthly[] }` (feeds Chart.js) |
| GET | `/instructor/payouts` | 🎓 | `{ items, pendingBalanceCents }` |
| POST | `/admin/payouts` | 🛡 | `{ instructorId }` → settles all unpaid completed payments into one `PAID` payout (409 if nothing to pay) |
