import { describe, expect, test } from "vitest";
import { abortError } from "../signal";
import { createGate } from "./gate";

describe("createGate", () => {
  test("wait() resolves once the gate opens, and immediately thereafter", async () => {
    const gate = createGate();
    let settled = false;
    const waiting = gate.wait().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    gate.open();
    await waiting;
    await expect(gate.wait()).resolves.toBeUndefined();
  });

  test("cancel() rejects current and future waiters with its reason", async () => {
    const gate = createGate();
    const reason = abortError("cancelled");
    const waiting = gate.wait();

    gate.cancel(reason);

    await expect(waiting).rejects.toBe(reason);
    await expect(gate.wait()).rejects.toBe(reason);
  });

  test("open() after cancel() and cancel() after open() are no-ops", async () => {
    const cancelled = createGate();
    const reason = abortError("cancelled");
    cancelled.cancel(reason);
    cancelled.open();
    await expect(cancelled.wait()).rejects.toBe(reason);

    const opened = createGate();
    opened.open();
    opened.cancel(abortError("too late"));
    await expect(opened.wait()).resolves.toBeUndefined();
  });

  test("a caller signal cancels only that caller's wait", async () => {
    const gate = createGate();
    const controller = new AbortController();
    const reason = abortError("caller bailed");
    const aborted = gate.wait(controller.signal);
    const patient = gate.wait();

    controller.abort(reason);
    await expect(aborted).rejects.toBe(reason);

    gate.open();
    await expect(patient).resolves.toBeUndefined();
  });
});
