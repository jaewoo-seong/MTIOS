import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { type ProjectActivityEvent, repository } from "@/lib/repository";
import { SSE_HEADERS, pollingEventStream } from "@/lib/sse";

import { guard } from "@/lib/api/guard";
export const dynamic = "force-dynamic";

/**
 * Live activity for a whole project: every event from every run, in order.
 * Returns a snapshot for a normal request and an SSE stream when the client
 * asks for `text/event-stream`, so the panel can hydrate then follow along.
 */
export const GET = guard<{ projectId: string }>(async (request, { params }) => {
  const { projectId } = params;
  const project = await repository.getProject(projectId);
  if (!project) return notFound("project");

  const url = new URL(request.url);
  const wantsStream =
    url.searchParams.get("stream") === "1" ||
    (request.headers.get("accept") ?? "").includes("text/event-stream");

  if (!wantsStream) {
    const events = await repository.listProjectEvents(projectId);
    return NextResponse.json({ data: events });
  }

  const since = request.headers.get("last-event-id") ?? url.searchParams.get("since");

  const stream = pollingEventStream<ProjectActivityEvent>({
    signal: request.signal,
    initialCursor: since,
    poll: async (cursor) => {
      const events = await repository.listProjectEvents(projectId, cursor ?? undefined);
      const nextCursor = events.length > 0 ? events[events.length - 1].createdAt : cursor;
      return { events, cursor: nextCursor };
    },
    frame: (event) =>
      `id: ${event.createdAt}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  });

  return new Response(stream, { headers: SSE_HEADERS });
});
