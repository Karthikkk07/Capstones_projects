# Data Model

Source of truth: `backend/prisma/schema.prisma` (PostgreSQL, migration `0001_init`). IDs are `cuid()` strings.

```mermaid
erDiagram
  User ||--o{ Course : "teaches (instructorId)"
  User ||--o{ Enrollment : enrolls
  User ||--o{ LessonProgress : tracks
  User ||--o{ QuizAttempt : attempts
  User ||--o{ Certificate : earns
  User ||--o{ Payment : "pays (userId)"
  User ||--o{ Payment : "earns (instructorId)"
  User ||--o{ Payout : receives
  User ||--o{ ChatMessage : writes
  Course ||--o{ Section : has
  Course ||--o{ Lesson : has
  Section ||--o{ Lesson : contains
  Course ||--o{ Enrollment : has
  Course ||--o{ Quiz : has
  Course ||--o{ Certificate : issues
  Course ||--o{ Payment : sold_via
  Course ||--o{ LiveClass : schedules
  Course ||--o{ LessonProgress : scopes
  Lesson ||--o{ LessonProgress : progress
  Lesson |o--o{ Quiz : "optional lesson quiz"
  Quiz ||--o{ Question : has
  Quiz ||--o{ QuizAttempt : has
  Payout ||--o{ Payment : settles
  LiveClass ||--o{ ChatMessage : has

  User {
    string id PK
    string email UK
    string passwordHash
    string name
    Role role "STUDENT|INSTRUCTOR|ADMIN"
    datetime createdAt
  }
  Course {
    string id PK
    string slug UK
    string title
    string description
    int priceCents
    CourseStatus status "DRAFT|PUBLISHED"
    string category
    string thumbnail
    string instructorId FK
  }
  Section {
    string id PK
    string courseId FK
    string title
    int position
  }
  Lesson {
    string id PK
    string courseId FK
    string sectionId FK
    string title
    int position
    LessonType type "VIDEO|TEXT"
    string content
    VideoStatus videoStatus "PENDING|PROCESSING|READY|FAILED"
    string sourcePath
    string hlsPath
    int durationSec
  }
  Enrollment {
    string id PK
    string userId FK
    string courseId FK
    datetime completedAt
  }
  LessonProgress {
    string id PK
    string userId FK
    string courseId FK
    string lessonId FK
    boolean completed
    int positionSec
  }
  Quiz {
    string id PK
    string courseId FK
    string lessonId FK "nullable"
    string title
    int passMarkPct
    int maxAttempts "nullable"
    boolean required
  }
  Question {
    string id PK
    string quizId FK
    QuestionType type "SINGLE|MULTIPLE|TRUE_FALSE"
    string prompt
    json options
    json correct
    int points
    int position
  }
  QuizAttempt {
    string id PK
    string quizId FK
    string userId FK
    json answers
    float score
    float maxScore
    float percent
    boolean passed
  }
  Certificate {
    string id PK
    string code UK
    string courseId FK
    string userId FK
    datetime issuedAt
  }
  Payment {
    string id PK
    string userId FK
    string instructorId FK
    string courseId FK
    string stripeSessionId UK
    string stripePaymentIntent
    int amountCents
    int instructorShareCents
    int platformFeeCents
    PaymentStatus status "PENDING|COMPLETED|FAILED|REFUNDED"
    string payoutId FK "nullable"
  }
  Payout {
    string id PK
    string instructorId FK
    int amountCents
    PayoutStatus status "PENDING|PAID"
    datetime paidAt
  }
  LiveClass {
    string id PK
    string courseId FK
    string title
    datetime scheduledAt
    LiveClassStatus status "SCHEDULED|LIVE|ENDED"
    string roomName UK
    datetime startedAt
    datetime endedAt
  }
  ChatMessage {
    string id PK
    string liveClassId FK
    string userId FK
    string content
    datetime createdAt
  }
```

## Constraints and indexes

| Table | Unique | Indexes |
|---|---|---|
| User | `email` | |
| Course | `slug` | `(status, category)`, `(instructorId)` |
| Section | | `(courseId, position)` |
| Lesson | | `(courseId)`, `(sectionId, position)` |
| Enrollment | `(userId, courseId)` | `(courseId)` |
| LessonProgress | `(userId, lessonId)` | `(userId, courseId)` |
| Quiz | | `(courseId)` |
| Question | | `(quizId, position)` |
| QuizAttempt | | `(quizId, userId)` |
| Certificate | `code`, `(userId, courseId)` | |
| Payment | `stripeSessionId` | `(instructorId, status)`, `(courseId)` |
| Payout | | `(instructorId)` |
| LiveClass | `roomName` | `(courseId, scheduledAt)` |
| ChatMessage | | `(liveClassId, createdAt)` |

## Notes

- All foreign keys cascade on delete, except `Quiz.lessonId` and `Payment.payoutId`, which are set to `NULL`.
- `Question.options` is `[{ "id": "a", "text": "..." }]`; `Question.correct` is `["a"]` / `["a","c"]`, and `["true"]` or `["false"]` for `TRUE_FALSE`. Correct answers are stripped from quiz payloads sent to students.
- `Payment.instructorShareCents + platformFeeCents = amountCents`. The instructor share is `INSTRUCTOR_SHARE_PCT` (default 80%) and only `COMPLETED` payments count towards revenue.
- A certificate is unique per `(user, course)`; `code` is a public verification code.
