"use client";

import type { HelpArticleId } from "@/lib/help/content";
import {
  helpSystemMapCopy,
  mapEdges,
  mapNodeHeight,
  mapNodes
} from "@/lib/help/system-map";
import type { Locale } from "@/lib/i18n";

export function HelpSystemMap({ locale = "en", onOpenArticle }: {
  locale?: Locale;
  onOpenArticle?: (id: HelpArticleId) => void;
}) {
  const text = helpSystemMapCopy[locale] ?? helpSystemMapCopy.en;
  return (
    <figure className="help-map">
      <svg viewBox="0 0 640 440" role="img" aria-label={text.alt}>
        <defs>
          <marker id="help-map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="help-map-arrowhead" />
          </marker>
          <marker id="help-map-arrow-strong" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="help-map-arrowhead strong" />
          </marker>
        </defs>

        {mapEdges.map((edge, index) => (
          <g key={index}>
            <path
              d={edge.d}
              className={`help-map-edge${edge.emphasis ? " strong" : ""}${edge.dashed ? " dashed" : ""}`}
              markerEnd={`url(#help-map-arrow${edge.emphasis ? "-strong" : ""})`}
            />
            {edge.label && (
              <text x={edge.labelX} y={edge.labelY} className={`help-map-edge-label${edge.emphasis ? " strong" : ""}`}>
                {text.edges[edge.label] ?? edge.label}
              </text>
            )}
          </g>
        ))}

        {mapNodes.map((node) => {
          const label = text.nodes[node.id] ?? helpSystemMapCopy.en.nodes[node.id];
          const interactive = Boolean(node.article && onOpenArticle);
          return (
            <g
              key={node.id}
              className={`help-map-node${node.tone ? ` ${node.tone}` : ""}${interactive ? " interactive" : ""}`}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? `${label.title}: ${label.detail}` : undefined}
              onClick={interactive ? () => onOpenArticle?.(node.article as HelpArticleId) : undefined}
              onKeyDown={interactive ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenArticle?.(node.article as HelpArticleId);
                }
              } : undefined}
            >
              <rect x={node.x} y={node.y} width={node.w} height={mapNodeHeight} rx="8" />
              <text x={node.x + node.w / 2} y={node.y + 22} className="help-map-title">{label.title}</text>
              <text x={node.x + node.w / 2} y={node.y + 39} className="help-map-detail">{label.detail}</text>
            </g>
          );
        })}
      </svg>
      <figcaption>{text.caption}</figcaption>
    </figure>
  );
}
