import { describe, expect, it } from 'vitest';
import { questionSchema } from '../src/routes/quizzes';

describe('question validation schema', () => {
  const opts = [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ];

  it('accepts valid single and multiple questions', () => {
    expect(questionSchema.safeParse({ type: 'SINGLE', prompt: 'Q?', options: opts, correct: ['a'] }).success).toBe(true);
    expect(questionSchema.safeParse({ type: 'MULTIPLE', prompt: 'Q?', options: opts, correct: ['a', 'b'] }).success).toBe(true);
  });

  it('rejects SINGLE with several correct answers or unknown ids', () => {
    expect(questionSchema.safeParse({ type: 'SINGLE', prompt: 'Q?', options: opts, correct: ['a', 'b'] }).success).toBe(false);
    expect(questionSchema.safeParse({ type: 'MULTIPLE', prompt: 'Q?', options: opts, correct: ['z'] }).success).toBe(false);
  });

  it('normalises TRUE_FALSE options', () => {
    const parsed = questionSchema.parse({ type: 'TRUE_FALSE', prompt: 'Sky is blue', correct: ['true'] });
    expect(parsed.options.map((o) => o.id)).toEqual(['true', 'false']);
    expect(questionSchema.safeParse({ type: 'TRUE_FALSE', prompt: 'x', correct: ['maybe'] }).success).toBe(false);
  });
});
