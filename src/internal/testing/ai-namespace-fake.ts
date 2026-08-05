import { vi, type Mock } from "vitest";

interface AIFake<I> {
  Fake: { availability: Mock; create: Mock };
  create: Mock;
  instances: I[];
}

interface BuildAIFakeOptions<I> {
  status?: Availability;
  buildInstance: () => I;
  failCreate?: Error;
}

/**
 * Minimal fake for any built-in AI namespace — common path only. Tests needing
 * exotic timing (manual create resolution, monitor wiring, etc.) compose inline.
 *
 * @internal
 */
export function buildAIFake<I>({
  status = "available",
  buildInstance,
  failCreate,
}: BuildAIFakeOptions<I>): AIFake<I> {
  const instances: I[] = [];
  const availability = vi.fn(() => Promise.resolve(status));
  const create = vi.fn(() => {
    if (failCreate) {
      return Promise.reject(failCreate);
    }
    const inst = buildInstance();
    instances.push(inst);
    return Promise.resolve(inst);
  });
  return {
    Fake: { availability, create },
    create,
    instances,
  };
}
