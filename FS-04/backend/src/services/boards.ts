import type { Prisma, PrismaClient, StatusCategory } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export const DEFAULT_COLUMNS: { name: string; category: StatusCategory }[] = [
  { name: 'To Do', category: 'TODO' },
  { name: 'In Progress', category: 'IN_PROGRESS' },
  { name: 'Done', category: 'DONE' },
];

export async function createDefaultBoard(db: Db, workspaceId: string, projectId: string, name = 'Main board') {
  const board = await db.board.create({ data: { workspaceId, projectId, name } });
  await db.boardColumn.createMany({
    data: DEFAULT_COLUMNS.map((c, position) => ({ workspaceId, boardId: board.id, position, ...c })),
  });
  return board;
}
