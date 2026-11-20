import { vi, type Mock } from 'vitest';

type Delegate = Record<string, Mock>;
export type PrismaMock = Record<string, Delegate> & { $transaction: Mock };

const delegates = new Map<string, Delegate>();

const delegate = (model: string): Delegate => {
  let d = delegates.get(model);
  if (!d) {
    const fns = new Map<string, Mock>();
    d = new Proxy({} as Delegate, {
      get: (_t, method: string) => {
        let fn = fns.get(method);
        if (!fn) {
          fn = vi.fn();
          fns.set(method, fn);
        }
        return fn;
      },
    });
    delegates.set(model, d);
  }
  return d;
};

export const prismaMock: PrismaMock = new Proxy({} as PrismaMock, {
  get: (_t, prop: string) => (prop === '$transaction' ? transaction : delegate(prop)),
}) as PrismaMock;

// Interactive transactions receive the mock itself; array transactions resolve their promises.
const transaction = vi.fn();
const installTransaction = () =>
  transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
installTransaction();

/** Resets every model method mock; call in beforeEach. */
export function resetPrismaMock(): void {
  for (const d of delegates.values()) {
    for (const key of ['findMany', 'findFirst', 'findUnique', 'count', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      d[key].mockReset();
    }
  }
  transaction.mockReset();
  installTransaction();
}
