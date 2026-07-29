import type { SearchHit } from "@/lib/domain";
import { repository } from "@/lib/repository";

const MAX_PER_KIND = 6;
const EXCERPT_RADIUS = 60;

/**
 * Workspace-wide search across documents, projects, agendas, knowledge and
 * client databases.
 *
 * Deliberately a straightforward scan rather than a Postgres full-text index:
 * a single-workspace deployment has thousands of rows, not millions, and this
 * keeps the development repository and the database path identical. Swap in
 * `to_tsvector`/`websearch_to_tsquery` when document volume makes it worth the
 * migration.
 */
export async function searchWorkspace(rawQuery: string): Promise<SearchHit[]> {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return [];

  const [projects, documents, knowledge, databases] = await Promise.all([
    repository.listProjects(),
    repository.listDocuments(),
    repository.listKnowledge(),
    repository.listClientDatabases()
  ]);

  const hits: SearchHit[] = [];

  for (const project of projects.slice(0, 200)) {
    const field = match(query, [project.name, project.objective, project.context, project.scope]);
    if (!field) continue;
    hits.push({
      id: project.id,
      kind: "project",
      title: project.name,
      excerpt: excerpt(field.text, field.index),
      projectId: project.id
    });
    if (countKind(hits, "project") >= MAX_PER_KIND) break;
  }

  // Agendas are only worth scanning for projects the query already reaches, plus
  // the most recently touched ones, to keep this bounded.
  for (const project of projects.slice(0, 25)) {
    if (countKind(hits, "agenda") >= MAX_PER_KIND) break;
    const agendas = await repository.listAgendas(project.id);
    for (const agenda of agendas) {
      const field = match(query, [agenda.title, agenda.instruction]);
      if (!field) continue;
      hits.push({
        id: agenda.id,
        kind: "agenda",
        title: agenda.title,
        excerpt: excerpt(field.text, field.index),
        projectId: project.id
      });
      if (countKind(hits, "agenda") >= MAX_PER_KIND) break;
    }
  }

  for (const document of documents.slice(0, 400)) {
    if (countKind(hits, "document") >= MAX_PER_KIND) break;
    const meta = match(query, [document.title, document.filename]);
    if (meta) {
      hits.push({
        id: document.id,
        kind: "document",
        title: document.title,
        excerpt: `${document.filename} · ${document.sourceKind.toUpperCase()}`,
        documentId: document.id,
        projectId: document.projectId
      });
      continue;
    }
    // Only pull the body when metadata misses — it is the expensive read.
    const detail = await repository.getDocument(document.id);
    const body = detail ? match(query, [detail.markdown]) : null;
    if (!body) continue;
    hits.push({
      id: document.id,
      kind: "document",
      title: document.title,
      excerpt: excerpt(body.text, body.index),
      documentId: document.id,
      projectId: document.projectId
    });
  }

  for (const entry of knowledge.slice(0, 200)) {
    const field = match(query, [entry.title, entry.content, entry.collection]);
    if (!field) continue;
    hits.push({ id: entry.id, kind: "knowledge", title: entry.title, excerpt: excerpt(field.text, field.index) });
    if (countKind(hits, "knowledge") >= MAX_PER_KIND) break;
  }

  for (const database of databases.slice(0, 100)) {
    const field = match(query, [database.name, database.description]);
    if (!field) continue;
    hits.push({ id: database.id, kind: "database", title: database.name, excerpt: excerpt(field.text, field.index) });
    if (countKind(hits, "database") >= MAX_PER_KIND) break;
  }

  return hits;
}

function match(query: string, fields: Array<string | null | undefined>) {
  for (const text of fields) {
    if (!text) continue;
    const index = text.toLowerCase().indexOf(query);
    if (index >= 0) return { text, index };
  }
  return null;
}

/** A window of text around the match, trimmed to word boundaries. */
function excerpt(text: string, index: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  const offset = clean.toLowerCase().indexOf(text.slice(index, index + 24).toLowerCase().replace(/\s+/g, " "));
  const at = offset >= 0 ? offset : index;
  const start = Math.max(0, at - EXCERPT_RADIUS);
  const end = Math.min(clean.length, at + EXCERPT_RADIUS * 2);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${end < clean.length ? "…" : ""}`;
}

function countKind(hits: SearchHit[], kind: SearchHit["kind"]) {
  return hits.reduce((total, hit) => (hit.kind === kind ? total + 1 : total), 0);
}
