// src/app/AppShell.tsx
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { fetchAdminBranding, peekAdminSettingsCache, resolveShareLink } from "../api/projects";
import { useApiClient } from "../api/useApiClient";
import NavDrawer from "../components/common/NavDrawer";
import adspaceLogo from "../assets/adspace_logo_v1.svg";
import adspaceLogoDark from "../assets/adspace_logo_v1_dark.svg";
import { useAuth } from "../auth/AuthProvider";
import { useDemoStore } from "../domain/store/demoStore";

type AppShellProps = {
  children: ReactNode;
  customerName?: string;
  pageClassName?: string;
  projectTitle?: string; // used for nav drawer meta under "Current Project Hub"
  showNavTrigger?: boolean;
};

type BrandingSnapshot = {
  brandName: string;
  brandLogoUrl: string | null;
  brandAlt: string;
  viewerCompanyName: string;
  viewerIsPlatformAdmin: boolean;
  viewerDisplayName: string | null;
};

const BRANDING_STORAGE_TTL_MS = 10 * 60 * 1000;
const THEME_STORAGE_KEY = "adspace360:theme";

function readStoredTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function defaultBrandingSnapshot(customerName: string): BrandingSnapshot {
  return {
    brandName: customerName,
    brandLogoUrl: null,
    brandAlt: "Adspace360",
    viewerCompanyName: customerName,
    viewerIsPlatformAdmin: false,
    viewerDisplayName: null,
  };
}

function brandingStorageKey(userEmail: string) {
  return `adspace360:branding:${userEmail.toLowerCase()}`;
}

function readStoredBranding(userEmail: string): BrandingSnapshot | null {
  if (typeof window === "undefined" || !userEmail) return null;
  try {
    const raw = window.localStorage.getItem(brandingStorageKey(userEmail));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; snapshot?: BrandingSnapshot };
    if (!parsed.savedAt || Date.now() - parsed.savedAt > BRANDING_STORAGE_TTL_MS) return null;
    return parsed.snapshot || null;
  } catch {
    return null;
  }
}

function writeStoredBranding(userEmail: string, snapshot: BrandingSnapshot) {
  if (typeof window === "undefined" || !userEmail) return;
  try {
    window.localStorage.setItem(brandingStorageKey(userEmail), JSON.stringify({ savedAt: Date.now(), snapshot }));
  } catch {
    // Branding is a convenience cache only; storage failures should never block the app shell.
  }
}

function deriveBrandingFromAdminSettings(
  settings: ReturnType<typeof peekAdminSettingsCache>,
  userEmail: string,
  fallbackName: string,
  fallbackDisplayName: string | null
): BrandingSnapshot | null {
  if (!settings || !userEmail) return null;

  const currentProfile = settings.users.find(
    (profile) => profile.email.toLowerCase() === userEmail.toLowerCase()
  );

  if (settings.viewer.isPlatformAdmin) {
    return {
      brandName: "Adspace360",
      brandLogoUrl: null,
      brandAlt: "Adspace360",
      viewerCompanyName: "Adspace360",
      viewerIsPlatformAdmin: true,
      viewerDisplayName: currentProfile?.displayName || fallbackDisplayName,
    };
  }

  const scopedCustomer =
    settings.customers.find((customer) => settings.viewer.customerIds.includes(customer.id)) ||
    settings.customers[0];

  return {
    brandName: scopedCustomer?.name || fallbackName,
    brandLogoUrl: scopedCustomer?.logoUrl || null,
    brandAlt: scopedCustomer?.name || fallbackName || "Customer",
    viewerCompanyName: scopedCustomer?.name || fallbackName,
    viewerIsPlatformAdmin: false,
    viewerDisplayName: currentProfile?.displayName || fallbackDisplayName,
  };
}

