import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { provisionStandalone } from "./internal/lifecycle/provision";
import { useLifecycle } from "./internal/lifecycle/use-lifecycle";
import type { BuiltInAIName } from "./is-supported";
import { useGlobalDownloadProgress } from "./use-global-download-progress";

interface TestOptions {
  mode?: string;
}

interface TestInstance {
  destroy: () => void;
}

function setUserActivation(isActive: boolean): void {
  Object.defineProperty(navigator, "userActivation", {
    value: { isActive },
    configurable: true,
  });
}

afterEach(() => {
  delete (navigator as unknown as { userActivation?: unknown }).userActivation;
});

interface DownloadCall {
  monitor: CreateMonitor;
  resolve: (instance: TestInstance) => void;
}

/**
 * Stubs `name` as downloadable. Each `create()` call gets its own monitor
 * and resolver, indexed by call order — needed for scenarios with multiple
 * concurrent downloads under the same namespace.
 */
function stubDownloadable(name: BuiltInAIName): {
  callAt: (index: number) => DownloadCall;
} {
  const calls: DownloadCall[] = [];
  const create = vi.fn((opts?: { monitor?: (m: CreateMonitor) => void }) => {
    const monitor = new EventTarget() as CreateMonitor;
    return new Promise<TestInstance>((resolve) => {
      calls.push({ monitor, resolve });
      opts?.monitor?.(monitor);
    });
  });
  vi.stubGlobal(name, {
    availability: vi.fn(() => Promise.resolve("downloadable")),
    create,
  });
  return { callAt: (index) => calls[index] };
}

function emit(monitor: CreateMonitor, loaded: number): void {
  monitor.dispatchEvent(
    Object.assign(new Event("downloadprogress"), { loaded }),
  );
}

/** Starts a passively-joined download for `name`/`options` (no gesture needed). */
async function startJoinedDownload(
  name: BuiltInAIName,
  options: TestOptions | undefined,
): Promise<DownloadCall> {
  const calls: DownloadCall[] = [];
  const create = vi.fn((opts?: { monitor?: (m: CreateMonitor) => void }) => {
    const monitor = new EventTarget() as CreateMonitor;
    return new Promise<TestInstance>((resolve) => {
      calls.push({ monitor, resolve });
      opts?.monitor?.(monitor);
    });
  });
  vi.stubGlobal(name, {
    availability: vi.fn(() => Promise.resolve("downloading")),
    create,
  });

  const { result } = await renderHook(() =>
    useLifecycle<TestOptions, TestInstance>(name, options),
  );
  await vi.waitFor(() => expect(result.current.status).toBe("downloading"));

  return calls[0];
}

/** Starts a hook-driven download for `name`/`options` and leaves it parked "downloading". */
async function startHookDownload(
  name: BuiltInAIName,
  options: TestOptions | undefined,
): Promise<DownloadCall> {
  const controller = stubDownloadable(name);
  const { result } = await renderHook(() =>
    useLifecycle<TestOptions, TestInstance>(name, options),
  );
  await vi.waitFor(() => expect(result.current.status).toBe("downloadable"));

  setUserActivation(true);
  result.current.prepare().catch(() => undefined);
  await vi.waitFor(() => expect(result.current.status).toBe("downloading"));
  setUserActivation(false);

  return controller.callAt(0);
}

/** Starts a creator-driven (imperative) download for `name` and leaves it in flight. */
async function startCreatorDownload(
  name: BuiltInAIName,
): Promise<DownloadCall & { settled: Promise<unknown> }> {
  const controller = stubDownloadable(name);
  setUserActivation(true);
  const settled = provisionStandalone<TestOptions, TestInstance>(
    name,
    {},
  ).catch(() => undefined);
  await vi.waitFor(() => expect(controller.callAt(0)).toBeDefined());
  setUserActivation(false);
  return { ...controller.callAt(0), settled };
}

