import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { api, ApiError } from "./api";

/**
 * État d'authentification côté client.
 *
 * Les jetons vivent en sessionStorage (pas localStorage) : ils disparaissent à
 * la fermeture de l'onglet. Le client ne décode jamais le jeton et ne déduit
 * AUCUN droit côté navigateur : c'est le serveur qui filtre ; l'UI s'adapte à
 * la forme de la réponse.
 *
 * Session prolongée : le jeton d'accès est court (15 min). Sur un 401, `call`
 * échange automatiquement le refresh token (longue durée) contre un nouveau
 * couple et rejoue l'appel UNE fois — l'utilisateur n'est pas déconnecté en
 * plein travail.
 */

interface SessionUser {
  id: string;
  displayName: string;
  role: string;
}

interface StoredSession {
  token: string;
  refreshToken: string;
  user: SessionUser;
}

interface AuthState {
  token: string | null;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /**
   * Exécute un appel authentifié avec le jeton courant. Sur 401, tente un
   * rafraîchissement puis rejoue l'appel une seule fois. Propage l'erreur si
   * le rafraîchissement échoue (l'appelant déconnecte alors).
   */
  call: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = "cmr.session";

function readStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw !== null ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

/** Décode un JSON base64url (UTF-8) — pour le retour OIDC dans le fragment. */
function decodeBase64UrlJson<T>(b64url: string): T {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/**
 * Session initiale : si on revient d'un login OIDC, le fragment `#session=…`
 * contient le couple de jetons + l'utilisateur. On le capte SYNCHRONEMENT
 * (avant le premier rendu, sinon RequireAuth redirigerait vers /login), on le
 * persiste, et on nettoie le fragment. Sinon, on relit la session stockée.
 */
function readInitialSession(): StoredSession | null {
  const hash = window.location.hash;
  if (hash.startsWith("#session=")) {
    try {
      const s = decodeBase64UrlJson<StoredSession>(hash.slice("#session=".length));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      return s;
    } catch {
      /* fragment illisible → on ignore */
    }
  }
  return readStoredSession();
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const stored = readInitialSession();
  const [token, setToken] = useState<string | null>(stored?.token ?? null);
  const [user, setUser] = useState<SessionUser | null>(stored?.user ?? null);
  // Le refresh token vit dans une ref : il ne déclenche pas de rendu et reste
  // lisible par `call` sans dépendance de closure périmée.
  const refreshTokenRef = useRef<string | null>(stored?.refreshToken ?? null);

  const persist = useCallback((s: StoredSession) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    refreshTokenRef.current = s.refreshToken;
    setToken(s.token);
    setUser(s.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      persist(await api.login(email, password));
    },
    [persist],
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    refreshTokenRef.current = null;
    setToken(null);
    setUser(null);
  }, []);

  const call = useCallback(
    async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
      const current = token;
      if (current === null) throw new ApiError(401, "Session absente.");
      try {
        return await fn(current);
      } catch (err) {
        const rt = refreshTokenRef.current;
        if (err instanceof ApiError && err.status === 401 && rt !== null) {
          const refreshed = await api.refresh(rt).catch(() => null);
          if (refreshed !== null) {
            persist(refreshed);
            return await fn(refreshed.token);
          }
        }
        throw err;
      }
    },
    [token, persist],
  );

  const value = useMemo(() => ({ token, user, login, logout, call }), [token, user, login, logout, call]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth doit être utilisé sous <AuthProvider>");
  return ctx;
}
