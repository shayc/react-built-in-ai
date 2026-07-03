export {
  BuiltInAIError,
  NotReadyError,
  MissingUserActivationError,
  UnavailableError,
  UnsupportedError,
} from "./errors";

export { isSupported, type BuiltInAIName } from "./is-supported";

export { checkAvailability } from "./check-availability";

export type { BaseHookReturn, Status } from "./types";

export { useGlobalDownloadProgress } from "./use-global-download-progress";

export {
  createTranslator,
  type CreateTranslatorOptions,
} from "./translator/create-translator";
export {
  useTranslator,
  type TranslateCallOptions,
  type TranslatorHookReturn,
  type TranslatorOptions,
} from "./translator/use-translator";

export {
  createRewriter,
  type CreateRewriterOptions,
} from "./rewriter/create-rewriter";
export {
  useRewriter,
  type RewriteCallOptions,
  type RewriterHookReturn,
  type RewriterOptions,
} from "./rewriter/use-rewriter";

export {
  createProofreader,
  type CreateProofreaderOptions,
} from "./proofreader/create-proofreader";
export {
  useProofreader,
  type ProofreadCallOptions,
  type ProofreaderHookReturn,
  type ProofreaderOptions,
} from "./proofreader/use-proofreader";

export {
  createSummarizer,
  type CreateSummarizerOptions,
} from "./summarizer/create-summarizer";
export {
  useSummarizer,
  type SummarizeCallOptions,
  type SummarizerHookReturn,
  type SummarizerOptions,
} from "./summarizer/use-summarizer";

export { createWriter, type CreateWriterOptions } from "./writer/create-writer";
export {
  useWriter,
  type WriteCallOptions,
  type WriterHookReturn,
  type WriterOptions,
} from "./writer/use-writer";

export {
  createLanguageDetector,
  type CreateLanguageDetectorOptions,
} from "./language-detector/create-language-detector";
export {
  useLanguageDetector,
  type DetectCallOptions,
  type LanguageDetectorHookReturn,
  type LanguageDetectorOptions,
} from "./language-detector/use-language-detector";
