"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileText,
  FolderPlus,
  Loader2,
  Minimize2,
  Pencil,
  Trash2,
  Upload,
  X
} from "lucide-react";
import dynamic from "next/dynamic";
import type { DocumentFolder, Project, WorkspaceDocument, WorkspaceDocumentDetail } from "@/lib/domain";
import { ConfirmDialog, PromptDialog } from "@/components/ui/dialogs";
import { Markdown } from "@/components/ui/markdown";
import { Modal } from "@/components/ui/modal";

/** The rich text editor is a large dependency most sessions never open. */
const DocumentEditor = dynamic(
  () => import("@/components/document-editor").then((module) => module.DocumentEditor),
  { ssr: false, loading: () => <div className="doc-editor-loading">Preparing editor…</div> }
);

const UPLOAD_CONCURRENCY = 3;
const ACCEPT = ".pdf,.docx,.html,.htm,.csv,.tsv,.json,.md,.markdown,.txt";
type DocumentIntelligenceSummary = {
  conversions: Array<{
    status: string;
    confidence: number;
    ocrUsed: boolean;
    language: string | null;
    warnings: string[];
    error: string | null;
  }>;
  revisions: Array<{
    id: string;
    revision: number;
    markdown: string;
    source: string;
    approved: boolean;
    createdAt: string;
  }>;
};

