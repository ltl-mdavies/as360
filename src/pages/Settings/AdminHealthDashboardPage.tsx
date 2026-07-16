import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../app/AppShell";
import Panel from "../../components/common/Panel";
import PageHeader from "../../components/common/PageHeader";
import { useApiClient } from "../../api/useApiClient";
import { useAuth } from "../../auth/AuthProvider";
import {
  fetchAdminHealthSnapshot,
  runLiftReadinessSmokeTest,
  updateAdminHealthIncident,
  type ApiAdminHealthIncident,
  type ApiAdminHealthIssue,
  type ApiAdminHealthRunbook,
  type ApiAdminHealthSnapshot,
  type ApiAdminHealthStatus,
  type ApiAdminHealthSystem,
  type ApiLiftReadinessSmokeResponse,
  type ApiLiftSmokeEndpointResult,
} from "../../api/projects";
import "../../styles/settings.css";

const DEFAULT_INCIDENT_SUMMARY: ApiAdminHealthSnapshot["incidentSummary"] = {
  active: 0,
  acknowledged: 0,
  suppressed: 0,
  resolvedRecently: 0,
  newIncidents: 0,
  recurring: 0,
};

type IssueQueueView = "pending" | "acknowledged" | "suppressed" | "dispositioned" | "resolved" | "all";
type IssueSortMode = "urgency" | "newest" | "oldest";
type IssueVerificationState = {
  status: "checking" | "cleared" | "active";
  checkedAt: string;
  message: string;
  detail?: string;
};
type IncidentAction = "acknowledge" | "resolve" | "suppress" | "reopen";
type IssueResolutionDraft = {
  issueId: string;
  incidentId: string;
  reason: string;
  note: string;
  verificationStatus: "active" | "cleared";
  checkedAt: string;
  message: string;
};
type IncidentTimelineEntry = {
  action: string;
  actorName: string;
  at: string;
  reason?: string;
  note?: string;
};

const RESOLUTION_REASON_OPTIONS = [
  { value: "relinked_lift_order", label: "Relinked Lift order" },
  { value: "order_put_on_hold", label: "Order put on hold" },
  { value: "adspace_order_cancelled", label: "Adspace order cancelled" },
  { value: "vendor_confirmed_clear", label: "Vendor confirmed clear" },
  { value: "configuration_fixed", label: "Configuration fixed" },
  { value: "false_positive", label: "False positive" },
  { value: "verified_clear", label: "Verified clear" },
  { value: "other", label: "Other" },
];

