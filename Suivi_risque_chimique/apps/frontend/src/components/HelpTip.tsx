import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * Bulle d'aide contextuelle : un petit « ? » cliquable qui ouvre une explication.
 * Accessible (clavier + Échap + clic extérieur), sans dépendance externe.
 * Le contenu est passé en enfant (texte traduit) — à placer à côté de chaque
 * libellé d'étape ou de champ pour guider l'utilisateur.
 */
export function HelpTip({ children, label }: { children: ReactNode; label?: string }): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label ?? t("help.label")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold leading-none text-slate-500 transition-colors hover:border-teal-500 hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/30"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-6 z-50 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal leading-relaxed text-slate-600 shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}
