/**
 * Dossier previews are computed on the server so the research workspace, which
 * polls on an interval, never ships whole master documents to the browser just
 * to render a few lines of preview text.
 */

/** Longest excerpt any workspace view renders, and the size the API returns. */
export const dossierSummaryLimit = 600;

/** Characters read from the stored document to build that excerpt. */
export const dossierSummarySourceLimit = 2000;

export function buildDossierSummary(markdown: string, length = dossierSummaryLimit) {
  const clean = markdown
    // Headings become sentences so they do not run into the paragraph that
    // follows them. Bullet and rule dashes are stripped by position, because
    // a blanket dash strip turns "precision-manufacturing" into one word.
    .replace(/^#{1,6}\s+(.*)$/gm, (_match, heading: string) => `${heading.replace(/[:.]$/, "")}. `)
    .replace(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, " ")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`|~~)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
  return truncateDossierSummary(clean, length);
}

export function truncateDossierSummary(summary: string, length: number) {
  const value = summary.trim();
  if (value.length <= length) return value;
  return `${value.slice(0, length).trimEnd()}…`;
}
