/**
 * Quiz auto-grading (pure, no I/O).
 *
 * Rules:
 *  - SINGLE / TRUE_FALSE: all-or-nothing. Exactly one selected option equal to the correct one => full points.
 *    Selecting more than one option for a single-answer question scores 0.
 *  - MULTIPLE: partial credit with a wrong-answer penalty.
 *      credit = max(0, (correctSelected - wrongSelected) / totalCorrect)
 *    e.g. correct = [a,c]; picking [a] => 0.5; [a,c] => 1; [a,b] => 0; [a,c,b] => 0.5.
 *    Credit is multiplied by the question's points and rounded to 2 decimals.
 *  - Unanswered questions score 0. Unknown option ids and duplicates are ignored.
 *  - A quiz with no (or zero-point) questions can never be passed.
 *  - percent = score / maxScore * 100 (rounded to 2 decimals); passed = percent >= passMarkPct.
 */

export type QuestionKind = 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE';

export interface GradableQuestion {
  id: string;
  type: QuestionKind;
  options: { id: string; text: string }[];
  correct: string[];
  points: number;
}

export type AnswerMap = Record<string, string[] | string | undefined>;

export interface QuestionResult {
  questionId: string;
  earned: number;
  possible: number;
  correct: boolean;
}

export interface GradeResult {
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  results: QuestionResult[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function normalise(answer: string[] | string | undefined, validIds: Set<string>): string[] {
  if (answer === undefined || answer === null) return [];
  const list = Array.isArray(answer) ? answer : [answer];
  return [...new Set(list.map(String))].filter((id) => validIds.has(id));
}

export function gradeQuestion(question: GradableQuestion, answer: string[] | string | undefined): QuestionResult {
  const validIds =
    question.type === 'TRUE_FALSE' ? new Set(['true', 'false']) : new Set(question.options.map((o) => o.id));
  const selected = normalise(answer, validIds);
  const correct = [...new Set(question.correct)];
  const possible = question.points;
  let credit = 0;

  if (selected.length > 0 && correct.length > 0) {
    if (question.type === 'MULTIPLE') {
      const right = selected.filter((id) => correct.includes(id)).length;
      const wrong = selected.length - right;
      credit = Math.max(0, (right - wrong) / correct.length);
    } else {
      credit = selected.length === 1 && correct.includes(selected[0]) ? 1 : 0;
    }
  }

  return {
    questionId: question.id,
    earned: round2(credit * possible),
    possible,
    correct: credit === 1,
  };
}

export function gradeAttempt(questions: GradableQuestion[], answers: AnswerMap, passMarkPct: number): GradeResult {
  const results = questions.map((q) => gradeQuestion(q, answers[q.id]));
  const score = round2(results.reduce((sum, r) => sum + r.earned, 0));
  const maxScore = results.reduce((sum, r) => sum + r.possible, 0);
  const percent = maxScore > 0 ? round2((score / maxScore) * 100) : 0;
  return { score, maxScore, percent, passed: maxScore > 0 && percent >= passMarkPct, results };
}

export function attemptsRemaining(maxAttempts: number | null | undefined, used: number): number | null {
  if (maxAttempts === null || maxAttempts === undefined) return null; // unlimited
  return Math.max(0, maxAttempts - used);
}

export function canAttempt(maxAttempts: number | null | undefined, used: number): boolean {
  const remaining = attemptsRemaining(maxAttempts, used);
  return remaining === null || remaining > 0;
}
