import { describe, expect, it } from 'vitest';
import type { BoardColumn, Issue } from '../api/types';
import { groupIssuesByColumn, planMove } from './kanban';

const col = (id: string, position: number): BoardColumn => ({ id, boardId: 'b', name: id, position, category: 'TODO' });
const issue = (id: string, statusId: string, position: number): Issue =>
  ({ id, key: id.toUpperCase(), statusId, position, title: id }) as Issue;

const columns = [col('todo', 0), col('doing', 1), col('done', 2)];
const issues = [issue('b', 'todo', 1), issue('a', 'todo', 0), issue('c', 'doing', 0)];

describe('groupIssuesByColumn', () => {
  it('buckets by status, sorts by position and keeps empty columns', () => {
    const groups = groupIssuesByColumn(columns, issues);
    expect(groups.todo.map((i) => i.id)).toEqual(['a', 'b']);
    expect(groups.doing.map((i) => i.id)).toEqual(['c']);
    expect(groups.done).toEqual([]);
  });
});

describe('planMove', () => {
  const groups = groupIssuesByColumn(columns, issues);

  it('appends to a column when dropped on the column itself', () => {
    const plan = planMove(groups, 'a', 'doing')!;
    expect(plan).toMatchObject({ fromColumnId: 'todo', toColumnId: 'doing', position: 1 });
    expect(plan.next.todo.map((i) => i.id)).toEqual(['b']);
    expect(plan.next.doing.map((i) => [i.id, i.statusId, i.position])).toEqual([
      ['c', 'doing', 0],
      ['a', 'doing', 1],
    ]);
  });

  it('inserts before the issue it is dropped on and reorders within a column', () => {
    expect(planMove(groups, 'c', 'a')).toMatchObject({ toColumnId: 'todo', position: 0 });
    const down = planMove(groups, 'a', 'b')!;
    expect(down.position).toBe(1);
    expect(down.next.todo.map((i) => i.id)).toEqual(['b', 'a']);
    expect(planMove(groups, 'b', 'a')!.next.todo.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('returns null for no-op or unknown drops', () => {
    expect(planMove(groups, 'a', 'a')).toBeNull();
    expect(planMove(groups, 'nope', 'doing')).toBeNull();
    expect(planMove(groups, 'a', 'nope')).toBeNull();
  });
});