export function DocumentsView({
  onError, projects, focusDocumentId, onFocusHandled
}: {
  onError: (message: string) => void;
  projects: Project[];
  focusDocumentId?: string | null;
  onFocusHandled?: () => void;
}) {
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [openDocument, setOpenDocument] = useState<WorkspaceDocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<WorkspaceDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/v1/documents");
    if (!response.ok) throw new Error("Could not load documents.");
    const payload = (await response.json()) as { data: WorkspaceDocument[]; folders: DocumentFolder[] };
    setFolders(payload.folders);
    setDocuments(payload.data);
    setActiveFolderId((current) => current ?? payload.folders[0]?.id ?? null);
  }, []);

  useEffect(() => {
    refresh()
      .catch((reason: Error) => onError(reason.message))
      .finally(() => setLoading(false));
  }, [refresh, onError]);

  const visible = useMemo(
    () => documents.filter((document) => document.folderId === activeFolderId),
    [documents, activeFolderId]
  );

  // A search result can point at a document in a folder that is not open; switch
  // to its folder and open it once the list has loaded.
  useEffect(() => {
    if (!focusDocumentId || loading) return;
    const target = documents.find((document) => document.id === focusDocumentId);
    if (!target) return;
    setActiveFolderId(target.folderId);
    void openDocumentDetail(target.id);
    onFocusHandled?.();
    // openDocumentDetail is stable enough for this one-shot navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDocumentId, loading, documents]);

  const upload = useCallback(
    async (files: FileList | File[], folderId: string) => {
      const list = [...files];
      if (list.length === 0) return;
      setUploading((current) => [...current, ...list.map((file) => file.name)]);

      const sendOne = async (file: File) => {
        const body = new FormData();
        body.append("file", file);
        body.append("folderId", folderId);
        try {
          const response = await fetch("/api/v1/documents", { method: "POST", body });
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.detail ?? `Could not import ${file.name}.`);
          }
        } catch (reason) {
          onError(reason instanceof Error ? reason.message : `Could not import ${file.name}.`);
        } finally {
          setUploading((current) => current.filter((name) => name !== file.name));
        }
      };

      // Bounded concurrency: a ten-file drop should not be ten serial round
      // trips, but PDF conversion is CPU-bound so the server needs a ceiling.
      const queue = [...list];
      const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          await sendOne(file);
        }
      });
      await Promise.all(workers);
      await refresh().catch((reason: Error) => onError(reason.message));
    },
    [refresh, onError]
  );

  async function moveDocument(documentId: string, folderId: string) {
    const previous = documents;
    setDocuments((current) =>
      current.map((item) => (item.id === documentId ? { ...item, folderId } : item))
    );
    setOpenDocument((current) => (current?.id === documentId ? { ...current, folderId } : current));
    try {
      const response = await fetch(`/api/v1/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId })
      });
      if (!response.ok) throw new Error("Could not move the document.");
      await refresh();
    } catch (reason) {
      setDocuments(previous);
      onError(reason instanceof Error ? reason.message : "Could not move the document.");
    }
  }

  async function openDocumentDetail(documentId: string) {
    try {
      const response = await fetch(`/api/v1/documents/${documentId}`);
      if (!response.ok) throw new Error("Could not open the document.");
      const payload = (await response.json()) as { data: WorkspaceDocumentDetail };
      setOpenDocument(payload.data);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not open the document.");
    }
  }

  async function removeDocument(documentId: string) {
    setPendingDelete(null);
    try {
      const response = await fetch(`/api/v1/documents/${documentId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete the document.");
      setOpenDocument((current) => (current?.id === documentId ? null : current));
      await refresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not delete the document.");
    }
  }

  async function assignProject(documentId: string, projectId: string | null) {
    const previous = documents;
    setDocuments((current) =>
      current.map((item) => (item.id === documentId ? { ...item, projectId } : item))
    );
    setOpenDocument((current) => (current?.id === documentId ? { ...current, projectId } : current));
    try {
      const response = await fetch(`/api/v1/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId })
      });
      if (!response.ok) throw new Error("Could not attach the document to that project.");
      await refresh();
    } catch (reason) {
      setDocuments(previous);
      onError(reason instanceof Error ? reason.message : "Could not attach the document.");
    }
  }

  async function saveDocument(documentId: string, markdown: string) {
    const response = await fetch(`/api/v1/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown })
    });
    if (!response.ok) throw new Error("Could not save the document.");
    const payload = (await response.json()) as { data: WorkspaceDocumentDetail };
    setOpenDocument(payload.data);
    await refresh();
  }

  async function addFolder(name: string) {
    setCreatingFolder(false);
    try {
      const response = await fetch("/api/v1/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (!response.ok) throw new Error("Could not create the folder.");
      await refresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not create the folder.");
    }
  }

  if (loading) {
    return <div className="loading-state"><Loader2 size={20} className="spin" /><span>Loading documents</span></div>;
  }

  // Latent today because defaults are seeded, but deleting every folder would
  // otherwise leave Import silently disabled with no explanation.
  if (folders.length === 0) {
    return (
      <>
        <div className="empty-module">
          <div className="empty-icon"><FolderPlus size={22} aria-hidden /></div>
          <h2>No folders</h2>
          <p>Documents live inside folders. Create one to start importing files.</p>
          <button className="primary" onClick={() => setCreatingFolder(true)}>
            <FolderPlus size={14} aria-hidden /> Create folder
          </button>
        </div>
        {creatingFolder && (
          <PromptDialog
            title="Create folder"
            label="Folder name"
            placeholder="Quotations"
            onSubmit={addFolder}
            onCancel={() => setCreatingFolder(false)}
          />
        )}
      </>
    );
  }

  const activeFolder = folders.find((folder) => folder.id === activeFolderId);

  return (
    <div className="documents-layout">
      <aside className="document-folders">
        <div className="list-heading">
          <span>Folders</span>
          <button onClick={() => setCreatingFolder(true)} aria-label="Create folder" title="Create folder">
            <FolderPlus size={14} />
          </button>
        </div>
        {folders.map((folder) => (
          <button
            key={folder.id}
            className={[
              folder.id === activeFolderId ? "active" : "",
              dropTarget === folder.id ? "drop-target" : ""
            ].filter(Boolean).join(" ")}
            aria-current={folder.id === activeFolderId ? "true" : undefined}
            onClick={() => setActiveFolderId(folder.id)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = draggingId ? "move" : "copy";
              setDropTarget(folder.id);
            }}
            onDragLeave={() => setDropTarget((current) => (current === folder.id ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setDropTarget(null);
              const documentId = event.dataTransfer.getData("application/x-mti-document");
              if (documentId) void moveDocument(documentId, folder.id);
              else if (event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files, folder.id);
            }}
          >
            <FileText size={15} aria-hidden />
            <span className="folder-name">{folder.name}</span>
            <span>{folder.documentCount}</span>
          </button>
        ))}
      </aside>

      <section
        className={`surface document-drop${dropTarget === "surface" ? " drop-target" : ""}`}
        onDragOver={(event) => {
          if (draggingId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropTarget("surface");
        }}
        onDragLeave={() => setDropTarget((current) => (current === "surface" ? null : current))}
        onDrop={(event) => {
          if (draggingId) return;
          event.preventDefault();
          setDropTarget(null);
          if (activeFolderId && event.dataTransfer.files.length > 0) {
            void upload(event.dataTransfer.files, activeFolderId);
          }
        }}
      >
        <div className="surface-header">
          <h2>{activeFolder?.name ?? "Documents"}</h2>
          <div className="surface-tools">
            <span>{plural(visible.length, "file")}</span>
            <button className="secondary" onClick={() => fileInputRef.current?.click()} disabled={!activeFolderId}>
              <Upload size={14} aria-hidden /> Import
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="visually-hidden"
          onChange={(event) => {
            if (event.target.files && activeFolderId) void upload(event.target.files, activeFolderId);
            event.target.value = "";
          }}
        />

        {uploading.length > 0 && (
          <div className="upload-strip" role="status">
            <Loader2 size={13} className="spin" aria-hidden />
            Converting {plural(uploading.length, "file")} to markdown…
          </div>
        )}

        {visible.length === 0 && uploading.length === 0 ? (
          <div className="document-dropzone">
            <Upload size={22} aria-hidden />
            <strong>Drop files here to import</strong>
            <p>PDF, DOCX, HTML, CSV, TSV, JSON, Markdown, and text files are converted to readable markdown.</p>
            <button className="primary" onClick={() => fileInputRef.current?.click()} disabled={!activeFolderId}>
              Choose files
            </button>
          </div>
        ) : (
          <ul className="document-list">
            {visible.map((document) => (
              <li key={document.id}>
                <div
                  className={`document-row${draggingId === document.id ? " dragging" : ""}`}
                  draggable
                  onDragStart={(event) => {
                    setDraggingId(document.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-mti-document", document.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropTarget(null);
                  }}
                >
                  <button className="document-open" onClick={() => void openDocumentDetail(document.id)}>
                    <span className={`kind-badge ${document.sourceKind}`}>{document.sourceKind}</span>
                    <span className="document-meta">
                      <strong>{document.title}</strong>
                      <span>
                        {describeDocument(document)}
                        {document.projectId && (
                          <span className="document-project"> · {projectName(projects, document.projectId)}</span>
                        )}
                      </span>
                    </span>
                  </button>
                  <div className="document-actions">
                    <a
                      className="icon-only"
                      href={`/api/v1/documents/${document.id}/export?format=md`}
                      title={`Export ${document.title} as markdown`}
                      aria-label={`Export ${document.title} as markdown`}
                      download
                    >
                      <Download size={14} aria-hidden />
                    </a>
                    <button
                      className="icon-only"
                      onClick={() => setPendingDelete(document)}
                      title={`Delete ${document.title}`}
                      aria-label={`Delete ${document.title}`}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openDocument && (
        <DocumentModal
          key={openDocument.id}
          document={openDocument}
          folders={folders}
          onClose={() => setOpenDocument(null)}
          projects={projects}
          onMove={(folderId) => void moveDocument(openDocument.id, folderId)}
          onAssignProject={(projectId) => void assignProject(openDocument.id, projectId)}
          onSave={(markdown) => saveDocument(openDocument.id, markdown)}
          onError={onError}
        />
      )}

      {creatingFolder && (
        <PromptDialog
          title="Create folder"
          label="Folder name"
          placeholder="Quotations"
          onSubmit={addFolder}
          onCancel={() => setCreatingFolder(false)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.title}”?`}
          body={`${pendingDelete.filename} and its converted text will be removed permanently. This cannot be undone.`}
          confirmLabel="Delete document"
          destructive
          onConfirm={() => void removeDocument(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function projectName(projects: Project[], projectId: string) {
  return projects.find((project) => project.id === projectId)?.name ?? "Unknown project";
}

function DocumentModal({
  document, folders, projects, onClose, onMove, onAssignProject, onSave, onError
}: {
  document: WorkspaceDocumentDetail;
  folders: DocumentFolder[];
  projects: Project[];
  onClose: () => void;
  onMove: (folderId: string) => void;
  onAssignProject: (projectId: string | null) => void;
  onSave: (markdown: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"edited" | "original" | "proposed">("edited");
  const [renderedMarkdown, setRenderedMarkdown] = useState(document.markdown);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [intelligence, setIntelligence] = useState<DocumentIntelligenceSummary | null>(null);
  const getMarkdownRef = useRef<(() => string) | null>(null);
  const registerGetter = useCallback((getter: () => string) => {
    getMarkdownRef.current = getter;
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/v1/documents/${document.id}/intelligence`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load conversion detail."))),
      document.storageKey
        ? fetch(`/api/v1/documents/${document.id}/original`).then((response) => response.ok ? response.json() : null)
        : Promise.resolve(null)
    ]).then(([detail, original]: [
      { data: DocumentIntelligenceSummary },
      { data?: { url: string } } | null
    ]) => {
      if (!active) return;
      setIntelligence(detail.data);
      setOriginalUrl(original?.data?.url ?? null);
    }).catch((reason: Error) => {
      if (active) onError(reason.message);
    });
    return () => { active = false; };
  }, [document.id, document.storageKey, onError]);

  useEffect(() => {
    setRenderedMarkdown(document.markdown);
  }, [document.markdown]);

  const close = useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved changes to this document?")) return;
    onClose();
  }, [dirty, onClose]);

  async function save({ thenClose }: { thenClose: boolean }) {
    const markdown = getMarkdownRef.current?.();
    if (markdown === undefined) return;
    setSaving(true);
    try {
      await onSave(markdown);
      setDirty(false);
      if (thenClose) setEditing(false);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not save the document.");
    } finally {
      setSaving(false);
    }
  }

  async function approveExtraction() {
    const revision = intelligence?.revisions[0];
    if (!revision) return;
    try {
      const response = await fetch(
        `/api/v1/documents/${document.id}/revisions/${revision.id}/approve`,
        { method: "POST" }
      );
      if (!response.ok) throw new Error("Could not approve this document revision.");
      if (revision.source === "ai_repair") setRenderedMarkdown(revision.markdown);
      setViewMode("edited");
      setIntelligence((current) => current ? {
        ...current,
        revisions: current.revisions.map((item) =>
          item.id === revision.id ? { ...item, approved: true } : item
        )
      } : current);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not approve this document revision.");
    }
  }

  async function retryConversion() {
    try {
      const response = await fetch(`/api/v1/documents/${document.id}/conversion/retry`, {
        method: "POST"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Document conversion retry failed.");
      window.location.reload();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Document conversion retry failed.");
    }
  }

  async function repairConversion() {
    try {
      const response = await fetch(`/api/v1/documents/${document.id}/ai-repair`, {
        method: "POST"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "AI document repair failed.");
      const detail = await fetch(`/api/v1/documents/${document.id}/intelligence`);
      if (detail.ok) {
        const body = (await detail.json()) as { data: DocumentIntelligenceSummary };
        setIntelligence(body.data);
        if (body.data.revisions[0]?.source === "ai_repair") setViewMode("proposed");
      }
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "AI document repair failed.");
    }
  }

  // Cmd/Ctrl+S saves without leaving the editor, as in any desktop word processor.
  useEffect(() => {
    if (!editing) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save({ thenClose: false });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <Modal
      labelledBy="document-modal-title"
      onClose={close}
      className={editing ? "doc-modal editing" : "doc-modal"}
      dismissOnBackdrop={!editing && !dirty}
    >
      <header className="doc-modal-head">
        <div className="doc-modal-identity">
          <span className={`kind-badge ${document.sourceKind}`}>{document.sourceKind}</span>
          <div>
            <h2 id="document-modal-title">{document.title}</h2>
            <p>{describeDocument(document)}{dirty ? " · Unsaved changes" : ""}</p>
          </div>
        </div>

        <div className="doc-modal-actions">
          {!editing && (
            <label className="doc-folder-picker">
              Folder
              <select value={document.folderId} onChange={(event) => onMove(event.target.value)}>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
            </label>
          )}

          {!editing && (
            <label className="doc-folder-picker">
              Project
              <select
                value={document.projectId ?? ""}
                onChange={(event) => onAssignProject(event.target.value || null)}
              >
                <option value="">Not attached</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
          )}

          {!editing && (
            <div className="segmented-control" role="group" aria-label="Document view">
              <button
                className={viewMode === "edited" ? "active" : ""}
                onClick={() => setViewMode("edited")}
              >
                Edited
              </button>
              <button
                className={viewMode === "original" ? "active" : ""}
                onClick={() => setViewMode("original")}
                disabled={!originalUrl}
              >
                Original
              </button>
              {intelligence?.revisions[0]?.source === "ai_repair" &&
                !intelligence.revisions[0].approved && (
                  <button
                    className={viewMode === "proposed" ? "active" : ""}
                    onClick={() => setViewMode("proposed")}
                  >
                    Proposed
                  </button>
                )}
            </div>
          )}

          {!editing && ([
            "md",
            ...(document.markdown.includes("| ---") ? ["csv" as const] : []),
            "docx",
            "pdf"
          ] as const).map((format) => (
            <a key={format} className="secondary" href={`/api/v1/documents/${document.id}/export?format=${format}`} download>
              <Download size={13} aria-hidden /> .{format}
            </a>
          ))}

          {editing ? (
            <>
              <button className="secondary" onClick={() => { setEditing(false); setDirty(false); }} disabled={saving}>
                <Minimize2 size={13} aria-hidden /> Done
              </button>
              <button className="primary" onClick={() => void save({ thenClose: false })} disabled={saving || !dirty}>
                {saving ? <Loader2 size={13} className="spin" aria-hidden /> : null}
                {saving ? "Saving" : "Save"}
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => setEditing(true)}>
              <Pencil size={13} aria-hidden /> Edit
            </button>
          )}

          <button className="icon-only" onClick={close} aria-label="Close document">
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>

      {editing ? (
        <DocumentEditor
          markdown={renderedMarkdown}
          onDirtyChange={setDirty}
          registerGetter={registerGetter}
        />
      ) : (
        <div className="doc-modal-body">
          {intelligence?.conversions[0] && (
            <ConversionStatus
              conversion={intelligence.conversions[0]}
              revisionCount={intelligence.revisions.length}
              approved={intelligence.revisions[0]?.approved ?? false}
              onApprove={() => void approveExtraction()}
              onRetry={() => void retryConversion()}
              onRepair={() => void repairConversion()}
            />
          )}
          {viewMode === "original" && originalUrl ? (
            document.mimeType === "application/pdf" || document.mimeType.startsWith("image/") ? (
              <iframe className="document-original" src={originalUrl} title={`Original ${document.title}`} />
            ) : (
              <div className="original-download">
                <FileText size={24} aria-hidden />
                <strong>{document.filename}</strong>
                <a className="primary" href={originalUrl} download>
                  <Download size={14} aria-hidden /> Download original
                </a>
              </div>
            )
          ) : viewMode === "proposed" && intelligence?.revisions[0] ? (
            <div className="doc-page">
              <Markdown source={intelligence.revisions[0].markdown} />
            </div>
          ) : (
            <div className="doc-page">
              <Markdown source={renderedMarkdown} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ConversionStatus({
  conversion, revisionCount, approved, onApprove, onRetry, onRepair
}: {
  conversion: {
    status: string;
    confidence: number;
    ocrUsed: boolean;
    language: string | null;
    warnings: string[];
    error: string | null;
  };
  revisionCount: number;
  approved: boolean;
  onApprove: () => void;
  onRetry: () => void;
  onRepair: () => void;
}) {
  const attention = conversion.status === "failed" ||
    conversion.status === "review_required" ||
    conversion.confidence < 80;
  return (
    <div className={attention ? "conversion-status attention" : "conversion-status"}>
      <span className={`pill ${conversion.status === "completed" ? "good" : "warn"}`}>
        {conversion.status.replaceAll("_", " ")}
      </span>
      <span>{conversion.confidence}% confidence</span>
      {conversion.ocrUsed && <span>OCR</span>}
      {conversion.language && <span>{conversion.language}</span>}
      <span>{revisionCount} {revisionCount === 1 ? "revision" : "revisions"}</span>
      {(conversion.error || conversion.warnings[0]) && (
        <strong>{conversion.error ?? conversion.warnings[0]}</strong>
      )}
      {!approved && conversion.status !== "failed" && (
        <>
          <button className="secondary" onClick={onRepair}>Repair with AI</button>
          <button className="secondary" onClick={onApprove}>Approve extraction</button>
        </>
      )}
      {conversion.status === "failed" && (
        <button className="secondary" onClick={onRetry}>Retry conversion</button>
      )}
    </div>
  );
}

function describeDocument(document: WorkspaceDocument) {
  return [
    document.filename,
    formatBytes(document.sizeBytes),
    document.pageCount ? plural(document.pageCount, "page") : null,
    plural(document.wordCount, "word")
  ].filter(Boolean).join(" · ");
}

function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
