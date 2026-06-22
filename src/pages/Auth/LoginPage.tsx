import { useEffect, useMemo, useState } from "react";
import { Lock, Mail } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import adspaceLogo from "../../assets/adspace_logo_v1.svg";
import adspaceLogoDark from "../../assets/adspace_logo_v1_dark.svg";
import { apiConfig } from "../../api/apiConfig";
import { useAuth } from "../../auth/AuthProvider";

type AuthMode = "sign_in" | "forgot_password" | "confirm_reset";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { challenge, completeNewPassword, confirmForgotPassword, forgotPassword, isAuthenticated, session, signIn } = useAuth();

  const destination = useMemo(() => {
    const from = location.state && typeof location.state === "object" ? (location.state as { from?: string }).from : undefined;
    return from || "/customer/projects";
  }, [location.state]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("sign_in");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || isSubmitting) return undefined;
    let cancelled = false;
    async function redirectAuthenticatedUser() {
      const nextDestination = session?.accessToken
        ? await resolveAuthenticatedDestination(destination, session.accessToken)
        : destination;
      if (!cancelled) navigate(nextDestination, { replace: true });
    }
    void redirectAuthenticatedUser();
    return () => {
      cancelled = true;
    };
  }, [destination, isAuthenticated, isSubmitting, navigate, session?.accessToken]);

  useEffect(() => {
    if (challenge?.email) setEmail(challenge.email);
  }, [challenge]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim();

      if (authMode === "forgot_password") {
        await forgotPassword(normalizedEmail);
        setAuthMode("confirm_reset");
        setNotice("Check your email for the password reset code.");
        return;
      }

      if (authMode === "confirm_reset") {
        await confirmForgotPassword(normalizedEmail, resetCode.trim(), newPassword);
        setAuthMode("sign_in");
        setPassword("");
        setNewPassword("");
        setResetCode("");
        setNotice("Password reset. Sign in with your new password.");
        return;
      }

      if (challenge) {
        const session = await completeNewPassword(newPassword);
        navigate(await resolveAuthenticatedDestination(destination, session.accessToken), { replace: true });
        return;
      }

      const result = await signIn(normalizedEmail, password);
      if (result.status === "authenticated") {
        navigate(await resolveAuthenticatedDestination(destination, result.session.accessToken), { replace: true });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logoStack" role="img" aria-label="Adspace">
          <img className="auth-logo auth-logo-light" src={adspaceLogo} alt="" aria-hidden="true" />
          <img className="auth-logo auth-logo-dark" src={adspaceLogoDark} alt="" aria-hidden="true" />
        </div>
        <div className="auth-copy">
          <h1 className="auth-title">Welcome to Adspace</h1>
          <p className="auth-subtitle">
            {authMode === "forgot_password"
              ? "Enter your email and we'll send a reset code."
              : authMode === "confirm_reset"
              ? "Enter the reset code and choose a new password."
              : challenge
              ? "Set a permanent password to finish account setup."
              : "Sign in to enter your workspace."}
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span className="auth-label">Email</span>
            <span className="auth-inputShell">
              <Mail className="auth-inputIcon" aria-hidden="true" strokeWidth={2.2} />
              <input
                className="auth-input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@adspace360.com"
                disabled={isSubmitting || Boolean(challenge) || authMode === "confirm_reset"}
                required
              />
            </span>
          </label>

          {authMode === "confirm_reset" ? (
            <>
              <label className="auth-field">
                <span className="auth-label">Reset code</span>
                <span className="auth-inputShell">
                  <Lock className="auth-inputIcon" aria-hidden="true" strokeWidth={2.2} />
                  <input
                    className="auth-input"
                    type="text"
                    autoComplete="one-time-code"
                    value={resetCode}
                    onChange={(event) => setResetCode(event.target.value)}
                    placeholder="Enter your reset code"
                    disabled={isSubmitting}
                    required
                  />
                </span>
              </label>
              <label className="auth-field">
                <span className="auth-label">New password</span>
                <span className="auth-inputShell">
                  <Lock className="auth-inputIcon" aria-hidden="true" strokeWidth={2.2} />
                  <input
                    className="auth-input"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Create a new password"
                    disabled={isSubmitting}
                    minLength={8}
                    required
                  />
                </span>
              </label>
            </>
          ) : !challenge && authMode === "sign_in" ? (
            <label className="auth-field">
              <span className="auth-label">Password</span>
              <span className="auth-inputShell">
                <Lock className="auth-inputIcon" aria-hidden="true" strokeWidth={2.2} />
                <input
                  className="auth-input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  disabled={isSubmitting}
                  required
                />
              </span>
            </label>
          ) : challenge ? (
            <label className="auth-field">
              <span className="auth-label">Set a new password</span>
              <span className="auth-inputShell">
                <Lock className="auth-inputIcon" aria-hidden="true" strokeWidth={2.2} />
                <input
                  className="auth-input"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Create a permanent password"
                  disabled={isSubmitting}
                  minLength={8}
                  required
                />
              </span>
            </label>
          ) : null}

          {challenge ? (
            <div className="auth-notice">This account is ready for first-time setup. Choose a permanent password to continue.</div>
          ) : null}
          {notice ? <div className="auth-notice">{notice}</div> : null}
          {error ? <div className="auth-error">{error}</div> : null}

          <button className="btn btn-primary auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Working…"
              : challenge
              ? "Set Password"
              : authMode === "forgot_password"
              ? "Send Reset Code"
              : authMode === "confirm_reset"
              ? "Reset Password"
              : "Sign In"}
          </button>

          {!challenge ? (
            <div className="auth-secondaryActions">
              {authMode === "sign_in" ? (
                <button type="button" onClick={() => { setAuthMode("forgot_password"); setError(""); setNotice(""); }}>
                  Forgot password?
                </button>
              ) : (
                <button type="button" onClick={() => { setAuthMode("sign_in"); setError(""); setNotice(""); }}>
                  Back to sign in
                </button>
              )}
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}

async function resolveAuthenticatedDestination(destination: string, accessToken: string) {
  const requestedVendorDestination = destination.startsWith("/vendor/");
  try {
    const response = await fetch(`${apiConfig.baseUrl}/api/vendor/orders`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response.ok) return requestedVendorDestination ? destination : "/vendor/orders";
  } catch {
    // Keep the default customer/admin destination if vendor detection is unavailable.
  }

  if (requestedVendorDestination) return "/customer/projects";
  return destination || "/customer/projects";
}