describe("useGlobalDownloadProgress", () => {
  test("reports the least-complete in-flight progress matching the namespace", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Translator"),
    );
    expect(result.current).toBeNull();

    const a = await startHookDownload("Translator", { mode: "en-fr" });
    emit(a.monitor, 0.25);
    await vi.waitFor(() => expect(result.current).toBe(0.25));

    const b = await startHookDownload("Translator", { mode: "en-de" });
    emit(b.monitor, 0.7);
    await vi.waitFor(() => expect(result.current).toBe(0.25));

    emit(a.monitor, 0.8);
    await vi.waitFor(() => expect(result.current).toBe(0.7));

    a.resolve({ destroy: vi.fn() });
    b.resolve({ destroy: vi.fn() });
  });

  test("never moves backwards when the further-along download completes", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Translator"),
    );

    const a = await startHookDownload("Translator", { mode: "en-fr" });
    const b = await startHookDownload("Translator", { mode: "en-de" });
    emit(a.monitor, 0.2);
    emit(b.monitor, 0.9);
    await vi.waitFor(() => expect(result.current).toBe(0.2));

    b.resolve({ destroy: vi.fn() });
    await vi.waitFor(() => expect(result.current).toBe(0.2));

    emit(a.monitor, 0.5);
    await vi.waitFor(() => expect(result.current).toBe(0.5));

    a.resolve({ destroy: vi.fn() });
  });

  test("matches a bare-options key as well as `namespace:…` keys", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Translator"),
    );

    const a = await startHookDownload("Translator", undefined);
    emit(a.monitor, 0.5);
    await vi.waitFor(() => expect(result.current).toBe(0.5));

    a.resolve({ destroy: vi.fn() });
  });

  test("ignores keys outside the requested namespace", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Translator"),
    );

    // A lower-value write in a different namespace must not leak in: a
    // larger-value write in our namespace should still be the reported value.
    // If filtering were broken, the hook would report 0.1 (the least complete).
    const other = await startHookDownload("Rewriter", undefined);
    emit(other.monitor, 0.1);
    const mine = await startHookDownload("Translator", undefined);
    emit(mine.monitor, 0.3);
    await vi.waitFor(() => expect(result.current).toBe(0.3));

    other.resolve({ destroy: vi.fn() });
    mine.resolve({ destroy: vi.fn() });
  });

  test("aggregates across the requested namespaces only", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress(["Proofreader", "Rewriter"]),
    );
    expect(result.current).toBeNull();

    const translator = await startHookDownload("Translator", undefined);
    emit(translator.monitor, 0.1);
    await vi.waitFor(() => expect(result.current).toBeNull());

    const proofreader = await startHookDownload("Proofreader", undefined);
    emit(proofreader.monitor, 0.5);
    await vi.waitFor(() => expect(result.current).toBe(0.5));

    const rewriter = await startHookDownload("Rewriter", undefined);
    emit(rewriter.monitor, 0.3);
    await vi.waitFor(() => expect(result.current).toBe(0.3));

    rewriter.resolve({ destroy: vi.fn() });
    await vi.waitFor(() => expect(result.current).toBe(0.5));

    translator.resolve({ destroy: vi.fn() });
    proofreader.resolve({ destroy: vi.fn() });
  });

  test("with no argument, aggregates across every namespace", async () => {
    const { result } = await renderHook(() => useGlobalDownloadProgress());
    expect(result.current).toBeNull();

    const rewriter = await startHookDownload("Rewriter", undefined);
    emit(rewriter.monitor, 0.6);
    await vi.waitFor(() => expect(result.current).toBe(0.6));

    const translator = await startHookDownload("Translator", { mode: "a" });
    emit(translator.monitor, 0.2);
    await vi.waitFor(() => expect(result.current).toBe(0.2));

    translator.resolve({ destroy: vi.fn() });
    await vi.waitFor(() => expect(result.current).toBe(0.6));

    rewriter.resolve({ destroy: vi.fn() });
  });

  test("treats an explicit undefined argument like the no-argument call", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress(undefined),
    );
    expect(result.current).toBeNull();

    const rewriter = await startHookDownload("Rewriter", undefined);
    emit(rewriter.monitor, 0.6);
    await vi.waitFor(() => expect(result.current).toBe(0.6));

    rewriter.resolve({ destroy: vi.fn() });
  });

  test("a creator-driven (imperative) download is visible alongside hook-driven ones", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Summarizer"),
    );

    const created = await startCreatorDownload("Summarizer");
    emit(created.monitor, 0.4);
    await vi.waitFor(() => expect(result.current).toBe(0.4));

    created.resolve({ destroy: vi.fn() });
    await created.settled;
    await vi.waitFor(() => expect(result.current).toBeNull());
  });

  test("mixes hook-driven and creator-driven progress under the same min aggregate", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Writer"),
    );

    const viaHook = await startHookDownload("Writer", { mode: "a" });
    emit(viaHook.monitor, 0.6);
    await vi.waitFor(() => expect(result.current).toBe(0.6));

    const viaCreator = await startCreatorDownload("Writer");
    emit(viaCreator.monitor, 0.3);
    await vi.waitFor(() => expect(result.current).toBe(0.3));

    viaCreator.resolve({ destroy: vi.fn() });
    await viaCreator.settled;
    await vi.waitFor(() => expect(result.current).toBe(0.6));

    viaHook.resolve({ destroy: vi.fn() });
  });

  test("one of two identical-options creator downloads finishing does not blank the other's still-reported progress", async () => {
    // Regression: external downloads are keyed by a unique token per call,
    // not by options — so one call's cleanup can't clear a key the other
    // (sharing the same options) is still reporting against.
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("LanguageDetector"),
    );

    const controller = stubDownloadable("LanguageDetector");
    setUserActivation(true);
    const first = provisionStandalone<TestOptions, TestInstance>(
      "LanguageDetector",
      {},
    );
    await vi.waitFor(() => expect(controller.callAt(0)).toBeDefined());
    const second = provisionStandalone<TestOptions, TestInstance>(
      "LanguageDetector",
      {},
    );
    await vi.waitFor(() => expect(controller.callAt(1)).toBeDefined());
    setUserActivation(false);

    emit(controller.callAt(0).monitor, 0.9);
    emit(controller.callAt(1).monitor, 0.2);
    await vi.waitFor(() => expect(result.current).toBe(0.2));

    // Finish the further-along download first — a per-key tracker would
    // clear the shared key here and blank the second's still-live 0.2.
    controller.callAt(0).resolve({ destroy: vi.fn() });
    await first;
    await vi.waitFor(() => expect(result.current).toBe(0.2));

    controller.callAt(1).resolve({ destroy: vi.fn() });
    await second;
    await vi.waitFor(() => expect(result.current).toBeNull());
  });

  test("cancelling one of two identical-options creator downloads via AbortSignal does not blank the other's still-reported progress", async () => {
    // Same regression as above, but exercising the abort path instead of the
    // happy path: cancelling the first call must still run provisionStandalone's
    // `finally` cleanup (clearing only its own token), not leave a stale
    // entry behind or blank the second download's still-live progress.
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("LanguageDetector"),
    );

    const calls: DownloadCall[] = [];
    const create = vi.fn(
      (opts?: {
        monitor?: (m: CreateMonitor) => void;
        signal?: AbortSignal;
      }) => {
        const monitor = new EventTarget() as CreateMonitor;
        return new Promise<TestInstance>((resolve, reject) => {
          calls.push({ monitor, resolve });
          opts?.monitor?.(monitor);
          opts?.signal?.addEventListener("abort", () => {
            reject(new DOMException("cancelled", "AbortError"));
          });
        });
      },
    );
    vi.stubGlobal("LanguageDetector", {
      availability: vi.fn(() => Promise.resolve("downloadable")),
      create,
    });

    setUserActivation(true);
    const controller = new AbortController();
    const first = provisionStandalone<TestOptions, TestInstance>(
      "LanguageDetector",
      {},
      controller.signal,
    ).catch(() => undefined);
    await vi.waitFor(() => expect(calls[0]).toBeDefined());
    const second = provisionStandalone<TestOptions, TestInstance>(
      "LanguageDetector",
      {},
    );
    await vi.waitFor(() => expect(calls[1]).toBeDefined());
    setUserActivation(false);

    emit(calls[0].monitor, 0.9);
    emit(calls[1].monitor, 0.2);
    await vi.waitFor(() => expect(result.current).toBe(0.2));

    controller.abort(new DOMException("cancelled", "AbortError"));
    await first;
    await vi.waitFor(() => expect(result.current).toBe(0.2));

    calls[1].resolve({ destroy: vi.fn() });
    await second;
    await vi.waitFor(() => expect(result.current).toBeNull());
  });

  test("a passively-joined download with unknown progress contributes 0 to the aggregate", async () => {
    const { result } = await renderHook(() =>
      useGlobalDownloadProgress("Proofreader"),
    );
    expect(result.current).toBeNull();

    const active = await startHookDownload("Proofreader", { mode: "a" });
    emit(active.monitor, 0.4);
    await vi.waitFor(() => expect(result.current).toBe(0.4));

    // The joined store reports no progress yet — it contributes 0, so the
    // min-aggregate drops to 0 instead of staying at the active download's
    // 0.4 or (wrongly) skipping the joined download entirely.
    const joined = await startJoinedDownload("Proofreader", { mode: "b" });
    await vi.waitFor(() => expect(result.current).toBe(0));

    active.resolve({ destroy: vi.fn() });
    await vi.waitFor(() => expect(result.current).toBe(0));

    emit(joined.monitor, 0.7);
    await vi.waitFor(() => expect(result.current).toBe(0.7));

    joined.resolve({ destroy: vi.fn() });
    await vi.waitFor(() => expect(result.current).toBeNull());
  });

  test("server-renders as null even while a download is in flight", async () => {
    const download = await startHookDownload("Translator", undefined);
    emit(download.monitor, 0.5);

    function Probe(): string {
      const progress = useGlobalDownloadProgress();
      return progress === null ? "null" : String(progress);
    }

    expect(renderToString(createElement(Probe))).toBe("null");

    download.resolve({ destroy: vi.fn() });
  });
});
