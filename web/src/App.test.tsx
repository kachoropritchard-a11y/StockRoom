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
      if (url.startsWith('/api/reports/inventory')) {
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
        if (url === '/api/branches') {
          return new Response(JSON.stringify([{ id: 1, name: 'Harare HQ', city: 'Harare' }]), { status: 200 });
        }
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
    expect((await screen.findAllByText('StockRoom')).length).toBeGreaterThan(0);
    expect(await screen.findByText('5. Departments')).toBeTruthy();
  });

  it('shows the executive portal to executives', async () => {
    mockFetch({ id: 2, name: 'Eli', role: 'executive_manager', email: 'e@x.com', organisationId: 1, branchId: null });
    renderAt('/');
    expect((await screen.findAllByText('StockRoom')).length).toBeGreaterThan(0);
    expect(await screen.findByText('5. Settings & Backups')).toBeTruthy();
  });

  it('renders executive governance portal with approval queues, permissions, audit logs, and backups', async () => {
    mockFetch({ id: 2, name: 'Eli', role: 'executive_manager', email: 'e@x.com', organisationId: 1, branchId: null });
    renderAt('/executive/organisation');
    expect(await screen.findByRole('heading', { name: /Executive Governance, Approvals & System Control/i })).toBeTruthy();
    expect(await screen.findByText('PO-2026-009')).toBeTruthy();

    const tablist = screen.getByRole('tablist', { name: /Executive governance sections/i });
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(await screen.findByText('Approve Purchase Orders')).toBeTruthy();

    // Verify /api/executive/approvals was only fetched once on initial mount (no duplicate useCallback reload loop)
    const fetchMock = vi.mocked(globalThis.fetch);
    const approvalCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/executive/approvals');
    expect(approvalCalls.length).toBe(1);
  });

  it('renders inventory manager reports and supports keyboard arrow-key tab navigation', async () => {
    mockFetch({ id: 1, name: 'Ina', role: 'inventory_manager', email: 'i@x.com', organisationId: 1, branchId: null });
    renderAt('/inventory/reports');
    expect(await screen.findByRole('heading', { name: /Low-Stock Alerts & Inventory Reports/i })).toBeTruthy();
    expect(await screen.findByText('Roil Cooking Oil 2L')).toBeTruthy();
    expect(await screen.findByText('Restock via PO')).toBeTruthy();

    // Press ArrowRight on the tablist to switch to the Multi-Currency Valuation tab via keyboard
    const tablist = screen.getByRole('tablist', { name: /Inventory report sections/i });
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(await screen.findByText('Stock Valuation by Category')).toBeTruthy();
  });

  it('supports topbar Multi-Currency (USD / ZiG / ZAR) switching and renders 3-Tier Sub-Navigation across new modules', async () => {
    mockFetch({ id: 2, name: 'Eli', role: 'executive_manager', email: 'e@x.com', organisationId: 1, branchId: null });
    renderAt('/executive');
    expect(await screen.findByText('1. Overview & Quick Actions')).toBeTruthy();
    expect(await screen.findByText('Step 1: Stock Intake (GRN)')).toBeTruthy();

    // Switch currency from USD $ to ZiG in the top action bar
    const zigBtn = screen.getByRole('button', { name: 'ZiG' });
    fireEvent.click(zigBtn);
    expect((await screen.findAllByText(/ZiG/i)).length).toBeGreaterThan(0);
  });

  it('renders real configured store departments and POS counter on the Store & Yard map rather than mock grids', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 1, name: 'Ina', role: 'inventory_manager', email: 'i@x.com' } }), { status: 200 });
        if (url === '/api/dashboard/summary') {
          return new Response(
            JSON.stringify({
              role: 'inventory_manager',
              branches: 1,
              warehouses: 1,
              departments: 3,
              products: 2,
              totalStockUnits: 50,
              totalStockValue: 200,
              warehouseSummary: [{ warehouseId: 1, warehouseName: 'Main Store & Yard', branchName: 'Harare HQ', totalUnits: 50, stockValue: 200 }],
              lowStockCount: 0,
            }),
            { status: 200 },
          );
        }
        if (url === '/api/notifications') return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url === '/api/departments') {
          return new Response(
            JSON.stringify([
              { id: 1, name: 'Hardware & Building Supplies', branchId: 1, branchName: 'Harare HQ', active: 1 },
              { id: 2, name: 'Groceries & FMCG', branchId: 1, branchName: 'Harare HQ', active: 1 },
              { id: 3, name: 'SALES DPT', branchId: 1, branchName: 'Harare HQ', active: 1 },
            ]),
            { status: 200 },
          );
        }
        if (url === '/api/warehouses') {
          return new Response(
            JSON.stringify([
              { id: 1, name: 'Main Store & Yard', branchId: 1, branchName: 'Harare HQ', active: 1 },
            ]),
            { status: 200 },
          );
        }
        if (url === '/api/organisation') {
          return new Response(
            JSON.stringify({
              id: 1,
              name: 'Humba Groceries',
              currencyCode: 'USD',
              posDepartmentId: 3,
              posDepartmentName: 'SALES DPT',
            }),
            { status: 200 },
          );
        }
        if (url.startsWith('/api/products')) {
          return new Response(
            JSON.stringify({
              items: [
                { id: 10, sku: 'GRO-001', name: 'Roller Meal 10kg', departmentId: 2, departmentName: 'Groceries & FMCG', baseUnit: 'bag', totalStock: 30, unitCost: 4.5, sellingPrice: 6.0, reorderLevel: 10 },
                { id: 11, sku: 'HDW-001', name: 'PC15 Cement 50kg', departmentId: 1, departmentName: 'Hardware & Building Supplies', baseUnit: 'bag', totalStock: 20, unitCost: 10.0, sellingPrice: 12.5, reorderLevel: 5 },
              ],
              total: 2,
            }),
            { status: 200 },
          );
        }
        if (url === '/api/stock/balances') return new Response(JSON.stringify({ items: [] }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );

    renderAt('/inventory');
    // Switch to Sub-Tab 2: Visual Charts & Trends
    const chartsTab = await screen.findByRole('tab', { name: /Visual Charts & Trends/i });
    fireEvent.click(chartsTab);

    // Verify the architectural map heading is rendered
    expect(await screen.findByText('STORE & YARD ARCHITECTURAL MAP')).toBeTruthy();

    // Verify real departments are rendered with their exact names
    expect(await screen.findByText('SALES DPT')).toBeTruthy();
    expect(await screen.findByText('Hardware & Building Supplies')).toBeTruthy();
    expect(await screen.findByText('Groceries & FMCG')).toBeTruthy();
    expect((await screen.findAllByText('Main Store & Yard')).length).toBeGreaterThanOrEqual(1);

    // Verify Frontstore POS badge is attached to SALES DPT
    expect(await screen.findByText(/POS Active/i)).toBeTruthy();

    // Verify real product quantities on shelf appear
    expect(await screen.findByText('Roller Meal 10kg')).toBeTruthy();
    expect(await screen.findByText('PC15 Cement 50kg')).toBeTruthy();

    // Verify that the old mock A1..D4 grid is NOT rendered
    expect(screen.queryByText('A1')).toBeNull();
    expect(screen.queryByText('D4')).toBeNull();
  });
});
