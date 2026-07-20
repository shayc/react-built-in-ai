/**
 * Base for the typed subclasses below, and the concrete wrapper for unmapped
 * rejections (inspect `.cause`). `instanceof BuiltInAIError` separates library
 * errors from pass-through browser rejections like `AbortError`.
 */
export class BuiltInAIError extends Error {
  override name = "BuiltInAIError";
}

/** The matching built-in AI namespace is not on `globalThis`. */
export class UnsupportedError extends BuiltInAIError {
  override name = "UnsupportedError";
  constructor(
    message = "Built-in AI is not supported",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** `availability()` reported the model can't run on this device. */
export class UnavailableError extends BuiltInAIError {
  override name = "UnavailableError";
  constructor(
    message = "Built-in AI model is unavailable",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** A download needed to be started but no transient user activation was present. */
export class MissingUserActivationError extends BuiltInAIError {
  override name = "MissingUserActivationError";
  constructor(
    message = "Built-in AI must download the model, which the browser only allows from a transient user activation (e.g. a click or keypress handler). Call prepare() or the action directly inside such a handler — not from an effect, timer, page load, or after an await (activation expires quickly).",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** A prior availability probe or `create()` rejected; call `prepare()` to retry and inspect `.cause` for the underlying rejection. */
export class NotReadyError extends BuiltInAIError {
  override name = "NotReadyError";
  constructor(cause?: unknown) {
    super("Built-in AI is in an error state", { cause });
  }
}
