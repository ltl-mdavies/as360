import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  type AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authConfig, authStorageKey } from "./authConfig";

type AuthUser = {
  email: string;
  displayName: string;
};

type AuthSession = {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthUser;
};

type NewPasswordChallenge = {
  email: string;
  password: string;
  session: string;
};

type SignInResult =
  | { status: "authenticated" }
  | { status: "new_password_required" };

type AuthContextValue = {
  session: AuthSession | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  challenge: NewPasswordChallenge | null;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  completeNewPassword: (newPassword: string) => Promise<void>;
  signOut: () => void;
  getAccessToken: () => string | null;
};

const cognitoClient = new CognitoIdentityProviderClient({
  region: authConfig.region,
});

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [challenge, setChallenge] = useState<NewPasswordChallenge | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function restore() {
      const stored = readStoredSession();
      if (!stored) {
        if (active) setIsLoading(false);
        return;
      }

      try {
        const nextSession = stored.expiresAt > Date.now() + 30_000 ? stored : await refreshSession(stored.refreshToken);
        if (!active) return;
        persistSession(nextSession);
        setSession(nextSession);
      } catch {
        if (!active) return;
        clearStoredSession();
        setSession(null);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void restore();

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user || null,
      isAuthenticated: Boolean(session),
      isLoading,
      challenge,
      async signIn(email: string, password: string) {
        const response = await cognitoClient.send(
          new InitiateAuthCommand({
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: authConfig.userPoolClientId,
            AuthParameters: {
              USERNAME: email,
              PASSWORD: password,
            },
          })
        );

        if (response.ChallengeName === "NEW_PASSWORD_REQUIRED" && response.Session) {
          setChallenge({ email, password, session: response.Session });
          return { status: "new_password_required" };
        }

        const nextSession = toSession(response.AuthenticationResult, null);
        persistSession(nextSession);
        setChallenge(null);
        setSession(nextSession);
        return { status: "authenticated" };
      },
      async completeNewPassword(newPassword: string) {
        if (!challenge) throw new Error("No password challenge is active");

        const response = await cognitoClient.send(
          new RespondToAuthChallengeCommand({
            ClientId: authConfig.userPoolClientId,
            ChallengeName: "NEW_PASSWORD_REQUIRED",
            Session: challenge.session,
            ChallengeResponses: {
              USERNAME: challenge.email,
              NEW_PASSWORD: newPassword,
            },
          })
        );

        const nextSession = toSession(response.AuthenticationResult, challenge.email);
        persistSession(nextSession);
        setSession(nextSession);
        setChallenge(null);
      },
      signOut() {
        clearStoredSession();
        setChallenge(null);
        setSession(null);
      },
      getAccessToken() {
        return session?.accessToken || null;
      },
    }),
    [challenge, isLoading, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

function readStoredSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(authStorageKey);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function persistSession(session: AuthSession) {
  window.localStorage.setItem(authStorageKey, JSON.stringify(session));
}

function clearStoredSession() {
  window.localStorage.removeItem(authStorageKey);
}

async function refreshSession(refreshToken: string) {
  const response = await cognitoClient.send(
    new InitiateAuthCommand({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: authConfig.userPoolClientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    })
  );

  return toSession(response.AuthenticationResult, null, refreshToken);
}

function toSession(
  authResult: AuthenticationResultType | undefined,
  fallbackEmail: string | null,
  refreshTokenOverride?: string
): AuthSession {
  if (!authResult?.AccessToken || !authResult.IdToken) {
    throw new Error("Authentication did not return valid tokens");
  }

  const idClaims = parseJwt(authResult.IdToken);
  const accessClaims = parseJwt(authResult.AccessToken);
  const email = stringClaim(idClaims.email) || stringClaim(accessClaims.username) || fallbackEmail;
  if (!email) throw new Error("Authenticated session is missing an email identity");

  const displayName = stringClaim(idClaims.name) || email.split("@")[0] || "Adspace360 User";

  return {
    accessToken: authResult.AccessToken,
    idToken: authResult.IdToken,
    refreshToken: authResult.RefreshToken || refreshTokenOverride || "",
    expiresAt: Date.now() + (authResult.ExpiresIn || 3600) * 1000,
    user: {
      email,
      displayName,
    },
  };
}

function parseJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringClaim(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
