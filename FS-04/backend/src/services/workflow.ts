import type { WorkflowTransition } from '@prisma/client';
import { AppError } from '../lib/errors';

type Transition = Pick<WorkflowTransition, 'fromColumnId' | 'toColumnId'>;

/**
 * A board with no configured transitions is "open": any move is allowed.
 * Once at least one transition exists, only listed (from -> to) pairs are allowed.
 * Staying in the same column (reordering) is always allowed.
 */
export function isTransitionAllowed(fromId: string, toId: string, transitions: Transition[]): boolean {
  if (fromId === toId) return true;
  if (transitions.length === 0) return true;
  return transitions.some((t) => t.fromColumnId === fromId && t.toColumnId === toId);
}

export function assertTransitionAllowed(
  fromId: string,
  toId: string,
  transitions: Transition[],
  names?: { from: string; to: string },
): void {
  if (!isTransitionAllowed(fromId, toId, transitions)) {
    const label = names ? `"${names.from}" to "${names.to}"` : 'this status to the requested status';
    throw new AppError(409, 'WORKFLOW_TRANSITION_NOT_ALLOWED', `The board workflow does not allow moving from ${label}`);
  }
}
