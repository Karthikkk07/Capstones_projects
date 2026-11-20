import { describe, expect, it } from 'vitest';
import { PALETTE, monthLabel, monthlyChartData, perCourseChartData } from './chartData';
import { formatDuration, formatMoney } from './format';
import { draftToInput, emptyQuestion, emptyQuiz, quizToDraft, validateDraft } from './quizDraft';

describe('chart data mappers', () => {
  it('formats month labels', () => {
    expect(monthLabel('2026-03')).toBe('Mar 26');
  });

  it('maps the monthly series from cents to dollars', () => {
    const data = monthlyChartData([
      { month: '2026-01', totalCents: 1050 },
      { month: '2026-02', totalCents: 0 },
    ]);
    expect(data.labels).toEqual(['Jan 26', 'Feb 26']);
    expect(data.datasets[0].data).toEqual([10.5, 0]);
  });

  it('maps per-course revenue with a colour per slice', () => {
    const data = perCourseChartData([
      { courseId: 'a', title: 'A', totalCents: 2000, sales: 2 },
      { courseId: 'b', title: 'B', totalCents: 500, sales: 1 },
    ]);
    expect(data.labels).toEqual(['A', 'B']);
    expect(data.datasets[0].data).toEqual([20, 5]);
    expect(data.datasets[0].backgroundColor).toEqual(PALETTE.slice(0, 2));
  });
});

describe('formatters', () => {
  it('formats prices and durations', () => {
    expect(formatMoney(0)).toBe('Free');
    expect(formatMoney(1999)).toBe('$19.99');
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(null)).toBe('');
  });
});

describe('quiz draft conversion', () => {
  it('validates drafts', () => {
    expect(validateDraft(emptyQuiz())).toEqual(expect.arrayContaining(['Quiz title is required', 'Question 1: prompt is required']));
    const ok = { ...emptyQuiz(), title: 'T', questions: [{ ...emptyQuestion(), prompt: 'Q', options: ['x', 'y'], correct: [1] }] };
    expect(validateDraft(ok)).toEqual([]);
  });

  it('converts drafts to API input with letter option ids', () => {
    const input = draftToInput({
      ...emptyQuiz(),
      title: ' Quiz ',
      questions: [
        { ...emptyQuestion(), type: 'MULTIPLE', prompt: 'Pick', options: ['A', 'B', 'C'], correct: [2, 0], points: 3 },
        { ...emptyQuestion(), type: 'TRUE_FALSE', prompt: 'Sky?', tf: 'false' },
      ],
    });
    expect(input.title).toBe('Quiz');
    expect(input.questions[0]).toMatchObject({ options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], correct: ['a', 'c'], points: 3 });
    expect(input.questions[1]).toMatchObject({ type: 'TRUE_FALSE', options: [], correct: ['false'] });
  });

  it('round-trips an existing quiz into a draft', () => {
    const draft = quizToDraft({
      id: 'q',
      courseId: 'c',
      title: 'Q',
      lessonId: null,
      required: true,
      passMarkPct: 60,
      maxAttempts: 3,
      questions: [{ id: 'x', type: 'SINGLE', prompt: 'P', points: 1, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct: ['b'] }],
    });
    expect(draft.questions[0].correct).toEqual([1]);
    expect(draft.maxAttempts).toBe(3);
  });
});
