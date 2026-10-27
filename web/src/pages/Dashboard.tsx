import { useEffect, useState } from 'react';
import { api, type Summary } from '../api';
import { useAuth } from '../auth';
import { Spinner } from '../components/Spinner';

export function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.summary().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  const cards = data
    ? [
        { label: 'Branches', value: data.branches },
        { label: 'Warehouses', value: data.warehouses },
        { label: 'Departments', value: data.departments },
        ...(data.users !== null ? [{ label: 'Active users', value: data.users }] : []),
      ]
    : [];

  return (
    <>
      <h1>Welcome, {user?.name}</h1>
      <p className="muted">Organisation structure at a glance. Inventory metrics will appear here as features are added.</p>
      {error && <p className="form-error" role="alert">Could not load the dashboard. {error}</p>}
      {!data && !error && <Spinner label="Loading dashboard" />}
      <div className="kpi-grid">
        {cards.map((c) => (
          <div className="card kpi" key={c.label}>
            <span className="kpi-label">{c.label}</span>
            <span className="kpi-value">{c.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}
