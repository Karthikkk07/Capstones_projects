import { describe, expect, it } from 'vitest';
import { buildRevenueSummary, splitRevenue } from '../src/services/revenue';

describe('splitRevenue', () => {
  it('splits 80/20 and always sums to the total', () => {
    expect(splitRevenue(10_000, 80)).toEqual({ amountCents: 10_000, instructorShareCents: 8_000, platformFeeCents: 2_000 });
    const odd = splitRevenue(999, 80);
    expect(odd.instructorShareCents).toBe(799); // floored, platform keeps the odd cent
    expect(odd.instructorShareCents + odd.platformFeeCents).toBe(999);
  });

  it('honours a configurable percentage and handles edge values', () => {
    expect(splitRevenue(1000, 70).instructorShareCents).toBe(700);
    expect(splitRevenue(0, 80)).toMatchObject({ instructorShareCents: 0, platformFeeCents: 0 });
    expect(splitRevenue(500, 100).platformFeeCents).toBe(0);
  });

  it('rejects invalid input', () => {
    expect(() => splitRevenue(-1, 80)).toThrow();
    expect(() => splitRevenue(10.5, 80)).toThrow();
    expect(() => splitRevenue(100, 101)).toThrow();
  });
});

describe('buildRevenueSummary', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const rows = [
    { courseId: 'c1', courseTitle: 'Course 1', instructorShareCents: 800, createdAt: new Date('2026-06-10T00:00:00Z') },
    { courseId: 'c1', courseTitle: 'Course 1', instructorShareCents: 800, createdAt: new Date('2026-04-01T00:00:00Z') },
    { courseId: 'c2', courseTitle: 'Course 2', instructorShareCents: 2400, createdAt: new Date('2026-05-20T00:00:00Z') },
  ];

  it('totals, last-30-days and per-course figures', () => {
    const s = buildRevenueSummary(rows, now);
    expect(s.totalCents).toBe(4000);
    expect(s.last30DaysCents).toBe(3200); // Jun 10 + May 20 (26 days ago)
    expect(s.perCourse).toEqual([
      { courseId: 'c2', title: 'Course 2', totalCents: 2400, sales: 1 },
      { courseId: 'c1', title: 'Course 1', totalCents: 1600, sales: 2 },
    ]);
  });

  it('returns a zero-filled monthly series ending at the current month', () => {
    const s = buildRevenueSummary(rows, now);
    expect(s.monthly).toHaveLength(12);
    expect(s.monthly[11]).toEqual({ month: '2026-06', totalCents: 800 });
    expect(s.monthly.find((m) => m.month === '2026-05')?.totalCents).toBe(2400);
    expect(s.monthly.find((m) => m.month === '2026-03')?.totalCents).toBe(0);
  });

  it('handles no payments', () => {
    expect(buildRevenueSummary([], now)).toMatchObject({ totalCents: 0, last30DaysCents: 0, perCourse: [] });
  });
});
