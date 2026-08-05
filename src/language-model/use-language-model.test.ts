import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import {
  __resetForTests,
  __sizeForTests,
  snapshotDownloadProgress,
} from "../internal/lifecycle/registry";
import { abortError } from "../internal/signal";
import { buildAIFake } from "../internal/testing/ai-namespace-fake";
import { buildLanguageModelInstance } from "../internal/testing/instance-fakes";
import { useGlobalDownloadProgress } from "../use-global-download-progress";
import { createLanguageModel } from "./create-language-model";
import {
  useLanguageModel,
  type LanguageModelOptions,
} from "./use-language-model";

type LMInstance = ReturnType<typeof buildLanguageModelInstance>;

function setUserActivation(isActive: boolean): void {
  Object.defineProperty(navigator, "userActivation", {
    value: { isActive },
    configurable: true,
  });
}

function system(content: string): LanguageModelOptions {
  return { initialPrompts: [{ role: "system", content }] };
}

/**
 * Like `buildLanguageModelInstance`, but `prompt("hang")` stays pending until
 * its signal aborts — for the reset/unmount-during-in-flight races, where the
 * shared fake's instant resolution would settle before the abort can land.
 */
function buildAbortablePromptInstance() {
  const target = new EventTarget();
  let contextUsage = 0;
  return {
    prompt: vi.fn((input: string, opts?: LanguageModelPromptOptions) => {
      contextUsage += 10;
      return new Promise<string>((resolve, reject) => {
        if (input !== "hang") {
          resolve(`P:${input}`);
          return;
        }
        opts?.signal?.addEventListener("abort", () =>
          reject(abortError(opts.signal?.reason)),
        );
      });
    }),
    contextWindow: 4096,
    get contextUsage() {
      return contextUsage;
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    fireOverflow: () => target.dispatchEvent(new Event("contextoverflow")),
    destroy: vi.fn<() => void>(),
  };
}

beforeEach(() => {
  setUserActivation(false);
  __resetForTests();
});

afterEach(() => {
  delete (navigator as unknown as { userActivation?: unknown }).userActivation;
});

describe("useLanguageModel", () => {
  test("exposes the session's contextWindow once ready", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildLanguageModelInstance });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel());

    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.contextWindow).toBe(4096);
    expect(result.current.contextUsage).toBe(0);
    expect(result.current.overflowCount).toBe(0);
  });

  test("isolation: equal options give each mount its own session", async () => {
    const { Fake, create, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const a = await renderHook(() => useLanguageModel(system("shared")));
    const b = await renderHook(() => useLanguageModel(system("shared")));

    await vi.waitFor(() => expect(a.result.current.status).toBe("ready"));
    await vi.waitFor(() => expect(b.result.current.status).toBe("ready"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(instances).toHaveLength(2);

    await a.result.current.prompt("hi");
    expect(instances[0].prompt).toHaveBeenCalledTimes(1);
    expect(instances[1].prompt).not.toHaveBeenCalled();
  });

  test("continuity: consecutive prompts hit the same session", async () => {
    const { Fake, create, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await expect(result.current.prompt("one")).resolves.toBe("P:one");
    await expect(result.current.prompt("two")).resolves.toBe("P:two");
    expect(create).toHaveBeenCalledTimes(1);
    expect(instances[0].prompt).toHaveBeenCalledTimes(2);
  });

  test("capture-at-mount: re-rendering with different options never re-provisions", async () => {
    const { Fake, create } = buildAIFake({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result, rerender } = await renderHook(
      (opts?: LanguageModelOptions) => useLanguageModel(opts),
      { initialProps: system("first") },
    );
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(create).toHaveBeenCalledTimes(1);

    await rerender(system("second"));
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject(system("first"));
  });

  test("prompt/append/stream advance contextUsage", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildLanguageModelInstance });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await result.current.prompt("hi");
    await vi.waitFor(() => expect(result.current.contextUsage).toBe(10));

    await result.current.append("more");
    await vi.waitFor(() => expect(result.current.contextUsage).toBe(15));

    for await (const _ of result.current.promptStream("go")) {
      void _;
    }
    await vi.waitFor(() => expect(result.current.contextUsage).toBe(25));
  });

  test("an early-exited stream still syncs contextUsage", async () => {
    const { Fake } = buildAIFake({ buildInstance: buildLanguageModelInstance });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    for await (const _ of result.current.promptStream("go")) {
      void _;
      break;
    }
    await vi.waitFor(() => expect(result.current.contextUsage).toBe(10));
  });

  test("measureContext forwards to measureContextUsage without advancing usage", async () => {
    const { Fake, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    // Resolving with the instance's value proves the call reached it.
    await expect(result.current.measureContext("hi")).resolves.toBe(4);
    expect(instances[0].measureContextUsage).toHaveBeenCalledTimes(1);
    expect(result.current.contextUsage).toBe(0);
  });

  test("overflowCount increments once per fired contextoverflow, listener attached once", async () => {
    const { Fake, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    // Two prompts must not attach the listener twice.
    await result.current.prompt("a");
    await result.current.prompt("b");

    instances[0].fireOverflow();
    await vi.waitFor(() => expect(result.current.overflowCount).toBe(1));
  });

  test("reset() destroys the old session, provisions fresh, and zeroes counters", async () => {
    const { Fake, create, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    await result.current.prompt("hi");
    await vi.waitFor(() => expect(result.current.contextUsage).toBe(10));

    result.current.reset();

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(instances[0].destroy).toHaveBeenCalledTimes(1);
    expect(result.current.contextUsage).toBe(0);
    expect(result.current.overflowCount).toBe(0);
    // Registry swapped in place — no leaked entry.
    expect(__sizeForTests()).toBe(1);
  });

  test("reset(nextOptions) provisions with the replacement options", async () => {
    const { Fake, create } = buildAIFake({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel(system("a")));
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    result.current.reset(system("b"));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0]).toMatchObject(system("b"));
  });

  test("reset(); prompt() routes the prompt to the replacement session", async () => {
    const { Fake, create, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel(system("old")));
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    result.current.reset(system("fresh"));
    const prompted = result.current.prompt("Start fresh");

    await expect(prompted).resolves.toBe("P:Start fresh");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0]).toMatchObject(system("fresh"));
    expect(instances[0].prompt).not.toHaveBeenCalled();
    expect(instances[1].prompt).toHaveBeenCalledWith(
      "Start fresh",
      expect.any(Object),
    );
  });

  test("reset(); prepare() waits until the replacement session is ready", async () => {
    const first = buildLanguageModelInstance();
    const second = buildLanguageModelInstance();
    let resolveReplacement!: (instance: LMInstance) => void;
    const create = vi.fn(() =>
      create.mock.calls.length === 1
        ? Promise.resolve(first)
        : new Promise<LMInstance>((resolve) => {
            resolveReplacement = resolve;
          }),
    );
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn(() => Promise.resolve("available")),
      create,
    });

    const { result } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    result.current.reset();
    let prepared = false;
    const preparation = result.current.prepare().then(() => {
      prepared = true;
    });

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(prepared).toBe(false);

    resolveReplacement(second);
    await preparation;
    expect(prepared).toBe(true);
    expect(first.destroy).toHaveBeenCalledTimes(1);
  });

  test("a newer reset cancels actions waiting on a superseded generation", async () => {
    const { Fake, create, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel(system("old")));
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    result.current.reset(system("superseded"));
    const obsoletePrompt = result.current.prompt("obsolete");
    result.current.reset(system("fresh"));
    const freshPrompt = result.current.prompt("current");

    await expect(obsoletePrompt).rejects.toMatchObject({ name: "AbortError" });
    await expect(freshPrompt).resolves.toBe("P:current");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0]).toMatchObject(system("fresh"));
    expect(instances[0].prompt).not.toHaveBeenCalled();
    expect(instances[1].prompt).toHaveBeenCalledTimes(1);
  });

  test("reset() re-attaches the overflow listener to the fresh session", async () => {
    const { Fake, create, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    result.current.reset();
    // Wait for the fresh session to provision — `status` alone still reads the
    // old store's "ready" until the swap commits.
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    // Listener wires up on the new instance's first action.
    await result.current.prompt("hi");
    instances[1].fireOverflow();
    await vi.waitFor(() => expect(result.current.overflowCount).toBe(1));
    instances[0].fireOverflow();
    expect(result.current.overflowCount).toBe(1);
  });

  test("reset() during an in-flight prompt rejects it with AbortError and keeps contextUsage zeroed", async () => {
    const { Fake, create, instances } = buildAIFake({
      buildInstance: buildAbortablePromptInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    // A completed warm turn, so the discarded session holds non-zero usage —
    // the value an unguarded post-abort syncUsage would resurrect.
    await result.current.prompt("warm");
    await vi.waitFor(() => expect(result.current.contextUsage).toBe(10));

    const inflight = result.current.prompt("hang");
    await vi.waitFor(() =>
      expect(instances[0].prompt).toHaveBeenCalledTimes(2),
    );

    result.current.reset();

    // The swap aborts the old session's in-flight call — a cancellation, not
    // a failure.
    await expect(inflight).rejects.toMatchObject({ name: "AbortError" });

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    // The aborted call's finally ran after reset() zeroed the counter; the
    // currency guard keeps the dead session's usage from writing over it.
    expect(result.current.contextUsage).toBe(0);
  });

  test("a discarded session's late overflow event doesn't count", async () => {
    const { Fake, create, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    // Attach the listener to the first session, then discard it.
    await result.current.prompt("hi");
    result.current.reset();
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    await result.current.prompt("hi again");

    // The old session's listener is still registered on its EventTarget; the
    // currency guard is what keeps this event out of the count.
    instances[0].fireOverflow();
    instances[1].fireOverflow();
    await vi.waitFor(() => expect(result.current.overflowCount).toBe(1));
    expect(result.current.overflowCount).toBe(1);
  });

  test("unmount during an in-flight prompt rejects it with AbortError", async () => {
    const { Fake, instances } = buildAIFake({
      buildInstance: buildAbortablePromptInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result, unmount } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));

    const inflight = result.current.prompt("hang");
    await vi.waitFor(() =>
      expect(instances[0].prompt).toHaveBeenCalledTimes(1),
    );

    await unmount();

    await expect(inflight).rejects.toMatchObject({ name: "AbortError" });
    expect(instances[0].destroy).toHaveBeenCalledTimes(1);
  });

  test("unmount destroys the session and drops the registry entry", async () => {
    const { Fake, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const { result, unmount } = await renderHook(() => useLanguageModel());
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(__sizeForTests()).toBe(1);

    await unmount();
    expect(instances[0].destroy).toHaveBeenCalledTimes(1);
    expect(__sizeForTests()).toBe(0);
  });

  test("useGlobalDownloadProgress sees an owned session's download", async () => {
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn(() => Promise.resolve("downloading")),
      // Never resolves: keep the store parked in "downloading".
      create: vi.fn(() => new Promise<never>(() => undefined)),
    });

    const { result } = await renderHook(() => ({
      model: useLanguageModel(),
      progress: useGlobalDownloadProgress("LanguageModel"),
    }));

    await vi.waitFor(() =>
      expect(result.current.model.status).toBe("downloading"),
    );
    // In flight, no fraction reported yet ⇒ 0 (prefix match on "LanguageModel:#n").
    expect(result.current.progress).toBe(0);
  });
});

describe("createLanguageModel", () => {
  test("resolves an AsyncDisposable session", async () => {
    const { Fake, instances } = buildAIFake<LMInstance>({
      buildInstance: buildLanguageModelInstance,
    });
    vi.stubGlobal("LanguageModel", Fake);

    const model = await createLanguageModel(system("poet"));
    expect(model).toBe(instances[0]);
    expect(
      (model as unknown as Record<symbol, unknown>)[Symbol.asyncDispose],
    ).toBeTypeOf("function");
  });

  test("registers its download with the global aggregate", async () => {
    setUserActivation(true);
    let resolveCreate!: (value: LMInstance) => void;
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create: vi.fn(
        () =>
          new Promise<LMInstance>((resolve) => {
            resolveCreate = resolve;
          }),
      ),
    });

    const promise = createLanguageModel();
    await vi.waitFor(() =>
      expect(snapshotDownloadProgress(["LanguageModel"])).toBe(0),
    );

    resolveCreate(buildLanguageModelInstance());
    await promise;
    expect(snapshotDownloadProgress(["LanguageModel"])).toBeNull();
  });
});
