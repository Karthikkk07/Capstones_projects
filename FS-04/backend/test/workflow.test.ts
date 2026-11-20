import { describe, expect, it } from 'vitest';
import { assertTransitionAllowed, isTransitionAllowed } from '../src/services/workflow';
import { AppError } from '../src/lib/errors';

const t = (fromColumnId: string, toColumnId: string) => ({ fromColumnId, toColumnId });

describe('workflow transition validation', () => {
  it('allows any move on a board without configured transitions', () => {
    expect(isTransitionAllowed('todo', 'done', [])).toBe(true);
  });

  it('allows only listed transitions once a workflow is configured', () => {
    const rules = [t('todo', 'doing'), t('doing', 'done')];
    expect(isTransitionAllowed('todo', 'doing', rules)).toBe(true);
    expect(isTransitionAllowed('doing', 'done', rules)).toBe(true);
    expect(isTransitionAllowed('todo', 'done', rules)).toBe(false);
    expect(isTransitionAllowed('done', 'doing', rules)).toBe(false); // transitions are directional
  });

  it('always allows reordering inside the same column', () => {
    expect(isTransitionAllowed('todo', 'todo', [t('todo', 'doing')])).toBe(true);
  });

  it('throws a 409 AppError with a readable message for forbidden moves', () => {
    try {
      assertTransitionAllowed('todo', 'done', [t('todo', 'doing')], { from: 'To Do', to: 'Done' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.status).toBe(409);
      expect(e.code).toBe('WORKFLOW_TRANSITION_NOT_ALLOWED');
      expect(e.message).toContain('"To Do" to "Done"');
    }
  });

  it('does not throw for allowed moves', () => {
    expect(() => assertTransitionAllowed('todo', 'doing', [t('todo', 'doing')])).not.toThrow();
  });
});
