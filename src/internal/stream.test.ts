import { describe, expect, test } from "vitest";
import { streamChunks } from "./stream";
import { buildChunkStream } from "./testing/stream-fake";

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of it) {
    out.push(chunk);
  }
  return out;
}

describe("streamChunks", () => {
  test("yields all chunks from a ReadableStream in order", async () => {
    const stream = buildChunkStream(["a", "b", "c"]);
    const { signal } = new AbortController();
    expect(await collect(streamChunks(stream, signal))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("releases the reader lock after the stream drains", async () => {
    const stream = buildChunkStream(["only"]);
    const { signal } = new AbortController();
    await collect(streamChunks(stream, signal));
    expect(stream.locked).toBe(false);
  });

  test("cancels the underlying source when the consumer exits the loop early", async () => {
    let cancelled = false;
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("first");
        controller.enqueue("second");
      },
      cancel() {
        cancelled = true;
      },
    });
    const { signal } = new AbortController();

    for await (const chunk of streamChunks(stream, signal)) {
      expect(chunk).toBe("first");
      break;
    }

    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });

  test("throws an AbortError when the signal is already aborted on entry", async () => {
    const stream = buildChunkStream(["a", "b"]);
    const controller = new AbortController();
    controller.abort();

    const iter = streamChunks(stream, controller.signal)[
      Symbol.asyncIterator
    ]();
    await expect(iter.next()).rejects.toMatchObject({ name: "AbortError" });
  });

  test("cancels the underlying source and releases the lock when the signal aborts mid-stream", async () => {
    // Stream emits one chunk, then hangs in `pull` so the next read is pending at abort.
    // `cancel` records the reason for assertion.
    let cancelReason: unknown;
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("first");
      },
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });
    const controller = new AbortController();
    const iter = streamChunks(stream, controller.signal)[
      Symbol.asyncIterator
    ]();

    expect((await iter.next()).value).toBe("first");

    const reason = new DOMException("done", "AbortError");
    const secondNext = iter.next();
    controller.abort(reason);

    await expect(secondNext).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelReason).toBe(reason);
    expect(stream.locked).toBe(false);
  });
});
