import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { buildAIFake } from "../internal/testing/ai-namespace-fake";
import { buildProofreaderInstance } from "../internal/testing/instance-fakes";
import { createProofreader } from "./create-proofreader";
import { useProofreader } from "./use-proofreader";

describe("useProofreader", () => {
  test("proofread() forwards input and resolves with the instance's ProofreadResult", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildProofreaderInstance });
    vi.stubGlobal("Proofreader", Fake);

    const { result } = await renderHook(() => useProofreader());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const proofreadResult = await result.current.proofread("helo world");
    expect(proofreadResult.correctedInput).toBe("corrected(helo world)");
    expect(proofreadResult.corrections).toHaveLength(1);
    expect(proofreadResult.corrections[0]).toMatchObject({
      startIndex: 0,
      endIndex: 5,
      correction: "Hello",
    });
  });

  test("omits inputQuota and measureInput (compile-time)", () => {
    // This arrow is never executed; tsc type-checks the accesses statically.
    void (() => {
      const proofreader = useProofreader();
      // @ts-expect-error - inputQuota is not part of ProofreaderHookReturn
      void proofreader.inputQuota;
      // @ts-expect-error - measureInput is not part of ProofreaderHookReturn
      void proofreader.measureInput;
    });
  });
});

describe("createProofreader", () => {
  test("resolves an AsyncDisposable instance delegating to the namespace", async () => {
    const { Fake, instances } = buildAIFake({
      buildInstance: buildProofreaderInstance,
    });
    vi.stubGlobal("Proofreader", Fake);

    const proofreader = await createProofreader();

    expect(proofreader).toBe(instances[0]);
    expect(
      (proofreader as unknown as Record<symbol, unknown>)[Symbol.asyncDispose],
    ).toBeTypeOf("function");
    const result = await proofreader.proofread("helo");
    expect(result.correctedInput).toBe("corrected(helo)");
  });
});
