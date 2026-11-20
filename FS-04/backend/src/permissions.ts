import type { Role } from '@prisma/client';

export const PERMISSIONS = {
  'workspace:read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'member:manage': ['OWNER', 'ADMIN'],
  'project:read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'project:write': ['OWNER', 'ADMIN'],
  'board:write': ['OWNER', 'ADMIN'],
  'issue:read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'issue:write': ['OWNER', 'ADMIN', 'MEMBER'],
  'issue:delete': ['OWNER', 'ADMIN'],
  'comment:write': ['OWNER', 'ADMIN', 'MEMBER'],
  'attachment:write': ['OWNER', 'ADMIN', 'MEMBER'],
  'sprint:read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'sprint:write': ['OWNER', 'ADMIN'],
  'report:read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'webhook:manage': ['OWNER', 'ADMIN'],
  'audit:read': ['OWNER', 'ADMIN'],
  'billing:read': ['OWNER', 'ADMIN'],
  'billing:manage': ['OWNER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role, permission: Permission): boolean {
  const allowed: readonly Role[] | undefined = PERMISSIONS[permission];
  return !!allowed && allowed.includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => hasPermission(role, p));
}
