import { useEffect, useRef } from "react";

import { useExclusiveOpen } from "../../lib/useExclusiveOpen";

/**
 * Groupe de navigation : rend un menu déroulant quand plusieurs items sont
 * visibles pour le rôle courant, ou un simple bouton quand un seul l'est —
 * pas de menu à un seul choix. Rend `null` si aucun item n'est visible.
 *
 * Le RBAC d'affichage vit dans l'appelant (qui filtre `items` par rôle) ;
 * ce composant n'est que de la présentation.
 */
export interface NavItem {
  key: string;
  label: string;
  onClick: () => void;
}

export function NavGroup({ label, items }: { label: string; items: NavItem[] }): JSX.Element | null {
  const [open, setOpen] = useExclusiveOpen();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (items.length === 0) return null;

  const buttonCls =
    "pressable rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300";

  if (items.length === 1) {
    const only = items[0]!;
    return (
      <button onClick={only.onClick} className={buttonCls}>
        {only.label}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className={`${buttonCls} inline-flex items-center gap-1`}>
        {label}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
          {items.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="block w-full px-3.5 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
