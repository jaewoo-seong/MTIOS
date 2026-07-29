export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Nginx and similar proxies buffer by default, which defeats streaming entirely.
  "X-Accel-Buffering": "no"
} as const;

interface StreamOptions<T> {
  signal: AbortSignal;
  /** Returns events newer than the cursor, and the cursor to use on the next poll. */
  poll: (cursor: string | null) => Promise<{ events: T[]; cursor: string | null }>;
  /** Serializes one event into an SSE frame. */
  frame: (event: T) => string;
  /** Resolve true when the work is finished so the stream can close cleanly. */
  isDone?: (event: T) => boolean;
  initialCursor?: string | null;
  intervalMs?: number;
  maxDurationMs?: number;
}

/**
 * Long-lived SSE body backed by repository polling. Emits a comment heartbeat between
 * polls so intermediaries and the browser keep the connection open, and always closes
 * on client disconnect rather than leaking a timer.
 */
export function pollingEventStream<T>({
  signal,
  poll,
  frame,
  isDone,
  initialCursor = null,
  intervalMs = 1000,
  maxDurationMs = 5 * 60 * 1000
}: StreamOptions<T>) {
  const encoder = new TextEncoder();
  let cursor = initialCursor;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the runtime when the client vanished.
        }
      };

      const send = (chunk: string) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      signal.addEventListener("abort", close, { once: true });
      send(": stream open\n\n");

      while (!closed && !signal.aborted) {
        let batch: { events: T[]; cursor: string | null };
        try {
          batch = await poll(cursor);
        } catch (reason) {
          send(`event: stream.error\ndata: ${JSON.stringify({
            message: reason instanceof Error ? reason.message : "Activity stream failed."
          })}\n\n`);
          break;
        }

        cursor = batch.cursor ?? cursor;
        let finished = false;
        for (const event of batch.events) {
          if (!send(frame(event))) break;
          if (isDone?.(event)) finished = true;
        }
        if (finished) break;

        if (batch.events.length === 0 && !send(": ping\n\n")) break;
        if (Date.now() - startedAt > maxDurationMs) {
          send("event: stream.timeout\ndata: {}\n\n");
          break;
        }

        await sleep(intervalMs, signal);
      }

      close();
    }
  });
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}
