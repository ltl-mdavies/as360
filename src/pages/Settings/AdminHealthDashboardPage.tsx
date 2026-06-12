import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../app/AppShell";
import Panel from "../../components/common/Panel";
import PageHeader from "../../components/common/PageHeader";
import { useApiClient } from "../../api/useApiClient";
import { useAuth } from "../../auth/AuthProvider";
import {
  fetchAdminSettings,
  fetchRecentWorkflowIssues,
  runLiftReadinessSmokeTest,
  type ApiAdminSettingsResponse,
  type ApiLiftReadinessSmokeResponse,
  type ApiLiftSmokeEndpointResult,
  type ApiRecentWorkflowIssue,
} from "../../api/projects";
import "../../styles/settings.css";

type CustomerRecord = {
  id: string;
  name: string;
  status?: "active" | "suspended" | "inactive";
  isActive: boolean;
};

type MarketRecord = {
  id: string;
  customerId: string;
  name: string;
  isActive: boolean;
};

type VenueRecord = {
  id: string;
  customerId: string;
  marketId: string;
  customerName?: string;
  marketName?: string;
  name: string;
  isActive: boolean;
};

type ProjectRecord = {
  id: string;
  title: string;
  projectMode?: "live" | "internal_sandbox";
  customerName?: string;
  sourceCustomerName?: string;
  venueName?: string;
  liftOrderId?: string | null;
  proofs?: {
    total: number;
    approved: number;
    pending: number;
    waitingForProof?: number;
  };
  production?: {
    ready: boolean;
    released: boolean;
  };
};

type ReadinessGate = {
  label: string;
  state: "ready" | "watch" | "blocked";
  detail: string;
};

