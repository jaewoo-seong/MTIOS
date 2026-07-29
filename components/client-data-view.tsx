"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Loader2, Plus, Trash2, Upload } from "lucide-react";
import type { ClientDatabase, ClientRecord } from "@/lib/domain";
import { ConfirmDialog, PromptDialog } from "@/components/ui/dialogs";

export function ClientDataView({ onError }: { onError: (message: string) => void }) {
  const [databases, setDatabases] = useState<ClientDatabase[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [records, setRecords] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClientDatabase | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function importCsv(file: File) {
    if (!activeId) return;
    setImporting(true);
    try {
      const rows = parseDelimited(await file.text(), file.name.endsWith(".tsv") ? "\t" : ",");
      const [header, ...body] = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
      if (!header) throw new Error("The file has no header row.");
      const payloadRows = body.map((row) =>
        Object.fromEntries(header.map((column, index) => [column.trim() || `column_${index + 1}`, row[index] ?? ""]))
      );
      if (payloadRows.length === 0) throw new Error("The file has a header but no data rows.");

      const response = await fetch(`/api/v1/client-databases/${activeId}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: payloadRows })
      });
      if (!response.ok) throw new Error("Could not import the records.");
      const listed = await fetch(`/api/v1/client-databases/${activeId}/records`);
      setRecords(((await listed.json()) as { data: ClientRecord[] }).data);
      await loadDatabases();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not import the file.");
    } finally {
      setImporting(false);
    }
  }

  async function deleteDatabase(database: ClientDatabase) {
    setPendingDelete(null);
    try {
      const response = await fetch(`/api/v1/client-databases/${database.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete the database.");
      setActiveId((current) => (current === database.id ? null : current));
      await loadDatabases();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not delete the database.");
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
          <p>Create a database, then import a CSV or TSV to populate it. Columns are taken from the header row.</p>
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
            <button className="secondary" onClick={() => fileRef.current?.click()} disabled={importing || !activeId}>
              {importing ? <Loader2 size={14} className="spin" aria-hidden /> : <Upload size={14} aria-hidden />}
              {importing ? "Importing" : "Import CSV"}
            </button>
            {active && (
              <button className="icon-only" onClick={() => setPendingDelete(active)} aria-label={`Delete ${active.name}`} title={`Delete ${active.name}`}>
                <Trash2 size={14} aria-hidden />
              </button>
            )}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importCsv(file);
            event.target.value = "";
          }}
        />

        {records.length === 0 ? (
          <div className="document-dropzone">
            <Upload size={22} aria-hidden />
            <strong>No records yet</strong>
            <p>Import a CSV or TSV file. The header row becomes the column set for this database.</p>
            <button className="primary" onClick={() => fileRef.current?.click()} disabled={!activeId}>Choose file</button>
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
      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.name}”?`}
          body={`This removes the database and all ${pendingDelete.recordCount || records.length} of its records. This cannot be undone.`}
          confirmLabel="Delete database"
          destructive
          onConfirm={() => void deleteDatabase(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

/** RFC-4180 reader: quoted fields, escaped quotes, embedded newlines. */
function parseDelimited(input: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  row.push(field);
  rows.push(row);
  return rows;
}
