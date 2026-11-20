import type { Role } from '../api/types';

export type Permission =
  | 'project:write'
  | 'board:write'
  | 'issue:write'
  | 'issue:delete'
  | 'comment:write'
  | 'attachment:write'
  | 'sprint:write'
  | 'webhook:manage'
  | 'audit:read'
  | 'billing:read'
  | 'billing:manage';

// UI hints only; the backend (permissions.ts) remains the source of truth.
const PERMISSIONS: Record<Permission, Role[]> = {
  'project:write': ['OWNER', 'ADMIN'],
  'board:write': ['OWNER', 'ADMIN'],
  'issue:write': ['OWNER', 'ADMIN', 'MEMBER'],
  'issue:delete': ['OWNER', 'ADMIN'],
  'comment:write': ['OWNER', 'ADMIN', 'MEMBER'],
  'attachment:write': ['OWNER', 'ADMIN', 'MEMBER'],
  'sprint:write': ['OWNER', 'ADMIN'],
  'webhook:manage': ['OWNER', 'ADMIN'],
  'audit:read': ['OWNER', 'ADMIN'],
  'billing:read': ['OWNER', 'ADMIN'],
  'billing:manage': ['OWNER'],
};

export const roleCan = (role: Role, permission: Permission): boolean => PERMISSIONS[permission].includes(role);
