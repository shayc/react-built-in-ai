import { vi } from "vitest";
import { buildChunkStream } from "./stream-fake";

export function buildTranslatorInstance() {
  return {
    translate: vi.fn((input: string) => Promise.resolve(`T:${input}`)),
    translateStreaming: vi.fn(() => buildChunkStream(["T:", "hello"])),
    measureInputUsage: vi.fn(() => Promise.resolve(7)),
    inputQuota: 1024,
    destroy: vi.fn<() => void>(),
  };
}

export function buildRewriterInstance() {
  return {
    rewrite: vi.fn((input: string, opts?: RewriterRewriteOptions) =>
      Promise.resolve(`R(${opts?.context ?? ""}):${input}`),
    ),
    rewriteStreaming: vi.fn(() => buildChunkStream(["R:", "alt"])),
    measureInputUsage: vi.fn(() => Promise.resolve(4)),
    inputQuota: 768,
    destroy: vi.fn<() => void>(),
  };
}

export function buildProofreaderInstance() {
  return {
    proofread: vi.fn((input: string) =>
      Promise.resolve({
        correctedInput: `corrected(${input})`,
        corrections: [
          {
            startIndex: 0,
            endIndex: 5,
            correction: "Hello",
            types: ["capitalization" as const],
          },
        ],
      }),
    ),
    destroy: vi.fn<() => void>(),
  };
}

export function buildSummarizerInstance() {
  return {
    summarize: vi.fn((input: string, opts?: SummarizerSummarizeOptions) =>
      Promise.resolve(`S(${opts?.context ?? ""}):${input}`),
    ),
    summarizeStreaming: vi.fn(() => buildChunkStream(["S:", "sum"])),
    measureInputUsage: vi.fn(() => Promise.resolve(5)),
    inputQuota: 2048,
    destroy: vi.fn<() => void>(),
  };
}

export function buildWriterInstance() {
  return {
    write: vi.fn((input: string, opts?: WriterWriteOptions) =>
      Promise.resolve(`W(${opts?.context ?? ""}):${input}`),
    ),
    writeStreaming: vi.fn(() => buildChunkStream(["W:", "draft"])),
    measureInputUsage: vi.fn(() => Promise.resolve(6)),
    inputQuota: 1536,
    destroy: vi.fn<() => void>(),
  };
}

/**
 * Fake `LanguageModel` session. `contextUsage` is a live getter advanced by
 * each turn (`prompt`/`promptStreaming` +10, `append` +5); `fireOverflow()`
 * dispatches a real `contextoverflow` event to whatever the hook wired up via
 * `addEventListener`.
 */
export function buildLanguageModelInstance() {
  const target = new EventTarget();
  let contextUsage = 0;
  return {
    prompt: vi.fn((input: string) => {
      contextUsage += 10;
      return Promise.resolve(`P:${input}`);
    }),
    promptStreaming: vi.fn(() => {
      contextUsage += 10;
      return buildChunkStream(["P:", "hi"]);
    }),
    append: vi.fn(() => {
      contextUsage += 5;
      return Promise.resolve(undefined);
    }),
    measureContextUsage: vi.fn(() => Promise.resolve(4)),
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

export function buildLanguageDetectorInstance() {
  return {
    detect: vi.fn(() =>
      Promise.resolve([
        { detectedLanguage: "en", confidence: 0.99 },
        { detectedLanguage: "fr", confidence: 0.01 },
      ]),
    ),
    measureInputUsage: vi.fn(() => Promise.resolve(3)),
    inputQuota: 512,
    destroy: vi.fn<() => void>(),
  };
}
