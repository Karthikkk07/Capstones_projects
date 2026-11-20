import { describe, expect, it } from 'vitest';
import { calculateProgress, evaluateCompletion } from '../src/services/progress';
import { validateForPublish } from '../src/services/publish';

describe('calculateProgress', () => {
  const lessons = ['l1', 'l2', 'l3', 'l4'];

  it('returns 0% for a fresh enrollment and resumes at the first lesson', () => {
    expect(calculateProgress({ lessonIds: lessons, completedLessonIds: [] })).toEqual({
      totalLessons: 4,
      completedLessons: 0,
      percent: 0,
      resumeLessonId: 'l1',
    });
  });

  it('rounds the percentage and ignores unknown lesson ids', () => {
    const p = calculateProgress({ lessonIds: ['a', 'b', 'c'], completedLessonIds: ['a', 'ghost'] });
    expect(p.completedLessons).toBe(1);
    expect(p.percent).toBe(33);
  });

  it('resumes at the last viewed lesson if unfinished, otherwise at the next open lesson', () => {
    expect(calculateProgress({ lessonIds: lessons, completedLessonIds: ['l1'], lastViewedLessonId: 'l3' }).resumeLessonId).toBe('l3');
    expect(calculateProgress({ lessonIds: lessons, completedLessonIds: ['l1', 'l3'], lastViewedLessonId: 'l3' }).resumeLessonId).toBe('l2');
  });

  it('handles empty courses and fully completed courses', () => {
    expect(calculateProgress({ lessonIds: [], completedLessonIds: [] }).percent).toBe(0);
    const done = calculateProgress({ lessonIds: lessons, completedLessonIds: lessons });
    expect(done.percent).toBe(100);
    expect(done.resumeLessonId).toBeNull();
  });
});

describe('evaluateCompletion', () => {
  it('requires every lesson and every required quiz', () => {
    const base = { lessonIds: ['l1', 'l2'], requiredQuizIds: ['q1'] };
    expect(evaluateCompletion({ ...base, completedLessonIds: ['l1', 'l2'], passedQuizIds: ['q1'] }).complete).toBe(true);
    expect(evaluateCompletion({ ...base, completedLessonIds: ['l1'], passedQuizIds: ['q1'] })).toMatchObject({ complete: false, missingLessons: 1 });
    expect(evaluateCompletion({ ...base, completedLessonIds: ['l1', 'l2'], passedQuizIds: [] })).toMatchObject({ complete: false, missingQuizzes: 1 });
  });

  it('never completes a course without lessons', () => {
    expect(evaluateCompletion({ lessonIds: [], completedLessonIds: [], requiredQuizIds: [], passedQuizIds: [] }).complete).toBe(false);
  });
});

describe('validateForPublish', () => {
  const ok = {
    title: 'Node.js Basics',
    description: 'A long enough description for the course.',
    priceCents: 0,
    sections: [{ title: 'Intro', lessons: [{ title: 'Hello', type: 'VIDEO' as const, videoStatus: 'READY' }] }],
  };

  it('accepts a complete course', () => {
    expect(validateForPublish(ok)).toEqual([]);
  });

  it('reports unprocessed videos, empty sections and bad prices', () => {
    const problems = validateForPublish({
      ...ok,
      priceCents: 10,
      sections: [
        { title: 'Intro', lessons: [{ title: 'Hello', type: 'VIDEO', videoStatus: 'PROCESSING' }] },
        { title: 'Empty', lessons: [] },
      ],
    });
    expect(problems.join('|')).toMatch(/not processed yet/);
    expect(problems.join('|')).toMatch(/Section "Empty"/);
    expect(problems.join('|')).toMatch(/at least 50 cents/);
  });
});
