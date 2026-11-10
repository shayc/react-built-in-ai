import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { buildAIFake } from "../internal/testing/ai-namespace-fake";
import { buildRewriterInstance } from "../internal/testing/instance-fakes";
import { createRewriter } from "./create-rewriter";
import { useRewriter } from "./use-rewriter";

describe("useRewriter", () => {
  test("exposes the instance's inputQuota once ready", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildRewriterInstance });
    vi.stubGlobal("Rewriter", Fake);

    const { result } = await renderHook(() =>
      useRewriter({ tone: "more-formal" }),
    );

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.inputQuota).toBe(768);
  });

  test("rewrite() forwards input and context, resolving with the instance's result", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildRewriterInstance });
    vi.stubGlobal("Rewriter", Fake);

    const { result } = await renderHook(() => useRewriter());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(
      result.current.rewrite("hello", { context: "softer" }),
    ).resolves.toBe("R(softer):hello");
  });

  test("rewriteStream() yields the instance's chunks", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildRewriterInstance });
    vi.stubGlobal("Rewriter", Fake);

    const { result } = await renderHook(() => useRewriter());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const chunks: string[] = [];
    for await (const c of result.current.rewriteStream("hi")) {
      chunks.push(c);
    }
    expect(chunks).toEqual(["R:", "alt"]);
  });

  test("measureInput() forwards input and context to the instance", async () => {
    const { Fake, instances } = buildAIFake({
      buildInstance: buildRewriterInstance,
    });
    vi.stubGlobal("Rewriter", Fake);

    const { result } = await renderHook(() => useRewriter());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(
      result.current.measureInput("hi", { context: "softer" }),
    ).resolves.toBe(4);
    expect(instances[0].measureInputUsage).toHaveBeenCalledWith(
      "hi",
      expect.objectContaining({ context: "softer" }),
    );
  });
});

describe("createRewriter", () => {
  test("resolves an AsyncDisposable instance delegating to the namespace", async () => {
    const { Fake, instances } = buildAIFake({
      buildInstance: buildRewriterInstance,
    });
    vi.stubGlobal("Rewriter", Fake);

    const rewriter = await createRewriter();

    expect(rewriter).toBe(instances[0]);
    expect(
      (rewriter as unknown as Record<symbol, unknown>)[Symbol.asyncDispose],
    ).toBeTypeOf("function");
    await expect(rewriter.rewrite("draft")).resolves.toBe("R():draft");
  });

  test("reports a download to onDownloadProgress without forwarding it to Rewriter.create()", async () => {
    const { Fake, create } = buildAIFake({
      status: "downloading",
      buildInstance: buildRewriterInstance,
    });
    vi.stubGlobal("Rewriter", Fake);
    const onDownloadProgress = vi.fn();
    const controller = new AbortController();

    await createRewriter({ signal: controller.signal, onDownloadProgress });

    expect(onDownloadProgress.mock.calls).toEqual([[0]]);
    const [createArg] = create.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(createArg).not.toHaveProperty("onDownloadProgress");
    expect(createArg.signal).toBe(controller.signal);
    const [availabilityArg] = Fake.availability.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(availabilityArg).not.toHaveProperty("onDownloadProgress");
  });
});
