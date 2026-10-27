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
import { ZimProvider } from './zimContext';

/** Client-side route guard. The server enforces the same rules; this only provides sensible navigation. */
export function RequireRole({ roles, children }: { roles: User['role'][]; children?: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading" fullPage />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={portalPath(user.role)} replace />;
  return <>{children ?? <Outlet />}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading" fullPage />;
  return <Navigate to={user ? portalPath(user.role) : '/login'} replace />;
}

export function App() {
  return (
    <ZimProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route element={<RequireRole roles={['executive_manager']} />}>
          <Route path="/executive" element={<Shell portal="executive" />}>
            <Route index element={<Dashboard />} />
            <Route path="pos" element={<Pos />} />
            <Route path="products" element={<Products />} />
            <Route path="operations" element={<Operations />} />
            <Route path="procurement" element={<Procurement />} />
            <Route path="transfers" element={<Transfers />} />
            <Route path="warehouses" element={<Warehouses />} />
            <Route path="reports" element={<Reports />} />
            <Route path="users" element={<Users />} />
            <Route path="organisation" element={<Organisation />} />
          </Route>
        </Route>
        <Route element={<RequireRole roles={['inventory_manager']} />}>
          <Route path="/inventory" element={<Shell portal="inventory" />}>
            <Route index element={<Dashboard />} />
            <Route path="pos" element={<Pos />} />
            <Route path="products" element={<Products />} />
            <Route path="operations" element={<Operations />} />
            <Route path="procurement" element={<Procurement />} />
            <Route path="transfers" element={<Transfers />} />
            <Route path="warehouses" element={<Warehouses />} />
            <Route path="reports" element={<Reports />} />
            <Route path="users" element={<Users />} />
            <Route path="organisation" element={<Organisation />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ZimProvider>
  );
}
