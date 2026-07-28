import { repository } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const lastEventId = Number(request.headers.get("last-event-id") ?? "0");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const events = await repository.listEvents(runId, lastEventId);
      if (events.length === 0) {
        controller.enqueue(encoder.encode(": connected\n\n"));
      } else {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          );
        }
      }
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
