import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import { AnalyticsPage } from "../features/admin/AnalyticsPage";
import { AuditPage } from "../features/admin/AuditPage";
import { ConformityPage } from "../features/admin/ConformityPage";
import { ImportsPage } from "../features/admin/ImportsPage";
import { UsersPage } from "../features/admin/UsersPage";
import { LoginPage } from "../features/auth/LoginPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { AdminSourcesPage } from "../features/sources/AdminSourcesPage";
import { AuthProvider, useAuth } from "../lib/auth";

/**
 * Routing : /login public, tout le reste derrière RequireAuth.
 * Le guard côté client n'est qu'un confort de navigation — la sécurité
 * réelle est dans le backend (un client sans jeton valide reçoit 401).
 */

function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { token } = useAuth();
  if (token === null) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App(): JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/sources"
            element={
              <RequireAuth>
                <AdminSourcesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/imports"
            element={
              <RequireAuth>
                <ImportsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/conformity"
            element={
              <RequireAuth>
                <ConformityPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/analytics"
            element={
              <RequireAuth>
                <AnalyticsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/users"
            element={
              <RequireAuth>
                <UsersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <RequireAuth>
                <AuditPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
