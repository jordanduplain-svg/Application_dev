import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, ApiError, type UserDto, type UserPayload, type UserRole } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AdminShell } from "./AdminShell";

const ROLES: UserRole[] = ["ADMIN", "HSE", "RH", "MEDECINE", "MANAGER", "COLLABORATEUR"];

interface FormState {
  id: string | null; // null = création
  email: string;
  displayName: string;
  role: UserRole;
  matricule: string;
  password: string;
  isActive: boolean;
  managedSectors: string; // saisie « SECTEUR-A, SECTEUR-B »
}

const emptyForm = (): FormState => ({
  id: null,
  email: "",
  displayName: "",
  role: "COLLABORATEUR",
  matricule: "",
  password: "",
  isActive: true,
  managedSectors: "",
});

/**
 * Gestion des comptes (Admin) : liste + création / édition / suppression, avec
 * rôle, matricule (rattachement collaborateur) et secteurs gérés (manager). La
 * sécurité est côté serveur — l'API renvoie 403/409 le cas échéant.
 */
export function UsersPage(): JSX.Element {
  const { t } = useTranslation();
  const { call, logout } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const onAuthError = (err: unknown): void => {
    if (err instanceof ApiError && err.status === 401) {
      logout();
      navigate("/login", { replace: true });
      return;
    }
    setError(err instanceof ApiError ? err.message : t("users.error"));
  };

  const reload = (): void => {
    call(api.users).then(setUsers).catch(onAuthError);
  };

  useEffect(reload, [call, logout, navigate, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (u: UserDto): void =>
    setForm({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      matricule: u.matricule ?? "",
      password: "",
      isActive: u.isActive,
      managedSectors: u.managedSectors.join(", "),
    });

  const submit = async (): Promise<void> => {
    if (form === null) return;
    setSaving(true);
    setError(null);
    const payload: UserPayload = {
      displayName: form.displayName,
      role: form.role,
      isActive: form.isActive,
      managedSectors: form.managedSectors
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
      ...(form.matricule.trim() !== "" ? { matricule: form.matricule.trim() } : {}),
      ...(form.password !== "" ? { password: form.password } : {}),
    };
    try {
      if (form.id === null) {
        await call((tk) => api.createUser(tk, { ...payload, email: form.email.trim() }));
      } else {
        await call((tk) => api.updateUser(tk, form.id as string, payload));
      }
      setForm(null);
      reload();
    } catch (err) {
      onAuthError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u: UserDto): Promise<void> => {
    if (!window.confirm(t("users.confirm_delete", { name: u.displayName }))) return;
    try {
      await call((tk) => api.deleteUser(tk, u.id));
      reload();
    } catch (err) {
      onAuthError(err);
    }
  };

  return (
    <AdminShell title={t("users.title")} subtitle={t("users.subtitle")}>
      {error !== null && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mb-4">
        <button
          onClick={() => setForm(emptyForm())}
          className="pressable rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-800"
        >
          {t("users.new")}
        </button>
      </div>

      {form !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2"
        >
          {form.id === null && (
            <Field label={t("users.email")}>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputCls}
              />
            </Field>
          )}
          <Field label={t("users.display_name")}>
            <input
              required
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("users.role")}>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              className={inputCls}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("users.matricule")} hint={t("users.matricule_hint")}>
            <input
              value={form.matricule}
              onChange={(e) => setForm({ ...form, matricule: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("users.managed_sectors")} hint={t("users.managed_sectors_hint")}>
            <input
              value={form.managedSectors}
              onChange={(e) => setForm({ ...form, managedSectors: e.target.value })}
              className={inputCls}
              placeholder="SECTEUR-A, SECTEUR-B"
            />
          </Field>
          <Field
            label={form.id === null ? t("users.password") : t("users.password_edit")}
            hint={t("users.password_hint")}
          >
            <input
              type="password"
              required={form.id === null}
              minLength={12}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={inputCls}
            />
          </Field>
          <label className="flex items-center gap-2 self-end text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            {t("users.active")}
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="pressable rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {saving ? t("users.saving") : t("users.save")}
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="pressable rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {t("users.cancel")}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400">
              <th scope="col" className="px-3 py-2.5">{t("users.col_name")}</th>
              <th scope="col" className="px-3 py-2.5">{t("users.email")}</th>
              <th scope="col" className="px-3 py-2.5">{t("users.role")}</th>
              <th scope="col" className="px-3 py-2.5">{t("users.col_status")}</th>
              <th scope="col" className="px-3 py-2.5">{t("users.col_actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users?.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2 font-medium text-slate-900">{u.displayName}</td>
                <td className="px-3 py-2 text-slate-600">{u.email}</td>
                <td className="px-3 py-2 text-slate-600">{t(`roles.${u.role}`)}</td>
                <td className="px-3 py-2">
                  {u.isActive ? (
                    <span className="text-emerald-700">{t("users.active")}</span>
                  ) : (
                    <span className="text-slate-400">{t("users.inactive")}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => startEdit(u)} className="text-teal-700 hover:underline">
                    {t("users.edit")}
                  </button>
                  <button
                    onClick={() => void remove(u)}
                    className="ml-3 text-red-600 hover:underline"
                  >
                    {t("users.delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint !== undefined && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
