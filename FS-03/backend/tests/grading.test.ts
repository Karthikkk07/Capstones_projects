import { describe, expect, it } from 'vitest';
import { attemptsRemaining, canAttempt, gradeAttempt, gradeQuestion, type GradableQuestion } from '../src/services/grading';

const single: GradableQuestion = {
  id: 'q1',
  type: 'SINGLE',
  points: 2,
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
  ],
  correct: ['b'],
};
const multiple: GradableQuestion = {
  id: 'q2',
  type: 'MULTIPLE',
  points: 4,
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
    { id: 'd', text: 'D' },
  ],
  correct: ['a', 'c'],
};
const trueFalse: GradableQuestion = {
  id: 'q3',
  type: 'TRUE_FALSE',
  points: 1,
  options: [
    { id: 'true', text: 'True' },
    { id: 'false', text: 'False' },
  ],
  correct: ['false'],
};

describe('gradeQuestion', () => {
  it('awards full points for a correct single answer (string or array)', () => {
    expect(gradeQuestion(single, 'b').earned).toBe(2);
    expect(gradeQuestion(single, ['b']).correct).toBe(true);
  });

  it('awards zero for a wrong, empty or over-selected single answer', () => {
    expect(gradeQuestion(single, ['a']).earned).toBe(0);
    expect(gradeQuestion(single, undefined).earned).toBe(0);
    expect(gradeQuestion(single, ['a', 'b']).earned).toBe(0);
  });

  it('grades true/false questions', () => {
    expect(gradeQuestion(trueFalse, 'false').earned).toBe(1);
    expect(gradeQuestion(trueFalse, 'true').earned).toBe(0);
  });

  it('gives partial credit for multiple-choice with a wrong-answer penalty', () => {
    expect(gradeQuestion(multiple, ['a', 'c']).earned).toBe(4);
    expect(gradeQuestion(multiple, ['a']).earned).toBe(2);
    expect(gradeQuestion(multiple, ['a', 'c', 'b']).earned).toBe(2); // (2-1)/2
    expect(gradeQuestion(multiple, ['a', 'b']).earned).toBe(0); // (1-1)/2
  });

  it('never goes negative and ignores duplicates / unknown option ids', () => {
    expect(gradeQuestion(multiple, ['b', 'd']).earned).toBe(0);
    expect(gradeQuestion(multiple, ['a', 'a', 'c', 'zzz']).earned).toBe(4);
  });
});

describe('gradeAttempt', () => {
  const questions = [single, multiple, trueFalse];

  it('computes score, percent and pass state', () => {
    const result = gradeAttempt(questions, { q1: ['b'], q2: ['a'], q3: ['false'] }, 70);
    expect(result.score).toBe(5); // 2 + 2 + 1
    expect(result.maxScore).toBe(7);
    expect(result.percent).toBe(71.43);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(3);
  });

  it('fails when below the pass mark and passes exactly at the pass mark', () => {
    expect(gradeAttempt(questions, { q1: ['a'] }, 70).passed).toBe(false);
    expect(gradeAttempt([single], { q1: ['b'] }, 100).passed).toBe(true);
  });

  it('cannot pass a quiz without questions', () => {
    const result = gradeAttempt([], {}, 1);
    expect(result).toMatchObject({ score: 0, maxScore: 0, percent: 0, passed: false });
  });
});

describe('attempt limits', () => {
  it('treats null as unlimited and counts remaining attempts', () => {
    expect(attemptsRemaining(null, 99)).toBeNull();
    expect(canAttempt(null, 99)).toBe(true);
    expect(attemptsRemaining(3, 1)).toBe(2);
    expect(canAttempt(3, 2)).toBe(true);
    expect(canAttempt(3, 3)).toBe(false);
    expect(attemptsRemaining(3, 5)).toBe(0);
  });
});
