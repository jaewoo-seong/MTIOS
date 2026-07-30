import type { RunEvent } from "@/lib/domain";
import { repository } from "@/lib/repository";
import { SSE_HEADERS, pollingEventStream } from "@/lib/sse";

import { guard } from "@/lib/api/guard";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["run.completed", "run.failed", "run.cancelled"]);

export const GET = guard<{ runId: string }>(async (request, { params }) => {
  const { runId } = params;
  const lastEventId = Number(request.headers.get("last-event-id") ?? "0");

  const stream = pollingEventStream<RunEvent>({
    signal: request.signal,
    initialCursor: Number.isFinite(lastEventId) && lastEventId > 0 ? String(lastEventId) : "0",
    poll: async (cursor) => {
      const after = Number(cursor ?? "0");
      const events = await repository.listEvents(runId, Number.isFinite(after) ? after : 0);
      const nextCursor = events.length > 0 ? String(events[events.length - 1].sequence) : cursor;
      return { events, cursor: nextCursor };
    },
    frame: (event) =>
      `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    isDone: (event) => TERMINAL.has(event.type)
  });

  return new Response(stream, { headers: SSE_HEADERS });
});
