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
