import type { Quiz, QuizInput, QuestionType } from '../api/types';

export interface QuestionDraft {
  type: QuestionType;
  prompt: string;
  options: string[];
  correct: number[]; // indexes into options (SINGLE/MULTIPLE)
  tf: 'true' | 'false'; // TRUE_FALSE answer
  points: number;
}

export interface QuizDraft {
  title: string;
  passMarkPct: number;
  maxAttempts: number | null;
  required: boolean;
  questions: QuestionDraft[];
}

const optionId = (i: number) => String.fromCharCode(97 + i); // a, b, c ...

export const emptyQuestion = (): QuestionDraft => ({ type: 'SINGLE', prompt: '', options: ['', ''], correct: [0], tf: 'true', points: 1 });
export const emptyQuiz = (): QuizDraft => ({ title: '', passMarkPct: 70, maxAttempts: null, required: true, questions: [emptyQuestion()] });

/** Returns a list of problems; empty when the draft can be submitted. */
export function validateDraft(draft: QuizDraft): string[] {
  const problems: string[] = [];
  if (!draft.title.trim()) problems.push('Quiz title is required');
  if (draft.questions.length === 0) problems.push('Add at least one question');
  draft.questions.forEach((q, i) => {
    const n = i + 1;
    if (!q.prompt.trim()) problems.push(`Question ${n}: prompt is required`);
    if (q.type === 'TRUE_FALSE') return;
    if (q.options.length < 2 || q.options.some((o) => !o.trim())) problems.push(`Question ${n}: needs at least two non-empty options`);
    if (q.correct.length === 0) problems.push(`Question ${n}: mark a correct answer`);
    if (q.type === 'SINGLE' && q.correct.length > 1) problems.push(`Question ${n}: single-choice allows one correct answer`);
  });
  return problems;
}

export function draftToInput(draft: QuizDraft): QuizInput {
  return {
    title: draft.title.trim(),
    passMarkPct: draft.passMarkPct,
    maxAttempts: draft.maxAttempts,
    required: draft.required,
    questions: draft.questions.map((q) =>
      q.type === 'TRUE_FALSE'
        ? { type: q.type, prompt: q.prompt.trim(), options: [], correct: [q.tf], points: q.points }
        : {
            type: q.type,
            prompt: q.prompt.trim(),
            options: q.options.map((text, i) => ({ id: optionId(i), text: text.trim() })),
            correct: [...q.correct].sort().map(optionId),
            points: q.points,
          },
    ),
  };
}

export function quizToDraft(quiz: Quiz): QuizDraft {
  return {
    title: quiz.title,
    passMarkPct: quiz.passMarkPct,
    maxAttempts: quiz.maxAttempts,
    required: quiz.required,
    questions: quiz.questions.map((q) => ({
      type: q.type,
      prompt: q.prompt,
      options: q.type === 'TRUE_FALSE' ? ['', ''] : q.options.map((o) => o.text),
      correct: q.type === 'TRUE_FALSE' ? [0] : (q.correct ?? []).map((id) => q.options.findIndex((o) => o.id === id)).filter((i) => i >= 0),
      tf: q.type === 'TRUE_FALSE' && q.correct?.[0] === 'false' ? 'false' : 'true',
      points: q.points,
    })),
  };
}
