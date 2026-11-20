# Data Model

PostgreSQL, managed by Prisma (`backend/prisma/schema.prisma`, migration `0001_init`). The `Workspace` is the tenant; every tenant-owned table has an indexed `workspaceId` (cascade delete). `User` is global and linked to workspaces through `Membership`.

```mermaid
erDiagram
  Workspace ||--o{ Membership : has
  User ||--o{ Membership : joins
  Workspace ||--o{ Project : owns
  Workspace ||--o| Subscription : billed_by
  Workspace ||--o{ Webhook : configures
  Workspace ||--o{ AuditLog : records
  Project ||--o{ Board : has
  Project ||--o{ Sprint : plans
  Project ||--o{ Issue : contains
  Board ||--o{ BoardColumn : has
  Board ||--o{ WorkflowTransition : restricts
  BoardColumn ||--o{ WorkflowTransition : from
  BoardColumn ||--o{ WorkflowTransition : to
  BoardColumn ||--o{ Issue : status
  Sprint ||--o{ Issue : includes
  Issue ||--o{ Comment : has
  Issue ||--o{ Attachment : has
  User ||--o{ Issue : assigned
  User ||--o{ Issue : reported
  User ||--o{ Comment : writes
  User ||--o{ Attachment : uploads
  User ||--o{ AuditLog : acts

  Workspace {
    string id PK
    string name
    string slug UK
    datetime createdAt
  }
  User {
    string id PK
    string email UK
    string name
    string passwordHash
  }
  Membership {
    string id PK
    string userId FK
    string workspaceId FK
    enum role "OWNER|ADMIN|MEMBER|VIEWER"
  }
  Project {
    string id PK
    string workspaceId FK
    string key "UK with workspaceId"
    string name
    int issueCounter
  }
  Board {
    string id PK
    string workspaceId FK
    string projectId FK
    string name
  }
  BoardColumn {
    string id PK
    string workspaceId FK
    string boardId FK
    string name
    int position
    enum category "TODO|IN_PROGRESS|DONE"
  }
  WorkflowTransition {
    string id PK
    string workspaceId FK
    string boardId FK
    string fromColumnId FK
    string toColumnId FK
  }
  Issue {
    string id PK
    string workspaceId FK
    string projectId FK
    string boardId FK
    string statusId FK
    int number "UK with projectId"
    string key
    string title
    enum type "TASK|BUG|STORY|EPIC"
    enum priority "LOWEST..HIGHEST"
    string assigneeId FK
    string reporterId FK
    int position
    string sprintId FK
    int storyPoints
  }
  Sprint {
    string id PK
    string workspaceId FK
    string projectId FK
    string name
    string goal
    enum state "PLANNED|ACTIVE|COMPLETED"
    datetime startDate
    datetime endDate
    datetime completedAt
  }
  Comment {
    string id PK
    string workspaceId FK
    string issueId FK
    string authorId FK
    string body
  }
  Attachment {
    string id PK
    string workspaceId FK
    string issueId FK
    string uploaderId FK
    string filename
    string storedName
    string mimeType
    int size
  }
  AuditLog {
    string id PK
    string workspaceId FK
    string actorId FK
    string action
    string entity
    string entityId
    json meta
  }
  Webhook {
    string id PK
    string workspaceId FK
    string url
    string secret
    string[] events
    boolean active
  }
  Subscription {
    string id PK
    string workspaceId FK "unique"
    enum plan "FREE|PRO|BUSINESS"
    string status
    string stripeCustomerId
    string stripeSubscriptionId UK
    datetime currentPeriodEnd
  }
```

## Notes

- **Uniqueness:** `Membership(userId, workspaceId)`, `Project(workspaceId, key)`, `Issue(projectId, number)`, `WorkflowTransition(boardId, fromColumnId, toColumnId)`.
- **Issue numbering:** `Project.issueCounter` is incremented per issue to build keys like `WEB-12`.
- **Workflow:** a board with zero `WorkflowTransition` rows is open (any move allowed); once any exists, only listed pairs are allowed.
- **Key indexes:** `workspaceId` on every tenant table, `Issue(workspaceId, key)`, `Issue(statusId, position)`, `AuditLog(workspaceId, createdAt)`, `AuditLog(workspaceId, entity, entityId)`.
- **Deletion:** workspace deletion cascades to all tenant data; deleting a user nulls `Issue.assigneeId` and `AuditLog.actorId`.
