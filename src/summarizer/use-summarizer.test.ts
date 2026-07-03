import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { buildAIFake } from "../internal/testing/ai-namespace-fake";
import { buildSummarizerInstance } from "../internal/testing/instance-fakes";
import { useSummarizer } from "./use-summarizer";

describe("useSummarizer", () => {
  test("exposes the instance's inputQuota once ready", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildSummarizerInstance });
    vi.stubGlobal("Summarizer", Fake);

    const { result } = await renderHook(() =>
      useSummarizer({ type: "key-points" }),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.inputQuota).toBe(2048);
  });

  test("summarize() forwards input and context, resolving with the instance's result", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildSummarizerInstance });
    vi.stubGlobal("Summarizer", Fake);

    const { result } = await renderHook(() => useSummarizer());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(
      result.current.summarize("hello", { context: "brief" }),
    ).resolves.toBe("S(brief):hello");
  });

  test("summarizeStream() yields the instance's chunks", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildSummarizerInstance });
    vi.stubGlobal("Summarizer", Fake);

    const { result } = await renderHook(() => useSummarizer());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const chunks: string[] = [];
    for await (const c of result.current.summarizeStream("hi")) {
      chunks.push(c);
    }
    expect(chunks).toEqual(["S:", "sum"]);
  });

  test("measureInput() forwards input and context to the instance", async () => {
    const { Fake, instances } = buildAIFake({
      buildInstance: buildSummarizerInstance,
    });
    vi.stubGlobal("Summarizer", Fake);

    const { result } = await renderHook(() => useSummarizer());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(
      result.current.measureInput("hi", { context: "brief" }),
    ).resolves.toBe(5);
    expect(instances[0].measureInputUsage).toHaveBeenCalledWith(
      "hi",
      expect.objectContaining({ context: "brief" }),
    );
  });
});
