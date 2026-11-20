export interface ProgressInput {
  lessonIds: string[]; // ordered by curriculum position
  completedLessonIds: string[];
  lastViewedLessonId?: string | null;
}

export interface CourseProgress {
  totalLessons: number;
  completedLessons: number;
  percent: number;
  resumeLessonId: string | null;
}

export function calculateProgress({ lessonIds, completedLessonIds, lastViewedLessonId }: ProgressInput): CourseProgress {
  const total = lessonIds.length;
  const done = new Set(completedLessonIds.filter((id) => lessonIds.includes(id)));
  const percent = total === 0 ? 0 : Math.round((done.size / total) * 100);
  const firstIncomplete = lessonIds.find((id) => !done.has(id)) ?? null;
  // Resume where the learner last was, unless it is already completed - then continue with the next open lesson.
  const resume =
    lastViewedLessonId && lessonIds.includes(lastViewedLessonId) && !done.has(lastViewedLessonId)
      ? lastViewedLessonId
      : firstIncomplete;
  return { totalLessons: total, completedLessons: done.size, percent, resumeLessonId: resume };
}

export interface CompletionInput {
  lessonIds: string[];
  completedLessonIds: string[];
  requiredQuizIds: string[];
  passedQuizIds: string[];
}

export interface CompletionStatus {
  complete: boolean;
  missingLessons: number;
  missingQuizzes: number;
}

/** A course is complete when it has lessons, all of them are done and every required quiz was passed. */
export function evaluateCompletion(input: CompletionInput): CompletionStatus {
  const done = new Set(input.completedLessonIds);
  const passed = new Set(input.passedQuizIds);
  const missingLessons = input.lessonIds.filter((id) => !done.has(id)).length;
  const missingQuizzes = input.requiredQuizIds.filter((id) => !passed.has(id)).length;
  return {
    complete: input.lessonIds.length > 0 && missingLessons === 0 && missingQuizzes === 0,
    missingLessons,
    missingQuizzes,
  };
}
