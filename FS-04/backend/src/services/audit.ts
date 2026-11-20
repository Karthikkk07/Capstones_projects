import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface AuditEntry {
  workspaceId: string;
  actorId?: string | null;
  action: string; // e.g. "issue.created"
  entity: string; // e.g. "issue"
  entityId: string;
  meta?: { before?: unknown; after?: unknown; [key: string]: unknown };
}

/** Writes one audit row. Called by every mutating endpoint. Failures are logged, never thrown. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        meta: (entry.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'failed to write audit log');
  }
}
