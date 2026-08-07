import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Table,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { DegreBadge } from "../../components/DegreBadge";
import { HelpTip } from "../../components/HelpTip";
import {
  api,
  ApiError,
  type AdministrativeRowDto,
  type DashboardRowDto,
  type DashboardViewDto,
} from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { FlowMenu } from "../flows/FlowMenu";
import { AccountMenu } from "./AccountMenu";
import { DeparturesBanner } from "./DeparturesBanner";
import { ExportMenu } from "./ExportMenu";
import { NavGroup } from "./NavGroup";
import { PersonDrawer, type PersonKey } from "./PersonDrawer";

/**
 * Tableau de bord — 13 colonnes (vue complète) ou vue administrative (RH).
 * La forme est décidée par le SERVEUR : l'UI s'adapte à la réponse.
 * Clic sur une ligne → fiche individuelle (PersonDrawer).
 */

const dateFr = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleDateString("fr-FR");

const duree = (annees: number): string =>
  annees < 0.1 ? "< 0,1 an" : `${annees.toFixed(1).replace(".", ",")} ans`;

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation();
  const { token, user, logout, call } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState<DashboardViewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Vue temporelle : date « état au … » (vide = état courant).
  const [asOf, setAsOf] = useState("");

  useEffect(() => {
    if (token === null) return;
    setLoading(true);
    setError(null);
    call((tk) => api.dashboard(tk, asOf))
      .then(setView)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          navigate("/login", { replace: true });
          return;
        }
        setError(err instanceof ApiError ? err.message : t("dashboard.unexpected_error"));
      })
      .finally(() => setLoading(false));
  }, [token, asOf, call, logout, navigate, t]);

  const isCollaborateur = user?.role === "COLLABORATEUR";

  const downloadBackup = async (): Promise<void> => {
    if (token === null) return;
    try {
      const { blob, filename } = await api.downloadBackup(token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("backup.error"));
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">
              {t("app.title")}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {user !== null && (
              <NavGroup
                label={t("nav.data_group")}
                items={[
                  ...(user.role === "ADMIN" || user.role === "HSE"
                    ? [{ key: "sources", label: t("sources.button"), onClick: () => navigate("/admin/sources") }]
                    : []),
                  ...(user.role === "ADMIN" || user.role === "HSE"
                    ? [{ key: "imports", label: t("imports.button"), onClick: () => navigate("/admin/imports") }]
                    : []),
                ]}
              />
            )}
            {user !== null && token !== null && <FlowMenu role={user.role} token={token} />}
            {user !== null && (
              <NavGroup
                label={t("nav.tracking_group")}
                items={[
                  ...(user.role === "ADMIN" || user.role === "HSE"
                    ? [{ key: "conformity", label: t("conformity.button"), onClick: () => navigate("/admin/conformity") }]
                    : []),
                  ...(user.role === "ADMIN" || user.role === "HSE" || user.role === "MEDECINE"
                    ? [{ key: "analytics", label: t("analytics.button"), onClick: () => navigate("/admin/analytics") }]
                    : []),
                ]}
              />
            )}
            {user !== null && user.role === "ADMIN" && (
              <NavGroup
                label={t("nav.admin_group")}
                items={[
                  { key: "users", label: t("users.button"), onClick: () => navigate("/admin/users") },
                  { key: "audit", label: t("audit.button"), onClick: () => navigate("/admin/audit") },
                  { key: "backup", label: t("backup.button"), onClick: () => void downloadBackup() },
                ]}
              />
            )}
            {user !== null && token !== null && <ExportMenu role={user.role} token={token} />}
            {user !== null && (
              <AccountMenu
                displayName={user.displayName}
                role={user.role}
                onLogout={() => {
                  logout();
                  navigate("/login", { replace: true });
                }}
              />
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-screen-2xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {isCollaborateur ? t("dashboard.title_self") : t("dashboard.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isCollaborateur ? t("dashboard.subtitle_self") : t("dashboard.subtitle")}
          </p>
        </div>

        {user !== null && (user.role === "ADMIN" || user.role === "HSE" || user.role === "MEDECINE") && (
          <DeparturesBanner />
        )}

        {/* Vue temporelle (SCD2) : reconstituer l'état des listes à une date passée. */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            {t("dashboard.as_of_label")}
            <HelpTip>{t("dashboard.as_of_help")}</HelpTip>
            <input
              type="date"
              value={asOf}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setAsOf(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />
          </label>
          {asOf !== "" && (
            <>
              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                {t("dashboard.as_of_active", { date: new Date(asOf).toLocaleDateString("fr-FR") })}
              </span>
              <button onClick={() => setAsOf("")} className="text-sm font-medium text-teal-700 hover:underline">
                {t("dashboard.as_of_reset")}
              </button>
            </>
          )}
        </div>

        {loading && <LoadingState label={t("dashboard.loading")} />}
        {error !== null && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-600/10">
            {error}
          </p>
        )}
        {view !== null && view.columns === "full" && (
          <FullDashboard rows={view.rows} role={user?.role ?? ""} token={token} />
        )}
        {view !== null && view.columns === "administrative" && (
          <AdministrativeDashboard rows={view.rows} />
        )}
      </div>
    </main>
  );
}

function BrandMark(): JSX.Element {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-700 text-white" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        {/* Fiole : clin d'œil chimie, trait simple. */}
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
  );
}

function LoadingState({ label }: { label: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Vue complète (13 colonnes) + fiche individuelle
// ---------------------------------------------------------------------

function FullDashboard({
  rows,
  role,
  token,
}: {
  rows: DashboardRowDto[];
  role: string;
  token: string | null;
}): JSX.Element {
  const { t } = useTranslation();
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selected, setSelected] = useState<PersonKey | null>(null);
  // Filtre « CMR uniquement » : ne montrer que les produits cancérogènes /
  // mutagènes / reprotoxiques 1A/1B (le cœur du décret).
  const [cmrOnly, setCmrOnly] = useState(false);
  const data = cmrOnly ? rows.filter((r) => r.isCmr) : rows;

  const columns = useMemo<ColumnDef<DashboardRowDto>[]>(
    () => [
      {
        accessorKey: "nom",
        header: t("columns.nom"),
        cell: (c) => (
          <span className="font-medium text-slate-900">{c.getValue() as string}</span>
        ),
      },
      { accessorKey: "prenom", header: t("columns.prenom") },
      { accessorKey: "fonction", header: t("columns.fonction"), cell: (c) => c.getValue() ?? "—" },
      {
        accessorKey: "codeSecteur",
        header: t("columns.code_secteur"),
        cell: (c) => (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
            {c.getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: "dateDebutSecteur",
        header: t("columns.date_debut_secteur"),
        cell: (c) => <span className="tnum text-slate-500">{dateFr(c.getValue() as string)}</span>,
      },
      {
        accessorKey: "dateFinSecteur",
        header: t("columns.date_fin_secteur"),
        cell: (c) => (
          <span className="tnum text-slate-500">{dateFr(c.getValue() as string | null)}</span>
        ),
      },
      {
        accessorKey: "designation",
        header: t("columns.designation"),
        cell: (c) => {
          const row = c.row.original;
          return (
            <span className="flex items-center gap-1.5">
              <span className="font-medium text-slate-900">{c.getValue() as string}</span>
              {row.isCmr && (
                <span
                  title={row.cmrCategories.join(", ")}
                  className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 ring-1 ring-inset ring-red-600/20"
                >
                  CMR
                </span>
              )}
            </span>
          );
        },
      },
      {
        accessorKey: "nCas",
        header: t("columns.n_cas"),
        cell: (c) =>
          c.getValue() === null ? (
            "—"
          ) : (
            <span className="font-mono text-xs text-slate-500">{c.getValue() as string}</span>
          ),
      },
      {
        accessorKey: "classifSgh",
        header: t("columns.classif_sgh"),
        cell: (c) =>
          c.getValue() === null ? (
            "—"
          ) : (
            <span className="font-mono text-xs text-slate-500">{c.getValue() as string}</span>
          ),
      },
      {
        accessorKey: "mentionDanger",
        header: t("columns.mention_danger"),
        cell: (c) => (
          <span className="text-slate-600">{(c.getValue() as string | null) ?? "—"}</span>
        ),
      },
      {
        accessorKey: "dateEvaluation",
        header: t("columns.date_evaluation"),
        cell: (c) => (
          <span className="tnum text-slate-500">{dateFr(c.getValue() as string | null)}</span>
        ),
      },
      {
        accessorKey: "dateRetrait",
        header: t("columns.date_retrait"),
        cell: (c) => (
          <span className="tnum text-slate-500">{dateFr(c.getValue() as string | null)}</span>
        ),
      },
      {
        accessorKey: "degreExposition",
        header: t("columns.degre_exposition"),
        cell: (c) => <DegreBadge value={c.getValue() as string | null} />,
      },
      {
        accessorKey: "dureeExpositionAnnees",
        header: t("columns.duree_exposition"),
        cell: (c) => {
          const row = c.row.original;
          if (row.exposureAnomalies.length > 0) {
            return (
              <span
                className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20"
                title={row.exposureAnomalies.map((a) => a.message).join(" ")}
              >
                {t("dashboard.anomaly")}
              </span>
            );
          }
          return (
            <span className="tnum font-medium text-slate-900">
              {duree(c.getValue() as number)}
            </span>
          );
        },
      },
    ],
    [t],
  );

  const table = useReactTable({
    data,
    columns,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <section>
      <Toolbar
        value={globalFilter}
        onChange={setGlobalFilter}
        count={table.getFilteredRowModel().rows.length}
        cmrOnly={cmrOnly}
        onCmrToggle={setCmrOnly}
      />
      <DataTable
        table={table}
        emptyMessage={t("dashboard.empty")}
        onRowClick={(row: DashboardRowDto) =>
          setSelected({ nom: row.nom, prenom: row.prenom, matricule: row.matricule })
        }
      />
      {selected !== null && (
        <PersonDrawer
          person={selected}
          rows={rows}
          role={role}
          token={token}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Vue administrative (RH)
// ---------------------------------------------------------------------

function AdministrativeDashboard({ rows }: { rows: AdministrativeRowDto[] }): JSX.Element {
  const { t } = useTranslation();
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<AdministrativeRowDto>[]>(
    () => [
      {
        accessorKey: "matricule",
        header: t("columns.matricule"),
        cell: (c) =>
          c.getValue() === null ? (
            "—"
          ) : (
            <span className="font-mono text-xs text-slate-500">{c.getValue() as string}</span>
          ),
      },
      {
        accessorKey: "nom",
        header: t("columns.nom"),
        cell: (c) => <span className="font-medium text-slate-900">{c.getValue() as string}</span>,
      },
      { accessorKey: "prenom", header: t("columns.prenom") },
      { accessorKey: "fonction", header: t("columns.fonction"), cell: (c) => c.getValue() ?? "—" },
      {
        accessorKey: "entrepriseTravailTemporaire",
        header: t("columns.entreprise_tt"),
        cell: (c) =>
          c.getValue() === null ? (
            "—"
          ) : (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700 ring-1 ring-inset ring-violet-600/20">
              {c.getValue() as string}
            </span>
          ),
      },
      {
        accessorKey: "codeSecteur",
        header: t("columns.code_secteur"),
        cell: (c) => (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
            {c.getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: "dateDebutSecteur",
        header: t("columns.date_debut_secteur"),
        cell: (c) => <span className="tnum text-slate-500">{dateFr(c.getValue() as string)}</span>,
      },
      {
        accessorKey: "dateFinSecteur",
        header: t("columns.date_fin_secteur"),
        cell: (c) => (
          <span className="tnum text-slate-500">{dateFr(c.getValue() as string | null)}</span>
        ),
      },
    ],
    [t],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <section>
      <p className="mb-4 rounded-lg bg-blue-50 px-4 py-2.5 text-sm text-blue-800 ring-1 ring-inset ring-blue-600/10">
        {t("dashboard.administrative_notice")}
      </p>
      <Toolbar
        value={globalFilter}
        onChange={setGlobalFilter}
        count={table.getFilteredRowModel().rows.length}
      />
      <DataTable table={table} emptyMessage={t("dashboard.empty")} />
    </section>
  );
}

// ---------------------------------------------------------------------
// Briques partagées
// ---------------------------------------------------------------------

function Toolbar({
  value,
  onChange,
  count,
  cmrOnly,
  onCmrToggle,
}: {
  value: string;
  onChange: (v: string) => void;
  count: number;
  cmrOnly?: boolean;
  onCmrToggle?: (v: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="relative w-80">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("dashboard.search_placeholder")}
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm transition-shadow placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
          aria-label={t("dashboard.search_placeholder")}
        />
        </div>
        {onCmrToggle !== undefined && (
          <label className="flex select-none items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={cmrOnly ?? false}
              onChange={(e) => onCmrToggle(e.target.checked)}
              className="rounded border-slate-300 text-teal-600 focus:ring-teal-600/20"
            />
            {t("dashboard.cmr_only")}
            <HelpTip>{t("dashboard.cmr_help")}</HelpTip>
          </label>
        )}
      </div>
      <span className="tnum text-sm text-slate-400">{t("dashboard.row_count", { count })}</span>
    </div>
  );
}

/**
 * Table virtualisée (TanStack Virtual). Seules les lignes visibles sont
 * rendues : le DOM reste léger même avec plusieurs milliers de lignes pour
 * une ETI. L'en-tête est figé (sticky) en haut du conteneur scrollable, et on
 * réserve l'espace des lignes hors écran par deux lignes d'espacement
 * (haut/bas) pour que la barre de défilement reste exacte.
 */
const ROW_HEIGHT = 41;

function DataTable<T>({
  table,
  emptyMessage,
  onRowClick,
}: {
  table: Table<T>;
  emptyMessage: string;
  onRowClick?: (row: T) => void;
}): JSX.Element {
  const rows = table.getRowModel().rows;
  const colCount = table.getAllColumns().length;
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]!.start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1]!.end
      : 0;

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm"
      style={{ maxHeight: "calc(100vh - 240px)" }}
    >
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-slate-200">
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  tabIndex={0}
                  className="cursor-pointer select-none whitespace-nowrap bg-slate-50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 shadow-[inset_0_-1px_0_#e2e8f0] transition-colors hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600/40"
                  onClick={header.column.getToggleSortingHandler()}
                  onKeyDown={(e) => {
                    // Tri accessible au clavier (Entrée / Espace).
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      header.column.getToggleSortingHandler()?.(e);
                    }
                  }}
                  aria-sort={
                    header.column.getIsSorted() === "asc"
                      ? "ascending"
                      : header.column.getIsSorted() === "desc"
                        ? "descending"
                        : "none"
                  }
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === "asc" && <span className="ml-1 text-teal-600">↑</span>}
                  {header.column.getIsSorted() === "desc" && <span className="ml-1 text-teal-600">↓</span>}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-3 py-12 text-center text-slate-400">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            <>
              {paddingTop > 0 && (
                <tr>
                  <td colSpan={colCount} style={{ height: paddingTop }} />
                </tr>
              )}
              {virtualRows.map((vRow) => {
                const row = rows[vRow.index]!;
                return (
                  <tr
                    key={row.id}
                    className={`transition-colors hover:bg-teal-50/40 ${onRowClick !== undefined ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600/40" : ""}`}
                    onClick={onRowClick !== undefined ? () => onRowClick(row.original) : undefined}
                    {...(onRowClick !== undefined
                      ? {
                          // Pas de role="button" : on garde la sémantique de
                          // ligne de tableau, tout en la rendant focusable et
                          // activable au clavier.
                          tabIndex: 0,
                          onKeyDown: (e: KeyboardEvent) => {
                            // Ouverture de la fiche au clavier (Entrée / Espace).
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(row.original);
                            }
                          },
                        }
                      : {})}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="whitespace-nowrap px-3 py-2.5 text-slate-700">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td colSpan={colCount} style={{ height: paddingBottom }} />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
