import type { Plan } from '@prisma/client';

export interface PlanConfig {
  name: string;
  price: string;
  maxProjects: number | null; // null = unlimited
  maxMembers: number | null;
}

export const PLANS: Record<Plan, PlanConfig> = {
  FREE: { name: 'Free', price: '$0 / month', maxProjects: 1, maxMembers: 3 },
  PRO: { name: 'Pro', price: '$12 / user / month', maxProjects: 10, maxMembers: 25 },
  BUSINESS: { name: 'Business', price: '$29 / user / month', maxProjects: null, maxMembers: null },
};

export type LimitedResource = 'projects' | 'members';

export const PAID_PLANS: Plan[] = ['PRO', 'BUSINESS'];
