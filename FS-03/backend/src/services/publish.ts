interface PublishableCourse {
  title: string;
  description: string;
  priceCents: number;
  sections: {
    title: string;
    lessons: { title: string; type: 'VIDEO' | 'TEXT'; videoStatus: string; content?: string | null }[];
  }[];
}

export const MIN_PAID_PRICE_CENTS = 50; // Stripe minimum charge

/** Returns a list of human-readable problems; empty list => the course can be published. */
export function validateForPublish(course: PublishableCourse): string[] {
  const problems: string[] = [];
  if (course.title.trim().length < 3) problems.push('Title must be at least 3 characters');
  if (course.description.trim().length < 20) problems.push('Description must be at least 20 characters');
  if (course.priceCents > 0 && course.priceCents < MIN_PAID_PRICE_CENTS) {
    problems.push(`Paid courses must cost at least ${MIN_PAID_PRICE_CENTS} cents`);
  }
  const lessons = course.sections.flatMap((s) => s.lessons);
  if (lessons.length === 0) problems.push('Add at least one lesson');
  for (const s of course.sections) {
    if (s.lessons.length === 0) problems.push(`Section "${s.title}" has no lessons`);
  }
  for (const l of lessons) {
    if (l.type === 'VIDEO' && l.videoStatus !== 'READY') problems.push(`Video lesson "${l.title}" is not processed yet (${l.videoStatus})`);
    if (l.type === 'TEXT' && !l.content?.trim()) problems.push(`Text lesson "${l.title}" has no content`);
  }
  return problems;
}
