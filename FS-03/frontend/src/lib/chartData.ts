import type { RevenueSummary } from '../api/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#9333ea', '#0891b2', '#db2777', '#65a30d'];

/** "2026-03" -> "Mar 26" */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${year.slice(2)}`;
}

export function monthlyChartData(monthly: RevenueSummary['monthly']) {
  return {
    labels: monthly.map((m) => monthLabel(m.month)),
    datasets: [
      {
        label: 'Revenue (USD)',
        data: monthly.map((m) => m.totalCents / 100),
        backgroundColor: '#2563eb',
        borderColor: '#2563eb',
      },
    ],
  };
}

export function perCourseChartData(perCourse: RevenueSummary['perCourse']) {
  return {
    labels: perCourse.map((c) => c.title),
    datasets: [
      {
        label: 'Revenue (USD)',
        data: perCourse.map((c) => c.totalCents / 100),
        backgroundColor: perCourse.map((_, i) => PALETTE[i % PALETTE.length]),
      },
    ],
  };
}
