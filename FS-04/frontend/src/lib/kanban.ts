import type { BoardColumn, Issue } from '../api/types';

export type IssuesByColumn = Record<string, Issue[]>;

export interface MovePlan {
  issueId: string;
  fromColumnId: string;
  toColumnId: string;
  /** Index within the target column after the issue has been removed from its old spot. */
  position: number;
  next: IssuesByColumn;
}

/** Groups issues by status column (every column gets a key), ordered by position within each column. */
export function groupIssuesByColumn(columns: BoardColumn[], issues: Issue[]): IssuesByColumn {
  const groups: IssuesByColumn = {};
  for (const c of columns) groups[c.id] = [];
  for (const issue of issues) groups[issue.statusId]?.push(issue);
  for (const id of Object.keys(groups)) groups[id].sort((a, b) => a.position - b.position);
  return groups;
}

/**
 * Computes the result of dropping `issueId` onto `overId`, which is either a column id
 * (append to the end) or another issue id (take that issue's place).
 * Returns null when nothing would change or the ids are unknown.
 */
export function planMove(groups: IssuesByColumn, issueId: string, overId: string): MovePlan | null {
  const fromColumnId = Object.keys(groups).find((c) => groups[c].some((i) => i.id === issueId));
  if (!fromColumnId) return null;
  const toColumnId = overId in groups ? overId : Object.keys(groups).find((c) => groups[c].some((i) => i.id === overId));
  if (!toColumnId) return null;

  const moving = groups[fromColumnId].find((i) => i.id === issueId)!;
  const target = groups[toColumnId].filter((i) => i.id !== issueId);
  // Same column: the issue takes the index of the one it lands on (like arrayMove).
  // Other column: it is inserted just before it. Both reduce to the over item's current index.
  const overIndex = groups[toColumnId].findIndex((i) => i.id === overId);
  const position = overIndex === -1 ? target.length : overIndex;

  const sameSpot = fromColumnId === toColumnId && groups[fromColumnId].findIndex((i) => i.id === issueId) === position;
  if (sameSpot) return null;

  target.splice(position, 0, { ...moving, statusId: toColumnId });
  const next: IssuesByColumn = { ...groups, [toColumnId]: target.map((i, idx) => ({ ...i, position: idx })) };
  if (fromColumnId !== toColumnId) {
    next[fromColumnId] = groups[fromColumnId].filter((i) => i.id !== issueId).map((i, idx) => ({ ...i, position: idx }));
  }
  return { issueId, fromColumnId, toColumnId, position, next };
}