export default function AppShell({
  children,
  customerName = "Adspace360",
  pageClassName = "",
  projectTitle,
  showNavTrigger = false,
}: AppShellProps) {
  const [theme, setTheme] = useState<"light" | "dark">(() => readStoredTheme());
  const { signOut, user } = useAuth();
  const api = useApiClient();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme persistence is a convenience only; storage failures should not block navigation.
    }
  }, [theme]);

  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  const params = new URLSearchParams(location.search);
  const shareToken = params.get("share") || "";
  const isVendorContext = location.pathname.startsWith("/vendor/");
  const isCustomerContext =
    params.get("mode") === "customer" || location.pathname.startsWith("/customer/");
  const cachedBranding = useMemo(
    () =>
      shareToken || !user
        ? null
        : readStoredBranding(user.email || "") ||
          deriveBrandingFromAdminSettings(
            peekAdminSettingsCache(),
            user.email || "",
            customerName,
            user.displayName || null
          ),
    [customerName, shareToken, user]
  );
  const initialBranding = cachedBranding || defaultBrandingSnapshot(customerName);
  const [brandName, setBrandName] = useState(initialBranding.brandName);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(initialBranding.brandLogoUrl);
  const [brandAlt, setBrandAlt] = useState(initialBranding.brandAlt);
  const [brandLogoFailed, setBrandLogoFailed] = useState(false);
  const [viewerCompanyName, setViewerCompanyName] = useState(initialBranding.viewerCompanyName);
  const [viewerIsPlatformAdmin, setViewerIsPlatformAdmin] = useState(initialBranding.viewerIsPlatformAdmin);
  const [viewerDisplayName, setViewerDisplayName] = useState<string | null>(initialBranding.viewerDisplayName);

  useEffect(() => {
    setBrandLogoFailed(false);
  }, [brandLogoUrl]);

  useEffect(() => {
    let cancelled = false;

    async function loadBranding() {
      if (shareToken) {
        try {
          const response = await resolveShareLink(api, shareToken);
          if (cancelled) return;
          setBrandName(response.shareLink.customerName || customerName);
          setBrandLogoUrl(response.shareLink.customerLogoUrl || null);
          setBrandAlt(response.shareLink.customerName || customerName || "Customer");
          setViewerCompanyName(response.shareLink.customerName || customerName);
          setViewerIsPlatformAdmin(false);
          setViewerDisplayName(null);
          return;
        } catch (error) {
          if (!cancelled) console.warn("Failed to resolve shared branding", error);
        }
      }

      if (!user) {
        if (!cancelled) {
          setBrandName(customerName);
          setBrandLogoUrl(null);
          setBrandAlt("Adspace360");
          setViewerCompanyName(customerName);
          setViewerIsPlatformAdmin(false);
          setViewerDisplayName(null);
        }
        return;
      }

      const storedBranding = readStoredBranding(user.email || "");
      if (storedBranding) {
        if (!cancelled) {
          setBrandName(storedBranding.brandName);
          setBrandLogoUrl(storedBranding.brandLogoUrl);
          setBrandAlt(storedBranding.brandAlt);
          setViewerCompanyName(storedBranding.viewerCompanyName);
          setViewerIsPlatformAdmin(storedBranding.viewerIsPlatformAdmin);
          setViewerDisplayName(storedBranding.viewerDisplayName);
        }
        return;
      }

      try {
        const response = await fetchAdminBranding(api);
        if (cancelled) return;
        const nextBranding: BrandingSnapshot = {
          brandName: response.brand.name || customerName,
          brandLogoUrl: response.brand.logoUrl || null,
          brandAlt: response.brand.alt || response.brand.name || customerName || "Customer",
          viewerCompanyName: response.brand.companyName || response.brand.name || customerName,
          viewerIsPlatformAdmin: response.viewer.isPlatformAdmin,
          viewerDisplayName: response.viewer.displayName || user.displayName || null,
        };
        setBrandName(nextBranding.brandName);
        setBrandLogoUrl(nextBranding.brandLogoUrl);
        setBrandAlt(nextBranding.brandAlt);
        setViewerCompanyName(nextBranding.viewerCompanyName);
        setViewerIsPlatformAdmin(nextBranding.viewerIsPlatformAdmin);
        setViewerDisplayName(nextBranding.viewerDisplayName);
        writeStoredBranding(user.email || "", nextBranding);
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to resolve customer branding", error);
          setBrandName(customerName);
          setBrandLogoUrl(null);
          setBrandAlt("Adspace360");
          setViewerCompanyName(customerName);
          setViewerIsPlatformAdmin(false);
          setViewerDisplayName(user.displayName || null);
        }
      }
    }

    void loadBranding();
    return () => {
      cancelled = true;
    };
  }, [api, customerName, shareToken, user]);

  // If we're inside a project route, capture the projectId
  const match = location.pathname.match(/^\/p\/([^/]+)/);
  const currentProjectId = match ? match[1] : null;

  const navItems = isVendorContext
    ? [
        { label: "Vendor Orders", path: "/vendor/orders", kind: "primary" as const },
      ]
    : [
        { label: "Projects", path: "/customer/projects", kind: "primary" as const },
        ...(currentProjectId
          ? [
              {
                label: "Current Project Hub",
                path: `/p/${currentProjectId}?mode=customer`,
                kind: "primary" as const,
                meta: projectTitle ?? `Project ${currentProjectId}`,
              },
            ]
          : []),
        { label: "Venue Management", path: "/admin/venues", kind: "secondary" as const },
        { label: "Admin Setup", path: "/admin/settings", kind: "secondary" as const },
        { label: "Health Dashboard", path: "/admin/health", kind: "secondary" as const },
      ];

  const userPrimaryLabel = viewerDisplayName || user?.displayName || (shareToken ? "Shared Access" : "Adspace360");
  const userMetaLabel = viewerCompanyName || brandName || "Adspace360";
  const userInitials = useMemo(() => {
    const source = user?.displayName?.trim() || user?.email?.trim() || "AA";
    const parts = source
      .split(/\s+/)
      .map((part) => part.replace(/[^A-Za-z0-9]/g, ""))
      .filter(Boolean);
    if (parts.length === 0) return "AA";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }, [user?.displayName, user?.email]);
  
	const lastToast = useDemoStore((s) => s.lastToast);
	
	type ToastItem = {
	  id: string;
	  tone: "success" | "warning" | "danger";
	  message: string;
	  at: number;
	};
	
	const [toasts, setToasts] = useState<ToastItem[]>([]);
	
	useEffect(() => {
	  if (!lastToast) return;
	
	  const id = `${lastToast.at}_${Math.random().toString(16).slice(2)}`;
	
	  setToasts((prev) => {
		// Keep only last 3 toasts to avoid clutter
		const next = [...prev, { id, ...lastToast }];
		return next.slice(-3);
	  });
	
	  const t = setTimeout(() => {
		setToasts((prev) => prev.filter((x) => x.id !== id));
	  }, 2400);
	
	  return () => clearTimeout(t);
	}, [lastToast]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
        {(isCustomerContext || isVendorContext || showNavTrigger) && (
		  <button
			className="iconbtn"
			aria-label="Menu"
			title="Menu"
			type="button"
			onClick={() => setNavOpen(true)}
		  >
			☰
		  </button>
		)}

          <div className="brand">
            <img
              className={`brand-logo ${brandLogoUrl && !brandLogoFailed ? "brand-logo-customer" : ""}`.trim()}
              src={brandLogoUrl && !brandLogoFailed ? brandLogoUrl : theme === "dark" ? adspaceLogoDark : adspaceLogo}
              alt={brandAlt}
              onError={() => setBrandLogoFailed(true)}
            />
          </div>
        </div>

        <div className="topbar-right">
          <div className="customerchip" title={viewerIsPlatformAdmin ? "Internal workspace" : "Customer workspace"}>
            <span className="customerchip-dot" aria-hidden="true" />
            <span className="customerchip-text">{brandName}</span>
          </div>

          <button
            className="iconbtn"
            aria-label="Toggle theme"
            title="Toggle theme"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>

          <div className={`userpill ${viewerIsPlatformAdmin ? "userpill-internal" : ""}`} title={userPrimaryLabel}>
            <span className="userpill-avatar" aria-hidden="true">{userInitials}</span>
            <span className="userpill-copy">
              <span className="userpill-name">{userPrimaryLabel}</span>
              <span className="userpill-meta">{userMetaLabel}</span>
            </span>
            {user ? (
              <button
                className="userpill-logout"
                type="button"
                onClick={signOut}
                aria-label="Log out"
                title="Log out"
              >
                Log Out
              </button>
            ) : null}
          </div>
        </div>
      </header>

		<main className={`main-content ${pageClassName}`}>
		  <div className={`page ${pageClassName}`}>{children}</div>
		</main>
		
		{toasts.length > 0 && (
		  <div className="toast-stack" role="status" aria-live="polite">
			{toasts.map((t) => (
			  <div key={t.id} className={`toast toast-${t.tone}`}>
				<div className="toast-icon" aria-hidden="true">
				  {t.tone === "success" ? "✓" : t.tone === "warning" ? "!" : "×"}
				</div>
				<div className="toast-text">{t.message}</div>
			  </div>
			))}
		  </div>
		)}
		
		<NavDrawer
		  isOpen={navOpen}
		  onClose={() => setNavOpen(false)}
		  items={navItems}
		  activePath={location.pathname}
		/>
    </div>
  );
}
