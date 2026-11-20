export interface SplitResult {
  amountCents: number;
  instructorShareCents: number;
  platformFeeCents: number;
}

/** Splits a payment. The instructor share is rounded down so the platform keeps the odd cent; both always sum to the total. */
export function splitRevenue(amountCents: number, instructorSharePct: number): SplitResult {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error('amountCents must be a non-negative integer');
  if (instructorSharePct < 0 || instructorSharePct > 100) throw new Error('instructorSharePct must be 0-100');
  const instructorShareCents = Math.floor((amountCents * instructorSharePct) / 100);
  return { amountCents, instructorShareCents, platformFeeCents: amountCents - instructorShareCents };
}

export interface PaymentRow {
  courseId: string;
  courseTitle: string;
  instructorShareCents: number;
  createdAt: Date;
}

export interface RevenueSummary {
  totalCents: number;
  last30DaysCents: number;
  perCourse: { courseId: string; title: string; totalCents: number; sales: number }[];
  monthly: { month: string; totalCents: number }[];
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Aggregates completed payments into the figures used by the revenue dashboard (monthly series is zero-filled). */
export function buildRevenueSummary(payments: PaymentRow[], now: Date = new Date(), months = 12): RevenueSummary {
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  let totalCents = 0;
  let last30DaysCents = 0;
  const perCourse = new Map<string, { courseId: string; title: string; totalCents: number; sales: number }>();
  const monthly = new Map<string, number>();

  for (let i = months - 1; i >= 0; i--) {
    monthly.set(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))), 0);
  }

  for (const p of payments) {
    totalCents += p.instructorShareCents;
    if (p.createdAt.getTime() >= cutoff) last30DaysCents += p.instructorShareCents;
    const entry = perCourse.get(p.courseId) ?? { courseId: p.courseId, title: p.courseTitle, totalCents: 0, sales: 0 };
    entry.totalCents += p.instructorShareCents;
    entry.sales += 1;
    perCourse.set(p.courseId, entry);
    const key = monthKey(p.createdAt);
    if (monthly.has(key)) monthly.set(key, (monthly.get(key) ?? 0) + p.instructorShareCents);
  }

  return {
    totalCents,
    last30DaysCents,
    perCourse: [...perCourse.values()].sort((a, b) => b.totalCents - a.totalCents),
    monthly: [...monthly.entries()].map(([month, total]) => ({ month, totalCents: total })),
  };
}
