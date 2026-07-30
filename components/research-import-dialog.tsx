"use client";

import { useMemo, useRef, useState } from "react";
import { FileText, Loader2, Table, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import type { Project } from "@/lib/domain";
import { ImportError, partitionImportFiles } from "@/lib/research-import";
import { useI18n } from "@/lib/i18n";

type ImportResult = {
  changeSetId: string;
  entities: number;
  documents: number;
  unreferenced: string[];
  columns: string[];
};

/**
 * Imports an external research set: one CSV of entities plus one Markdown
 * report each.
 *
 * File selection is validated in the browser using the same module the server
 * uses, so the obvious mistakes - a stray PDF, two CSVs, no reports - are
 * named before anything is uploaded. The server revalidates regardless; this
 * only saves the round trip.
 */
export function ResearchImportDialog({
  databaseId, databaseName, projects, onClose, onImported, onError
}: {
  databaseId: string;
  databaseName: string;
  projects: Project[];
  onClose: () => void;
  onImported: (result: ImportResult) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Recomputed rather than stored, so the message can never describe an
  // earlier selection than the one shown.
  const selection = useMemo(() => {
    if (files.length === 0) return null;
    try {
      const { csv, markdown } = partitionImportFiles(files.map((file) => file.name));
      return { csv, reports: markdown.length, problem: null as string | null };
    } catch (error) {
      return {
        csv: null,
        reports: 0,
        problem: error instanceof ImportError ? error.message : t("That selection could not be read.")
      };
    }
  }, [files, t]);

  const ready = Boolean(selection && !selection.problem && projectId && !busy);

  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("databaseId", databaseId);
      body.set("projectId", projectId);
      for (const file of files) body.append("files", file);

      const response = await fetch("/api/v1/research-imports", { method: "POST", body });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail ?? payload?.error ?? t("The import could not be completed."));
      }
      setResult(payload.data);
      onImported(payload.data);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("The import could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy="research-import-title" onClose={onClose} className="dialog" dismissOnBackdrop={!busy && !result}>
      <div className="dialog-head">
        <div>
          <span className="eyebrow">{t("Import")}</span>
          <h2 id="research-import-title">{t("Import research")}</h2>
          <p>{t("One CSV of entities and one Markdown report each, into {database}", { database: databaseName })}</p>
        </div>
      </div>

      {result ? (
        <div className="import-body import-done">
          <p>
            <strong>{t("Staged for review — nothing is in the database yet.")}</strong>
          </p>
          <div className="metric-row">
            <div><span className="eyebrow">{t("Entities")}</span><strong>{result.entities}</strong></div>
            <div><span className="eyebrow">{t("Reports")}</span><strong>{result.documents}</strong></div>
            <div><span className="eyebrow">{t("Columns")}</span><strong>{result.columns.length}</strong></div>
          </div>
          {result.unreferenced.length > 0 && (
            <p className="import-note">
              {t("{count} report(s) were not referenced by any row and were ignored.", {
                count: String(result.unreferenced.length)
              })}
            </p>
          )}
          <p className="import-note">
            {t("Approve the change set in the project workspace. Each row will then show a View report action.")}
          </p>
        </div>
      ) : (
        <div className="import-body">
          <button
            type="button"
            className="import-dropzone"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <Upload size={18} aria-hidden />
            <strong>{files.length === 0 ? t("Choose files") : t("Change selection")}</strong>
            <span>{t("Select one .csv and every .md report together")}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".csv,.md,text/csv,text/markdown"
            hidden
            onChange={(event) => {
              setFiles([...(event.target.files ?? [])]);
              // Clearing lets the same selection be re-picked after a change.
              event.target.value = "";
            }}
          />

          {selection && (
            selection.problem
              ? <p className="import-problem" role="alert">{selection.problem}</p>
              : (
                <ul className="import-summary">
                  <li><Table size={14} aria-hidden /> {selection.csv}</li>
                  <li><FileText size={14} aria-hidden /> {t("{count} report(s)", { count: String(selection.reports) })}</li>
                </ul>
              )
          )}

          <label className="import-field">
            {t("Attach to project")}
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={busy}>
              {projects.length === 0 && <option value="">{t("No projects available")}</option>}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>

          <p className="import-note">
            {t("Rows enter as a proposal you approve. Nothing is written to client data by importing.")}
          </p>
        </div>
      )}

      <div className="dialog-actions">
        {result ? (
          <button className="primary" onClick={onClose}>{t("Done")}</button>
        ) : (
          <>
            <button className="secondary" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
            <button className="primary" onClick={() => void submit()} disabled={!ready}>
              {busy && <Loader2 size={14} className="spin" aria-hidden />}
              {busy ? t("Importing…") : t("Import")}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
