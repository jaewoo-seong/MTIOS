"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Compass,
  FileText,
  Loader2,
  Play,
  Send,
  Target,
  TriangleAlert
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * The surface for a collection campaign while it is running.
 *
 * The read API behind this already returned everything shown here and had no
 * consumer, which meant a campaign that ran for an hour was observable only as
 * a raw event stream. The three things a person actually needs mid-campaign
 * are: how far along it is, whether it is about to stop for a reason they can
 * fix, and a way to redirect it without throwing away completed work.
 */

type Coverage = {
  targetCount: number | null;
  discovered: number;
  duplicates: number;
  accepted: number;
  rejected: number;
  remaining: number | null;
  saturated: boolean;
  saturationReason: string | null;
};

type Budget = {
  ceilingCents: number;
  authorizedCeilingCents: number;
  spentCents: number;
  researchCostCents: number;
  modelCostCents: number;
  remainingCents: number;
  exhausted: boolean;
  ceilingSource: "campaign" | "default" | "project";
};

type Directive = {
  id: string;
  kind: string;
  instruction: string;
  status: "pending" | "absorbed";
  absorbedStage: string | null;
  createdAt: string;
};

type Candidate = {
  id: string;
  data: Record<string, unknown>;
  dossierStatus: "pending" | "completed" | "disqualified" | "failed";
  dossierReason: string | null;
  linkedRecordId: string | null;
  linkedDocumentId: string | null;
};

type CampaignSummary = {
  campaign: {
    id: string;
    name: string;
    projectId: string;
    status: string;
    targetCount: number | null;
    entitySchema: Array<{ name: string; description: string }>;
    qualificationRules: string[];
  };
  coverage: Coverage | null;
  ceilingCents: number;
};

type CampaignDetail = CampaignSummary & {
  budget: Budget;
  directives: Directive[];
  evidenceReuse: { storedQueries: number; reuseCount: number };
  pendingCount: number;
  candidates: Candidate[];
};

const DIRECTIVE_KINDS = [
  { id: "refocus", label: "Refocus the search" },
  { id: "add_criteria", label: "Add a requirement" },
  { id: "stop_discovery", label: "Stop finding, research what you have" }
] as const;

/** A campaign in these states may still pick up steering and continuation. */
const LIVE_STATUSES = new Set(["active", "draft"]);

function cents(value: number) {
  return `$${(value / 100).toFixed(2)}`;
}

async function campaignRequestError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (response.status === 401) return new Error("Your session expired. Sign in again.");
  if (response.status === 429) return new Error("Too many requests. Wait a moment and try again.");
  if (payload?.error && payload.error !== "internal_error") return new Error(payload.error);
  if (response.status >= 500) {
    return new Error("Campaign data is unavailable. Check the server logs and database migrations.");
  }
  return new Error(fallback);
}

