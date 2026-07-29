"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Loader2, Plus } from "lucide-react";
import type { ClientDatabase, ClientRecord } from "@/lib/domain";
import { PromptDialog } from "@/components/ui/dialogs";

export function ClientDataView({ onError }: { onError: (message: string) => void }) {
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
    return <div className="loading-state"><Loader2 size={20} className="spin" /><span>Loading client data</span></div>;
  }

  if (databases.length === 0) {
    return (
      <>
        <div className="empty-module">
          <div className="empty-icon"><Database size={22} aria-hidden /></div>
          <h2>No client databases</h2>
          <p>Create a database. Record changes enter through approved project proposals.</p>
          <button className="primary" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> Create database</button>
        </div>
        {creating && (
          <PromptDialog
            title="Create client database"
            label="Database name"
            placeholder="Korean medical device manufacturers"
            onSubmit={createDatabase}
            onCancel={() => setCreating(false)}
          />
        )}
      </>
    );
  }

  const active = databases.find((database) => database.id === activeId);
  const columns = records.length > 0 ? Object.keys(records[0].data) : [];

  return (
    <div className="documents-layout">
      <aside className="document-folders">
        <div className="list-heading">
          <span>Databases</span>
          <button onClick={() => setCreating(true)} aria-label="Create database" title="Create database">
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
          <h2>{active?.name ?? "Records"}</h2>
          <div className="surface-tools">
            <span>{records.length.toLocaleString()} {records.length === 1 ? "record" : "records"}</span>
            <span>Changes require project approval</span>
          </div>
        </div>

        {records.length === 0 ? (
          <div className="document-dropzone">
            <strong>No records yet</strong>
            <p>Approve a client-data proposal from a project workspace to add records.</p>
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
                    {columns.map((column) => <td key={column}>{record.data[column] ?? ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <PromptDialog
          title="Create client database"
          label="Database name"
          placeholder="Korean medical device manufacturers"
          onSubmit={createDatabase}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}
