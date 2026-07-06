import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { buildAIFake } from "../internal/testing/ai-namespace-fake";
import { buildWriterInstance } from "../internal/testing/instance-fakes";
import { createWriter } from "./create-writer";
import { useWriter } from "./use-writer";

describe("useWriter", () => {
  test("exposes the instance's inputQuota once ready", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildWriterInstance });
    vi.stubGlobal("Writer", Fake);

    const { result } = await renderHook(() => useWriter({ tone: "formal" }));

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.inputQuota).toBe(1536);
  });

  test("write() forwards input and context, resolving with the instance's result", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildWriterInstance });
    vi.stubGlobal("Writer", Fake);

    const { result } = await renderHook(() => useWriter());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(
      result.current.write("hello", { context: "polite" }),
    ).resolves.toBe("W(polite):hello");
  });

  test("writeStream() yields the instance's chunks", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildWriterInstance });
    vi.stubGlobal("Writer", Fake);

    const { result } = await renderHook(() => useWriter());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const chunks: string[] = [];
    for await (const c of result.current.writeStream("hi")) {
      chunks.push(c);
    }
    expect(chunks).toEqual(["W:", "draft"]);
  });

  test("measureInput() forwards input and context to the instance", async () => {
    const { Fake, instances } = buildAIFake({
      buildInstance: buildWriterInstance,
    });
    vi.stubGlobal("Writer", Fake);

    const { result } = await renderHook(() => useWriter());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(
      result.current.measureInput("hi", { context: "polite" }),
    ).resolves.toBe(6);
    expect(instances[0].measureInputUsage).toHaveBeenCalledWith(
      "hi",
      expect.objectContaining({ context: "polite" }),
    );
  });
});

describe("createWriter", () => {
  test("resolves an AsyncDisposable instance delegating to the namespace", async () => {
    const { Fake, instances } = buildAIFake({
      buildInstance: buildWriterInstance,
    });
    vi.stubGlobal("Writer", Fake);

    const writer = await createWriter();

    expect(writer).toBe(instances[0]);
    expect(
      (writer as unknown as Record<symbol, unknown>)[Symbol.asyncDispose],
    ).toBeTypeOf("function");
    await expect(writer.write("draft")).resolves.toBe("W():draft");
  });
});