export function CampaignsView({
  projectId, onError, onOpenDocument
}: {
  projectId: string;
  onError: (message: string) => void;
  onOpenDocument?: (documentId: string) => void;
}) {
  const { formatNumber, t } = useI18n();
  const [summaries, setSummaries] = useState<CampaignSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [directiveKind, setDirectiveKind] = useState<string>("refocus");
  const [directiveText, setDirectiveText] = useState("");
  const [ceilingDollars, setCeilingDollars] = useState("");

  const loadSummaries = useCallback(async () => {
    const response = await fetch(
      `/api/v1/collection-campaigns?projectId=${encodeURIComponent(projectId)}`
    );
    if (!response.ok) {
      throw await campaignRequestError(response, "Could not load collection campaigns.");
    }
    const payload = (await response.json()) as { data: CampaignSummary[] };
    setSummaries(payload.data);
    setActiveId((current) =>
      payload.data.some((summary) => summary.campaign.id === current)
        ? current
        : payload.data[0]?.campaign.id ?? null
    );
  }, [projectId]);

  const loadDetail = useCallback(async (campaignId: string) => {
    const response = await fetch(`/api/v1/collection-campaigns/${campaignId}`);
    if (!response.ok) {
      throw await campaignRequestError(response, "Could not load the campaign.");
    }
    const payload = (await response.json()) as { data: CampaignDetail };
    setDetail(payload.data);
  }, []);

  useEffect(() => {
    setLoadError(null);
    loadSummaries()
      .catch((reason: Error) => setLoadError(reason.message))
      .finally(() => setLoading(false));
  }, [loadSummaries]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    loadDetail(activeId).catch((reason: Error) => onError(reason.message));
  }, [activeId, loadDetail, onError]);

  // A running campaign changes without the person doing anything, so the view
  // refreshes itself. Polling only while the campaign is live keeps a finished
  // campaign from generating traffic forever.
  useEffect(() => {
    if (!activeId || !detail || !LIVE_STATUSES.has(detail.campaign.status)) return;
    const timer = setInterval(() => {
      loadDetail(activeId).catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [activeId, detail, loadDetail]);

  async function submitDirective() {
    if (!activeId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/collection-campaigns/${activeId}/directives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: directiveKind, instruction: directiveText })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not send the steering instruction.");
      }
      setDirectiveText("");
      await loadDetail(activeId);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not send the steering instruction.");
    } finally {
      setBusy(false);
    }
  }

  async function continueCampaign(resumeDiscovery: boolean) {
    if (!activeId) return;
    setBusy(true);
    try {
      const raised = Number(ceilingDollars);
      const body: Record<string, unknown> = { resumeDiscovery };
      // Only sent when the field holds a usable number, so continuing without
      // touching the ceiling leaves the existing authorization alone.
      if (ceilingDollars.trim() !== "" && Number.isFinite(raised) && raised > 0) {
        body.ceilingCents = Math.round(raised * 100);
      }
      const response = await fetch(`/api/v1/collection-campaigns/${activeId}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not continue the campaign.");
      }
      setCeilingDollars("");
      await Promise.all([loadDetail(activeId), loadSummaries()]);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not continue the campaign.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface campaign-section">
      <div className="surface-header">
        <h2>{t("Campaigns")}</h2>
        <span>{loading ? "…" : formatNumber(summaries.length)}</span>
      </div>

      {loading ? (
        <div className="loading-state campaign-section-state">
          <Loader2 size={20} className="spin" />
          <span>{t("Loading campaigns")}</span>
        </div>
      ) : loadError ? (
        <div className="error-banner campaign-load-error" role="alert">
          <TriangleAlert size={15} aria-hidden />
          {loadError}
        </div>
      ) : summaries.length === 0 ? (
        <div className="campaign-empty">
          <Compass size={20} aria-hidden />
          <div>
            <strong>{t("No collection campaigns")}</strong>
            <p>{t("Ask the Executive Agent to find multiple entities and write one report on each. A campaign appears here while it runs.")}</p>
          </div>
        </div>
      ) : (
        <div className="campaign-tabs" role="tablist" aria-label={t("Campaigns")}>
          {summaries.map((summary) => (
            <button
              key={summary.campaign.id}
              role="tab"
              className={summary.campaign.id === activeId ? "active" : ""}
              aria-selected={summary.campaign.id === activeId}
              onClick={() => setActiveId(summary.campaign.id)}
            >
              <Target size={15} aria-hidden />
              <span className="folder-name">{summary.campaign.name}</span>
              {summary.coverage && (
                <span className="nav-count">
                  {formatNumber(summary.coverage.accepted)}
                  {summary.coverage.targetCount ? `/${formatNumber(summary.coverage.targetCount)}` : ""}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {!loading && detail && (
        <div className="campaign-detail">
          <div className="surface-header campaign-detail-header">
            <h3>{detail.campaign.name}</h3>
            <span><CampaignStatusLabel status={detail.campaign.status} /></span>
          </div>

          <CampaignProgress coverage={detail.coverage} pendingCount={detail.pendingCount} />

          <div className="campaign-metrics">
            <Metric
              label={t("Spent")}
              value={`${cents(detail.budget.spentCents)} / ${cents(detail.budget.ceilingCents)}`}
              detail={t("{model} models, {research} research", {
                model: cents(detail.budget.modelCostCents),
                research: cents(detail.budget.researchCostCents)
              })}
            />
            <Metric
              label={t("Reports written")}
              value={formatNumber(detail.coverage?.accepted ?? 0)}
              detail={t("{count} awaiting research", { count: formatNumber(detail.pendingCount) })}
            />
            <Metric
              label={t("Searches reused")}
              value={formatNumber(detail.evidenceReuse.reuseCount)}
              detail={t("across {count} stored queries", {
                count: formatNumber(detail.evidenceReuse.storedQueries)
              })}
            />
          </div>

          {detail.budget.exhausted && (
            <div className="error-banner" role="status">
              <TriangleAlert size={15} aria-hidden />
              {detail.budget.ceilingSource === "project"
                ? t("This campaign has reached the project's budget, which caps it below its own ceiling. Raise the project budget to continue.")
                : t("This campaign has reached its spend ceiling. Raise it below to continue without rediscovering anything.")}
            </div>
          )}

          {detail.pendingCount > 0 && (
            <div className="campaign-continue">
              <h3>{t("Continue this campaign")}</h3>
              <p>{t("{count} candidates are still waiting for a report. Continuing researches them without rediscovering or re-paying for anything already found.", {
                count: formatNumber(detail.pendingCount)
              })}</p>
              <div className="campaign-continue-row">
                <label>
                  <span>{t("Raise ceiling to (USD)")}</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={ceilingDollars}
                    placeholder={(detail.budget.authorizedCeilingCents / 100).toFixed(2)}
                    onChange={(event) => setCeilingDollars(event.target.value)}
                  />
                </label>
                <button className="primary" disabled={busy} onClick={() => void continueCampaign(false)}>
                  <Play size={14} aria-hidden /> {t("Research pending")}
                </button>
                <button disabled={busy} onClick={() => void continueCampaign(true)}>
                  <Compass size={14} aria-hidden /> {t("Find more, then research")}
                </button>
              </div>
            </div>
          )}

          <div className="campaign-steering">
            <h3>{t("Steer this campaign")}</h3>
            <p>{t("Takes effect on the next discovery round and before any worker starts its next entity. Finished reports are kept.")}</p>
            <div className="campaign-steering-row">
              <select value={directiveKind} onChange={(event) => setDirectiveKind(event.target.value)}>
                {DIRECTIVE_KINDS.map((kind) => (
                  <option key={kind.id} value={kind.id}>{t(kind.label)}</option>
                ))}
              </select>
              <input
                value={directiveText}
                placeholder={t("Prioritize manufacturers based in Korea")}
                onChange={(event) => setDirectiveText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !busy) void submitDirective();
                }}
              />
              <button className="primary" disabled={busy} onClick={() => void submitDirective()}>
                <Send size={14} aria-hidden /> {t("Send")}
              </button>
            </div>
            {detail.directives.length > 0 && (
              <ul className="campaign-directives">
                {detail.directives.slice(-6).reverse().map((directive) => (
                  <li key={directive.id}>
                    <strong>{directive.kind}</strong>
                    <span>{directive.instruction}</span>
                    <em>
                      {directive.status === "pending"
                        ? t("waiting to be picked up")
                        : t("applied at {stage}", { stage: directive.absorbedStage ?? "" })}
                    </em>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <CandidateTable
            campaign={detail.campaign}
            candidates={detail.candidates}
            onOpenDocument={onOpenDocument}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Status labels are switches over literal strings rather than a computed
 * translation key. A key built by interpolation reads as dynamic to the
 * localization coverage test, so it would silently ship untranslated - the
 * exact drift that test exists to catch.
 */
function CampaignStatusLabel({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "active") return <>{t("Running")}</>;
  if (status === "saturated") return <>{t("Found everything findable")}</>;
  if (status === "draft") return <>{t("Not started")}</>;
  return <>{status}</>;
}

function DossierStatusLabel({ status }: { status: Candidate["dossierStatus"] }) {
  const { t } = useI18n();
  if (status === "completed") return <>{t("Reported")}</>;
  if (status === "disqualified") return <>{t("Did not qualify")}</>;
  if (status === "failed") return <>{t("Failed")}</>;
  return <>{t("Pending")}</>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="campaign-metric">
      <span className="campaign-metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="campaign-metric-detail">{detail}</span>
    </div>
  );
}

/**
 * Progress against the target, with discovery and report-writing shown
 * separately. They move at different times and conflating them makes a
 * campaign that has found everything but written nothing look stalled.
 */
function CampaignProgress({
  coverage, pendingCount
}: {
  coverage: Coverage | null;
  pendingCount: number;
}) {
  const { formatNumber, t } = useI18n();
  if (!coverage) return null;
  const target = coverage.targetCount;
  const pct = (value: number) =>
    target && target > 0 ? `${Math.min(100, Math.round((value / target) * 100))}%` : "0%";

  return (
    <div className="campaign-progress">
      <div className="campaign-progress-row">
        <span>{t("Found")}</span>
        <div className="campaign-bar">
          <div className="campaign-bar-fill discovery" style={{ width: pct(coverage.discovered) }} />
        </div>
        <span>
          {formatNumber(coverage.discovered)}
          {target ? ` / ${formatNumber(target)}` : ""}
        </span>
      </div>
      <div className="campaign-progress-row">
        <span>{t("Reported")}</span>
        <div className="campaign-bar">
          <div className="campaign-bar-fill dossier" style={{ width: pct(coverage.accepted) }} />
        </div>
        <span>
          {formatNumber(coverage.accepted)}
          {target ? ` / ${formatNumber(target)}` : ""}
        </span>
      </div>
      <p className="campaign-progress-note">
        {t("{duplicates} duplicates skipped, {rejected} did not qualify, {pending} pending.", {
          duplicates: formatNumber(coverage.duplicates),
          rejected: formatNumber(coverage.rejected),
          pending: formatNumber(pendingCount)
        })}
        {coverage.saturationReason ? ` ${coverage.saturationReason}` : ""}
      </p>
    </div>
  );
}

function CandidateTable({
  campaign, candidates, onOpenDocument
}: {
  campaign: CampaignDetail["campaign"];
  candidates: Candidate[];
  onOpenDocument?: (documentId: string) => void;
}) {
  const { t } = useI18n();
  if (candidates.length === 0) {
    return (
      <div className="document-dropzone">
        <strong>{t("Nothing found yet")}</strong>
        <p>{t("Discovery is still running. Entities appear here as they are found.")}</p>
      </div>
    );
  }
  // The campaign's own declared fields, in the order it declared them - not the
  // union of whatever keys happen to be on the rows, so an extraction step that
  // returned extra keys cannot widen the table the user agreed to.
  const columns = campaign.entitySchema.map((field) => field.name);

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column} scope="col">{column}</th>)}
            <th scope="col">{t("Status")}</th>
            <th scope="col">{t("Report")}</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr key={candidate.id}>
              {columns.map((column) => (
                <td key={column}>{formatCell(candidate.data[column])}</td>
              ))}
              <td>
                <span className={`campaign-status ${candidate.dossierStatus}`}>
                  <DossierStatusLabel status={candidate.dossierStatus} />
                </span>
                {candidate.dossierStatus === "disqualified" && candidate.dossierReason && (
                  <span className="campaign-status-reason">{candidate.dossierReason}</span>
                )}
              </td>
              <td>
                {candidate.linkedDocumentId
                  ? (
                    <button
                      className="link-button"
                      onClick={() => onOpenDocument?.(candidate.linkedDocumentId as string)}
                    >
                      <FileText size={13} aria-hidden /> {t("View report")}
                    </button>
                  )
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}
