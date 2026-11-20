import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AttemptResult } from '../api/types';
import { errorMessage, useAsync } from '../lib/useAsync';

export function QuizPage() {
  const { id = '' } = useParams();
  const quiz = useAsync(() => api.getQuiz(id), [id]);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (quiz.loading && !quiz.data) return <p className="muted">Loading quiz…</p>;
  if (quiz.error || !quiz.data) return <p className="error">{quiz.error ?? 'Quiz not found'}</p>;
  const q = quiz.data;

  function toggle(questionId: string, optionId: string, multiple: boolean) {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      if (!multiple) return { ...prev, [questionId]: [optionId] };
      return { ...prev, [questionId]: current.includes(optionId) ? current.filter((o) => o !== optionId) : [...current, optionId] };
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.submitQuiz(id, answers));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    setAnswers({});
    setResult(null);
  }

  const resultFor = (questionId: string) => result?.results.find((r) => r.questionId === questionId);

  return (
    <div className="narrow-wide">
      <Link to={`/learn/${q.courseId}`}>← Back to course</Link>
      <h1>{q.title}</h1>
      <p className="muted">
        Pass mark {q.passMarkPct}% · {q.maxAttempts ? `${q.maxAttempts} attempts max` : 'unlimited attempts'}
      </p>
      {error && <p className="error">{error}</p>}

      {result && (
        <div className={`card result ${result.passed ? 'pass' : 'fail'}`}>
          <h2>{result.passed ? 'Passed 🎉' : 'Not passed yet'}</h2>
          <p>
            Score {result.score}/{result.maxScore} ({result.percent}%). Required: {result.passMarkPct}%.
          </p>
          {result.attemptsRemaining !== null && <p className="muted">{result.attemptsRemaining} attempt(s) remaining.</p>}
          {result.certificate && <p>Certificate issued: <strong>{result.certificate.code}</strong></p>}
          {!result.passed && (result.attemptsRemaining === null || result.attemptsRemaining > 0) && (
            <button className="btn" onClick={retry}>
              Try again
            </button>
          )}
        </div>
      )}

      {q.questions.map((question, i) => {
        const multiple = question.type === 'MULTIPLE';
        const r = resultFor(question.id);
        return (
          <fieldset key={question.id} className={`card question ${r ? (r.correct ? 'correct' : 'incorrect') : ''}`} disabled={Boolean(result)}>
            <legend>
              {i + 1}. {question.prompt} <span className="muted">({question.points} pt{question.points > 1 ? 's' : ''})</span>
            </legend>
            {multiple && <p className="muted">Select all that apply</p>}
            {question.options.map((o) => (
              <label key={o.id} className="option">
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={question.id}
                  checked={(answers[question.id] ?? []).includes(o.id)}
                  onChange={() => toggle(question.id, o.id, multiple)}
                />
                {o.text}
              </label>
            ))}
            {r && (
              <p className="muted">
                {r.earned}/{r.possible} points
              </p>
            )}
          </fieldset>
        );
      })}

      {!result && (
        <button className="btn" onClick={submit} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit answers'}
        </button>
      )}
    </div>
  );
}