export default function AdminHealthDashboardPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<ApiAdminHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSystemId, setExpandedSystemId] = useState<string | null>(null);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [copiedIssueId, setCopiedIssueId] = useState<string | null>(null);
  const [incidentActionKey, setIncidentActionKey] = useState<string | null>(null);
  const [issueVerification, setIssueVerification] = useState<Record<string, IssueVerificationState>>({});
  const [resolutionDraft, setResolutionDraft] = useState<IssueResolutionDraft | null>(null);
  const [issueQueueView, setIssueQueueView] = useState<IssueQueueView>("pending");
  const [issueSort, setIssueSort] = useState<IssueSortMode>("urgency");
  const [liftSmokeOrder, setLiftSmokeOrder] = useState("A0219609");
  const [liftSmokeResult, setLiftSmokeResult] = useState<ApiLiftReadinessSmokeResponse | null>(null);
  const [liftSmokeLoading, setLiftSmokeLoading] = useState(false);
  const [liftSmokeError, setLiftSmokeError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const result = await fetchAdminHealthSnapshot(api);
      setSnapshot(result);
    } catch (loadError) {
      console.error("Failed to load admin health snapshot", loadError);
      setError("We could not load the latest health snapshot.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void loadSnapshot("initial");
  }, [loadSnapshot]);

  const runbooksById = useMemo(() => new Map((snapshot?.runbooks || []).map((runbook) => [runbook.id, runbook])), [snapshot?.runbooks]);

  const handleCopyIncidentPacket = useCallback(async (issue: ApiAdminHealthIssue, runbook?: ApiAdminHealthRunbook) => {
    const operatorActions = buildIssueOperatorActions(issue, runbook);
    const packetText = buildIncidentPacketText(
      issue,
      runbook,
      operatorActions,
      issueVerification[issue.id],
      typeof window !== "undefined" ? window.location.origin : ""
    );
    try {
      await navigator.clipboard.writeText(packetText);
      setCopiedIssueId(issue.id);
      window.setTimeout(() => {
        setCopiedIssueId((current) => current === issue.id ? null : current);
      }, 2500);
    } catch (copyError) {
      console.error("Failed to copy incident packet", copyError);
      setError("We could not copy the incident packet from this browser.");
    }
  }, [issueVerification]);

  const handleVerifyAndResolve = useCallback(async (issue: ApiAdminHealthIssue) => {
    if (!issue.incident?.id) return;
    const checkedAt = new Date().toISOString();
    const actionKey = `${issue.incident.id}:resolve`;
    setIncidentActionKey(actionKey);
    setResolutionDraft(null);
    setError(null);
    setIssueVerification((current) => ({
      ...current,
      [issue.id]: {
        status: "checking",
        checkedAt,
        message: "Refreshing health evidence before resolution...",
      },
    }));
    try {
      const result = await fetchAdminHealthSnapshot(api);
      setSnapshot(result);
      const stillActive = result.issues.some((nextIssue) =>
        nextIssue.id === issue.id ||
        (issue.incident?.fingerprint && nextIssue.incident?.fingerprint === issue.incident.fingerprint)
      );
      if (stillActive) {
        const activeIssue = findMatchingVerifiedIssue(result.issues, issue);
        const verificationResult = buildVerificationResult(issue, activeIssue || issue, true);
        setIssueVerification((current) => ({
          ...current,
          [issue.id]: {
            status: "active",
            checkedAt: result.checkedAt,
            message: verificationResult.message,
            detail: verificationResult.detail,
          },
        }));
        setResolutionDraft({
          issueId: issue.id,
          incidentId: issue.incident.id,
          reason: isLiftDispositionIssue(issue) ? "order_put_on_hold" : "other",
          note: "",
          verificationStatus: "active",
          checkedAt: result.checkedAt,
          message: `${verificationResult.message} Choose an override reason before resolving.`,
        });
        return;
      }
      const verificationResult = buildVerificationResult(issue, null, false);
      await updateAdminHealthIncident(api, issue.incident.id, "resolve", {
        reason: "verified_clear",
        note: verificationResult.message,
        verificationStatus: "cleared",
      });
      setIssueVerification((current) => ({
        ...current,
        [issue.id]: {
          status: "cleared",
          checkedAt: result.checkedAt,
          message: `${verificationResult.message} Resolved.`,
          detail: verificationResult.detail,
        },
      }));
      await loadSnapshot("refresh");
    } catch (actionError) {
      console.error("Failed to verify and resolve health incident", actionError);
      setError("We could not verify and resolve that incident.");
      setIssueVerification((current) => ({
        ...current,
        [issue.id]: {
          status: "active",
          checkedAt,
          message: "Verification could not refresh the health snapshot.",
        },
      }));
    } finally {
      setIncidentActionKey(null);
    }
  }, [api, loadSnapshot]);

  const handleIncidentAction = useCallback(async (
    issue: ApiAdminHealthIssue,
    action: IncidentAction
  ) => {
    if (!issue.incident?.id) return;
    if (action === "resolve") {
      await handleVerifyAndResolve(issue);
      return;
    }
    const actionKey = `${issue.incident.id}:${action}`;
    setIncidentActionKey(actionKey);
    setError(null);
    try {
      await updateAdminHealthIncident(api, issue.incident.id, action, {
        ...(action === "suppress" ? { hours: 24 } : {}),
        reason: defaultIncidentActionReason(action),
        note: defaultIncidentActionNote(action),
        verificationStatus: "not_checked",
      });
      await loadSnapshot("refresh");
    } catch (actionError) {
      console.error("Failed to update health incident", actionError);
      setError("We could not update that incident action.");
    } finally {
      setIncidentActionKey(null);
    }
  }, [api, handleVerifyAndResolve, loadSnapshot]);

  const handleSubmitResolutionOverride = useCallback(async () => {
    if (!resolutionDraft) return;
    if (!resolutionDraft.reason) {
      setError("Choose a resolution reason before overriding an active issue.");
      return;
    }
    const actionKey = `${resolutionDraft.incidentId}:resolve`;
    setIncidentActionKey(actionKey);
    setError(null);
    try {
      await updateAdminHealthIncident(api, resolutionDraft.incidentId, "resolve", {
        reason: resolutionDraft.reason,
        note: resolutionDraft.note.trim() || resolutionDraft.message,
        verificationStatus: resolutionDraft.verificationStatus,
      });
      setResolutionDraft(null);
      await loadSnapshot("refresh");
    } catch (actionError) {
      console.error("Failed to resolve health incident", actionError);
      setError("We could not resolve that incident.");
    } finally {
      setIncidentActionKey(null);
    }
  }, [api, loadSnapshot, resolutionDraft]);

  const handleVerifyIssue = useCallback(async (issue: ApiAdminHealthIssue) => {
    const checkedAt = new Date().toISOString();
    setIssueVerification((current) => ({
      ...current,
      [issue.id]: {
        status: "checking",
        checkedAt,
        message: "Refreshing health evidence...",
      },
    }));
    setError(null);
    try {
      const result = await fetchAdminHealthSnapshot(api);
      setSnapshot(result);
      const stillActive = result.issues.some((nextIssue) =>
        nextIssue.id === issue.id ||
        (issue.incident?.fingerprint && nextIssue.incident?.fingerprint === issue.incident.fingerprint)
      );
      const activeIssue = stillActive ? findMatchingVerifiedIssue(result.issues, issue) : null;
      const verificationResult = buildVerificationResult(issue, activeIssue, stillActive);
      setIssueVerification((current) => ({
        ...current,
        [issue.id]: {
          status: stillActive ? "active" : "cleared",
          checkedAt: result.checkedAt,
          message: verificationResult.message,
          detail: verificationResult.detail,
        },
      }));
    } catch (verifyError) {
      console.error("Failed to verify health issue", verifyError);
      setIssueVerification((current) => ({
        ...current,
        [issue.id]: {
          status: "active",
          checkedAt,
          message: "Verification could not refresh the health snapshot.",
        },
      }));
      setError("We could not refresh health evidence for that issue.");
    }
  }, [api]);

  const issuesBySystem = useMemo(() => {
    const grouped = new Map<string, ApiAdminHealthIssue[]>();
    for (const issue of snapshot?.issues || []) {
      const existing = grouped.get(issue.systemId) || [];
      existing.push(issue);
      grouped.set(issue.systemId, existing);
    }
    return grouped;
  }, [snapshot?.issues]);

  const healthIssues = useMemo(
    () => sortHealthIssues((snapshot?.issues || []).filter((issue) => issue.severity !== "info"), issueSort),
    [snapshot?.issues, issueSort]
  );
  const pendingIssues = useMemo(() => healthIssues.filter((issue) => issueQueueStatus(issue) === "pending"), [healthIssues]);
  const acknowledgedIssues = useMemo(() => healthIssues.filter((issue) => issueQueueStatus(issue) === "acknowledged"), [healthIssues]);
  const suppressedIssues = useMemo(() => healthIssues.filter((issue) => issueQueueStatus(issue) === "suppressed"), [healthIssues]);
  const incidentSummary = snapshot?.incidentSummary ?? DEFAULT_INCIDENT_SUMMARY;
  const recentIncidents = snapshot?.recentIncidents ?? [];
  const resolvedIncidents = useMemo(
    () => recentIncidents.filter((incident) => incident.status === "resolved"),
    [recentIncidents]
  );
  const dispositionedIncidents = useMemo(
    () => resolvedIncidents.filter(isDispositionedIncident),
    [resolvedIncidents]
  );
  const visibleIssues = useMemo(() => {
    if (issueQueueView === "acknowledged") return acknowledgedIssues;
    if (issueQueueView === "suppressed") return suppressedIssues;
    if (issueQueueView === "resolved" || issueQueueView === "dispositioned") return [];
    if (issueQueueView === "all") return healthIssues;
    return pendingIssues;
  }, [acknowledgedIssues, healthIssues, issueQueueView, pendingIssues, suppressedIssues]);
  const visibleIncidentQueue = useMemo(() => {
    if (issueQueueView === "resolved") return resolvedIncidents;
    if (issueQueueView === "dispositioned") return dispositionedIncidents;
    return [];
  }, [dispositionedIncidents, issueQueueView, resolvedIncidents]);
  const issueQueueCounts = {
    pending: pendingIssues.length,
    acknowledged: acknowledgedIssues.length,
    suppressed: suppressedIssues.length,
    dispositioned: dispositionedIncidents.length,
    resolved: resolvedIncidents.length,
    all: healthIssues.length,
  };

  const orderedSystems = useMemo(
    () => (snapshot?.systems || []).slice().sort((a, b) => statusRank(b.status) - statusRank(a.status) || a.label.localeCompare(b.label)),
    [snapshot?.systems]
  );

  const actionRunbooks = useMemo(() => {
    return pendingIssues
      .map((issue) => {
        const runbook = issue.runbookActionId ? runbooksById.get(issue.runbookActionId) : undefined;
        return runbook ? { issue, runbook } : null;
      })
      .filter((item): item is { issue: ApiAdminHealthIssue; runbook: ApiAdminHealthRunbook } => Boolean(item))
      .slice(0, 5);
  }, [pendingIssues, runbooksById]);

  async function handleRunLiftSmokeTest() {
    const orderNumber = liftSmokeOrder.trim();
    if (!orderNumber) {
      setLiftSmokeError("Enter a Lift order number to test.");
      return;
    }
    setLiftSmokeLoading(true);
    setLiftSmokeError(null);
    try {
      const result = await runLiftReadinessSmokeTest(api, orderNumber);
      setLiftSmokeResult(result);
    } catch (smokeError) {
      console.error("Failed to run Lift readiness smoke test", smokeError);
      setLiftSmokeError("The Lift readiness smoke test could not run.");
    } finally {
      setLiftSmokeLoading(false);
    }
  }

  return (
    <AppShell pageClassName="wide" showNavTrigger>
      <PageHeader
        className="settings-pageHeader"
        title="Health Dashboard"
        subtitle="At-a-glance operational health across Adspace360, AWS foundation, Lift, customers, vendors, notifications, and realtime collaboration."
        backLabel="← Projects"
        onBack={() => navigate("/customer/projects")}
        actions={
          <div className="settings-actions settings-actions-header">
            <button className="btn btn-ghost btn-soft" type="button" onClick={() => navigate("/admin/settings")}>
              Admin Setup
            </button>
            <button className="btn btn-primary" type="button" onClick={() => void loadSnapshot("refresh")} disabled={refreshing}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        }
      />

      <div className="settings-grid settings-healthGrid">
        <Panel className={`settings-panel settings-panel-hero settings-healthHero settings-healthHero-${snapshot?.overallStatus || "watch"}`}>
          {loading && !snapshot ? (
            <div className="assign-empty">
              <div className="assign-empty-title">Loading health snapshot</div>
              <div className="assign-empty-body">Checking the current operational posture.</div>
            </div>
          ) : error && !snapshot ? (
            <div className="assign-empty">
              <div className="assign-empty-title">Health snapshot unavailable</div>
              <div className="assign-empty-body">{error}</div>
            </div>
          ) : snapshot ? (
            <div className="settings-healthHeroInner">
              <div>
                <div className="settings-sectionEyebrow">Current Health</div>
                <div className="settings-healthStatusRow">
                  <h2 className="settings-healthStatusTitle">{overallStatusCopy(snapshot.overallStatus)}</h2>
                  <span className={`chip ${statusTone(snapshot.overallStatus)}`}>{statusLabel(snapshot.overallStatus)}</span>
                </div>
                <p className="settings-copy settings-healthCopy">
                  {pendingIssues.length
                    ? `${pendingIssues.length} pending issue${pendingIssues.length === 1 ? "" : "s"} need operator review.`
                    : "No active warnings or errors are currently detected."}
                </p>
                <div className="settings-healthMeta">
                  <span>Checked {formatDate(snapshot.checkedAt, true)}</span>
                  <span>{user?.displayName || "Admin User"}</span>
                  <span>{incidentSummary.newIncidents} new / {incidentSummary.recurring} recurring</span>
                </div>
              </div>
              <div className="settings-healthSummaryGrid">
                <HealthCount label="Good" value={snapshot.summaryCounts.systemsGood} tone="success" />
                <HealthCount label="Watch" value={snapshot.summaryCounts.systemsWatch} tone="warning" />
                <HealthCount label="Degraded" value={snapshot.summaryCounts.systemsDegraded} tone="danger" />
                <HealthCount label="Blocked" value={snapshot.summaryCounts.systemsBlocked} tone="danger" />
              </div>
            </div>
          ) : null}
        </Panel>

        {snapshot ? (
          <>
            <Panel className="settings-panel settings-panel-wide">
              <div className="settings-cardHead settings-healthSectionHead">
                <div>
                  <div className="settings-sectionEyebrow">Systems</div>
                  <h3 className="settings-cardTitle">Operational posture</h3>
                </div>
                <span className="chip tone-info">{snapshot.systems.length} systems</span>
              </div>
              <div className="settings-healthSystemGrid">
                {orderedSystems.map((system) => (
                  <SystemCard
                    key={system.id}
                    system={system}
                    issues={issuesBySystem.get(system.id) || []}
                    expanded={expandedSystemId === system.id}
                    onToggle={() => setExpandedSystemId((current) => current === system.id ? null : system.id)}
                  />
                ))}
              </div>
            </Panel>

            <Panel className="settings-panel settings-panel-wide">
              <div className="settings-cardHead settings-healthSectionHead">
                <div>
                  <div className="settings-sectionEyebrow">Issue Queue</div>
                  <h3 className="settings-cardTitle">{issueQueueTitle(issueQueueView)}</h3>
                </div>
                <span className={`chip ${pendingIssues.length ? "tone-warning" : "tone-success"}`}>
                  {pendingIssues.length ? `${pendingIssues.length} pending` : "Clear"}
                </span>
              </div>
              <div className="settings-healthQueueToolbar">
                <div className="settings-healthQueueTabs" aria-label="Issue queue">
                  {(["pending", "acknowledged", "suppressed", "dispositioned", "resolved", "all"] as IssueQueueView[]).map((view) => (
                    <button
                      key={view}
                      className={`settings-healthQueueTab ${issueQueueView === view ? "is-active" : ""}`}
                      type="button"
                      onClick={() => setIssueQueueView(view)}
                    >
                      <span>{issueQueueLabel(view)}</span>
                      <strong>{issueQueueCounts[view]}</strong>
                    </button>
                  ))}
                </div>
                <label className="settings-healthSort">
                  <span>Sort</span>
                  <select value={issueSort} onChange={(event) => setIssueSort(event.target.value as IssueSortMode)}>
                    <option value="urgency">Urgency</option>
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                  </select>
                </label>
              </div>
              {visibleIssues.length ? (
                <div className="settings-healthIssueList">
                  {visibleIssues.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      runbook={issue.runbookActionId ? runbooksById.get(issue.runbookActionId) : undefined}
                      expanded={expandedIssueId === issue.id}
                      copied={copiedIssueId === issue.id}
                      actionKey={incidentActionKey}
                      verification={issueVerification[issue.id]}
                      resolutionDraft={resolutionDraft?.issueId === issue.id ? resolutionDraft : null}
                      onToggle={() => setExpandedIssueId((current) => current === issue.id ? null : issue.id)}
                      onCopy={() => void handleCopyIncidentPacket(issue, issue.runbookActionId ? runbooksById.get(issue.runbookActionId) : undefined)}
                      onOpenPath={(path) => navigate(path)}
                      onIncidentAction={(action) => void handleIncidentAction(issue, action)}
                      onVerify={() => void handleVerifyIssue(issue)}
                      onResolutionDraftChange={setResolutionDraft}
                      onResolutionOverrideSubmit={() => void handleSubmitResolutionOverride()}
                      onResolutionOverrideCancel={() => setResolutionDraft(null)}
                    />
                  ))}
                </div>
              ) : visibleIncidentQueue.length ? (
                <div className="settings-healthIncidentList settings-healthIncidentList-queue">
                  {visibleIncidentQueue.map((incident) => (
                    <IncidentActivity key={incident.id} incident={incident} />
                  ))}
                </div>
              ) : (
                <div className="settings-healthClear">
                  <div className="settings-healthClearTitle">{emptyQueueTitle(issueQueueView)}</div>
                  <div className="settings-healthClearBody">{emptyQueueBody(issueQueueView)}</div>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Action Center</div>
                  <h3 className="settings-cardTitle">Mapped runbooks</h3>
                </div>
                <span className={`chip ${actionRunbooks.length ? "tone-info" : "tone-success"}`}>
                  {actionRunbooks.length ? `${actionRunbooks.length} ready` : "Clear"}
                </span>
              </div>
              <div className="settings-healthActionCenter">
                {actionRunbooks.length ? actionRunbooks.map(({ issue, runbook }) => (
                  <RunbookActionItem
                    key={`${issue.id}:${runbook.id}`}
                    issue={issue}
                    runbook={runbook}
                    primaryAction={buildIssueOperatorActions(issue, runbook)[0]}
                    onOpenIssue={() => setExpandedIssueId(issue.id)}
                    onOpenPath={(path) => navigate(path)}
                  />
                )) : (
                  <div className="settings-healthClearBody">No mapped operator actions are pending.</div>
                )}
              </div>
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Incident State</div>
                  <h3 className="settings-cardTitle">Recent activity</h3>
                </div>
                <span className="chip tone-info">{incidentSummary.resolvedRecently} resolved</span>
              </div>
              <div className="settings-healthIncidentSummary">
                <HealthCount label="Active" value={incidentSummary.active} tone="danger" />
                <HealthCount label="Acked" value={incidentSummary.acknowledged} tone="warning" />
                <HealthCount label="Muted" value={incidentSummary.suppressed} tone="warning" />
              </div>
              <div className="settings-healthIncidentList">
                {recentIncidents.length ? recentIncidents.slice(0, 5).map((incident) => (
                  <IncidentActivity key={incident.id} incident={incident} />
                )) : (
                  <div className="settings-healthClearBody">No incident activity has been recorded yet.</div>
                )}
              </div>
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Next Checks</div>
                  <h3 className="settings-cardTitle">Operator guidance</h3>
                </div>
              </div>
              <div className="settings-stack">
                {snapshot.nextRecommendedChecks.map((check) => (
                  <div key={check} className="settings-healthAction">{check}</div>
                ))}
              </div>
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">MVP Boundary</div>
                  <h3 className="settings-cardTitle">What this checks</h3>
                </div>
                <span className="chip tone-info">Read-only</span>
              </div>
              <div className="settings-stack">
                <div className="settings-kv"><span className="settings-k">Current scope</span><span className="settings-v">Existing app data, AWS reachability, CloudWatch metrics, SES posture, audit events, presence, notifications, and Lift posture</span></div>
                <div className="settings-kv"><span className="settings-k">Follow-up</span><span className="settings-v">Log excerpts, object-level S3 checks, AI triage, and guarded repair actions</span></div>
              </div>
            </Panel>
          </>
        ) : null}

        <Panel className="settings-panel settings-panel-wide">
          <div className="settings-cardHead">
            <div>
              <div className="settings-sectionEyebrow">Lift Readiness</div>
              <h3 className="settings-cardTitle">Read-only endpoint smoke test</h3>
            </div>
            <span className="chip tone-info">No write</span>
          </div>
          <div className="settings-subsection">
            <div className="settings-subsectionHead">
              <div className="settings-subsectionTitle">Validate current Lift read contracts</div>
              <div className="settings-subsectionMeta">
                Tests AS360Orders, ShippingReport, AS360ProofReport, and the Lift order deep-link resolver for one existing Lift order.
              </div>
            </div>
            <div className="settings-smokeBar">
              <label className="settings-field settings-smokeField">
                <span className="settings-fieldLabel">Lift order number</span>
                <input
                  className="settings-input field-input"
                  value={liftSmokeOrder}
                  onChange={(event) => setLiftSmokeOrder(event.target.value)}
                  placeholder="A0219609"
                />
              </label>
              <button className="btn btn-primary" type="button" onClick={handleRunLiftSmokeTest} disabled={liftSmokeLoading}>
                {liftSmokeLoading ? "Testing..." : "Run Read-Only Test"}
              </button>
            </div>
            {liftSmokeError ? <div className="settings-note settings-note-warning">{liftSmokeError}</div> : null}
            {liftSmokeResult ? (
              <div className="settings-smokeResult">
                <div className="settings-listMeta">
                  Tested {liftSmokeResult.orderNumber} against {liftSmokeResult.activeEnvironment === "prod" ? "Production" : "QA1"} at{" "}
                  {formatDate(liftSmokeResult.testedAt, true)}.
                </div>
                <div className="settings-smokeGrid">
                  <LiftSmokeCard result={liftSmokeResult.endpoints.orderSync} />
                  <LiftSmokeCard result={liftSmokeResult.endpoints.shippingReport} />
                  <LiftSmokeCard result={liftSmokeResult.endpoints.proofReport} />
                  <LiftSmokeCard result={liftSmokeResult.endpoints.orderUrl} />
                </div>
              </div>
            ) : (
              <div className="settings-note">
                Suggested first test: <strong>A0219609</strong>, the recent Apex-created Lift order used to validate the current slim read reports.
              </div>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

function HealthCount({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "danger" }) {
  return (
    <div className={`settings-healthCount settings-healthCount-${tone}`}>
      <div className="settings-healthCountValue">{value}</div>
      <div className="settings-healthCountLabel">{label}</div>
    </div>
  );
}

function SystemCard({
  system,
  issues,
  expanded,
  onToggle,
}: {
  system: ApiAdminHealthSystem;
  issues: ApiAdminHealthIssue[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const details = Object.entries(system.details || {});
  return (
    <article className={`settings-healthSystem settings-healthSystem-${system.status}`}>
      <button className="settings-healthSystemButton" type="button" onClick={onToggle} aria-expanded={expanded}>
        <span className="settings-healthSystemTop">
          <span className="settings-healthSystemName">{system.label}</span>
          <span className={`chip ${statusTone(system.status)}`}>{statusLabel(system.status)}</span>
        </span>
        <span className="settings-healthSystemSummary">{system.summary}</span>
        <span className="settings-healthSystemMeta">
          <span>{system.issueCount} issue{system.issueCount === 1 ? "" : "s"}</span>
          <span>Checked {formatDate(system.lastCheckedAt, true)}</span>
        </span>
      </button>
      {expanded ? (
        <div className="settings-healthSystemDetails">
          {issues.length ? (
            <div className="settings-healthMiniIssues">
              {issues.slice(0, 3).map((issue) => (
                <div key={issue.id} className="settings-healthMiniIssue">
                  <span className={`settings-healthDot settings-healthDot-${issue.severity}`} />
                  <span>{issue.title}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="settings-healthDetailsGrid">
            {details.slice(0, 8).map(([key, value]) => (
              <div key={key} className="settings-healthDetail">
                <span>{formatHealthKey(key)}</span>
                <strong>{formatHealthValue(value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function IssueCard({
  issue,
  runbook,
  expanded,
  copied,
  actionKey,
  verification,
  resolutionDraft,
  onToggle,
  onCopy,
  onOpenPath,
  onIncidentAction,
  onVerify,
  onResolutionDraftChange,
  onResolutionOverrideSubmit,
  onResolutionOverrideCancel,
}: {
  issue: ApiAdminHealthIssue;
  runbook?: ApiAdminHealthRunbook;
  expanded: boolean;
  copied: boolean;
  actionKey: string | null;
  verification?: IssueVerificationState;
  resolutionDraft?: IssueResolutionDraft | null;
  onToggle: () => void;
  onCopy: () => void;
  onOpenPath: (path: string) => void;
  onIncidentAction: (action: IncidentAction) => void;
  onVerify: () => void;
  onResolutionDraftChange: (draft: IssueResolutionDraft) => void;
  onResolutionOverrideSubmit: () => void;
  onResolutionOverrideCancel: () => void;
}) {
  const incidentStatus = issue.incident?.status || "active";
  const operatorActions = buildIssueOperatorActions(issue, runbook);
  const quickOperatorActions = operatorActions.slice(0, 3);
  return (
    <article className={`settings-healthIssue settings-healthIssue-${issue.severity}`}>
      <button className="settings-healthIssueButton" type="button" onClick={onToggle} aria-expanded={expanded}>
        <span className="settings-healthIssueTop">
          <span className={`settings-healthDot settings-healthDot-${issue.severity}`} />
          <span className="settings-healthIssueTitle">{titleCase(issue.title)}</span>
          <span className={`chip ${severityTone(issue.severity)}`}>{issue.severity}</span>
          {issue.incident ? <span className={`chip ${incidentTone(issue.incident.status)}`}>{incidentLabel(issue.incident.status)}</span> : null}
        </span>
        <span className="settings-healthIssueMessage">{issue.message}</span>
        <IssueDependency dependency={issue.dependency} />
        <span className="settings-healthIssueMeta">
          <ScopeMeta scope={issue.scope} fallback={issue.source} />
          <span>
            {incidentStatus === "suppressed" && issue.incident?.suppressedUntil
              ? `Suppressed ${formatTimeRemaining(issue.incident.suppressedUntil)}`
              : formatDate(issue.detectedAt, true)}
          </span>
        </span>
      </button>
      {quickOperatorActions.length ? (
        <div className="settings-healthIssueDrillActions" aria-label={`${issue.title} drill-through actions`}>
          {quickOperatorActions.map((action) => (
            <button
              key={action.id}
              className={`btn ${action.tone === "primary" ? "btn-primary" : "btn-ghost btn-soft"} ${action.tone === "danger" ? "settings-dangerAction" : ""}`}
              type="button"
              onClick={() => onOpenPath(action.path)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {issue.incident ? (
        <div className="settings-healthIssueQuickActions" aria-label={`${issue.title} incident actions`}>
          {incidentStatus === "active" ? (
            <button className="btn btn-ghost btn-soft" type="button" onClick={() => onIncidentAction("acknowledge")} disabled={actionKey === `${issue.incident.id}:acknowledge`}>
              {actionKey === `${issue.incident.id}:acknowledge` ? "Saving..." : "Acknowledge"}
            </button>
          ) : (
            <button className="btn btn-ghost btn-soft" type="button" onClick={() => onIncidentAction("reopen")} disabled={actionKey === `${issue.incident.id}:reopen`}>
              {actionKey === `${issue.incident.id}:reopen` ? "Saving..." : "Reopen"}
            </button>
          )}
          {incidentStatus !== "suppressed" ? (
            <button className="btn btn-ghost btn-soft" type="button" onClick={() => onIncidentAction("suppress")} disabled={actionKey === `${issue.incident.id}:suppress`}>
              {actionKey === `${issue.incident.id}:suppress` ? "Saving..." : "Suppress 24h"}
            </button>
          ) : null}
          <button className="btn btn-ghost btn-soft" type="button" onClick={() => onIncidentAction("resolve")} disabled={actionKey === `${issue.incident.id}:resolve`}>
            {actionKey === `${issue.incident.id}:resolve` ? "Verifying..." : "Verify & resolve"}
          </button>
        </div>
      ) : null}
      {expanded ? (
        <div className="settings-healthIssueDetails">
          <div className="settings-kv"><span className="settings-k">Recommended action</span><span className="settings-v">{issue.recommendedAction}</span></div>
          {issue.dependency ? <div className="settings-kv"><span className="settings-k">Dependency</span><span className="settings-v">{issue.dependency.message}</span></div> : null}
          <div className="settings-kv"><span className="settings-k">Source</span><span className="settings-v">{issue.source}</span></div>
          <IssueEvidencePanel issue={issue} operatorActions={operatorActions} verification={verification} />
          <div className="settings-healthOperatorPanel">
            <div className="settings-healthOperatorTop">
              <div>
                <div className="settings-listTitle">Operator actions</div>
                <div className="settings-listMeta">{operatorActionSummary(issue)}</div>
              </div>
              {verification ? (
                <span className={`chip ${verification.status === "cleared" ? "tone-success" : verification.status === "checking" ? "tone-info" : "tone-warning"}`}>
                  {verification.status === "cleared" ? "Cleared" : verification.status === "checking" ? "Checking" : "Still active"}
                </span>
              ) : null}
            </div>
            <div className="settings-healthOperatorActions">
              {operatorActions.map((action) => (
                <button
                  key={action.id}
                  className={`btn ${action.tone === "primary" ? "btn-primary" : "btn-ghost btn-soft"} ${action.tone === "danger" ? "settings-dangerAction" : ""}`}
                  type="button"
                  onClick={() => onOpenPath(action.path)}
                >
                  {action.label}
                </button>
              ))}
              <button className="btn btn-ghost btn-soft" type="button" onClick={onVerify} disabled={verification?.status === "checking"}>
                {verification?.status === "checking" ? "Verifying..." : "Refresh & verify"}
              </button>
            </div>
            {verification ? (
              <div className={`settings-healthVerification settings-healthVerification-${verification.status}`}>
                <div>
                  <strong>{verification.message}</strong>
                  {verification.detail ? <em>{verification.detail}</em> : null}
                </div>
                <span>Last checked {formatDate(verification.checkedAt, true)}</span>
              </div>
            ) : null}
            {resolutionDraft ? (
              <div className="settings-healthResolutionPanel">
                <div>
                  <div className="settings-listTitle">Manual resolution override</div>
                  <div className="settings-listMeta">{resolutionDraft.message}</div>
                </div>
                <label className="settings-field">
                  <span className="settings-fieldLabel">Resolution reason</span>
                  <select
                    className="select settings-input"
                    value={resolutionDraft.reason}
                    onChange={(event) => onResolutionDraftChange({ ...resolutionDraft, reason: event.target.value })}
                  >
                    {RESOLUTION_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span className="settings-fieldLabel">Operator note</span>
                  <textarea
                    className="field-input settings-input settings-healthResolutionNote"
                    value={resolutionDraft.note}
                    onChange={(event) => onResolutionDraftChange({ ...resolutionDraft, note: event.target.value })}
                    placeholder="Optional context for why this active issue can be resolved."
                  />
                </label>
                <div className="settings-healthResolutionActions">
                  <button className="btn btn-ghost btn-soft" type="button" onClick={onResolutionOverrideCancel}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" type="button" onClick={onResolutionOverrideSubmit} disabled={actionKey === `${issue.incident?.id}:resolve`}>
                    {actionKey === `${issue.incident?.id}:resolve` ? "Saving..." : "Resolve with override"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {runbook ? (
            <div className="settings-healthRunbook">
              <div className="settings-healthRunbookTop">
                <div>
                  <div className="settings-listTitle">{runbook.label}</div>
                  <div className="settings-listMeta">{runbook.summary}</div>
                </div>
                <span className={`chip ${runbookSafetyTone(runbook.safety)}`}>{runbookSafetyLabel(runbook.safety)}</span>
              </div>
              <ol className="settings-healthRunbookSteps">
                {runbook.operatorSteps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              {runbook.evidenceHints.length ? (
                <div className="settings-healthRunbookHints">
                  {runbook.evidenceHints.slice(0, 5).map((hint) => <span key={hint}>{formatHealthKey(hint)}</span>)}
                </div>
              ) : null}
              {runbook.appPath ? (
                <div className="settings-healthRunbookActions">
                  <button className="btn btn-ghost btn-soft" type="button" onClick={() => onOpenPath(runbook.appPath as string)}>
                    {runbook.actionLabel || "Open related page"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : issue.runbookActionId ? (
            <div className="settings-kv"><span className="settings-k">Runbook</span><span className="settings-v">{issue.runbookActionId}</span></div>
          ) : null}
          {issue.incident ? (
            <>
              <div className="settings-healthIncidentMeta">
                <div className="settings-healthDetail"><span>First seen</span><strong>{formatDate(issue.incident.firstSeenAt, true)}</strong></div>
                <div className="settings-healthDetail"><span>Last seen</span><strong>{formatDate(issue.incident.lastSeenAt, true)}</strong></div>
                <div className="settings-healthDetail"><span>Occurrences</span><strong>{issue.incident.occurrenceCount}</strong></div>
                <div className="settings-healthDetail"><span>Last action</span><strong>{formatIncidentAction(issue.incident.lastOperatorAction)}</strong></div>
                {issue.incident.lastOperatorReason ? <div className="settings-healthDetail"><span>Reason</span><strong>{formatIncidentAction(issue.incident.lastOperatorReason)}</strong></div> : null}
                {issue.incident.suppressedUntil ? <div className="settings-healthDetail"><span>Suppressed until</span><strong>{formatDate(issue.incident.suppressedUntil, true)}</strong></div> : null}
              </div>
              <IncidentTimeline incident={issue.incident} />
            </>
          ) : null}
          <div className="settings-healthIssueActions">
            <button className="btn btn-ghost btn-soft" type="button" onClick={onCopy}>
              {copied ? "Packet copied" : "Copy incident packet"}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function IssueEvidencePanel({
  issue,
  operatorActions,
  verification,
}: {
  issue: ApiAdminHealthIssue;
  operatorActions: IssueOperatorAction[];
  verification?: IssueVerificationState;
}) {
  const items = buildIssueEvidenceItems(issue, verification);
  const primaryAction = operatorActions[0];
  const evidence = issue.incidentPacket?.evidence || {};
  const mappingVenueIds = isLiftProductMappingIssue(issue) ? evidenceArray(evidence, "venueIds") : [];
  const mappingInventoryIds = isLiftProductMappingIssue(issue) ? evidenceArray(evidence, "sampleInventoryIds") : [];
  return (
    <div className="settings-healthEvidencePanel">
      <div className="settings-healthEvidenceTop">
        <div>
          <div className="settings-listTitle">Evidence</div>
          <div className="settings-listMeta">{buildIssueTypeLabel(issue)} · {issue.source}</div>
        </div>
        <span className={`chip ${severityTone(issue.severity)}`}>{issue.severity}</span>
      </div>
      <div className="settings-healthEvidenceGrid">
        {items.slice(0, 12).map((item) => (
          <div key={`${item.label}:${item.value}`} className="settings-healthEvidenceItem">
            <span>{item.label}</span>
            <strong title={item.value}>{item.value}</strong>
          </div>
        ))}
      </div>
      {mappingVenueIds.length || mappingInventoryIds.length ? (
        <div className="settings-healthEvidenceSamples">
          {mappingVenueIds.length ? (
            <div>
              <span>Affected venues</span>
              <strong>{mappingVenueIds.slice(0, 6).join(", ")}</strong>
            </div>
          ) : null}
          {mappingInventoryIds.length ? (
            <div>
              <span>Sample inventory IDs</span>
              <strong>{mappingInventoryIds.slice(0, 8).join(", ")}</strong>
            </div>
          ) : null}
        </div>
      ) : null}
      {primaryAction ? (
        <div className="settings-healthEvidenceLinks">
          <span>Primary link</span>
          <strong>{primaryAction.label}</strong>
          <code>{primaryAction.path}</code>
        </div>
      ) : null}
    </div>
  );
}

function RunbookActionItem({
  issue,
  runbook,
  primaryAction,
  onOpenIssue,
  onOpenPath,
}: {
  issue: ApiAdminHealthIssue;
  runbook: ApiAdminHealthRunbook;
  primaryAction?: IssueOperatorAction;
  onOpenIssue: () => void;
  onOpenPath: (path: string) => void;
}) {
  return (
    <article className="settings-healthActionItem">
      <div className="settings-healthActionItemTop">
        <span className={`settings-healthDot settings-healthDot-${issue.severity}`} />
        <div>
          <div className="settings-listTitle">{runbook.label}</div>
          <div className="settings-listMeta">{titleCase(issue.title)} · {issue.source}</div>
          <IssueDependency dependency={issue.dependency} />
          <ScopeMeta scope={issue.scope} />
        </div>
        <span className={`chip ${runbookSafetyTone(runbook.safety)}`}>{runbookSafetyLabel(runbook.safety)}</span>
      </div>
      <div className="settings-healthActionItemSummary">{runbook.summary}</div>
      <div className="settings-healthActionItemActions">
        <button className="btn btn-ghost btn-soft" type="button" onClick={onOpenIssue}>
          View issue
        </button>
        {primaryAction ? (
          <button
            className={`btn ${primaryAction.tone === "primary" ? "btn-primary" : "btn-ghost btn-soft"} ${primaryAction.tone === "danger" ? "settings-dangerAction" : ""}`}
            type="button"
            onClick={() => onOpenPath(primaryAction.path)}
          >
            {primaryAction.label || runbook.actionLabel || "Open page"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function IssueDependency({ dependency }: { dependency?: ApiAdminHealthIssue["dependency"] }) {
  if (!dependency) return null;
  return (
    <span className="settings-healthDependency">
      <span>Caused by</span>
      <strong>{titleCase(dependency.title)}</strong>
      <em>{dependency.message}</em>
    </span>
  );
}

function IncidentActivity({ incident }: { incident: ApiAdminHealthIncident }) {
  return (
    <div className="settings-healthIncidentItem">
      <div>
        <div className="settings-listTitle">{titleCase(incident.title)}</div>
        <div className="settings-listMeta">
          {incidentLabel(incident.status)} · {incident.occurrenceCount} occurrence{incident.occurrenceCount === 1 ? "" : "s"} · last seen {formatDate(incident.lastSeenAt, true)}
        </div>
        <ScopeMeta scope={incident.scope} />
      </div>
      <span className={`chip ${incidentTone(incident.status)}`}>{incidentLabel(incident.status)}</span>
    </div>
  );
}

function IncidentTimeline({ incident }: { incident: NonNullable<ApiAdminHealthIssue["incident"]> }) {
  const entries = buildIncidentTimelineEntries(incident);
  if (!entries.length) return null;
  return (
    <div className="settings-healthTimeline">
      <div className="settings-listTitle">Incident timeline</div>
      <div className="settings-healthTimelineItems">
        {entries.map((entry) => (
          <div key={`${entry.action}-${entry.at}`} className="settings-healthTimelineItem">
            <span className="settings-healthTimelineDot" />
            <div>
              <strong>{formatIncidentAction(entry.action)}</strong>
              <span>{entry.actorName ? `${entry.actorName} · ` : ""}{formatDate(entry.at, true)}</span>
              {entry.reason ? <em>{formatIncidentAction(entry.reason)}</em> : null}
              {entry.note ? <p>{entry.note}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScopeMeta({ scope, fallback }: { scope?: ApiAdminHealthIssue["scope"]; fallback?: string }) {
  const items = buildScopeMetaItems(scope);
  if (!items.length) {
    return fallback ? <span className="settings-healthScopeFallback">{fallback}</span> : null;
  }
  return (
    <span className="settings-healthScopeMeta">
      {items.map((item) => (
        <span key={item.label} className="settings-healthScopePill">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </span>
      ))}
    </span>
  );
}

function LiftSmokeCard({ result }: { result: ApiLiftSmokeEndpointResult }) {
  const missing = result.requiredFieldsMissing || [];
  return (
    <div className={`settings-smokeCard ${result.ok ? "is-ok" : result.configured ? "is-watch" : "is-missing"}`}>
      <div className="settings-cardHead">
        <div>
          <div className="settings-listTitle">{result.label}</div>
          <div className="settings-listMeta">
            {result.urlHost || "No endpoint configured"}
            {result.durationMs !== undefined ? ` • ${result.durationMs}ms` : ""}
            {result.status ? ` • HTTP ${result.status}` : ""}
          </div>
        </div>
        <span className={`chip ${result.ok ? "tone-success" : result.configured ? "tone-warning" : "tone-danger"}`}>
          {result.ok ? "Healthy" : result.configured ? "Check" : "Missing"}
        </span>
      </div>
      <p className="settings-smokeMessage">{result.message}</p>
      <div className="settings-smokeMetaGrid">
        {result.rowCount !== undefined ? <SmokeMetric label="Rows" value={result.rowCount} /> : null}
        {result.lineCount !== undefined ? <SmokeMetric label="Lines" value={result.lineCount} /> : null}
        {result.completeRowCount !== undefined ? <SmokeMetric label="Complete rows" value={result.completeRowCount} success /> : null}
        {missing.length ? <SmokeMetric label="Missing fields" value={missing.length} warning /> : result.requiredFieldsPresent?.length ? <SmokeMetric label="Fields present" value={result.requiredFieldsPresent.length} success /> : null}
      </div>
      {missing.length ? <div className="settings-smokeMissing">{missing.slice(0, 5).join(", ")}{missing.length > 5 ? "..." : ""}</div> : null}
      {result.sample ? <SmokeSample sample={result.sample} /> : null}
    </div>
  );
}

function SmokeMetric({ label, value, success, warning }: { label: string; value: number; success?: boolean; warning?: boolean }) {
  return (
    <div className={`settings-kvCard ${success ? "settings-kvCard-success" : warning ? "settings-kvCard-warning" : ""}`.trim()}>
      <div className="settings-kvValue">{value}</div>
      <div className="settings-kvLabel">{label}</div>
    </div>
  );
}

function SmokeSample({ sample }: { sample: Record<string, unknown> }) {
  const entries = Object.entries(sample).filter(([, value]) => value !== undefined && value !== null && String(value).length > 0);
  if (!entries.length) return null;
  return (
    <div className="settings-smokeSample">
      {entries.slice(0, 6).map(([key, value]) => (
        <div key={key} className="settings-kv">
          <span className="settings-k">{formatHealthKey(key)}</span>
          <span className="settings-v">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function statusRank(status: ApiAdminHealthStatus) {
  if (status === "blocked") return 4;
  if (status === "degraded") return 3;
  if (status === "watch") return 2;
  return 1;
}

function issueQueueStatus(issue: ApiAdminHealthIssue): IssueQueueView | "resolved" {
  if (issue.incident?.status === "acknowledged") return "acknowledged";
  if (issue.incident?.status === "suppressed") return "suppressed";
  if (issue.incident?.status === "resolved") return "resolved";
  return "pending";
}

function sortHealthIssues(issues: ApiAdminHealthIssue[], sortMode: IssueSortMode) {
  const sorted = issues.slice();
  if (sortMode === "newest") return sorted.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  if (sortMode === "oldest") return sorted.sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
  return sorted.sort((a, b) =>
    healthIssueSeverityRank(b.severity) - healthIssueSeverityRank(a.severity) ||
    b.detectedAt.localeCompare(a.detectedAt)
  );
}

function healthIssueSeverityRank(severity: ApiAdminHealthIssue["severity"]) {
  if (severity === "blocked") return 4;
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function findMatchingVerifiedIssue(issues: ApiAdminHealthIssue[], issue: ApiAdminHealthIssue) {
  return issues.find((nextIssue) =>
    nextIssue.id === issue.id ||
    (issue.incident?.fingerprint && nextIssue.incident?.fingerprint === issue.incident.fingerprint)
  ) || null;
}

function buildVerificationResult(
  originalIssue: ApiAdminHealthIssue,
  activeIssue: ApiAdminHealthIssue | null,
  stillActive: boolean
): { message: string; detail?: string } {
  const issue = activeIssue || originalIssue;
  const evidence = issue.incidentPacket?.evidence || {};
  if (stillActive) {
    if (isLiftDispositionIssue(issue)) {
      return {
        message: "Still active: the linked Lift order still needs an Adspace disposition.",
        detail: "Relink the order, put it on hold, or cancel the Adspace order before resolving.",
      };
    }
    if (isDependencyOnlyIssue(issue)) {
      return {
        message: "Still active: vendor actions are still locked by the parent Lift issue.",
        detail: "Resolve the linked Lift order health issue first, then verify this issue again.",
      };
    }
    if (isShippingUnmappedIssue(issue)) {
      return {
        message: "Still active: ShippingReport lines are still unmapped.",
        detail: verificationEvidenceDetail(evidence, ["unmappedLineCount", "firstLiftOrderLineId", "firstTrackingNumber"]),
      };
    }
    if (isShippingTransitIssue(issue)) {
      return {
        message: "Still active: Lift shipment activity is still ahead of Adspace transit approval.",
        detail: verificationEvidenceDetail(evidence, ["transitStatus", "shippedLineCount", "firstTrackingNumber"]),
      };
    }
    if (isLiftConfigurationIssue(issue)) {
      return {
        message: "Still active: Lift configuration is still incomplete.",
        detail: "Complete the active Lift credentials and endpoint settings, then run the smoke test again.",
      };
    }
    if (isStaleLiftSyncIssue(issue)) {
      return {
        message: "Still active: Lift sync is still stale.",
        detail: verificationEvidenceDetail(evidence, ["projectIds", "waitingProofLines"]),
      };
    }
    if (isProofIssue(issue)) {
      return {
        message: "Still active: proof evidence still needs attention.",
        detail: verificationEvidenceDetail(evidence, ["proofLineIds", "waitingProofLines", "projectIds"]),
      };
    }
    return {
      message: "Still active in the latest health snapshot.",
      detail: issue.recommendedAction,
    };
  }

  if (isLiftDispositionIssue(originalIssue)) {
    return {
      message: "Cleared: the Lift order blocker is no longer active.",
      detail: "The order was relinked, placed on hold, cancelled, or otherwise removed from active health.",
    };
  }
  if (isDependencyOnlyIssue(originalIssue)) {
    return {
      message: "Cleared: the dependent vendor lock is no longer active.",
      detail: "The parent Lift issue is no longer blocking primary vendor progress.",
    };
  }
  if (isShippingUnmappedIssue(originalIssue)) {
    return {
      message: "Cleared: ShippingReport rows now map cleanly or no longer require action.",
      detail: "No unmapped ShippingReport issue was returned in the refreshed snapshot.",
    };
  }
  if (isShippingTransitIssue(originalIssue)) {
    return {
      message: "Cleared: Lift shipping and Adspace transit no longer disagree.",
      detail: "No shipping/transit mismatch was returned in the refreshed snapshot.",
    };
  }
  if (isLiftConfigurationIssue(originalIssue)) {
    return {
      message: "Cleared: Lift configuration no longer appears incomplete.",
      detail: "The refreshed health snapshot did not return this configuration issue.",
    };
  }
  if (isStaleLiftSyncIssue(originalIssue)) {
    return {
      message: "Cleared: Lift sync freshness is back within the monitored window.",
      detail: "The refreshed health snapshot did not return this stale sync issue.",
    };
  }
  if (isProofIssue(originalIssue)) {
    return {
      message: "Cleared: proof health no longer reports this issue.",
      detail: "The refreshed health snapshot did not return the proof warning/error.",
    };
  }
  return {
    message: "Cleared from active health.",
    detail: "The refreshed health snapshot did not return this issue.",
  };
}

function verificationEvidenceDetail(evidence: Record<string, unknown>, keys: string[]) {
  const parts = keys
    .map((key) => {
      const value = evidence[key];
      if (value === undefined || value === null || value === "") return "";
      if (Array.isArray(value)) return `${formatHealthKey(key)}: ${value.slice(0, 3).join(", ")}${value.length > 3 ? ` +${value.length - 3}` : ""}`;
      return `${formatHealthKey(key)}: ${String(value)}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

type IssueEvidenceItem = {
  label: string;
  value: string;
};

function buildIssueEvidenceItems(issue: ApiAdminHealthIssue, verification?: IssueVerificationState): IssueEvidenceItem[] {
  const evidence = issue.incidentPacket?.evidence || {};
  const scope = issue.scope || {};
  const orderValue = [scope.orderName || scope.projectTitle, scope.orderNumber || scope.orderId].filter(Boolean).join(" · ");
  const items: Array<IssueEvidenceItem | null> = [
    { label: "System", value: formatHealthKey(issue.systemId) },
    { label: "Severity", value: issue.severity },
    scope.customerName ? { label: "Customer", value: scope.customerName } : null,
    orderValue ? { label: "Order", value: orderValue } : null,
    scope.liftOrderId ? { label: "Lift order", value: scope.liftOrderId } : evidenceString(evidence, "liftOrderId", "Lift order"),
    scope.lineNumber != null ? { label: "Line", value: String(scope.lineNumber) } : evidenceString(evidence, "firstLineNumber", "Line"),
    scope.filename ? { label: "File", value: scope.filename } : evidenceString(evidence, "firstFilename", "File"),
    evidenceString(evidence, "firstTrackingNumber", "Tracking"),
    evidenceString(evidence, "firstShippingStatus", "Ship status"),
    evidenceString(evidence, "firstShipMethod", "Ship method"),
    evidenceString(evidence, "firstActualShipDate", "Ship date"),
    evidenceString(evidence, "transitStatus", "Transit status"),
    evidenceString(evidence, "productIdentifierMode", "Lift submit context"),
    evidenceString(evidence, "missingInventoryCount", "Missing inventory"),
    evidenceString(evidence, "affectedVenueCount", "Affected venues"),
    evidenceString(evidence, "shippedLineCount", "Shipped lines"),
    evidenceString(evidence, "unmappedLineCount", "Unmapped lines"),
    evidenceString(evidence, "firstLiftOrderLineId", "Lift line"),
    issue.dependency ? { label: "Dependency", value: issue.dependency.title } : null,
    verification ? { label: "Verification", value: verification.status } : null,
  ];
  return dedupeEvidenceItems(items.filter((item): item is IssueEvidenceItem => Boolean(item)));
}

function evidenceString(evidence: Record<string, unknown>, key: string, label: string): IssueEvidenceItem | null {
  const value = evidence[key];
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) {
    if (!value.length) return null;
    return { label, value: value.slice(0, 4).map((entry) => String(entry)).join(", ") };
  }
  if (typeof value === "object") return null;
  return { label, value: String(value) };
}

function evidenceArray(evidence: Record<string, unknown>, key: string) {
  const value = evidence[key];
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function dedupeEvidenceItems(items: IssueEvidenceItem[]) {
  const seen = new Set<string>();
  const deduped: IssueEvidenceItem[] = [];
  for (const item of items) {
    const key = `${item.label}:${item.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function buildIssueTypeLabel(issue: ApiAdminHealthIssue) {
  if (isShippingUnmappedIssue(issue)) return "Shipping line mapping";
  if (isLiftProductMappingIssue(issue)) return "Lift product mapping";
  if (isShippingTransitIssue(issue)) return "Shipping / transit mismatch";
  if (isLiftDispositionIssue(issue)) return "Lift order disposition";
  if (isDependencyOnlyIssue(issue)) return "Dependency lock";
  if (isLiftConfigurationIssue(issue)) return "Lift configuration";
  if (isStaleLiftSyncIssue(issue)) return "Lift sync freshness";
  if (isProofIssue(issue)) return "Proof operations";
  if (isDocumentIssue(issue)) return "Document / asset health";
  return titleCase(issue.title);
}

function buildIncidentPacketText(
  issue: ApiAdminHealthIssue,
  runbook: ApiAdminHealthRunbook | undefined,
  operatorActions: IssueOperatorAction[],
  verification: IssueVerificationState | undefined,
  origin: string
) {
  const evidenceItems = buildIssueEvidenceItems(issue, verification);
  const actionLinks = operatorActions.map((action) => ({
    id: action.id,
    label: action.label,
    path: action.path,
    url: absoluteAppUrl(action.path, origin),
    tone: action.tone,
  }));
  const structuredPacket = {
    id: issue.id,
    title: issue.title,
    issueType: buildIssueTypeLabel(issue),
    message: issue.message,
    systemId: issue.systemId,
    severity: issue.severity,
    source: issue.source,
    detectedAt: issue.detectedAt,
    scope: issue.scope || null,
    recommendedAction: issue.recommendedAction,
    dependency: issue.dependency || null,
    appLinks: actionLinks,
    verification: verification || null,
    runbook: runbook ? {
      id: runbook.id,
      label: runbook.label,
      safety: runbook.safety,
      summary: runbook.summary,
      operatorSteps: runbook.operatorSteps,
      evidenceHints: runbook.evidenceHints,
    } : null,
    incidentPacket: issue.incidentPacket,
    aiReady: {
      issueType: buildIssueTypeLabel(issue),
      systemId: issue.systemId,
      severity: issue.severity,
      status: issue.incident?.status || "active",
      evidence: issue.incidentPacket?.evidence || {},
      normalizedEvidence: evidenceItems,
      allowedActions: actionLinks.map((action) => ({ id: action.id, label: action.label, url: action.url })),
      recommendedAction: issue.recommendedAction,
      verification: verification || null,
    },
  };
  const readableEvidence = evidenceItems.length
    ? evidenceItems.map((item) => `- ${item.label}: ${item.value}`).join("\n")
    : "- No normalized evidence fields were available.";
  const readableLinks = actionLinks.length
    ? actionLinks.map((action) => `- ${action.label}: ${action.url}`).join("\n")
    : "- No direct app links were available.";
  const verificationText = verification
    ? `${verification.status}: ${verification.message}${verification.detail ? ` ${verification.detail}` : ""} Last checked ${formatDate(verification.checkedAt, true)}.`
    : "Not verified in this browser session.";

  return [
    "Adspace360 Health Incident Packet",
    "",
    `Issue: ${titleCase(issue.title)}`,
    `Type: ${buildIssueTypeLabel(issue)}`,
    `System: ${formatHealthKey(issue.systemId)}`,
    `Severity: ${issue.severity}`,
    `Status: ${issue.incident?.status || "active"}`,
    `Detected: ${formatDate(issue.detectedAt, true)}`,
    "",
    "Summary",
    issue.message,
    "",
    "Recommended action",
    issue.recommendedAction,
    "",
    "Evidence",
    readableEvidence,
    "",
    "Direct app links",
    readableLinks,
    "",
    "Verification",
    verificationText,
    "",
    "AI-ready structured context",
    JSON.stringify(structuredPacket.aiReady, null, 2),
    "",
    "Full structured JSON",
    JSON.stringify(structuredPacket, null, 2),
  ].join("\n");
}

function absoluteAppUrl(path: string, origin: string) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const safeOrigin = origin || "https://app.adspace360.com";
  return `${safeOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}

type IssueOperatorAction = {
  id: string;
  label: string;
  path: string;
  tone: "primary" | "secondary" | "danger";
};

function buildIssueOperatorActions(issue: ApiAdminHealthIssue, runbook?: ApiAdminHealthRunbook): IssueOperatorAction[] {
  const projectPath = issue.scope?.projectId ? buildProjectPath(issue.scope.projectId) : "";
  const transitPath = issue.scope?.projectId ? buildProjectPath(issue.scope.projectId, "transit") : "";
  const proofsPath = issue.scope?.projectId ? buildProjectPath(issue.scope.projectId, "proofs") : "";
  const documentsPath = issue.scope?.projectId ? buildProjectPath(issue.scope.projectId, "docs") : "";
  const vendorOrderPath = buildVendorOrderPath(issue);
  const projectDetailsPath = (healthAction: "relink_lift" | "hold_order" | "cancel_order") =>
    issue.scope?.projectId ? buildProjectPath(issue.scope.projectId, undefined, { panel: "details", healthAction }) : "";

  if (isShippingTransitIssue(issue)) {
    return dedupeIssueActions([
      transitPath ? { id: "open_transit", label: "Open Transit", path: transitPath, tone: "primary" } : null,
      vendorOrderPath ? { id: "open_vendor_order", label: "Open Vendor Order", path: vendorOrderPath, tone: "secondary" } : null,
      projectPath ? { id: "open_hub", label: "Open Hub", path: projectPath, tone: "secondary" } : null,
    ]);
  }

  if (isShippingUnmappedIssue(issue)) {
    return dedupeIssueActions([
      vendorOrderPath ? { id: "open_vendor_order", label: "Open Vendor Order", path: vendorOrderPath, tone: "primary" } : null,
      projectPath ? { id: "open_hub", label: "Open Hub", path: projectPath, tone: vendorOrderPath ? "secondary" : "primary" } : null,
      transitPath ? { id: "open_transit", label: "Open Transit", path: transitPath, tone: "secondary" } : null,
    ]);
  }

  if (isLiftDispositionIssue(issue)) {
    return dedupeIssueActions([
      projectDetailsPath("relink_lift") ? { id: "relink_lift", label: "Relink Lift Order", path: projectDetailsPath("relink_lift"), tone: "primary" } : null,
      projectDetailsPath("hold_order") ? { id: "hold_order", label: "Put Order On Hold", path: projectDetailsPath("hold_order"), tone: "secondary" } : null,
      projectDetailsPath("cancel_order") ? { id: "cancel_order", label: "Cancel Adspace Order", path: projectDetailsPath("cancel_order"), tone: "danger" } : null,
      projectPath ? { id: "open_hub", label: "Open Hub", path: projectPath, tone: "secondary" } : null,
      !projectPath && runbook?.appPath ? { id: "open_runbook", label: runbook.actionLabel || "Open related page", path: runbook.appPath, tone: "primary" } : null,
    ]);
  }

  if (isDependencyOnlyIssue(issue) && projectPath) {
    return dedupeIssueActions([
      { id: "fix_parent", label: "Fix Parent Issue", path: projectDetailsPath("relink_lift") || projectPath, tone: "primary" },
      { id: "open_hub", label: "Open Hub", path: projectPath, tone: "secondary" },
    ]);
  }

  if (isAdminSettingsIssue(issue, runbook)) {
    return dedupeIssueActions([
      runbook?.appPath ? { id: "open_admin_settings", label: runbook.actionLabel || "Open Admin Settings", path: runbook.appPath, tone: "primary" } : null,
      { id: "open_admin_settings_fallback", label: "Open Admin Settings", path: "/admin/settings", tone: "primary" },
    ]);
  }

  if (isLiftProductMappingIssue(issue)) {
    const venueIds = evidenceArray(issue.incidentPacket?.evidence || {}, "venueIds");
    const venuePath = venueIds[0]
      ? `/admin/venues?venue=${encodeURIComponent(venueIds[0])}`
      : "/admin/venues";
    return dedupeIssueActions([
      { id: "open_venue_mapping", label: "Open Venue Mapping", path: venuePath, tone: "primary" },
      runbook?.appPath ? { id: "open_runbook", label: runbook.actionLabel || "Open Venue Management", path: runbook.appPath, tone: "secondary" } : null,
    ]);
  }

  if (isProofIssue(issue)) {
    return dedupeIssueActions([
      proofsPath ? { id: "open_proofs", label: "Open Proofs", path: proofsPath, tone: "primary" } : null,
      projectPath ? { id: "open_hub", label: "Open Hub", path: projectPath, tone: proofsPath ? "secondary" : "primary" } : null,
      runbook?.appPath ? { id: "open_runbook", label: runbook.actionLabel || "Open related page", path: runbook.appPath, tone: "secondary" } : null,
    ]);
  }

  if (isDocumentIssue(issue)) {
    return dedupeIssueActions([
      documentsPath ? { id: "open_documents", label: "Open Documents", path: documentsPath, tone: "primary" } : null,
      projectPath ? { id: "open_hub", label: "Open Hub", path: projectPath, tone: documentsPath ? "secondary" : "primary" } : null,
      runbook?.appPath ? { id: "open_runbook", label: runbook.actionLabel || "Open related page", path: runbook.appPath, tone: "secondary" } : null,
    ]);
  }

  return dedupeIssueActions([
    vendorOrderPath ? { id: "open_vendor_order", label: "Open Vendor Order", path: vendorOrderPath, tone: "primary" } : null,
    projectPath ? { id: "open_hub", label: "Open Hub", path: projectPath, tone: vendorOrderPath ? "secondary" : "primary" } : null,
    runbook?.appPath ? { id: "open_runbook", label: runbook.actionLabel || "Open related page", path: runbook.appPath, tone: projectPath ? "secondary" : "primary" } : null,
  ]);
}

function buildProjectPath(
  projectId: string,
  workspace?: "transit" | "proofs" | "docs",
  params?: Record<string, string>
) {
  const search = new URLSearchParams({ mode: "customer", ...(params || {}) });
  const suffix = workspace ? `/${workspace}` : "";
  return `/p/${encodeURIComponent(projectId)}${suffix}?${search.toString()}`;
}

function buildVendorOrderPath(issue: ApiAdminHealthIssue) {
  const projectId = issue.scope?.projectId;
  const vendorAccountId = issue.scope?.vendorAccountId;
  if (!projectId || !vendorAccountId) return "";
  return `/vendor/orders/${encodeURIComponent(`${projectId}__${vendorAccountId}`)}`;
}

function dedupeIssueActions(actions: Array<IssueOperatorAction | null>) {
  const seen = new Set<string>();
  const filtered: IssueOperatorAction[] = [];
  for (const action of actions) {
    if (!action || !action.path || seen.has(action.path)) continue;
    seen.add(action.path);
    filtered.push(action);
  }
  return filtered.slice(0, 4);
}

function isLiftDispositionIssue(issue: ApiAdminHealthIssue) {
  const haystack = `${issue.title} ${issue.message} ${issue.runbookActionId || ""}`.toLowerCase();
  return haystack.includes("lift order unavailable") || haystack.includes("review_lift_order_health");
}

function isShippingTransitIssue(issue: ApiAdminHealthIssue) {
  const haystack = `${issue.title} ${issue.message} ${issue.source} ${issue.runbookActionId || ""}`.toLowerCase();
  return !isShippingUnmappedIssue(issue) && (
    haystack.includes("shipping without transit") ||
    haystack.includes("shipment activity") ||
    (haystack.includes("review_lift_shipping_transit_mismatch") && haystack.includes("transit"))
  );
}

function isShippingUnmappedIssue(issue: ApiAdminHealthIssue) {
  const haystack = `${issue.title} ${issue.message} ${issue.source}`.toLowerCase();
  return haystack.includes("shipping line unmapped") || haystack.includes("unmapped shippingreport");
}

function isLiftProductMappingIssue(issue: ApiAdminHealthIssue) {
  const haystack = `${issue.title} ${issue.message} ${issue.source} ${issue.runbookActionId || ""}`.toLowerCase();
  return haystack.includes("lift product") || haystack.includes("venue_inventory_lift_mapping") || haystack.includes("review_lift_product_mapping");
}

function isLiftConfigurationIssue(issue: ApiAdminHealthIssue) {
  const haystack = `${issue.title} ${issue.message} ${issue.source} ${issue.runbookActionId || ""}`.toLowerCase();
  return haystack.includes("lift configuration incomplete") || haystack.includes("open_admin_lift_settings");
}

function isStaleLiftSyncIssue(issue: ApiAdminHealthIssue) {
  const haystack = `${issue.title} ${issue.message} ${issue.source} ${issue.runbookActionId || ""}`.toLowerCase();
  return haystack.includes("stale lift sync") || haystack.includes("project_lift_sync");
}

function isAdminSettingsIssue(issue: ApiAdminHealthIssue, runbook?: ApiAdminHealthRunbook) {
  const haystack = `${issue.title} ${issue.message} ${issue.source} ${issue.runbookActionId || ""} ${runbook?.appPath || ""}`.toLowerCase();
  return haystack.includes("admin_settings") || haystack.includes("configuration") || haystack.includes("/admin/settings");
}

function isProofIssue(issue: ApiAdminHealthIssue) {
  const haystack = `${issue.title} ${issue.message} ${issue.systemId} ${issue.source} ${issue.runbookActionId || ""}`.toLowerCase();
  return haystack.includes("proof") || haystack.includes("proof_ops");
}

function isDocumentIssue(issue: ApiAdminHealthIssue) {
  const haystack = `${issue.title} ${issue.message} ${issue.source}`.toLowerCase();
  return haystack.includes("document") || haystack.includes("asset bucket");
}

function isDependencyOnlyIssue(issue: ApiAdminHealthIssue) {
  const haystack = `${issue.title} ${issue.dependency?.title || ""}`.toLowerCase();
  return haystack.includes("primary vendor actions locked") || haystack.includes("lift order unavailable");
}

function isDispositionedIncident(incident: ApiAdminHealthIncident) {
  const haystack = `${incident.title} ${incident.message} ${incident.lastOperatorAction || ""}`.toLowerCase();
  return incident.status === "resolved" && (
    haystack.includes("lift order unavailable") ||
    haystack.includes("primary vendor actions locked") ||
    haystack.includes("auto_resolved")
  );
}

function operatorActionSummary(issue: ApiAdminHealthIssue) {
  if (isLiftDispositionIssue(issue)) {
    return "Choose the intended order path, save it in Project Details, then refresh verification here.";
  }
  if (isDependencyOnlyIssue(issue)) {
    return "This issue depends on the parent Lift order issue. Fix that first, then verify this card.";
  }
  return "Open the related workspace or runbook, then refresh verification after the workflow succeeds.";
}

function issueQueueLabel(view: IssueQueueView) {
  if (view === "pending") return "Pending";
  if (view === "acknowledged") return "Acked";
  if (view === "suppressed") return "Suppressed";
  if (view === "dispositioned") return "Dispositioned";
  if (view === "resolved") return "Resolved";
  return "All";
}

function issueQueueTitle(view: IssueQueueView) {
  if (view === "pending") return "Pending operator work";
  if (view === "acknowledged") return "Acknowledged issues";
  if (view === "suppressed") return "Suppressed issues";
  if (view === "dispositioned") return "Dispositioned / cleared";
  if (view === "resolved") return "Recently resolved";
  return "All current issues";
}

function emptyQueueTitle(view: IssueQueueView) {
  if (view === "pending") return "Everything looks good";
  if (view === "acknowledged") return "No acknowledged issues";
  if (view === "suppressed") return "No suppressed issues";
  if (view === "dispositioned") return "No dispositioned issues";
  if (view === "resolved") return "No recently resolved issues";
  return "No current issues";
}

function emptyQueueBody(view: IssueQueueView) {
  if (view === "pending") return "No pending warnings or errors need operator review.";
  if (view === "acknowledged") return "Acknowledged issues will appear here after an operator takes ownership.";
  if (view === "suppressed") return "Suppressed issues will appear here with their mute window.";
  if (view === "dispositioned") return "Lift/vendor blockers that clear after a relink, hold, or cancellation will appear here.";
  if (view === "resolved") return "Resolved incidents from the recent health window will appear here.";
  return "All monitored systems are clear based on the current health signals.";
}

function statusLabel(status: ApiAdminHealthStatus) {
  if (status === "good") return "Good";
  if (status === "watch") return "Watch";
  if (status === "degraded") return "Degraded";
  return "Blocked";
}

function overallStatusCopy(status: ApiAdminHealthStatus) {
  if (status === "good") return "Everything looks good";
  if (status === "watch") return "Worth watching";
  if (status === "degraded") return "Some systems are degraded";
  return "Operator action required";
}

function statusTone(status: ApiAdminHealthStatus) {
  if (status === "good") return "tone-success";
  if (status === "watch") return "tone-warning";
  return "tone-danger";
}

function severityTone(severity: ApiAdminHealthIssue["severity"]) {
  if (severity === "info") return "tone-info";
  if (severity === "warning") return "tone-warning";
  return "tone-danger";
}

function runbookSafetyLabel(safety: ApiAdminHealthRunbook["safety"]) {
  if (safety === "read_only") return "Read-only";
  if (safety === "guarded_write") return "Guarded";
  return "Review";
}

function runbookSafetyTone(safety: ApiAdminHealthRunbook["safety"]) {
  if (safety === "read_only") return "tone-success";
  if (safety === "guarded_write") return "tone-warning";
  return "tone-info";
}

function buildScopeMetaItems(scope?: ApiAdminHealthIssue["scope"]) {
  if (!scope) return [];
  const orderNumber = scope.orderNumber || scope.orderId;
  const items: Array<{ label: string; value: string }> = [];
  if (scope.customerName) items.push({ label: "Customer", value: scope.customerName });
  if (scope.orderName || orderNumber) {
    const orderParts = [scope.orderName || scope.projectTitle, orderNumber].filter(Boolean);
    items.push({ label: "Order", value: orderParts.join(" · ") });
  } else if (scope.projectTitle) {
    items.push({ label: "Order", value: scope.projectTitle });
  }
  if (scope.lineNumber != null) items.push({ label: "Line", value: String(scope.lineNumber) });
  if (scope.filename) items.push({ label: "File", value: scope.filename });
  if (!items.length && scope.vendorName) items.push({ label: "Vendor", value: scope.vendorName });
  return items.slice(0, 4);
}

function incidentLabel(status: ApiAdminHealthIncident["status"]) {
  if (status === "acknowledged") return "Acknowledged";
  if (status === "resolved") return "Resolved";
  if (status === "suppressed") return "Suppressed";
  return "Active";
}

function incidentTone(status: ApiAdminHealthIncident["status"]) {
  if (status === "resolved") return "tone-success";
  if (status === "suppressed" || status === "acknowledged") return "tone-warning";
  return "tone-danger";
}

function formatIncidentAction(value: string | null | undefined) {
  if (!value) return "None";
  return titleCase(value);
}

function defaultIncidentActionReason(action: IncidentAction) {
  if (action === "acknowledge") return "ownership_assigned";
  if (action === "suppress") return "temporary_noise_reduction";
  if (action === "reopen") return "needs_review";
  return "other";
}

function defaultIncidentActionNote(action: IncidentAction) {
  if (action === "acknowledge") return "Operator acknowledged the incident from the Health dashboard.";
  if (action === "suppress") return "Operator suppressed the incident for 24 hours from the Health dashboard.";
  if (action === "reopen") return "Operator reopened the incident from the Health dashboard.";
  return undefined;
}

function buildIncidentTimelineEntries(incident: NonNullable<ApiAdminHealthIssue["incident"]>) {
  const detected: IncidentTimelineEntry = {
    action: "detected",
    actorName: "Health monitor",
    at: incident.firstSeenAt,
  };
  const history: IncidentTimelineEntry[] = (incident.actionHistory || []).map((entry) => ({
    action: entry.action,
    actorName: entry.actorName,
    at: entry.at,
    reason: entry.reason,
    note: entry.note,
  }));
  if (history.length) return [detected, ...history].slice(-8);
  if (!incident.lastOperatorAction || !incident.lastOperatorActionAt) return [detected];
  return [
    detected,
    {
      action: incident.lastOperatorAction,
      actorName: incident.lastOperatorName || "Operator",
      at: incident.lastOperatorActionAt,
      reason: incident.lastOperatorReason,
      note: incident.lastOperatorNote,
    },
  ];
}

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "Not checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

function formatTimeRemaining(value: string | null | undefined) {
  if (!value) return "";
  const until = Date.parse(value);
  if (Number.isNaN(until)) return `until ${value}`;
  const remainingMs = until - Date.now();
  if (remainingMs <= 0) return "expired";
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.max(1, Math.round((remainingMs % (60 * 60 * 1000)) / (60 * 1000)));
  if (hours <= 0) return `${minutes}m left`;
  return `${hours}h ${minutes}m left`;
}

function formatHealthKey(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

function formatHealthValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) return `${value.length}`;
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 4)
      .map(([key, entryValue]) => `${formatHealthKey(key)}: ${formatHealthValue(entryValue)}`)
      .join(", ");
  }
  return String(value);
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
