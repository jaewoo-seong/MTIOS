"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { tourCopy, tourSteps, type TourStep } from "@/lib/help/tour";
import type { HelpArticleId, HelpTopic } from "@/lib/help/content";

type Box = { top: number; left: number; width: number; height: number };

const CALLOUT_WIDTH = 340;
const GAP = 14;
const EDGE = 12;

function findAnchor(step: TourStep) {
  const element = document.querySelector<HTMLElement>(`[data-help-anchor="${step.anchor}"]`);
  if (!element) return null;
  // A hidden anchor (a control dropped at this breakpoint) is as good as
  // missing: the step still shows, just without a spotlight.
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return element;
}

export function HelpTour({ onFinish, onNavigate, onOpenArticle }: {
  onFinish: () => void;
  onNavigate?: (page: HelpTopic) => void;
  onOpenArticle: (article: HelpArticleId) => void;
}) {
  const { preferences } = useI18n();
  const copy = tourCopy[preferences.locale] ?? tourCopy.en;
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [position, setPosition] = useState<React.CSSProperties>({});
  const calloutRef = useRef<HTMLDivElement>(null);
  const step = tourSteps[index];

  const measure = useCallback(() => {
    const element = findAnchor(step);
    if (!element) {
      setBox(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
  }, [step]);

  // The anchor may not be mounted until after a module switch renders, so the
  // lookup retries briefly before giving up and centring the callout.
  useEffect(() => {
    if (step.page) onNavigate?.(step.page);
    let attempts = 0;
    let frame = 0;
    const seek = () => {
      const element = findAnchor(step);
      if (element) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        window.setTimeout(measure, 260);
        return;
      }
      if (attempts++ < 14) frame = window.setTimeout(seek, 60);
      else setBox(null);
    };
    seek();
    return () => window.clearTimeout(frame);
  }, [step, measure, onNavigate]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  useEffect(() => { calloutRef.current?.focus(); }, [index]);

  // Placement needs the callout's real height, so it is measured after render
  // rather than estimated. Width is fixed, so this settles in one extra pass.
  useLayoutEffect(() => {
    const element = calloutRef.current;
    if (!element) return;
    setPosition(calloutPosition(box, element.offsetHeight));
  }, [box, index]);

  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);
  // The bound is checked outside the updater: calling onFinish inside one would
  // set provider state during this component's render.
  const next = useCallback(() => {
    if (index + 1 >= tourSteps.length) onFinish();
    else setIndex(index + 1);
  }, [index, onFinish]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onFinish(); }
      else if (event.key === "ArrowRight") { event.preventDefault(); next(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); back(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, back, onFinish]);

  const last = index === tourSteps.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={copy.label}>
      {box
        ? <div className="tour-spotlight" style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }} />
        : <div className="tour-scrim" />}
      <div
        ref={calloutRef}
        className={`tour-callout${box ? "" : " centered"}`}
        style={position}
        tabIndex={-1}
        aria-live="polite"
      >
        <header>
          <span className="tour-progress">
            {copy.progress.replace("{current}", String(index + 1)).replace("{total}", String(tourSteps.length))}
          </span>
          <button className="tour-close" onClick={onFinish} aria-label={copy.skip}><X size={15} /></button>
        </header>
        <h3>{step.title[preferences.locale] ?? step.title.en}</h3>
        <p>{step.body[preferences.locale] ?? step.body.en}</p>
        {step.article && (
          <button className="tour-read-more" onClick={() => { onFinish(); onOpenArticle(step.article as HelpArticleId); }}>
            <BookOpen size={13} /> {copy.readMore}
          </button>
        )}
        <footer>
          <button className="tour-skip" onClick={onFinish}>{copy.skip}</button>
          <div>
            {index > 0 && <button className="secondary" onClick={back}><ArrowLeft size={14} /> {copy.back}</button>}
            <button className="primary" onClick={next}>
              {last ? copy.done : <>{copy.next} <ArrowRight size={14} /></>}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Picks whichever side of the anchor actually has room. A full-height anchor
 * such as the sidebar has space on neither top nor bottom, so vertical-only
 * placement would drop the callout on top of the thing it is pointing at.
 */
function calloutPosition(box: Box | null, height: number): React.CSSProperties {
  if (typeof window === "undefined" || !box) return {};
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (viewportWidth <= 760) return {};

  const clampX = (value: number) => Math.min(Math.max(EDGE, value), viewportWidth - CALLOUT_WIDTH - EDGE);
  const clampY = (value: number) => Math.min(Math.max(EDGE, value), viewportHeight - height - EDGE);
  const centeredX = clampX(box.left + box.width / 2 - CALLOUT_WIDTH / 2);
  const centeredY = clampY(box.top + box.height / 2 - height / 2);

  const below = viewportHeight - (box.top + box.height) - GAP - EDGE;
  const above = box.top - GAP - EDGE;
  const right = viewportWidth - (box.left + box.width) - GAP - EDGE;
  const left = box.left - GAP - EDGE;

  if (below >= height) return { top: box.top + box.height + GAP, left: centeredX, width: CALLOUT_WIDTH };
  if (above >= height) return { top: box.top - GAP - height, left: centeredX, width: CALLOUT_WIDTH };
  if (right >= CALLOUT_WIDTH) return { top: centeredY, left: box.left + box.width + GAP, width: CALLOUT_WIDTH };
  if (left >= CALLOUT_WIDTH) return { top: centeredY, left: box.left - GAP - CALLOUT_WIDTH, width: CALLOUT_WIDTH };
  return { top: centeredY, left: centeredX, width: CALLOUT_WIDTH };
}
