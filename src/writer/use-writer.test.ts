import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { makeAIFake } from "../internal/testing/ai-namespace-fake";
import { buildWriterInstance } from "../internal/testing/instance-fakes";
import { useWriter } from "./use-writer";

describe("useWriter", () => {
  test("reaches ready and exposes inputQuota from the instance", async () => {
    const { Fake } = makeAIFake({ buildInstance: buildWriterInstance });
    vi.stubGlobal("Writer", Fake);

    const { result } = await renderHook(() => useWriter({ tone: "formal" }));

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.inputQuota).toBe(1536);
  });

  test("write() forwards both input and context to the instance", async () => {
    const { Fake } = makeAIFake({ buildInstance: buildWriterInstance });
    vi.stubGlobal("Writer", Fake);

    const { result } = await renderHook(() => useWriter());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(
      result.current.write("hello", { context: "polite" }),
    ).resolves.toBe("W(polite):hello");
  });

  test("writeStream() yields all chunks from the streaming source", async () => {
    const { Fake } = makeAIFake({ buildInstance: buildWriterInstance });
    vi.stubGlobal("Writer", Fake);

    const { result } = await renderHook(() => useWriter());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const out: string[] = [];
    for await (const c of result.current.writeStream("hi")) {
      out.push(c);
    }
    expect(out).toEqual(["W:", "draft"]);
  });

  test("useWriter options argument is optional (compile-time)", () => {
    // Arrow is never invoked — runtime skipped; tsc still type-checks the calls.
    void (() => useWriter());
    void (() => useWriter(undefined));
  });
});
