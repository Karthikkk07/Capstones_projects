import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export type TenantModel =
  | 'project'
  | 'board'
  | 'boardColumn'
  | 'workflowTransition'
  | 'issue'
  | 'sprint'
  | 'comment'
  | 'attachment'
  | 'auditLog'
  | 'webhook';

const TENANT_MODELS: TenantModel[] = [
  'project',
  'board',
  'boardColumn',
  'workflowTransition',
  'issue',
  'sprint',
  'comment',
  'attachment',
  'auditLog',
  'webhook',
];

type ScopedOps = 'findMany' | 'findFirst' | 'count' | 'create' | 'createMany' | 'updateMany' | 'deleteMany';
export type ScopedDelegate<M extends TenantModel> = Pick<PrismaClient[M], ScopedOps>;
export type ScopedClient = { [M in TenantModel]: ScopedDelegate<M> };

// Delegates are indexed dynamically; the public typing comes from ScopedClient.
type Args = any;

/**
 * Tenant-scoped data access. Every read/update/delete is forced to include
 * `workspaceId` in its `where` clause and every create stamps `workspaceId`
 * into `data`, overriding anything the caller (or the client) supplied.
 * There is deliberately no findUnique/update/delete-by-id here: those cannot be
 * scoped by workspace, so use findFirst + updateMany/deleteMany instead.
 */
export function scoped(workspaceId: string, client: PrismaClient = prisma): ScopedClient {
  const out: Record<string, unknown> = {};
  for (const model of TENANT_MODELS) {
    const delegate = (client as Args)[model];
    const withWhere = (args: Args = {}) => ({ ...args, where: { ...(args.where ?? {}), workspaceId } });
    const stamp = (data: Args) =>
      Array.isArray(data) ? data.map((d) => ({ ...d, workspaceId })) : { ...data, workspaceId };
    out[model] = {
      findMany: (args?: Args) => delegate.findMany(withWhere(args)),
      findFirst: (args?: Args) => delegate.findFirst(withWhere(args)),
      count: (args?: Args) => delegate.count(withWhere(args)),
      create: (args: Args) => delegate.create({ ...args, data: stamp(args.data) }),
      createMany: (args: Args) => delegate.createMany({ ...args, data: stamp(args.data) }),
      updateMany: (args: Args) => delegate.updateMany(withWhere(args)),
      deleteMany: (args?: Args) => delegate.deleteMany(withWhere(args)),
    };
  }
  return out as ScopedClient;
}
