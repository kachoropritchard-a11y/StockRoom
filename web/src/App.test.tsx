import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth';

function mockFetch(user: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return user ? new Response(JSON.stringify({ user }), { status: 200 }) : new Response('{"error":"unauthenticated"}', { status: 401 });
      if (url === '/api/dashboard/summary') {
        return new Response(
          JSON.stringify({
            role: 'x',
            branches: 3,
            warehouses: 4,
            departments: 5,
            users: 4,
            products: 12,
            totalStockUnits: 420,
            totalStockValue: 1850.5,
            receiptsCount: 5,
            receiptsUnits: 500,
            issuesCount: 3,
            issuesUnits: 80,
            transfersCount: 2,
            transfersUnits: 40,
            lowStockCount: 1,
            pendingApprovals: { draftPurchaseOrders: 1, pendingRequisitions: 1, draftCountSheets: 0, total: 2 },
          }),
          { status: 200 },
        );
      }
      if (url === '/api/notifications') return new Response(JSON.stringify({ items: [], unreadCount: 0 }), { status: 200 });
      if (url === '/api/reports/inventory') {
        return new Response(
          JSON.stringify({
            lowStockAlerts: [{ productId: 1, sku: 'OIL-RG2L', productName: 'Roil Cooking Oil 2L', categoryName: 'Oils', unit: 'each', currentStock: 24, reorderLevel: 45, shortfall: 21, unitCost: 3.6, estimatedRestockCost: 162 }],
            valuationByCategory: [{ categoryName: 'Oils', productCount: 1, totalQuantity: 24, totalValue: 86.4 }],
            warehouseStockSummary: [{ warehouseId: 1, warehouseName: 'Main Warehouse', branchName: 'Head Office', skuCount: 1, totalQuantity: 24, totalValue: 86.4 }],
            departmentConsumption: [{ departmentId: 1, departmentName: 'Retail Dispatch', branchName: 'Head Office', issueCount: 1, writeOffCount: 0, consumedQuantity: 6, consumedValue: 21.6 }],
            movementSummary: [{ type: 'receipt', documentCount: 2, lineCount: 4, netBaseChange: 200 }],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/organisation') {
        return new Response(
          JSON.stringify({
            id: 1,
            name: 'Great Zimbabwe Groceries Ltd',
            allowNegativeStock: false,
            enforceSeparationOfDuties: true,
            poApprovalThreshold: 500,
            currencyCode: 'USD',
          }),
          { status: 200 },
        );
      }
      if (url === '/api/executive/approvals') {
        return new Response(
          JSON.stringify({
            draftPurchaseOrders: [{ id: 10, reference: 'PO-2026-009', notes: null, status: 'draft', createdAt: '2026-10-27', supplierName: 'National Foods', warehouseName: 'Harare Central', createdById: 1, createdByName: 'Ina', lineCount: 2, totalValue: 740 }],
            pendingRequisitions: [],
            draftCountSheets: [],
            totalPending: 1,
          }),
          { status: 200 },
        );
      }
      if (url === '/api/executive/permissions') {
        return new Response(
          JSON.stringify({
            role: 'inventory_manager',
            permissions: [
              { key: 'can_approve_po', label: 'Approve Purchase Orders', description: 'Allow Inventory Managers to approve Purchase Orders below the executive threshold.', allowed: true, updatedAt: null },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/branches' || url === '/api/warehouses' || url === '/api/departments' || url === '/api/users') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.startsWith('/api/executive/audit-logs')) {
        return new Response(JSON.stringify({ items: [{ id: 1, actorId: 2, actorEmail: 'e@x.com', actorRole: 'executive_manager', action: 'org.policy_update', targetType: 'organisation', targetId: '1', details: { enforceSeparationOfDuties: true }, createdAt: '2026-10-27' }], total: 1 }), { status: 200 });
      }
      if (url === '/api/executive/system-health') {
        return new Response(
          JSON.stringify({
            status: 'healthy',
            databaseConnected: true,
            ledgerIntegrity: { ok: true, problems: [] },
            activeSessions: 2,
            lockedUsers: 0,
            lastBackup: null,
            tableCounts: { users: 2, branches: 3, warehouses: 4, departments: 5, products: 12, stockDocuments: 8, stockMovements: 16, purchaseOrders: 3, requisitions: 2, auditLogs: 5, backups: 1 },
            uptimeSeconds: 120,
            checkedAt: '2026-10-27',
          }),
          { status: 200 },
        );
      }
      if (url === '/api/executive/backups') {
        return new Response(
          JSON.stringify({
            items: [{ id: 1, label: 'Initial Snapshot', checksumSha256: 'abc1234567890defabc1234567890def', sizeBytes: 4096, status: 'verified', createdBy: 2, createdByName: 'Eli', createdAt: '2026-10-27', restoredAt: null }],
          }),
          { status: 200 },
        );
      }
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
    expect((await screen.findAllByText('Inventory Portal')).length).toBeGreaterThan(0);
    expect(await screen.findByText('3. Warehouses & Depts')).toBeTruthy();
  });

  it('shows the executive portal to executives', async () => {
    mockFetch({ id: 2, name: 'Eli', role: 'executive_manager', email: 'e@x.com', organisationId: 1, branchId: null });
    renderAt('/');
    expect((await screen.findAllByText('Executive Portal')).length).toBeGreaterThan(0);
    expect(await screen.findByText('7. Governance & System')).toBeTruthy();
  });

  it('renders executive governance portal with approval queues, permissions, audit logs, and backups', async () => {
    mockFetch({ id: 2, name: 'Eli', role: 'executive_manager', email: 'e@x.com', organisationId: 1, branchId: null });
    renderAt('/executive/organisation');
    expect(await screen.findByRole('heading', { name: /Executive Governance, Approvals & System Control/i })).toBeTruthy();
    expect(await screen.findByText('PO-2026-009')).toBeTruthy();

    const tablist = screen.getByRole('tablist', { name: /Executive governance sections/i });
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(await screen.findByText('Approve Purchase Orders')).toBeTruthy();
  });

  it('renders inventory manager reports and supports keyboard arrow-key tab navigation', async () => {
    mockFetch({ id: 1, name: 'Ina', role: 'inventory_manager', email: 'i@x.com', organisationId: 1, branchId: null });
    renderAt('/inventory/reports');
    expect(await screen.findByRole('heading', { name: /Low-Stock Alerts & Inventory Reports/i })).toBeTruthy();
    expect(await screen.findByText('Roil Cooking Oil 2L')).toBeTruthy();
    expect(await screen.findByText('Restock via PO')).toBeTruthy();

    // Press ArrowRight on the tablist to switch to the Valuation tab via keyboard
    const tablist = screen.getByRole('tablist', { name: /Inventory report sections/i });
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(await screen.findByText('Stock Valuation by Category')).toBeTruthy();
  });
});
