import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

/** Cadre commun des écrans d'administration : en-tête + retour + titre. */
export function AdminShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between px-6 py-3">
          <button
            onClick={() => navigate("/")}
            className="pressable inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            ← {t("sources.back_to_dashboard")}
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-screen-xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

/** Badge de statut commun (success / partial / failed). */
export function StatusBadge({ status }: { status: "success" | "partial" | "failed" }): JSX.Element {
  const { t } = useTranslation();
  const cls =
    status === "success"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
      : status === "partial"
        ? "bg-amber-50 text-amber-700 ring-amber-600/20"
        : "bg-red-50 text-red-700 ring-red-600/20";
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {t(`flows.status.${status}`)}
    </span>
  );
}
