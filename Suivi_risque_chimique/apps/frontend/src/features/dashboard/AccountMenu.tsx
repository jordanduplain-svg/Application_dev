import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useExclusiveOpen } from "../../lib/useExclusiveOpen";

/**
 * Menu « compte » — toujours à l'extrémité droite de la barre de
 * navigation, séparé des actions métier. Identité + rôle en un coup d'œil,
 * déconnexion dans le menu (pas un bouton flottant à part).
 */
export function AccountMenu({
  displayName,
  role,
  onLogout,
}: {
  displayName: string;
  role: string;
  onLogout: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useExclusiveOpen();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const initial = displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="relative border-l border-slate-200 pl-3" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="pressable inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-slate-100"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white" aria-hidden="true">
          {initial}
        </span>
        <span className="hidden text-slate-700 sm:block">{displayName}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
          <div className="border-b border-slate-100 px-3.5 py-2.5">
            <p className="text-sm font-medium text-slate-900">{displayName}</p>
            <span className="mt-1 inline-block rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 ring-1 ring-inset ring-teal-600/20">
              {t(`roles.${role}`)}
            </span>
          </div>
          <button
            onClick={onLogout}
            className="block w-full px-3.5 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            {t("nav.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
