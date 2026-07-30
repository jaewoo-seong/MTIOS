"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, FileText, Loader2, Plus } from "lucide-react";
import { DOSSIER_DOCUMENT_COLUMN } from "@/lib/collection-columns";
import type { ClientDatabase, ClientRecord } from "@/lib/domain";
import { PromptDialog } from "@/components/ui/dialogs";
import { useI18n } from "@/lib/i18n";

export function ClientDataView({
  onError, onOpenDocument
}: {
  onError: (message: string) => void;
  onOpenDocument?: (documentId: string) => void;
}) {
  const { formatNumber, t } = useI18n();
  const [databases, setDatabases] = useState<ClientDatabase[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [records, setRecords] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadDatabases = useCallback(async () => {
    const response = await fetch("/api/v1/client-databases");
    if (!response.ok) throw new Error("Could not load client databases.");
    const payload = (await response.json()) as { data: ClientDatabase[] };
    setDatabases(payload.data);
    setActiveId((current) => current ?? payload.data[0]?.id ?? null);
  }, []);

  useEffect(() => {
    loadDatabases().catch((reason: Error) => onError(reason.message)).finally(() => setLoading(false));
  }, [loadDatabases, onError]);

  useEffect(() => {
    if (!activeId) {
      setRecords([]);
      return;
    }
    fetch(`/api/v1/client-databases/${activeId}/records`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Could not load records."))))
      .then((payload: { data: ClientRecord[] }) => setRecords(payload.data))
      .catch((reason: Error) => onError(reason.message));
  }, [activeId, onError]);

  async function createDatabase(name: string) {
    setCreating(false);
    try {
      const response = await fetch("/api/v1/client-databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: "" })
      });
      if (!response.ok) throw new Error("Could not create the database.");
      const payload = (await response.json()) as { data: ClientDatabase };
      await loadDatabases();
      setActiveId(payload.data.id);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not create the database.");
    }
  }

  if (loading) {
    return <div className="loading-state"><Loader2 size={20} className="spin" /><span>{t("Loading client data")}</span></div>;
  }

  if (databases.length === 0) {
    return (
      <>
        <div className="empty-module">
          <div className="empty-icon"><Database size={22} aria-hidden /></div>
          <h2>{t("No client databases")}</h2>
          <p>{t("Create a database. Record changes enter through approved project proposals.")}</p>
          <button className="primary" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> {t("Create database")}</button>
        </div>
        {creating && (
          <PromptDialog
            title={t("Create client database")}
            label={t("Database name")}
            placeholder={t("Korean medical device manufacturers")}
            onSubmit={createDatabase}
            onCancel={() => setCreating(false)}
          />
        )}
      </>
    );
  }

  const active = databases.find((database) => database.id === activeId);
  // Union across every row, not just the first: a database holding rows from
  // more than one source would otherwise hide any column the first row lacks.
  const columns = [...new Set(records.flatMap((record) => Object.keys(record.data)))];

  return (
    <div className="documents-layout">
      <aside className="document-folders">
        <div className="list-heading">
          <span>{t("Databases")}</span>
          <button onClick={() => setCreating(true)} aria-label={t("Create database")} title={t("Create database")}>
            <Plus size={14} />
          </button>
        </div>
        {databases.map((database) => (
          <button
            key={database.id}
            className={database.id === activeId ? "active" : ""}
            aria-current={database.id === activeId ? "true" : undefined}
            onClick={() => setActiveId(database.id)}
          >
            <Database size={15} aria-hidden />
            <span className="folder-name">{database.name}</span>
          </button>
        ))}
      </aside>

      <section className="surface document-drop">
        <div className="surface-header">
          <h2>{active?.name ?? t("Records")}</h2>
          <div className="surface-tools">
            <span>{t(records.length === 1 ? "{count} record" : "{count} records", { count: formatNumber(records.length) })}</span>
            <span>{t("Changes require project approval")}</span>
          </div>
        </div>

        {records.length === 0 ? (
          <div className="document-dropzone">
            <strong>{t("No records yet")}</strong>
            <p>{t("Approve a client-data proposal from a project workspace to add records.")}</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map((column) => <th key={column} scope="col">{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    {columns.map((column) => (
                      <td key={column}>
                        {column === DOSSIER_DOCUMENT_COLUMN && record.data[column]
                          ? (
                            <button
                              className="link-button"
                              onClick={() => onOpenDocument?.(record.data[column])}
                            >
                              <FileText size={13} aria-hidden /> {t("View report")}
                            </button>
                          )
                          : record.data[column] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <PromptDialog
          title={t("Create client database")}
          label={t("Database name")}
          placeholder={t("Korean medical device manufacturers")}
          onSubmit={createDatabase}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}
