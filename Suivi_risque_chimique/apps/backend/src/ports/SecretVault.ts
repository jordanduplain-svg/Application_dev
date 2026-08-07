/**
 * Port `SecretVault` — coffre à secrets chiffrés pour les identifiants des
 * connecteurs distants (chaîne de connexion SQL, jeton SharePoint…).
 *
 * Les secrets ne transitent JAMAIS en clair vers le client et ne sont JAMAIS
 * stockés dans la config de la source (qui, elle, est en clair). `ref` est une
 * clé opaque — en pratique l'id de la source d'import.
 */
export interface SecretVault {
  put(tenantId: string, ref: string, plaintext: string): Promise<void>;
  /** Renvoie le secret en clair, ou null s'il n'existe pas. */
  get(tenantId: string, ref: string): Promise<string | null>;
  remove(tenantId: string, ref: string): Promise<void>;
}
