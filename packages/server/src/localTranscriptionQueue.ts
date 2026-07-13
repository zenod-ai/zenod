/**
 * Local whisper.cpp loads a large model into each child process. Running two
 * copies at once can exceed the container memory limit, so all in-process
 * callers share one FIFO slot. Cloud transcription is intentionally outside
 * this queue.
 */
let tail: Promise<void> = Promise.resolve();

function abortError(): Error {
  const error = new Error("transcription deadline exceeded");
  error.name = "AbortError";
  return error;
}

export async function runLocalTranscriptionSerialized<T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
  onAcquired?: (queueWaitMs: number) => void,
): Promise<T> {
  const queuedAt = Date.now();
  const previous = tail.catch(() => {});
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  let acquired = false;
  try {
    if (signal?.aborted) {
      throw abortError();
    }
    if (signal) {
      let onAbort!: () => void;
      const abortPromise = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        await Promise.race([previous, abortPromise]);
      } finally {
        // The predecessor normally wins. Explicit cleanup keeps completed
        // queue entries from retaining their controller/listener indefinitely.
        signal.removeEventListener("abort", onAbort);
      }
    } else {
      await previous;
    }
    if (signal?.aborted) {
      throw abortError();
    }
    acquired = true;
    onAcquired?.(Date.now() - queuedAt);
    return await task();
  } finally {
    if (acquired) release();
    else void previous.finally(release);
  }
}
