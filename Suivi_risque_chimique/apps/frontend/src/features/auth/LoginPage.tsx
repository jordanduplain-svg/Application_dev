import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";

/**
 * Connexion. Panneau de marque à gauche (desktop), formulaire à droite.
 * Sobre : c'est la porte d'entrée d'un outil de données de santé, pas un
 * site vitrine. Messages d'erreur actionnables (règle UX n°5).
 */
export function LoginPage(): JSX.Element {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Retour d'un échec OIDC (fragment posé par le backend) → message + nettoyage.
  useEffect(() => {
    if (/#oidc_error=/.test(window.location.hash)) {
      setError(t("login.oidc_error"));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [t]);

  const submit = async (mail: string, pass: string): Promise<void> => {
    setError(null);
    setPending(true);
    try {
      await login(mail, pass);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("login.unexpected_error"));
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    void submit(email, password);
  };

  // Aide à la connexion en DÉVELOPPEMENT uniquement : les comptes de démo sont
  // affichés et cliquables. Jamais rendu en production (import.meta.env.DEV).
  const DEMO_PASSWORD = "demo-cmr-2026!";
  const DEMO_ACCOUNTS = [
    { email: "hse@demo.local", label: "HSE — voit tout" },
    { email: "medecine@demo.local", label: "Médecine du travail" },
    { email: "rh@demo.local", label: "RH — vue administrative" },
    { email: "manager@demo.local", label: "Manager — un secteur" },
    { email: "alice@demo.local", label: "Collaborateur — sa fiche" },
    { email: "admin@demo.local", label: "Administration" },
  ];

  return (
    <main className="flex min-h-screen bg-white">
      {/* Panneau de marque — desktop uniquement. */}
      <aside className="relative hidden w-[44%] flex-col justify-between bg-slate-900 p-10 lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 2h4M7 2v4.5L3.5 12a2 2 0 0 0 1.8 3h5.4a2 2 0 0 0 1.8-3L9 6.5V2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M5.2 10.5h5.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">{t("app.title")}</span>
        </div>

        <div>
          <h2 className="max-w-md text-3xl font-semibold leading-snug tracking-tight text-white">
            {t("login.hero_title")}
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-slate-400">
            {t("login.hero_subtitle")}
          </p>
        </div>

        <p className="text-xs text-slate-500">{t("login.hero_footnote")}</p>
      </aside>

      {/* Formulaire */}
      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {t("app.title")}
            </h1>
          </div>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {t("login.heading")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t("login.subtitle")}</p>

          <form onSubmit={(e) => void onSubmit(e)} className="mt-8">
            <label className="block text-sm font-medium text-slate-700" htmlFor="email">
              {t("login.email")}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition-shadow placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />

            <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="password">
              {t("login.password")}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition-shadow placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />

            {error !== null && (
              <p role="alert" className="mt-5 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-600/10">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="pressable mt-7 w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-600 disabled:opacity-60"
            >
              {pending ? t("login.pending") : t("login.submit")}
            </button>
          </form>

          <div className="mt-5">
            <div className="relative flex items-center">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="px-3 text-xs text-slate-400">{t("login.or")}</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.href = api.oidcLoginUrl();
              }}
              className="pressable mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              {t("login.oidc_button")}
            </button>
          </div>

          {import.meta.env.DEV && (
            <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-500">
                {t("login.demo_title")}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-1.5">
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    disabled={pending}
                    onClick={() => void submit(acc.email, DEMO_PASSWORD)}
                    className="pressable flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-1.5 text-left text-xs transition-colors hover:border-teal-500 disabled:opacity-50"
                  >
                    <span className="font-medium text-slate-700">{acc.label}</span>
                    <span className="font-mono text-slate-400">{acc.email}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">{t("login.demo_hint")}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
