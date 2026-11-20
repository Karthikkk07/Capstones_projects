import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { QuestionType } from '../api/types';
import { type QuizDraft, type QuestionDraft, draftToInput, emptyQuestion, emptyQuiz, quizToDraft, validateDraft } from '../lib/quizDraft';
import { errorMessage } from '../lib/useAsync';

interface Props {
  courseId: string;
  quizId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function QuizBuilder({ courseId, quizId, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState<QuizDraft>(emptyQuiz);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!quizId) return;
    api.getQuiz(quizId).then((q) => setDraft(quizToDraft(q))).catch((e) => setError(errorMessage(e)));
  }, [quizId]);

  const patchQuestion = (i: number, patch: Partial<QuestionDraft>) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)) }));

  function changeType(i: number, type: QuestionType) {
    patchQuestion(i, { type, correct: type === 'MULTIPLE' ? [] : [0] });
  }

  function toggleCorrect(i: number, optionIndex: number) {
    const q = draft.questions[i];
    if (q.type === 'SINGLE') return patchQuestion(i, { correct: [optionIndex] });
    patchQuestion(i, { correct: q.correct.includes(optionIndex) ? q.correct.filter((c) => c !== optionIndex) : [...q.correct, optionIndex] });
  }

  async function save() {
    const found = validateDraft(draft);
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    setError(null);
    try {
      const input = draftToInput(draft);
      if (quizId) await api.updateQuiz(quizId, input);
      else await api.createQuiz(courseId, input);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card form">
      <h3>{quizId ? 'Edit quiz' : 'New quiz'}</h3>
      <label>
        Title
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </label>
      <div className="row">
        <label>
          Pass mark (%)
          <input type="number" min={1} max={100} value={draft.passMarkPct} onChange={(e) => setDraft({ ...draft, passMarkPct: Number(e.target.value) })} />
        </label>
        <label>
          Max attempts (empty = unlimited)
          <input
            type="number"
            min={1}
            value={draft.maxAttempts ?? ''}
            onChange={(e) => setDraft({ ...draft, maxAttempts: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />
          Required for certificate
        </label>
      </div>

      {draft.questions.map((q, i) => (
        <fieldset key={i} className="card">
          <legend>Question {i + 1}</legend>
          <div className="row">
            <select value={q.type} onChange={(e) => changeType(i, e.target.value as QuestionType)} aria-label={`Question ${i + 1} type`}>
              <option value="SINGLE">Single choice</option>
              <option value="MULTIPLE">Multiple choice</option>
              <option value="TRUE_FALSE">True / False</option>
            </select>
            <input
              type="number"
              min={1}
              value={q.points}
              onChange={(e) => patchQuestion(i, { points: Number(e.target.value) })}
              aria-label={`Question ${i + 1} points`}
              title="Points"
            />
            <button className="btn btn-ghost btn-small" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, idx) => idx !== i) })}>
              Remove
            </button>
          </div>
          <input placeholder="Question prompt" value={q.prompt} onChange={(e) => patchQuestion(i, { prompt: e.target.value })} aria-label={`Question ${i + 1} prompt`} />

          {q.type === 'TRUE_FALSE' ? (
            <div className="row">
              {(['true', 'false'] as const).map((v) => (
                <label key={v} className="check">
                  <input type="radio" name={`tf-${i}`} checked={q.tf === v} onChange={() => patchQuestion(i, { tf: v })} />
                  {v === 'true' ? 'True' : 'False'} is correct
                </label>
              ))}
            </div>
          ) : (
            <>
              {q.options.map((text, oi) => (
                <div key={oi} className="row">
                  <input
                    type={q.type === 'SINGLE' ? 'radio' : 'checkbox'}
                    name={`correct-${i}`}
                    checked={q.correct.includes(oi)}
                    onChange={() => toggleCorrect(i, oi)}
                    aria-label={`Option ${oi + 1} is correct`}
                  />
                  <input
                    value={text}
                    placeholder={`Option ${oi + 1}`}
                    onChange={(e) => patchQuestion(i, { options: q.options.map((o, idx) => (idx === oi ? e.target.value : o)) })}
                  />
                  {q.options.length > 2 && (
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={() => patchQuestion(i, { options: q.options.filter((_, idx) => idx !== oi), correct: q.correct.filter((c) => c !== oi).map((c) => (c > oi ? c - 1 : c)) })}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {q.options.length < 8 && (
                <button className="btn btn-ghost btn-small" onClick={() => patchQuestion(i, { options: [...q.options, ''] })}>
                  + Add option
                </button>
              )}
            </>
          )}
        </fieldset>
      ))}

      <button className="btn btn-ghost" onClick={() => setDraft({ ...draft, questions: [...draft.questions, emptyQuestion()] })}>
        + Add question
      </button>
      {problems.length > 0 && (
        <ul className="error">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save quiz'}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
