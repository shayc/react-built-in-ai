import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { makeAIFake } from "../internal/testing/ai-namespace-fake";
import { buildSummarizerInstance } from "../internal/testing/instance-fakes";
import { useSummarizer } from "./use-summarizer";

describe("useSummarizer", () => {
  test("reaches ready and exposes inputQuota from the instance", async () => {
    const { Fake } = makeAIFake({ buildInstance: buildSummarizerInstance });
    vi.stubGlobal("Summarizer", Fake);

    const { result } = await renderHook(() =>
      useSummarizer({ type: "key-points" }),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.inputQuota).toBe(2048);
  });

  test("summarize() forwards both input and context to the instance", async () => {
    const { Fake } = makeAIFake({ buildInstance: buildSummarizerInstance });
    vi.stubGlobal("Summarizer", Fake);

    const { result } = await renderHook(() => useSummarizer());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(
      result.current.summarize("hello", { context: "brief" }),
    ).resolves.toBe("S(brief):hello");
  });

  test("summarizeStream() yields all chunks from the streaming source", async () => {
    const { Fake } = makeAIFake({ buildInstance: buildSummarizerInstance });
    vi.stubGlobal("Summarizer", Fake);

    const { result } = await renderHook(() => useSummarizer());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const out: string[] = [];
    for await (const c of result.current.summarizeStream("hi")) {
      out.push(c);
    }
    expect(out).toEqual(["S:", "sum"]);
  });

  test("useSummarizer options argument is optional (compile-time)", () => {
    // Arrow is never invoked — runtime skipped; tsc still type-checks the calls.
    void (() => useSummarizer());
    void (() => useSummarizer(undefined));
  });
});
