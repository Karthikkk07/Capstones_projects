export type Role = 'STUDENT' | 'INSTRUCTOR' | 'ADMIN';
export type VideoStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
export type QuestionType = 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  description: string;
  priceCents: number;
  status: 'DRAFT' | 'PUBLISHED';
  category: string;
  thumbnail: string | null;
  instructorId: string;
  instructor?: { id: string; name: string };
  _count?: { lessons: number; enrollments: number };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface LessonSummary {
  id: string;
  title: string;
  position: number;
  type: 'VIDEO' | 'TEXT';
  durationSec: number | null;
  videoStatus: VideoStatus;
}

export interface Section {
  id: string;
  title: string;
  position: number;
  lessons: LessonSummary[];
}

export interface QuizSummary {
  id: string;
  title: string;
  lessonId: string | null;
  required: boolean;
  passMarkPct: number;
  maxAttempts: number | null;
}

export interface CourseDetail extends Course {
  sections: Section[];
  quizzes: QuizSummary[];
  enrolled: boolean;
  canManage: boolean;
}

export interface Lesson extends LessonSummary {
  courseId: string;
  content: string | null;
  progress: { completed: boolean; positionSec: number } | null;
}

export interface Playback {
  lessonId: string;
  url: string;
  strategy: string;
  expiresAt?: string;
}

export interface CourseProgress {
  totalLessons: number;
  completedLessons: number;
  percent: number;
  resumeLessonId: string | null;
  lessons?: { lessonId: string; completed: boolean; positionSec: number }[];
}

export interface Enrollment {
  id: string;
  courseId: string;
  course: { id: string; title: string; slug: string; thumbnail: string | null; category: string; instructor: { name: string } };
  progress: CourseProgress;
}

export interface Certificate {
  id: string;
  code: string;
  issuedAt: string;
  course: { id: string; title: string };
}

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options: { id: string; text: string }[];
  points: number;
  correct?: string[];
}

export interface Quiz extends QuizSummary {
  courseId: string;
  questions: QuizQuestion[];
}

export interface QuizListItem extends QuizSummary {
  attemptsUsed: number;
  attemptsRemaining: number | null;
  passed: boolean;
  bestPercent: number;
  _count: { questions: number };
}

export interface AttemptResult {
  attemptId: string;
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  passMarkPct: number;
  attemptsRemaining: number | null;
  results: { questionId: string; earned: number; possible: number; correct: boolean }[];
  certificate: Certificate | null;
}

export interface QuizInput {
  title: string;
  passMarkPct: number;
  maxAttempts: number | null;
  required: boolean;
  questions: { type: QuestionType; prompt: string; options: { id: string; text: string }[]; correct: string[]; points: number }[];
}

export interface LiveClass {
  id: string;
  courseId: string;
  title: string;
  scheduledAt: string;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED';
  roomName: string;
  course?: { id: string; title: string };
  isHost?: boolean;
}

export interface LiveToken {
  token: string;
  url: string;
  roomName: string;
  role: 'host' | 'viewer';
}

export interface ChatMessage {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string; role: Role };
}

export interface RevenueSummary {
  totalCents: number;
  last30DaysCents: number;
  perCourse: { courseId: string; title: string; totalCents: number; sales: number }[];
  monthly: { month: string; totalCents: number }[];
}

export interface Payout {
  id: string;
  amountCents: number;
  status: 'PENDING' | 'PAID';
  createdAt: string;
  paidAt: string | null;
}

export interface CertificateVerification {
  valid: boolean;
  code: string;
  studentName: string;
  courseTitle: string;
  issuedAt: string;
}