export default function AdminHealthDashboardPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [markets, setMarkets] = useState<MarketRecord[]>([]);
  const [venues, setVenues] = useState<VenueRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [recentIssues, setRecentIssues] = useState<ApiRecentWorkflowIssue[]>([]);
  const [adminSettings, setAdminSettings] = useState<ApiAdminSettingsResponse | null>(null);
  const [liftSmokeOrder, setLiftSmokeOrder] = useState("A0219609");
  const [liftSmokeResult, setLiftSmokeResult] = useState<ApiLiftReadinessSmokeResponse | null>(null);
  const [liftSmokeLoading, setLiftSmokeLoading] = useState(false);
  const [liftSmokeError, setLiftSmokeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      setLoading(true);
      setError(null);
      try {
        const customerResponse = await api.request<{ customers: CustomerRecord[] }>("/api/customers?lite=1");
        if (cancelled) return;

        const activeCustomers = (customerResponse.customers || []).filter(
          (customer) => (customer.status || (customer.isActive === false ? "inactive" : "active")) === "active"
        );
        setCustomers(activeCustomers);

        const [venueResponse, projectResponse, settingsResponse, issuesResponse] = await Promise.all([
          api.request<{ venues: VenueRecord[] }>("/api/venues?lite=1"),
          api.request<{ projects: ProjectRecord[] }>("/api/projects"),
          fetchAdminSettings(api),
          fetchRecentWorkflowIssues(api, 8),
        ]);
        if (cancelled) return;

        const activeVenues = (venueResponse.venues || []).filter((venue) => venue.isActive !== false);
        setVenues(activeVenues);
        setMarkets(deriveMarketsFromVenues(activeVenues));
        setProjects(projectResponse.projects || []);
        setAdminSettings(settingsResponse);
        setRecentIssues(issuesResponse.issues || []);
      } catch (loadError) {
        if (cancelled) return;
        console.error("Failed to load admin health snapshot", loadError);
        setError("We could not load the latest health snapshot.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const stats = useMemo(() => {
    const releasedProjects = projects.filter((project) => project.production?.released).length;
    const submittedProjects = projects.filter((project) => project.liftOrderId).length;
    const awaitingRelease = projects.filter((project) => project.production?.ready && !project.production?.released).length;
    return [
      { label: "Active Customers", value: customers.length, tone: "info" },
      { label: "Active Markets", value: markets.length, tone: "neutral" },
      { label: "Active Venues", value: venues.length, tone: "success" },
      { label: "Live Projects", value: projects.length, tone: "warning" },
      { label: "Submitted Orders", value: submittedProjects, tone: "neutral" },
      { label: "Released Projects", value: releasedProjects, tone: "success" },
      { label: "Awaiting Release", value: awaitingRelease, tone: "warning" },
    ] as const;
  }, [customers.length, markets.length, projects, venues.length]);

  const integrationPosture = useMemo(() => {
    const vendor = adminSettings?.settings.integrations.primaryPrintVendor;
    if (!adminSettings || !vendor || !vendor.enabled) return { label: "Disabled", tone: "tone-neutral", detail: "Primary print vendor config is currently disabled." };
    const activeEnvironment = vendor.environments[vendor.activeEnvironment];
    const hasLiveValidatedLift = projects.some((project) => Boolean(project.liftOrderId));
    const endpointConfigured = [
      activeEnvironment.orderEndpointUrl,
      activeEnvironment.fallbackOrderLookupUrl,
      activeEnvironment.flushSyncUrl,
      activeEnvironment.proofEndpointUrlTemplate,
    ].every((value) => {
      const trimmed = value.trim();
      return trimmed.startsWith("http://") || trimmed.startsWith("https://") || (trimmed.length > 0 && activeEnvironment.baseUrl.trim().length > 0);
    });
    const sharedCredentialsConfigured =
      vendor.vendorName.trim() &&
      vendor.platformLabel.trim() &&
      vendor.companyId.trim() &&
      vendor.createOrderUsername.trim() &&
      vendor.createOrderPassword.trim() &&
      vendor.proofClientId.trim() &&
      vendor.proofClientSecret.trim();
    if (!sharedCredentialsConfigured) {
      return { label: "Missing Shared Credentials", tone: "tone-warning", detail: `The active ${vendor.activeEnvironment === "prod" ? "Production" : "QA1"} Lift environment is selected, but shared Lift credentials are still incomplete.` };
    }
    if (!endpointConfigured) {
      return { label: "Missing Required Endpoint URLs", tone: "tone-warning", detail: `The active ${vendor.activeEnvironment === "prod" ? "Production" : "QA1"} Lift environment is selected, but one or more required endpoint URLs are still incomplete.` };
    }
    return hasLiveValidatedLift
      ? { label: "Configured", tone: "tone-success", detail: `${vendor.vendorName} / ${vendor.platformLabel} is configured for ${vendor.activeEnvironment === "prod" ? "Production" : "QA1"} order export, proof sync, and Lift proof approval, and at least one Lift-backed project has already been submitted from this workspace.` }
      : { label: "Configured · Awaiting Live Validation", tone: "tone-warning", detail: `${vendor.vendorName} / ${vendor.platformLabel} is configured for ${vendor.activeEnvironment === "prod" ? "Production" : "QA1"}, but no real Lift-backed submission has been observed yet. Use the sandbox lane for the first controlled validation.` };
  }, [adminSettings, projects]);

  const sandboxProjects = useMemo(
    () => projects.filter((project) => project.projectMode === "internal_sandbox"),
    [projects]
  );

  const readinessGates = useMemo<ReadinessGate[]>(() => {
    const hasSubmittedSandbox = sandboxProjects.some((project) => Boolean(project.liftOrderId));
    const hasLiveValidatedLift = projects.some((project) => Boolean(project.liftOrderId));
    const proofBackedProjects = projects.filter((project) => (project.proofs?.total || 0) > 0);
    const proofWaitingProjects = projects.filter((project) => (project.proofs?.waitingForProof || 0) > 0);
    const realCustomers = adminSettings?.customers.filter((customer) => !customer.isInternalSandbox) || [];
    const sandboxCustomer = adminSettings?.customers.find((customer) => customer.isInternalSandbox);
    const customersWithLiftIds = realCustomers.filter((customer) => String(customer.liftCustomerId || "").trim().length > 0);
    const shareIdentityRequired = !!adminSettings?.settings.shareDefaults.requireParticipantIdentity;
    const notificationsEnabled = !!(
      adminSettings?.settings.notifications.proofApproved ||
      adminSettings?.settings.notifications.transitDecision ||
      adminSettings?.settings.notifications.productionReleased ||
      adminSettings?.settings.notifications.workflowErrors
    );
    const hasRecentErrors = recentIssues.some((issue) => !issue.isDrill && issue.severity === "error");
    const activeVendorCount = adminSettings ? 1 : 0;

    return [
      {
        label: "Stabilization",
        state: hasRecentErrors ? "blocked" : recentIssues.some((issue) => !issue.isDrill) ? "watch" : "ready",
        detail: hasRecentErrors
          ? "Recent non-drill workflow errors need investigation before pilot expansion."
          : recentIssues.some((issue) => !issue.isDrill)
            ? "Workflow issues are being captured; review warnings before a pilot run."
            : "No non-drill workflow issues are currently recorded.",
      },
      {
        label: "Lift sandbox validation",
        state: hasSubmittedSandbox ? "ready" : hasLiveValidatedLift ? "watch" : "blocked",
        detail: hasSubmittedSandbox
          ? "At least one internal sandbox project has a persisted Lift order number."
          : hasLiveValidatedLift
            ? "Lift has been validated by a submitted project; run the next check through sandbox."
            : "Submit one controlled sandbox order before moving toward pilot validation.",
      },
      {
        label: "Proof sync trust",
        state: proofBackedProjects.length && proofWaitingProjects.length === 0 ? "ready" : proofBackedProjects.length ? "watch" : "blocked",
        detail: proofBackedProjects.length
          ? proofWaitingProjects.length
            ? `${proofWaitingProjects.length} project${proofWaitingProjects.length === 1 ? "" : "s"} still have proof lines waiting for Lift proof assets.`
            : "Proof-backed projects are present and no current project is waiting for proof assets."
          : "No proof-backed project is available yet; validate after the next sandbox sync.",
      },
      {
        label: "Customer setup",
        state: sandboxCustomer && customersWithLiftIds.length > 0 ? "ready" : sandboxCustomer ? "watch" : "blocked",
        detail: sandboxCustomer
          ? customersWithLiftIds.length
            ? `${customersWithLiftIds.length} real customer${customersWithLiftIds.length === 1 ? "" : "s"} have Lift customer IDs, and the sandbox customer is separate.`
            : "Sandbox customer exists; add or import at least one real customer with a Lift customer ID before pilot."
          : "Internal sandbox customer is missing or not marked as sandbox.",
      },
      {
        label: "Notifications",
        state: notificationsEnabled ? "watch" : "blocked",
        detail: notificationsEnabled
          ? "Notification rules are configurable; use Admin Setup preview/test-send before enabling pilot recipients."
          : "Global notification posture is disabled; validate templates and recipients before pilot.",
      },
      {
        label: "Shared access",
        state: shareIdentityRequired ? "ready" : "watch",
        detail: shareIdentityRequired
          ? "Participant identity is required for share links, which keeps customer collaboration auditable."
          : "Share links are enabled, but participant identity is not globally required.",
      },
      {
        label: "Vendor routing foundation",
        state: activeVendorCount > 0 ? "watch" : "blocked",
        detail: "Primary vendor config is in place; external vendor routing should follow primary Lift/proof stabilization.",
      },
    ];
  }, [adminSettings, projects, recentIssues, sandboxProjects]);

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
        subtitle="Monitor workflow posture, integration health, and the customer, venue, and project footprint."
        backLabel="← Projects"
        onBack={() => navigate("/customer/projects")}
        actions={
          <div className="settings-actions">
            <button className="btn btn-ghost btn-soft" type="button" onClick={() => navigate("/admin/settings")}>
              Open Admin Setup
            </button>
          </div>
        }
      />

      <div className="settings-grid">
        <Panel className="settings-panel settings-panel-hero">
          <div className="settings-hero">
            <div>
              <div className="settings-sectionEyebrow">Current Admin Session</div>
              <h2 className="settings-title">Live operations snapshot</h2>
              <p className="settings-copy">
                This dashboard is the operational view. Use Admin Setup for configuration and policy, then come here to
                watch the live system footprint and release posture.
              </p>
            </div>
            <div className="settings-sessionCard">
              <div className="settings-sessionLabel">Signed in as</div>
              <div className="settings-sessionValue">{user?.displayName || "Admin User"}</div>
              <div className="settings-sessionMeta">{user?.email || "admin@adspace360.com"}</div>
            </div>
          </div>

          <div className="settings-statGrid">
            {stats.map((stat) => (
              <div key={stat.label} className={`settings-stat settings-stat-${stat.tone}`}>
                <div className="settings-statValue">{stat.value}</div>
                <div className="settings-statLabel">{stat.label}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="settings-panel">
          <div className="settings-cardHead">
            <div>
              <div className="settings-sectionEyebrow">Workflow</div>
              <h3 className="settings-cardTitle">Production controls</h3>
            </div>
            <span className="chip tone-warning">Manual release</span>
          </div>
          <div className="settings-subsection">
            <div className="settings-subsectionHead">
              <div className="settings-subsectionTitle">Release flow</div>
              <div className="settings-subsectionMeta">Operational rules that govern how projects move from ordering into production release.</div>
            </div>
            <div className="settings-stack">
              <div className="settings-kv">
                <span className="settings-k">Order submission</span>
                <span className="settings-v">Required before proof and transit work can begin</span>
              </div>
              <div className="settings-kv">
                <span className="settings-k">Proof + transit model</span>
                <span className="settings-v">Parallel post-submit review tracks</span>
              </div>
              <div className="settings-kv">
                <span className="settings-k">Production release</span>
                <span className="settings-v">Unlocked only when all proofs are approved and transit is accepted</span>
              </div>
              <div className="settings-kv">
                <span className="settings-k">Release lock behavior</span>
                <span className="settings-v">Proof undo remains available until production release is confirmed, then the workflow is locked</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="settings-panel">
          <div className="settings-cardHead">
            <div>
              <div className="settings-sectionEyebrow">Operations</div>
              <h3 className="settings-cardTitle">Error visibility & retry posture</h3>
            </div>
            <span className={`chip ${integrationPosture.tone}`}>{integrationPosture.label}</span>
          </div>
          <div className="settings-subsection">
            <div className="settings-subsectionHead">
              <div className="settings-subsectionTitle">Monitoring posture</div>
              <div className="settings-subsectionMeta">A quick read on how operational issues surface, retry, and escalate through the app today.</div>
            </div>
            <div className="settings-stack">
              <div className="settings-kv">
                <span className="settings-k">Project Activity</span>
                <span className="settings-v">Operational errors have their own lane on Hub through the Errors filter</span>
              </div>
              <div className="settings-kv">
                <span className="settings-k">Tracked failure types</span>
                <span className="settings-v">Uploads, replacements, deletes, assignments, transit resets, project edits, scope updates, and release failures</span>
              </div>
              <div className="settings-kv">
                <span className="settings-k">Retry model</span>
                <span className="settings-v">Users see immediate toasts while audit events preserve enough detail for later automation and fix-up tickets</span>
              </div>
              <div className="settings-kv">
                <span className="settings-k">Notification delivery</span>
                <span className="settings-v">Immediate customer rules send in real time, and digest rules roll into the next hourly summary from noreply@adspace360.com</span>
              </div>
              <div className="settings-kv">
                <span className="settings-k">Primary print vendor posture</span>
                <span className="settings-v">{integrationPosture.detail}</span>
              </div>
            </div>
          </div>
        </Panel>

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
                Tests AS360Orders, AS360ProofReport, and the Lift order deep-link resolver for one existing Lift order.
                This does not submit orders, approve proofs, save project data, or create documents.
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
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleRunLiftSmokeTest}
                disabled={liftSmokeLoading}
              >
                {liftSmokeLoading ? "Testing…" : "Run Read-Only Test"}
              </button>
            </div>
            {liftSmokeError ? <div className="settings-note settings-note-warning">{liftSmokeError}</div> : null}
            {liftSmokeResult ? (
              <div className="settings-smokeResult">
                <div className="settings-listMeta">
                  Tested {liftSmokeResult.orderNumber} against {liftSmokeResult.activeEnvironment === "prod" ? "Production" : "QA1"} at{" "}
                  {new Date(liftSmokeResult.testedAt).toLocaleString()}.
                </div>
                <div className="settings-smokeGrid">
                  <LiftSmokeCard result={liftSmokeResult.endpoints.orderSync} />
                  <LiftSmokeCard result={liftSmokeResult.endpoints.proofReport} />
                  <LiftSmokeCard result={liftSmokeResult.endpoints.orderUrl} />
                </div>
              </div>
            ) : (
              <div className="settings-note">
                Suggested first test: <strong>A0219609</strong>, the recent Apex-created Lift order we are using to validate the new slim read reports.
              </div>
            )}
          </div>
        </Panel>

        <Panel className="settings-panel">
          <div className="settings-cardHead">
            <div>
              <div className="settings-sectionEyebrow">Recent Issues</div>
              <h3 className="settings-cardTitle">Latest workflow issues</h3>
            </div>
            <span className="chip tone-warning">{recentIssues.length} tracked</span>
          </div>
          <div className="settings-subsection">
            <div className="settings-subsectionHead">
              <div className="settings-subsectionTitle">Operator-facing failures</div>
              <div className="settings-subsectionMeta">These come from the same structured workflow error stream that feeds Project Activity and the Errors lane.</div>
            </div>
            {recentIssues.length ? (
              <div className="settings-list">
                {recentIssues.map((issue) => (
                  <div key={`${issue.projectId}:${issue.createdAt}:${issue.errorCode}`} className="settings-listItem">
                    <div className="settings-cardHead">
                      <div>
                        <div className="settings-listTitle">{issue.projectTitle}</div>
                        <div className="settings-listMeta">
                          {issue.customerName} • {issue.venueName} • {new Date(issue.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="settings-inline">
                        {issue.isDrill ? <span className="chip tone-info">Drill</span> : null}
                        <span className={`chip ${issue.severity === "error" ? "tone-warning" : issue.severity === "warning" ? "tone-info" : "tone-neutral"}`}>{issue.severity}</span>
                      </div>
                    </div>
                    <div className="settings-stack">
                      <div className="settings-kv"><span className="settings-k">Surface</span><span className="settings-v">{issue.surface}</span></div>
                      <div className="settings-kv"><span className="settings-k">Error code</span><span className="settings-v">{issue.errorCode}</span></div>
                      <div className="settings-kv"><span className="settings-k">Message</span><span className="settings-v">{issue.message}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="settings-note">No structured workflow issues are currently recorded. Run a controlled drill from Admin Setup if you want to validate the ops surfaces before the first live Lift submit.</div>
            )}
          </div>
        </Panel>

        <Panel className="settings-panel settings-panel-wide">
          <div className="settings-cardHead">
            <div>
              <div className="settings-sectionEyebrow">Pilot Readiness</div>
              <h3 className="settings-cardTitle">V1 launch gates</h3>
            </div>
            <span className="chip tone-info">Operator checklist</span>
          </div>
          <div className="settings-subsection">
            <div className="settings-subsectionHead">
              <div className="settings-subsectionTitle">Readiness by milestone</div>
              <div className="settings-subsectionMeta">
                This keeps the roadmap visible inside the app: stabilize the current product spine, validate sandbox Lift/proofing, then move into customer, notification, share, and vendor readiness.
              </div>
            </div>
            <div className="settings-readinessGrid">
              {readinessGates.map((gate) => (
                <div key={gate.label} className={`settings-readinessGate settings-readinessGate-${gate.state}`}>
                  <div className="settings-readinessTop">
                    <span className="settings-readinessDot" aria-hidden="true" />
                    <span className="settings-readinessLabel">{gate.label}</span>
                    <span className={`chip ${gate.state === "ready" ? "tone-success" : gate.state === "watch" ? "tone-warning" : "tone-danger"}`}>
                      {gate.state === "ready" ? "Ready" : gate.state === "watch" ? "Watch" : "Blocked"}
                    </span>
                  </div>
                  <div className="settings-readinessDetail">{gate.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="settings-panel">
          <div className="settings-cardHead">
            <div>
              <div className="settings-sectionEyebrow">Data</div>
              <h3 className="settings-cardTitle">Venue source of truth</h3>
            </div>
            <span className="chip tone-info">In progress</span>
          </div>
          <div className="settings-subsection">
            <div className="settings-subsectionHead">
              <div className="settings-subsectionTitle">Source-of-truth rules</div>
              <div className="settings-subsectionMeta">The data contracts we’re protecting between venue management and downstream project workflows.</div>
            </div>
            <div className="settings-stack">
              <div className="settings-kv">
                <span className="settings-k">Canonical inventory id</span>
                <span className="settings-v">Stable backend record id for scope, assignments, proofs, transit, and reports</span>
              </div>
              <div className="settings-kv">
                <span className="settings-k">Display inventory id</span>
                <span className="settings-v">Human-readable unit label shown in maps, pins, lists, and PDFs</span>
              </div>
              <div className="settings-kv">
                <span className="settings-k">Map linkage</span>
                <span className="settings-v">Room map id remains the anchor for pin placement and location summaries</span>
              </div>
              <div className="settings-kv">
                <span className="settings-k">Project scope default</span>
                <span className="settings-v">New projects begin with all active visible venue inventory, then admins can reduce scope to an explicit subset</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="settings-panel settings-panel-wide">
          <div className="settings-cardHead">
            <div>
              <div className="settings-sectionEyebrow">Integrations & next setup</div>
              <h3 className="settings-cardTitle">Operational launch checklist</h3>
            </div>
          </div>
          <div className="settings-formGrid">
            <div className="settings-subsection">
              <div className="settings-subsectionHead">
                <div className="settings-subsectionTitle">Launch checklist</div>
                <div className="settings-subsectionMeta">A quick working view of what is live now and what still needs wiring before launch confidence is complete.</div>
              </div>
              <div className="settings-list">
                <div className="settings-listItem">
                  <div className="settings-listTitle">Lift ERP order integration</div>
                  <div className="settings-listMeta">{integrationPosture.detail}</div>
                </div>
                <div className="settings-listItem">
                  <div className="settings-listTitle">Proof API integration</div>
                  <div className="settings-listMeta">Frontend proofing is live; next step is wiring Lift-backed proof records and error handling.</div>
                </div>
                <div className="settings-listItem">
                  <div className="settings-listTitle">Share Access defaults</div>
                  <div className="settings-listMeta">Current scopes: End Client Collaboration, Artwork Upload Only, Transit Approval, View Only.</div>
                </div>
                <div className="settings-listItem">
                  <div className="settings-listTitle">Error operations</div>
                  <div className="settings-listMeta">Next layer is alert routing and auto-created fix tickets from repeatable failures.</div>
                </div>
              </div>
            </div>

            <div className="settings-subsection">
              <div className="settings-subsectionHead">
                <div className="settings-subsectionTitle">Sandbox rehearsal lane</div>
                <div className="settings-subsectionMeta">Use the internal sandbox path to validate payload shape and guardrails without writing anything to Lift.</div>
              </div>
              <div className="settings-stack">
                <div className="settings-kv"><span className="settings-k">Sandbox projects</span><span className="settings-v">{sandboxProjects.length} internal-only project{sandboxProjects.length === 1 ? "" : "s"} available</span></div>
                <div className="settings-kv"><span className="settings-k">Dry-run check</span><span className="settings-v">Open Review Allocation, inspect Lift payload preview, then save the preview snapshot to Documents.</span></div>
                <div className="settings-kv"><span className="settings-k">Expected clean result</span><span className="settings-v">Health stays in awaiting-live-validation posture, and the Errors lane should remain empty for a clean sandbox rehearsal.</span></div>
                <div className="settings-kv"><span className="settings-k">Guardrails</span><span className="settings-v">Keep sandbox work off customer dashboards, block share links, and route customer_id to 1249.</span></div>
                <div className="settings-kv"><span className="settings-k">Live test boundary</span><span className="settings-v">When ready, validate one sandbox order only: order id, line ids, proof urls, flush shape, and deep link behavior.</span></div>
              </div>
              {sandboxProjects.length ? (
                <div className="settings-pills">
                  {sandboxProjects.slice(0, 4).map((project) => (
                    <span key={project.id} className="chip tone-info">
                      {project.title}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="settings-subsection">
              <div className="settings-subsectionHead">
                <div className="settings-subsectionTitle">Admin jump points</div>
                <div className="settings-subsectionMeta">Quick links back into the places where we make setup changes and manage live venue data.</div>
              </div>
              <div className="settings-actions">
                <button className="btn btn-primary" type="button" onClick={() => navigate("/admin/settings")}>
                  Open Admin Setup
                </button>
                <button className="btn btn-ghost btn-soft" type="button" onClick={() => navigate("/admin/venues")}>
                  Open Venue Management
                </button>
              </div>
            </div>
          </div>
        </Panel>

        {loading && (
          <Panel className="settings-panel settings-panel-wide">
            <div className="assign-empty">
              <div className="assign-empty-title">Loading health snapshot</div>
              <div className="assign-empty-body">Pulling the latest customer, venue, and project snapshot from the live backend.</div>
            </div>
          </Panel>
        )}

        {error && !loading && (
          <Panel className="settings-panel settings-panel-wide">
            <div className="assign-empty">
              <div className="assign-empty-title">Health snapshot unavailable</div>
              <div className="assign-empty-body">{error}</div>
            </div>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

function deriveMarketsFromVenues(venues: VenueRecord[]): MarketRecord[] {
  const marketsById = new Map<string, MarketRecord>();
  for (const venue of venues) {
    if (!venue.marketId || marketsById.has(venue.marketId)) continue;
    marketsById.set(venue.marketId, {
      id: venue.marketId,
      customerId: venue.customerId,
      name: venue.marketName || venue.marketId,
      isActive: true,
    });
  }
  return Array.from(marketsById.values()).sort((a, b) => a.name.localeCompare(b.name));
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
        {result.rowCount !== undefined ? (
          <div className="settings-kvCard">
            <div className="settings-kvValue">{result.rowCount}</div>
            <div className="settings-kvLabel">Rows</div>
          </div>
        ) : null}
        {result.lineCount !== undefined ? (
          <div className="settings-kvCard">
            <div className="settings-kvValue">{result.lineCount}</div>
            <div className="settings-kvLabel">Lines</div>
          </div>
        ) : null}
        {result.completeRowCount !== undefined ? (
          <div className="settings-kvCard settings-kvCard-success">
            <div className="settings-kvValue">{result.completeRowCount}</div>
            <div className="settings-kvLabel">Complete rows</div>
          </div>
        ) : null}
        {missing.length ? (
          <div className="settings-kvCard settings-kvCard-warning">
            <div className="settings-kvValue">{missing.length}</div>
            <div className="settings-kvLabel">Missing fields</div>
          </div>
        ) : result.requiredFieldsPresent?.length ? (
          <div className="settings-kvCard settings-kvCard-success">
            <div className="settings-kvValue">{result.requiredFieldsPresent.length}</div>
            <div className="settings-kvLabel">Fields present</div>
          </div>
        ) : null}
      </div>
      {missing.length ? (
        <div className="settings-smokeMissing">{missing.slice(0, 5).join(", ")}{missing.length > 5 ? "…" : ""}</div>
      ) : null}
      {result.sample ? <SmokeSample sample={result.sample} /> : null}
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
          <span className="settings-k">{formatSmokeKey(key)}</span>
          <span className="settings-v">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function formatSmokeKey(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}
