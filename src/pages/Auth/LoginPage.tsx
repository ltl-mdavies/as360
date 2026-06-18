import { useEffect, useMemo, useState } from "react";
import { Lock, Mail } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import adspaceLogo from "../../assets/adspace_logo_v1.svg";
import adspaceLogoDark from "../../assets/adspace_logo_v1_dark.svg";
import { useAuth } from "../../auth/AuthProvider";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { challenge, completeNewPassword, isAuthenticated, signIn } = useAuth();

  const destination = useMemo(() => {
    const from = location.state && typeof location.state === "object" ? (location.state as { from?: string }).from : undefined;
    return from || "/customer/projects";
  }, [location.state]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate(destination, { replace: true });
  }, [destination, isAuthenticated, navigate]);

  useEffect(() => {
    if (challenge?.email) setEmail(challenge.email);
  }, [challenge]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (challenge) {
        await completeNewPassword(newPassword);
        navigate(destination, { replace: true });
        return;
      }

      const result = await signIn(email.trim(), password);
      if (result.status === "authenticated") {
        navigate(destination, { replace: true });
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
          <p className="auth-subtitle">Sign in to enter your workspace.</p>
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
                disabled={isSubmitting || Boolean(challenge)}
                required
              />
            </span>
          </label>

          {!challenge ? (
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
          ) : (
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
          )}

          {error ? <div className="auth-error">{error}</div> : null}

          <button className="btn btn-primary auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Working…" : challenge ? "Set Password" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
