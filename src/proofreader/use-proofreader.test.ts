import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { makeAIFake } from "../internal/testing/ai-namespace-fake";
import { buildProofreaderInstance } from "../internal/testing/instance-fakes";
import { useProofreader } from "./use-proofreader";

describe("useProofreader", () => {
  test("proofread() forwards input and resolves with the instance's ProofreadResult", async () => {
    const { Fake } = makeAIFake({ buildInstance: buildProofreaderInstance });
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
    // This arrow is never executed; tsc type-checks the accesses statically,
    // verifying inputQuota and measureInput are omitted from the return type.
    void (() => {
      const proofreader = useProofreader();
      // @ts-expect-error - inputQuota is not part of ProofreaderHookReturn
      void proofreader.inputQuota;
      // @ts-expect-error - measureInput is not part of ProofreaderHookReturn
      void proofreader.measureInput;
    });
  });
});
