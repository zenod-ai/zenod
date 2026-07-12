/**
 * Local whisper.cpp loads a large model into each child process. Running two
 * copies at once can exceed the container memory limit, so all in-process
 * callers share one FIFO slot. Cloud transcription is intentionally outside
 * this queue.
 */
let tail: Promise<void> = Promise.resolve();

export async function runLocalTranscriptionSerialized<T>(task: () => Promise<T>): Promise<T> {
  const previous = tail.catch(() => {});
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}
