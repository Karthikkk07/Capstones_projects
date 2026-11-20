/* Seed script: 2 workspaces, users, projects, boards, issues, sprints. Run with `npm run seed`. */
import { PrismaClient, type IssuePriority, type IssueType, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';
import { createDefaultBoard } from '../src/services/boards';

const prisma = new PrismaClient();
const PASSWORD = 'Password123!';

const TYPES: IssueType[] = ['TASK', 'BUG', 'STORY', 'EPIC'];
const PRIORITIES: IssuePriority[] = ['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST'];

async function wipe() {
  await prisma.auditLog.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.sprint.deleteMany();
  await prisma.workflowTransition.deleteMany();
  await prisma.boardColumn.deleteMany();
  await prisma.board.deleteMany();
  await prisma.project.deleteMany();
  await prisma.webhook.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
}

async function makeUser(email: string, name: string, passwordHash: string) {
  return prisma.user.create({ data: { email, name, passwordHash } });
}

async function seedProject(
  workspaceId: string,
  key: string,
  name: string,
  userIds: string[],
  reporterId: string,
  restrictWorkflow: boolean,
) {
  const project = await prisma.project.create({
    data: { workspaceId, key, name, description: faker.company.catchPhrase() },
  });
  const board = await createDefaultBoard(prisma, workspaceId, project.id);
  const columns = await prisma.boardColumn.findMany({ where: { boardId: board.id }, orderBy: { position: 'asc' } });
  const [todo, doing, done] = columns;

  if (restrictWorkflow) {
    const pairs = [
      [todo, doing],
      [doing, todo],
      [doing, done],
      [done, doing],
    ];
    await prisma.workflowTransition.createMany({
      data: pairs.map(([from, to]) => ({ workspaceId, boardId: board.id, fromColumnId: from.id, toColumnId: to.id })),
    });
  }

  const active = await prisma.sprint.create({
    data: {
      workspaceId,
      projectId: project.id,
      name: `${key} Sprint 1`,
      goal: faker.company.buzzPhrase(),
      state: 'ACTIVE',
      startDate: faker.date.recent({ days: 5 }),
      endDate: faker.date.soon({ days: 9 }),
    },
  });
  const planned = await prisma.sprint.create({
    data: { workspaceId, projectId: project.id, name: `${key} Sprint 2`, goal: faker.company.buzzPhrase() },
  });

  const positions = new Map<string, number>();
  for (let n = 1; n <= 14; n++) {
    const status = faker.helpers.arrayElement(columns);
    const position = positions.get(status.id) ?? 0;
    positions.set(status.id, position + 1);
    const issue = await prisma.issue.create({
      data: {
        workspaceId,
        projectId: project.id,
        boardId: board.id,
        statusId: status.id,
        number: n,
        key: `${key}-${n}`,
        title: faker.hacker.phrase().slice(0, 120),
        description: faker.lorem.paragraph(),
        type: faker.helpers.arrayElement(TYPES),
        priority: faker.helpers.arrayElement(PRIORITIES),
        assigneeId: faker.helpers.maybe(() => faker.helpers.arrayElement(userIds), { probability: 0.8 }) ?? null,
        reporterId,
        position,
        storyPoints: faker.helpers.arrayElement([1, 2, 3, 5, 8]),
        sprintId: n <= 9 ? active.id : n <= 12 ? planned.id : null,
      },
    });
    if (n % 3 === 0) {
      await prisma.comment.create({
        data: { workspaceId, issueId: issue.id, authorId: reporterId, body: faker.lorem.sentence() },
      });
    }
    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorId: reporterId,
        action: 'issue.created',
        entity: 'issue',
        entityId: issue.id,
        meta: { after: { key: issue.key, title: issue.title } },
      },
    });
  }
  await prisma.project.update({ where: { id: project.id }, data: { issueCounter: 14 } });
}

async function main() {
  await wipe();
  const hash = await bcrypt.hash(PASSWORD, 10);

  const acmeOwner = await makeUser('owner@acme.test', 'Alice Owner', hash);
  const acmeAdmin = await makeUser('admin@acme.test', 'Adam Admin', hash);
  const acmeMember = await makeUser('member@acme.test', 'Maya Member', hash);
  const acmeViewer = await makeUser('viewer@acme.test', 'Victor Viewer', hash);
  const globexOwner = await makeUser('owner@globex.test', 'Grace Owner', hash);
  const globexMember = await makeUser('member@globex.test', 'Gary Member', hash);

  const acme = await prisma.workspace.create({ data: { name: 'Acme Corp', slug: 'acme' } });
  const globex = await prisma.workspace.create({ data: { name: 'Globex Inc', slug: 'globex' } });

  const memberships: [string, string, Role][] = [
    [acmeOwner.id, acme.id, 'OWNER'],
    [acmeAdmin.id, acme.id, 'ADMIN'],
    [acmeMember.id, acme.id, 'MEMBER'],
    [acmeViewer.id, acme.id, 'VIEWER'],
    [globexOwner.id, globex.id, 'OWNER'],
    [globexMember.id, globex.id, 'MEMBER'],
    [acmeAdmin.id, globex.id, 'VIEWER'], // one user in both tenants -> demonstrates workspace switching
  ];
  await prisma.membership.createMany({
    data: memberships.map(([userId, workspaceId, role]) => ({ userId, workspaceId, role })),
  });

  await prisma.subscription.createMany({
    data: [
      { workspaceId: acme.id, plan: 'PRO', status: 'active' },
      { workspaceId: globex.id, plan: 'FREE', status: 'active' },
    ],
  });

  const acmeUsers = [acmeOwner.id, acmeAdmin.id, acmeMember.id];
  await seedProject(acme.id, 'WEB', 'Website Redesign', acmeUsers, acmeOwner.id, true);
  await seedProject(acme.id, 'API', 'Public API', acmeUsers, acmeAdmin.id, false);
  await seedProject(globex.id, 'OPS', 'Operations', [globexOwner.id, globexMember.id], globexOwner.id, false);

  await prisma.webhook.create({
    data: {
      workspaceId: acme.id,
      url: 'https://example.com/hooks/fs04',
      secret: 'whsec_seed_secret_change_me_0001',
      events: ['issue.created', 'issue.moved'],
      active: false,
    },
  });

  console.log(`Seeded. Log in with e.g. owner@acme.test / ${PASSWORD} (or owner@globex.test, member@acme.test, viewer@acme.test)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
