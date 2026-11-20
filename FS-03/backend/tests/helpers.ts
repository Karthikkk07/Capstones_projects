import { vi } from 'vitest';
import { signToken } from '../src/lib/jwt';

type MockFn = ReturnType<typeof vi.fn>;
type ModelMock = Record<string, MockFn>;

/** Auto-vivifying Prisma mock: any `prisma.<model>.<method>` is a vi.fn() created on first access. */
const models: Record<string, ModelMock> = {};
const topLevel: Record<string, MockFn> = {};

export const prismaMock: any = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (prop === 'then') return undefined;
      if (prop.startsWith('$')) return (topLevel[prop] ??= vi.fn());
      return (models[prop] ??= new Proxy({} as ModelMock, {
        get(m, method: string) {
          if (method === 'then') return undefined;
          return (m[method] ??= vi.fn());
        },
      }));
    },
  },
);

export function resetPrismaMock() {
  for (const model of Object.values(models)) for (const fn of Object.values(model)) fn.mockReset();
  for (const fn of Object.values(topLevel)) fn.mockReset();
  prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
}

export const authHeader = (id: string, role: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN') => ({
  Authorization: `Bearer ${signToken({ id, role })}`,
});
