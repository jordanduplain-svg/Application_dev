import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { HelpTip } from "../../components/HelpTip";
import { suggestMapping } from "../../lib/suggestMapping";
import {
  api,
  ApiError,
  type ConnectorDescriptor,
  type DryRunResultDto,
  type MappingRule,
  type PreviewResultDto,
  type SourceDto,
  type SourcePayload,
  type SourceSchemaDto,
} from "../../lib/api";

/**
 * Assistant de configuration d'une source en 4 étapes :
 *   1. Source   — type de connecteur + fichier (Excel/CSV).
 *   2. Aperçu   — profils de colonnes + échantillon (la « vue data analyst »).
 *   3. Mapping  — colonne source ↔ champ canonique + règles de transformation.
 *   4. Validation — dry-run (combien de lignes passeraient) puis enregistrement.
 *
 * Aucune donnée n'est écrite avant l'étape 4. Tout le RBAC et la sécurité sont
 * côté serveur ; ce composant n'orchestre que l'UX.
 */

type Step = 1 | 2 | 3 | 4;

const LIST_TYPES = ["PERSONNEL", "RISQUES_CHIMIQUES", "DEGRE_EXPOSITION"] as const;

interface WizardProps {
  token: string;
  schema: SourceSchemaDto;
  editing: SourceDto | null;
  onClose: () => void;
  onSaved: () => void;
}

