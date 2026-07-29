"use client";

import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface ActivityEvent {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  message: string;
  createdAt: string;
  runStatus?: string;
}

type Connection = "connecting" | "live" | "idle" | "error";

/** Event types that should read as an alert rather than routine progress. */
const ATTENTION = new Set(["run.blocked", "run.failed", "stream.error"]);
const DONE = new Set(["run.completed", "run.cancelled"]);

/**
 * Terminal-style activity feed for a project. Hydrates from a snapshot, then follows
 * the SSE stream, auto-scrolling only while the operator is already at the bottom so
 * reading back through history is never interrupted.
 */
export function LiveActivity({ projectId }: { projectId: string }) {
  const { preferences, t } = useI18n();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    setEvents([]);
    setConnection("connecting");
    pinnedRef.current = true;

    const source = new EventSource(`/api/v1/projects/${projectId}/activity?stream=1`);

    const onMessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as ActivityEvent;
        setConnection(DONE.has(parsed.type) ? "idle" : "live");
        setEvents((current) =>
          current.some((item) => item.id === parsed.id) ? current : [...current, parsed]
        );
      } catch {
        // A malformed frame should never take the panel down.
      }
    };

    source.onopen = () => setConnection((state) => (state === "connecting" ? "live" : state));
    source.onmessage = onMessage;
    for (const type of [
      "run.queued", "run.planning", "run.context", "run.review",
      "run.progress", "run.blocked", "run.completed", "run.failed", "run.cancelled"
    ]) {
      source.addEventListener(type, onMessage as EventListener);
    }
    source.onerror = () => {
      // EventSource retries on its own; surface the gap without tearing down.
      setConnection((state) => (state === "live" ? "idle" : "error"));
    };

    return () => source.close();
  }, [projectId]);

  useEffect(() => {
    if (!pinnedRef.current) return;
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [events]);

  return (
    <section className="surface activity-surface">
      <div className="surface-header">
        <h2>{t("Live activity")}</h2>
        <span className={`activity-status ${connection}`}>
          <Radio size={11} aria-hidden />
          {t(connection === "live" ? "Streaming" : connection === "connecting" ? "Connecting" : connection === "error" ? "Disconnected" : "Idle")}
        </span>
      </div>
      <div
        className="activity-log"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t("Live agent activity")}
        onScroll={(event) => {
          const node = event.currentTarget;
          pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
      >
        {events.length === 0 ? (
          <p className="activity-empty">
            {connection === "connecting"
              ? t("Connecting to the activity stream…")
              : t("No agent activity yet. Confirm an instruction to start a run.")}
          </p>
        ) : (
          events.map((event) => (
            <div
              className={`activity-line${ATTENTION.has(event.type) ? " attention" : ""}`}
              key={event.id}
            >
              <time dateTime={event.createdAt}>{formatTime(event.createdAt, preferences.locale, preferences.timezone)}</time>
              <span className="activity-type">{t(shortType(event.type))}</span>
              <span className="activity-message">{event.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatTime(iso: string, locale: "en" | "ko", timezone: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-GB", {
    hour12: false,
    timeZone: timezone
  });
}

function shortType(type: string) {
  return type.replace(/^run\./, "").replace(/^stream\./, "").replace(/_/g, " ");
}
