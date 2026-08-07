import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Connexion déléguée OIDC (Authorization Code) — fournisseur générique :
 * Microsoft Entra ID, Keycloak, Authentik… On découvre les endpoints via le
 * document standard `/.well-known/openid-configuration`, donc aucun couplage à
 * un fournisseur.
 *
 * Sécurité : `state` (anti-CSRF) + `nonce` (anti-rejeu) générés au départ et
 * vérifiés au retour ; l'`id_token` est vérifié cryptographiquement (signature
 * via JWKS distant, issuer, audience) avec `jose` (déjà utilisé pour nos JWT).
 *
 * On ne provisionne PAS de compte : l'email validé doit déjà correspondre à un
 * utilisateur créé par un admin (cf. AuthProvider.issueForEmail).
 */
export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface Endpoints {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export class OidcService {
  private endpoints: Endpoints | null = null;
  private jwks: JWTVerifyGetKey | null = null;
  // ponytail: état CSRF en mémoire (instance unique). Multi-instance → store partagé (Redis).
  private readonly states = new Map<string, { nonce: string; exp: number }>();

  constructor(private readonly config: OidcConfig) {}

  private async discover(): Promise<Endpoints> {
    if (this.endpoints !== null) return this.endpoints;
    const res = await fetch(`${this.config.issuerUrl}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`Découverte OIDC échouée (${res.status}).`);
    const doc = (await res.json()) as Endpoints;
    this.endpoints = doc;
    this.jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
    return doc;
  }

  /** URL d'autorisation ; mémorise (state → nonce) avec TTL 10 min. */
  async startUrl(state: string, nonce: string): Promise<string> {
    const ep = await this.discover();
    this.gc();
    this.states.set(state, { nonce, exp: Date.now() + 10 * 60_000 });
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: this.config.redirectUri,
      response_mode: "query",
      scope: "openid profile email",
      state,
      nonce,
    });
    return `${ep.authorization_endpoint}?${params.toString()}`;
  }

  /** Valide le retour, échange le code, vérifie l'id_token → email vérifié. */
  async handleCallback(code: string, state: string): Promise<{ email: string } | null> {
    const saved = this.states.get(state);
    this.states.delete(state);
    if (saved === undefined || saved.exp < Date.now()) return null; // anti-CSRF

    const ep = await this.discover();
    const res = await fetch(ep.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!res.ok) return null;
    const tokens = (await res.json()) as { id_token?: string };
    if (tokens.id_token === undefined || this.jwks === null) return null;

    const { payload } = await jwtVerify(tokens.id_token, this.jwks, {
      issuer: ep.issuer,
      audience: this.config.clientId,
    });
    if (payload.nonce !== saved.nonce) return null; // anti-rejeu

    const email = (payload.email ?? payload.preferred_username) as string | undefined;
    return email !== undefined && email !== "" ? { email } : null;
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.states) if (v.exp < now) this.states.delete(k);
  }
}