export function SourceWizard({ token, schema, editing, onClose, onSaved }: WizardProps): JSX.Element {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);

  // --- État de la source en construction. ---
  const [name, setName] = useState(editing?.name ?? "");
  const [listType, setListType] = useState(editing?.listType ?? "PERSONNEL");
  const [connectorType, setConnectorType] = useState(editing?.connectorType ?? "excel");
  const [fileToken, setFileToken] = useState<string | null>(null);
  const [originalName, setOriginalName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string>(editing?.sheet ?? "");
  // Secret des connecteurs base de données. Jamais renvoyé par le serveur : vide
  // à l'édition = on conserve le secret déjà enregistré.
  const [connectionString, setConnectionString] = useState("");
  const [columns, setColumns] = useState<Record<string, string>>(editing?.columns ?? {});
  const [rules, setRules] = useState<MappingRule[]>(editing?.rules ?? []);

  const [preview, setPreview] = useState<PreviewResultDto | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = schema.fields[listType] ?? [];
  const category = schema.connectors.find((c) => c.type === connectorType)?.category;
  const isCloud = category === "cloud";
  // « needsSecret » : la localisation est un secret saisi (chaîne SQL / lien
  // SharePoint), pas un fichier uploadé. La feuille est requise pour les bases
  // (table) mais optionnelle pour le cloud (fichier Excel/CSV).
  const needsSecret = category === "database" || category === "cloud";

  // Colonnes disponibles au mapping : celles détectées + celles créées par une
  // règle `concat` (le champ peut pointer vers une colonne synthétique).
  const availableColumns = useMemo(() => {
    const fromPreview = preview?.columns.map((c) => c.name) ?? Object.values(columns);
    const fromRules = rules.filter((r) => r.kind === "concat").map((r) => r.targetColumn);
    return [...new Set([...fromPreview, ...fromRules])].filter((c) => c !== "");
  }, [preview, columns, rules]);

  const runPreview = useCallback(async () => {
    // Secret (SQL/SharePoint) : chaîne/lien requis (+ table pour SQL). Fichier : jeton.
    if (needsSecret ? connectionString === "" || (!isCloud && sheet === "") : fileToken === null)
      return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.previewSource(token, {
        connectorType,
        ...(sheet !== "" ? { sheet } : {}),
        ...(rules.length > 0 ? { rules } : {}),
        ...(needsSecret ? { connectionString } : fileToken !== null ? { fileToken } : {}),
      });
      setPreview(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("sources.error_generic"));
    } finally {
      setBusy(false);
    }
  }, [token, connectorType, needsSecret, isCloud, connectionString, fileToken, sheet, rules, t]);

  const runDryRun = useCallback(async () => {
    if (needsSecret ? connectionString === "" || (!isCloud && sheet === "") : fileToken === null)
      return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.dryRunSource(token, {
        connectorType,
        ...(sheet !== "" ? { sheet } : {}),
        listType,
        columns,
        ...(rules.length > 0 ? { rules } : {}),
        ...(needsSecret ? { connectionString } : fileToken !== null ? { fileToken } : {}),
      });
      setDryRun(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("sources.error_generic"));
    } finally {
      setBusy(false);
    }
  }, [token, connectorType, needsSecret, isCloud, connectionString, fileToken, sheet, listType, columns, rules, t]);

  // Source prête à être lue : un fichier uploadé OU un secret saisi (SQL/SharePoint).
  const sourceReady = fileToken !== null || (needsSecret && connectionString !== "");
  // Chargements automatiques à l'entrée des étapes qui en dépendent.
  useEffect(() => {
    if (step === 2 && sourceReady) void runPreview();
  }, [step, sourceReady, runPreview]);
  // Aperçu LIVE à l'étape Mapping : on recalcule l'échantillon après chaque
  // modification de règle (débounce léger pour ne pas spammer le serveur).
  useEffect(() => {
    if (step !== 3 || !sourceReady) return;
    const id = setTimeout(() => void runPreview(), 400);
    return () => clearTimeout(id);
  }, [step, rules, sourceReady, runPreview]);
  useEffect(() => {
    if (step === 4) void runDryRun();
  }, [step, runDryRun]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const payload: SourcePayload = {
        name,
        listType,
        connectorType,
        ...(fileToken !== null ? { fileToken } : {}),
        ...(needsSecret && connectionString !== "" ? { connectionString } : {}),
        ...(sheet !== "" ? { sheet } : {}),
        columns,
        ...(rules.length > 0 ? { rules } : {}),
        enabled: editing?.enabled ?? true,
      };
      if (editing !== null) await api.updateSource(token, editing.id, payload);
      else await api.createSource(token, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("sources.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  // Conditions d'avancement par étape.
  const canLeaveStep1 =
    name.trim() !== "" &&
    (needsSecret
      ? (isCloud || sheet.trim() !== "") && (connectionString !== "" || editing !== null)
      : fileToken !== null || editing !== null);
  const requiredFieldsMapped = fields
    .filter((f) => f.required)
    .every((f) => (columns[f.field] ?? "") !== "");

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">
            {editing !== null ? t("sources.wizard.edit_title") : t("sources.wizard.new_title")}
          </h2>
          <Stepper step={step} />
        </div>
        <button
          onClick={onClose}
          className="pressable rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label={t("sources.wizard.close")}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
        {step === 1 && (
          <StepSource
            schema={schema}
            token={token}
            name={name}
            onName={setName}
            listType={listType}
            onListType={setListType}
            connectorType={connectorType}
            onConnectorType={setConnectorType}
            needsSecret={needsSecret}
            isCloud={isCloud}
            connectionString={connectionString}
            onConnectionString={setConnectionString}
            sheet={sheet}
            onSheet={setSheet}
            originalName={originalName ?? (editing !== null ? t("sources.wizard.existing_file") : null)}
            onUploaded={(tok, original) => {
              setFileToken(tok);
              setOriginalName(original);
              setPreview(null);
            }}
            onError={setError}
          />
        )}
        {step === 2 && <StepPreview preview={preview} busy={busy} />}
        {step === 3 && (
          <StepMapping
            fields={fields}
            columns={columns}
            onColumns={setColumns}
            rules={rules}
            onRules={setRules}
            availableColumns={availableColumns}
            preview={preview}
          />
        )}
        {step === 4 && <StepValidate dryRun={dryRun} busy={busy} />}

        {error !== null && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-600/10">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
        <button
          onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as Step))}
          className="pressable rounded-lg px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
        >
          {step === 1 ? t("sources.wizard.cancel") : t("sources.wizard.back")}
        </button>
        {step < 4 ? (
          <button
            disabled={(step === 1 && !canLeaveStep1) || (step === 3 && !requiredFieldsMapped)}
            onClick={() => setStep((s) => (s + 1) as Step)}
            className="pressable rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-600 disabled:opacity-50"
          >
            {t("sources.wizard.next")}
          </button>
        ) : (
          <button
            disabled={busy || (dryRun?.configError ?? false)}
            onClick={() => void save()}
            className="pressable rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-600 disabled:opacity-50"
          >
            {busy ? t("sources.wizard.saving") : t("sources.wizard.save")}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Étape 1 — Source
// ---------------------------------------------------------------------

function StepSource(props: {
  schema: SourceSchemaDto;
  token: string;
  name: string;
  onName: (v: string) => void;
  listType: string;
  onListType: (v: string) => void;
  connectorType: string;
  onConnectorType: (v: string) => void;
  needsSecret: boolean;
  isCloud: boolean;
  connectionString: string;
  onConnectionString: (v: string) => void;
  sheet: string;
  onSheet: (v: string) => void;
  originalName: string | null;
  onUploaded: (fileToken: string, originalName: string) => void;
  onError: (msg: string | null) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const selected = props.schema.connectors.find((c) => c.type === props.connectorType);
  const isFile = selected?.category === "file";

  const upload = async (file: File): Promise<void> => {
    setUploading(true);
    props.onError(null);
    try {
      const res = await api.uploadSource(props.token, file);
      props.onUploaded(res.fileToken, res.originalName);
    } catch (err) {
      props.onError(err instanceof ApiError ? err.message : t("sources.error_generic"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <Field label={t("sources.wizard.name_label")}>
        <input
          value={props.name}
          onChange={(e) => props.onName(e.target.value)}
          placeholder={t("sources.wizard.name_placeholder")}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
        />
      </Field>

      <Field
        label={t("sources.wizard.list_label")}
        hint={t("sources.wizard.list_hint")}
        help={t("sources.help.list")}
      >
        <div className="grid grid-cols-3 gap-2">
          {LIST_TYPES.map((lt) => (
            <button
              key={lt}
              onClick={() => props.onListType(lt)}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                props.listType === lt
                  ? "border-teal-500 bg-teal-50 text-teal-800 ring-1 ring-teal-500/30"
                  : "border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {t(`sources.list_types.${lt}`)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("sources.wizard.connector_label")} help={t("sources.help.connector")}>
        <div className="grid grid-cols-2 gap-2">
          {props.schema.connectors.map((c) => (
            <ConnectorCard
              key={c.type}
              connector={c}
              active={props.connectorType === c.type}
              onSelect={() => c.status === "available" && props.onConnectorType(c.type)}
            />
          ))}
        </div>
      </Field>

      {isFile && (
        <Field label={t("sources.wizard.file_label")} help={t("sources.help.file")}>
          <input
            ref={inputRef}
            type="file"
            accept={selected?.fileExtensions?.join(",")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="pressable rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 disabled:opacity-50"
            >
              {uploading ? t("sources.wizard.uploading") : t("sources.wizard.choose_file")}
            </button>
            {props.originalName !== null && (
              <span className="truncate text-sm text-slate-500">{props.originalName}</span>
            )}
          </div>
          {props.connectorType === "excel" && (
            <input
              value={props.sheet}
              onChange={(e) => props.onSheet(e.target.value)}
              placeholder={t("sources.wizard.sheet_placeholder")}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />
          )}
        </Field>
      )}

      {props.needsSecret && (
        <>
          <Field
            label={props.isCloud ? t("sources.wizard.share_label") : t("sources.wizard.connection_label")}
            hint={t("sources.wizard.connection_hint")}
            help={t(props.isCloud ? "sources.help.share" : "sources.help.connection")}
          >
            <input
              type={props.isCloud ? "text" : "password"}
              value={props.connectionString}
              onChange={(e) => props.onConnectionString(e.target.value)}
              placeholder={
                props.isCloud
                  ? "https://contoso.sharepoint.com/:x:/s/.../fichier.xlsx"
                  : props.connectorType === "snowflake"
                    ? "account=xy12345.eu-west-1;user=...;password=...;warehouse=...;database=...;schema=..."
                    : "postgresql://user:motdepasse@hote:5432/base"
              }
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />
          </Field>
          <Field
            label={props.isCloud ? t("sources.wizard.sheet_label") : t("sources.wizard.table_label")}
          >
            <input
              value={props.sheet}
              onChange={(e) => props.onSheet(e.target.value)}
              placeholder={props.isCloud ? t("sources.wizard.sheet_placeholder") : "public.ma_table"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />
          </Field>
        </>
      )}
    </div>
  );
}

function ConnectorCard({
  connector,
  active,
  onSelect,
}: {
  connector: ConnectorDescriptor;
  active: boolean;
  onSelect: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const disabled = connector.status === "coming_soon";
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500/30"
          : disabled
            ? "border-dashed border-slate-200 bg-slate-50/50"
            : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium ${disabled ? "text-slate-400" : "text-slate-800"}`}>
          {connector.label}
        </span>
        {disabled && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {t("sources.coming_soon")}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{connector.description}</p>
    </button>
  );
}

// ---------------------------------------------------------------------
// Étape 2 — Aperçu (profils de colonnes)
// ---------------------------------------------------------------------

const TYPE_TONE: Record<string, string> = {
  date: "bg-violet-50 text-violet-700",
  number: "bg-blue-50 text-blue-700",
  text: "bg-slate-100 text-slate-600",
  empty: "bg-amber-50 text-amber-700",
};

function StepPreview({ preview, busy }: { preview: PreviewResultDto | null; busy: boolean }): JSX.Element {
  const { t } = useTranslation();
  if (busy || preview === null) {
    return <p className="py-8 text-center text-sm text-slate-500">{t("sources.wizard.analyzing")}</p>;
  }
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-sm text-slate-600">
        {t("sources.wizard.preview_summary", { rows: preview.rowCount, cols: preview.columns.length })}
        <HelpTip>{t("sources.help.preview")}</HelpTip>
      </p>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2">{t("sources.wizard.col_name")}</th>
              <th className="px-3 py-2">{t("sources.wizard.col_type")}</th>
              <th className="px-3 py-2">{t("sources.wizard.col_fill")}</th>
              <th className="px-3 py-2">{t("sources.wizard.col_distinct")}</th>
              <th className="px-3 py-2">{t("sources.wizard.col_sample")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {preview.columns.map((c) => (
              <tr key={c.name}>
                <td className="px-3 py-2 font-medium text-slate-800">{c.name}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_TONE[c.inferredType] ?? ""}`}>
                    {t(`sources.types.${c.inferredType}`)}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-500">
                  {c.filledCount}/{c.totalCount}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-500">{c.distinctCount}</td>
                <td className="px-3 py-2 text-slate-400">
                  <span className="line-clamp-1">{c.sampleValues.join(", ") || "—"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Étape 3 — Mapping + règles
// ---------------------------------------------------------------------

function StepMapping(props: {
  fields: { field: string; label: string; required: boolean; kind: string; hint?: string }[];
  columns: Record<string, string>;
  onColumns: (c: Record<string, string>) => void;
  rules: MappingRule[];
  onRules: (r: MappingRule[]) => void;
  availableColumns: string[];
  preview: PreviewResultDto | null;
}): JSX.Element {
  const { t } = useTranslation();

  const setColumn = (field: string, column: string): void => {
    const next = { ...props.columns };
    if (column === "") delete next[field];
    else next[field] = column;
    props.onColumns(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              {t("sources.wizard.mapping_title")}
              <HelpTip>{t("sources.help.mapping")}</HelpTip>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">{t("sources.wizard.mapping_hint")}</p>
          </div>
          {props.availableColumns.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const suggested = suggestMapping(props.availableColumns, props.fields);
                const next = { ...props.columns };
                for (const [field, col] of Object.entries(suggested)) {
                  if ((next[field] ?? "") === "") next[field] = col;
                }
                props.onColumns(next);
              }}
              className="pressable shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-teal-500 hover:text-teal-700"
            >
              {t("sources.wizard.auto_fill")}
            </button>
          )}
        </div>
        <div className="mt-3 space-y-2">
          {props.fields.map((f) => (
            <div key={f.field} className="grid grid-cols-2 items-center gap-3">
              <label className="text-sm text-slate-700">
                {f.label}
                {f.required && <span className="ml-1 text-red-500">*</span>}
                {f.hint !== undefined && <span className="block text-[11px] text-slate-400">{f.hint}</span>}
              </label>
              <select
                value={props.columns[f.field] ?? ""}
                onChange={(e) => setColumn(f.field, e.target.value)}
                className={`rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/20 ${
                  f.required && (props.columns[f.field] ?? "") === ""
                    ? "border-amber-300 bg-amber-50/40"
                    : "border-slate-300"
                }`}
              >
                <option value="">{t("sources.wizard.unmapped")}</option>
                {props.availableColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <RulesEditor
        rules={props.rules}
        onRules={props.onRules}
        availableColumns={props.availableColumns}
      />

      {props.preview !== null && <LivePreview preview={props.preview} />}
    </div>
  );
}

/** Aperçu LIVE des données APRÈS application des règles (échantillon). */
function LivePreview({ preview }: { preview: PreviewResultDto }): JSX.Element {
  const { t } = useTranslation();
  const cols = preview.columns.map((c) => c.name);
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        {t("sources.wizard.live_preview_title")}
        <HelpTip>{t("sources.help.live_preview")}</HelpTip>
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">
        {t("sources.wizard.preview_summary", { rows: preview.rowCount, cols: cols.length })}
      </p>
      <div className="mt-2 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
              {cols.map((c) => (
                <th key={c} className="whitespace-nowrap px-2.5 py-1.5">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {preview.sampleRows.slice(0, 8).map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} className="whitespace-nowrap px-2.5 py-1.5 text-slate-600">
                    {row[c] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const RULE_KINDS: MappingRule["kind"][] = [
  "trim",
  "uppercase",
  "lowercase",
  "defaultValue",
  "filterRowWhen",
  "concat",
  "rename",
  "splitColumn",
  "replace",
  "removeColumn",
  "fillDown",
  "dropEmptyRows",
];

function defaultRule(kind: MappingRule["kind"], col: string): MappingRule {
  switch (kind) {
    case "defaultValue":
      return { kind, column: col, value: "" };
    case "filterRowWhen":
      return { kind, column: col, equals: "" };
    case "concat":
      return { kind, targetColumn: "", columns: col !== "" ? [col] : [], separator: " " };
    case "rename":
      return { kind, column: col, to: "" };
    case "splitColumn":
      return { kind, column: col, separator: " ", left: "", right: "" };
    case "replace":
      return { kind, column: col, search: "", replaceWith: "" };
    case "dropEmptyRows":
      return { kind };
    default:
      // trim / uppercase / lowercase / removeColumn / fillDown
      return { kind, column: col };
  }
}

function RulesEditor(props: {
  rules: MappingRule[];
  onRules: (r: MappingRule[]) => void;
  availableColumns: string[];
}): JSX.Element {
  const { t } = useTranslation();
  const firstCol = props.availableColumns[0] ?? "";

  const update = (i: number, rule: MappingRule): void => {
    const next = [...props.rules];
    next[i] = rule;
    props.onRules(next);
  };
  const remove = (i: number): void => props.onRules(props.rules.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= props.rules.length) return;
    const next = [...props.rules];
    [next[i], next[j]] = [next[j] as MappingRule, next[i] as MappingRule];
    props.onRules(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            {t("sources.wizard.rules_title")}
            <HelpTip>{t("sources.help.rules")}</HelpTip>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">{t("sources.wizard.rules_hint")}</p>
        </div>
        <button
          onClick={() => props.onRules([...props.rules, defaultRule("trim", firstCol)])}
          className="pressable rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400"
        >
          {t("sources.wizard.add_rule")}
        </button>
      </div>

      {props.rules.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
          {t("sources.wizard.no_rules")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {props.rules.map((rule, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
              <select
                value={rule.kind}
                onChange={(e) => update(i, defaultRule(e.target.value as MappingRule["kind"], firstCol))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                {RULE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`sources.rules.${k}`)}
                  </option>
                ))}
              </select>
              <RuleParams rule={rule} onChange={(r) => update(i, r)} columns={props.availableColumns} />
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="pressable rounded-md px-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                  aria-label={t("sources.wizard.move_up")}
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === props.rules.length - 1}
                  className="pressable rounded-md px-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                  aria-label={t("sources.wizard.move_down")}
                >
                  ↓
                </button>
                <button
                  onClick={() => remove(i)}
                  className="pressable rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                  aria-label={t("sources.wizard.remove_rule")}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Champs spécifiques à chaque type de règle. */
function RuleParams({
  rule,
  onChange,
  columns,
}: {
  rule: MappingRule;
  onChange: (r: MappingRule) => void;
  columns: string[];
}): JSX.Element {
  const { t } = useTranslation();
  const colSelect = (value: string, set: (v: string) => void): JSX.Element => (
    <select
      value={value}
      onChange={(e) => set(e.target.value)}
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
    >
      <option value="">{t("sources.wizard.column")}</option>
      {columns.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );

  if (rule.kind === "concat") {
    return (
      <>
        <input
          value={rule.targetColumn}
          onChange={(e) => onChange({ ...rule, targetColumn: e.target.value })}
          placeholder={t("sources.wizard.new_column")}
          className="w-28 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <span className="text-xs text-slate-400">=</span>
        <input
          value={rule.columns.join(",")}
          onChange={(e) => onChange({ ...rule, columns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          placeholder={t("sources.wizard.columns_csv")}
          className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <input
          value={rule.separator}
          onChange={(e) => onChange({ ...rule, separator: e.target.value })}
          placeholder={t("sources.wizard.separator")}
          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </>
    );
  }
  if (rule.kind === "defaultValue") {
    return (
      <>
        {colSelect(rule.column, (v) => onChange({ ...rule, column: v }))}
        <input
          value={rule.value}
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
          placeholder={t("sources.wizard.value")}
          className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </>
    );
  }
  if (rule.kind === "filterRowWhen") {
    return (
      <>
        {colSelect(rule.column, (v) => onChange({ ...rule, column: v }))}
        <span className="text-xs text-slate-400">=</span>
        <input
          value={rule.equals}
          onChange={(e) => onChange({ ...rule, equals: e.target.value })}
          placeholder={t("sources.wizard.value")}
          className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </>
    );
  }
  if (rule.kind === "rename") {
    return (
      <>
        {colSelect(rule.column, (v) => onChange({ ...rule, column: v }))}
        <span className="text-xs text-slate-400">→</span>
        <input
          value={rule.to}
          onChange={(e) => onChange({ ...rule, to: e.target.value })}
          placeholder={t("sources.wizard.new_column")}
          className="w-28 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </>
    );
  }
  if (rule.kind === "splitColumn") {
    return (
      <>
        {colSelect(rule.column, (v) => onChange({ ...rule, column: v }))}
        <input
          value={rule.separator}
          onChange={(e) => onChange({ ...rule, separator: e.target.value })}
          placeholder={t("sources.wizard.separator")}
          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <input
          value={rule.left}
          onChange={(e) => onChange({ ...rule, left: e.target.value })}
          placeholder={t("sources.wizard.split_left")}
          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <input
          value={rule.right}
          onChange={(e) => onChange({ ...rule, right: e.target.value })}
          placeholder={t("sources.wizard.split_right")}
          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </>
    );
  }
  if (rule.kind === "replace") {
    return (
      <>
        {colSelect(rule.column, (v) => onChange({ ...rule, column: v }))}
        <input
          value={rule.search}
          onChange={(e) => onChange({ ...rule, search: e.target.value })}
          placeholder={t("sources.wizard.replace_search")}
          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <span className="text-xs text-slate-400">→</span>
        <input
          value={rule.replaceWith}
          onChange={(e) => onChange({ ...rule, replaceWith: e.target.value })}
          placeholder={t("sources.wizard.replace_with")}
          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </>
    );
  }
  if (rule.kind === "dropEmptyRows") {
    return <span className="text-xs text-slate-400">{t("sources.wizard.rule_no_param")}</span>;
  }
  // trim / uppercase / lowercase / removeColumn / fillDown
  return colSelect(rule.column, (v) => onChange({ ...rule, column: v }));
}

// ---------------------------------------------------------------------
// Étape 4 — Validation (dry-run)
// ---------------------------------------------------------------------

function StepValidate({ dryRun, busy }: { dryRun: DryRunResultDto | null; busy: boolean }): JSX.Element {
  const { t } = useTranslation();
  if (busy || dryRun === null) {
    return <p className="py-8 text-center text-sm text-slate-500">{t("sources.wizard.validating")}</p>;
  }
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        {t("sources.wizard.validate_intro")}
        <HelpTip>{t("sources.help.validate")}</HelpTip>
      </p>
      {dryRun.configError && (
        <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-600/10">
          {t("sources.wizard.config_error")}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("sources.wizard.rows_read")} value={dryRun.rowsRead} tone="slate" />
        <Stat label={t("sources.wizard.would_import")} value={dryRun.wouldImport} tone="emerald" />
        <Stat label={t("sources.wizard.would_reject")} value={dryRun.wouldReject} tone="amber" />
      </div>

      {dryRun.anomalies.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500">{t("sources.wizard.anomalies_title")}</p>
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200">
            <ul className="divide-y divide-slate-100 text-xs">
              {dryRun.anomalies.slice(0, 50).map((a, i) => (
                <li key={i} className="px-3 py-1.5 text-slate-600">
                  <span className="font-mono text-slate-400">L{a.rowNumber}</span> · {a.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }): JSX.Element {
  const toneClass: Record<string, string> = {
    slate: "text-slate-900",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-center">
      <p className={`text-2xl font-semibold tabular-nums ${toneClass[tone] ?? ""}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------

function Field({
  label,
  hint,
  help,
  children,
}: {
  label: string;
  hint?: string;
  help?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {label}
        {help !== undefined && <HelpTip>{help}</HelpTip>}
      </p>
      {children}
      {hint !== undefined && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Stepper({ step }: { step: Step }): JSX.Element {
  const { t } = useTranslation();
  const labels = [
    t("sources.wizard.step_source"),
    t("sources.wizard.step_preview"),
    t("sources.wizard.step_mapping"),
    t("sources.wizard.step_validate"),
  ];
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      {labels.map((label, i) => (
        <span
          key={label}
          className={`text-[11px] ${i + 1 === step ? "font-medium text-teal-700" : "text-slate-400"}`}
        >
          {i + 1}. {label}
          {i < 3 && <span className="ml-1.5 text-slate-300">›</span>}
        </span>
      ))}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {children}
      </div>
    </div>
  );
}
