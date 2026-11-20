export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type StatusCategory = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type IssueType = 'TASK' | 'BUG' | 'STORY' | 'EPIC';
export type IssuePriority = 'LOWEST' | 'LOW' | 'MEDIUM' | 'HIGH' | 'HIGHEST';
export type SprintState = 'PLANNED' | 'ACTIVE' | 'COMPLETED';
export type Plan = 'FREE' | 'PRO' | 'BUSINESS';

export const ISSUE_TYPES: IssueType[] = ['TASK', 'BUG', 'STORY', 'EPIC'];
export const ISSUE_PRIORITIES: IssuePriority[] = ['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST'];

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceRef {
  id: string;
  name: string;
  slug: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  workspace: WorkspaceRef;
  role: Role;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  createdAt: string;
  _count?: { issues: number };
}

export interface BoardColumn {
  id: string;
  boardId: string;
  name: string;
  position: number;
  category: StatusCategory;
}

export interface WorkflowTransition {
  id: string;
  fromColumnId: string;
  toColumnId: string;
}

export interface Board {
  id: string;
  projectId: string;
  name: string;
  columns: BoardColumn[];
  transitions: WorkflowTransition[];
}

export interface Issue {
  id: string;
  key: string;
  projectId: string;
  boardId: string;
  statusId: string;
  title: string;
  description: string | null;
  type: IssueType;
  priority: IssuePriority;
  assigneeId: string | null;
  position: number;
  sprintId: string | null;
  storyPoints: number | null;
  createdAt: string;
  updatedAt: string;
  status: { id: string; name: string; category: StatusCategory };
  assignee: { id: string; name: string; email: string } | null;
  reporter: { id: string; name: string };
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Comment {
  id: string;
  issueId: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploader: { id: string; name: string };
}

export interface ActivityEntry {
  id: string;
  action: string;
  createdAt: string;
  meta: unknown;
  actor: { id: string; name: string } | null;
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  state: SprintState;
  completedAt: string | null;
  _count?: { issues: number };
}

export interface SprintReport {
  sprint: Pick<Sprint, 'id' | 'name' | 'goal' | 'state' | 'startDate' | 'endDate'>;
  totals: {
    issues: number;
    completedIssues: number;
    points: number;
    completedPoints: number;
    remainingPoints: number;
    completionPercent: number;
  };
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  meta: unknown;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

export interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface PlanInfo {
  id: Plan;
  name: string;
  price: string;
  maxProjects: number | null;
  maxMembers: number | null;
}

export interface BillingInfo {
  plan: Plan;
  status: string;
  currentPeriodEnd: string | null;
  hasBillingAccount: boolean;
  stripeConfigured: boolean;
  limits: { projects: number | null; members: number | null };
  usage: { projects: number; members: number };
  plans: PlanInfo[];
}
