import type { ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { portalPath, useAuth } from './auth';
import type { User } from './api';
import { Shell } from './components/Shell';
import { Spinner } from './components/Spinner';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';
import { Operations } from './pages/Operations';
import { Organisation } from './pages/Organisation';
import { Procurement } from './pages/Procurement';
import { Products } from './pages/Products';
import { Reports } from './pages/Reports';
import { Transfers } from './pages/Transfers';
import { Users } from './pages/Users';
import { Warehouses } from './pages/Warehouses';
import { Pos } from './pages/Pos';
import { SetupManager } from './pages/SetupManager';
import { StockIntake } from './pages/StockIntake';
import { StockCount } from './pages/StockCount';
import { AuditLogs } from './pages/AuditLogs';
import { LaybyAndChange } from './pages/LaybyAndChange';
import { ZimProvider } from './zimContext';

/** Client-side route guard. The server enforces the same rules; this only provides sensible navigation. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, needsSetup } = useAuth();
  if (loading) return <Spinner label="Loading" fullPage />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: User['role'][]; children?: ReactNode }) {
  const { user, loading, needsSetup } = useAuth();
  if (loading) return <Spinner label="Loading" fullPage />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={portalPath(user.role)} replace />;
  return <>{children ?? <Outlet />}</>;
}

function Home() {
  const { user, loading, needsSetup } = useAuth();
  if (loading) return <Spinner label="Loading" fullPage />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  return <Navigate to={user ? portalPath(user.role) : '/login'} replace />;
}

export function App() {
  return (
    <ZimProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<SetupManager />} />

        {/* Standalone POS Portal Route */}
        <Route
          path="/pos"
          element={
            <RequireAuth>
              <Pos />
            </RequireAuth>
          }
        />

        {/* Executive Manager Portal: Executive Overview, Reports & ZIMRA VAT, User Management, Audit Logs & Governance, Settings & Backups */}
        <Route element={<RequireRole roles={['executive_manager']} />}>
          <Route path="/executive" element={<Shell portal="executive" />}>
            <Route index element={<Dashboard />} />
            <Route path="reports" element={<Reports />} />
            <Route path="users" element={<Users />} />
            <Route path="audit" element={<AuditLogs />} />
            <Route path="settings" element={<Organisation />} />
            <Route path="layby-and-change" element={<LaybyAndChange />} />
            <Route path="layby" element={<Navigate to="/executive/layby-and-change" replace />} />
            {/* Backward-compatibility aliases */}
            <Route path="organisation" element={<Navigate to="/executive/settings" replace />} />
            <Route path="pos" element={<Pos />} />
            <Route path="products" element={<Products />} />
            <Route path="procurement" element={<StockIntake />} />
            <Route path="intake" element={<StockIntake />} />
            <Route path="transfers" element={<Transfers />} />
            <Route path="warehouses" element={<Warehouses />} />
            <Route path="departments" element={<Warehouses />} />
            <Route path="operations" element={<AuditLogs />} />
          </Route>
        </Route>

        {/* Inventory Manager Portal: Dashboard & Overview, Products & Packaging, Stock Intake, Transfers, Departments, Stock Count */}
        <Route element={<RequireRole roles={['inventory_manager']} />}>
          <Route path="/inventory" element={<Shell portal="inventory" />}>
            <Route index element={<Dashboard />} />
            <Route path="products" element={<Products />} />
            <Route path="intake" element={<StockIntake />} />
            <Route path="transfers" element={<Transfers />} />
            <Route path="departments" element={<Warehouses />} />
            <Route path="count" element={<StockCount />} />
            <Route path="layby-and-change" element={<LaybyAndChange />} />
            <Route path="layby" element={<Navigate to="/inventory/layby-and-change" replace />} />
            {/* Backward-compatibility aliases */}
            <Route path="procurement" element={<Navigate to="/inventory/intake" replace />} />
            <Route path="warehouses" element={<Navigate to="/inventory/departments" replace />} />
            <Route path="operations" element={<Navigate to="/inventory/count" replace />} />
            <Route path="reports" element={<Reports />} />
            <Route path="users" element={<Navigate to="/inventory" replace />} />
            <Route path="organisation" element={<Navigate to="/inventory" replace />} />
            <Route path="pos" element={<Pos />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ZimProvider>
  );
}
