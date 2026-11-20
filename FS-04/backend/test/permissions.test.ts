import { describe, expect, it } from 'vitest';
import type { Role } from '@prisma/client';
import { hasPermission, PERMISSIONS, permissionsFor, type Permission } from '../src/permissions';

describe('permission map', () => {
  it('lets viewers read but never write', () => {
    expect(hasPermission('VIEWER', 'issue:read')).toBe(true);
    expect(hasPermission('VIEWER', 'issue:write')).toBe(false);
    expect(hasPermission('VIEWER', 'comment:write')).toBe(false);
    expect(hasPermission('VIEWER', 'attachment:write')).toBe(false);
  });

  it('lets members create/edit issues and comment but not manage projects, sprints or webhooks', () => {
    expect(hasPermission('MEMBER', 'issue:write')).toBe(true);
    expect(hasPermission('MEMBER', 'comment:write')).toBe(true);
    expect(hasPermission('MEMBER', 'project:write')).toBe(false);
    expect(hasPermission('MEMBER', 'sprint:write')).toBe(false);
    expect(hasPermission('MEMBER', 'webhook:manage')).toBe(false);
    expect(hasPermission('MEMBER', 'audit:read')).toBe(false);
  });

  it('lets admins manage projects, sprints, webhooks and members but not billing', () => {
    for (const p of ['project:write', 'sprint:write', 'webhook:manage', 'member:manage', 'audit:read'] as Permission[]) {
      expect(hasPermission('ADMIN', p)).toBe(true);
    }
    expect(hasPermission('ADMIN', 'billing:manage')).toBe(false);
  });

  it('gives the owner every permission, including billing', () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      expect(hasPermission('OWNER', p)).toBe(true);
    }
  });

  it('denies unknown permissions', () => {
    expect(hasPermission('OWNER', 'nope:nothing' as Permission)).toBe(false);
  });

  it('is monotonic: every permission of a lower role is held by the roles above it', () => {
    const order: Role[] = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'];
    for (let i = 0; i < order.length - 1; i++) {
      const lower = permissionsFor(order[i]);
      const higher = new Set(permissionsFor(order[i + 1]));
      expect(lower.every((p) => higher.has(p))).toBe(true);
    }
  });
});
