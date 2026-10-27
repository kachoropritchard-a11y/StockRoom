import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth';

function mockFetch(user: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return user ? new Response(JSON.stringify({ user }), { status: 200 }) : new Response('{"error":"unauthenticated"}', { status: 401 });
      if (url === '/api/dashboard/summary') return new Response(JSON.stringify({ role: 'x', branches: 3, warehouses: 4, departments: 5, users: null }), { status: 200 });
      return new Response('{}', { status: 404 });
    }),
  );
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('role-based routing', () => {
  it('redirects anonymous users to login', async () => {
    mockFetch(null);
    renderAt('/executive');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('sends an inventory manager away from the executive portal', async () => {
    mockFetch({ id: 1, name: 'Ina', role: 'inventory_manager', email: 'i@x.com', organisationId: 1, branchId: null });
    renderAt('/executive');
    expect(await screen.findByText('Inventory Portal')).toBeTruthy();
    expect(await screen.findByText('Warehouses')).toBeTruthy();
  });

  it('shows the executive portal to executives', async () => {
    mockFetch({ id: 2, name: 'Eli', role: 'executive_manager', email: 'e@x.com', organisationId: 1, branchId: null });
    renderAt('/');
    expect(await screen.findByText('Executive Portal')).toBeTruthy();
  });
});
