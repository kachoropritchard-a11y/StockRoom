export interface User {
  id: number;
  organisationId: number;
  branchId: number | null;
  email: string;
  name: string;
  role: 'executive_manager' | 'inventory_manager';
}

export interface LowStockItem {
  productId: number;
  sku: string;
  productName: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
}

export interface WarehouseSummaryItem {
  warehouseId: number;
  warehouseName: string;
  branchName: string;
  totalUnits: number;
  stockValue: number;
}

export interface MovementItem {
  id: number;
  documentId: number;
  type: string;
  reference: string | null;
  reason?: string | null;
  createdAt: string;
  reversedByDocumentId?: number | null;
  productId?: number;
  sku: string;
  productName: string;
  warehouseId?: number;
  warehouseName: string;
  unit: string;
  quantity: number;
  factor?: number;
  baseChange: number;
  unitCost: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
}

export interface Summary {
  role: User['role'];
  branches: number;
  warehouses: number;
  departments: number;
  users: number | null;
  products?: number;
  totalStockUnits?: number;
  totalStockValue?: number;
  receiptsCount?: number;
  receiptsUnits?: number;
  issuesCount?: number;
  issuesUnits?: number;
  transfersCount?: number;
  transfersUnits?: number;
  lowStockCount?: number;
  expiringSoonCount?: number;
  pendingCountSheets?: number;
  pendingApprovals?: {
    draftPurchaseOrders: number;
    pendingRequisitions: number;
    draftCountSheets: number;
    total: number;
  };
  lowStockItems?: LowStockItem[];
  warehouseSummary?: WarehouseSummaryItem[];
  recentMovements?: MovementItem[];
}

export interface OrganisationSettings {
  id: number;
  name: string;
  allowNegativeStock: boolean;
  enforceSeparationOfDuties: boolean;
  poApprovalThreshold: number;
  currencyCode: string;
}

export interface GranularPermissionItem {
  key: 'can_approve_po' | 'can_fulfill_requisitions' | 'can_write_off_stock' | 'can_export_reports';
  label: string;
  description: string;
  allowed: boolean;
  updatedAt: string | null;
}

export interface ExecutiveApprovals {
  draftPurchaseOrders: {
    id: number;
    reference: string;
    notes: string | null;
    status: string;
    createdAt: string;
    supplierName: string;
    warehouseName: string;
    createdById: number;
    createdByName: string | null;
    lineCount: number;
    totalValue: number;
  }[];
  pendingRequisitions: {
    id: number;
    kind: 'department_issue' | 'warehouse_transfer';
    reference: string | null;
    notes: string | null;
    status: string;
    createdAt: string;
    warehouseName: string;
    departmentName: string | null;
    toWarehouseName: string | null;
    createdById: number;
    createdByName: string | null;
    lineCount: number;
  }[];
  draftCountSheets: {
    id: number;
    reference: string | null;
    notes: string | null;
    status: string;
    createdAt: string;
    warehouseName: string;
    createdById: number;
    createdByName: string | null;
    lineCount: number;
    varianceCount: number;
  }[];
  totalPending: number;
}

export interface AuditLogItem {
  id: number;
  actorId: number | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'low_stock' | 'expiry' | 'approval' | 'security' | 'backup';
  title: string;
  message: string;
  link: string;
}

export interface SystemBackupItem {
  id: number;
  label: string;
  checksumSha256: string;
  sizeBytes: number;
  status: 'verified' | 'restored';
  createdBy: number;
  createdByName: string | null;
  createdAt: string;
  restoredAt: string | null;
}

export interface SystemHealthStatus {
  status: 'healthy' | 'degraded';
  databaseConnected: boolean;
  ledgerIntegrity: { ok: boolean; problems: { check: string; detail: string }[] };
  activeSessions: number;
  lockedUsers: number;
  lastBackup: SystemBackupItem | null;
  tableCounts: {
    users: number;
    branches: number;
    warehouses: number;
    departments: number;
    products: number;
    stockDocuments: number;
    stockMovements: number;
    purchaseOrders: number;
    requisitions: number;
    auditLogs: number;
    backups: number;
  };
  uptimeSeconds: number;
  checkedAt: string;
}

export interface ProductItem {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  categoryId: number | null;
  categoryName?: string | null;
  baseUnitId: number;
  baseUnit: string;
  unitCost: number;
  reorderLevel: number;
  totalStock: number;
  active: number | boolean;
  packagings: { id: number; unitId: number; unit: string; factor: number }[];
}

export interface BalanceItem {
  productId: number;
  sku: string;
  productName: string;
  warehouseId: number;
  warehouseName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  stockValue: number;
  reorderLevel: number;
  lowStock: boolean;
}

export interface CountSheetSummary {
  id: number;
  warehouseId: number;
  warehouseName: string;
  reference: string | null;
  notes: string | null;
  status: 'draft' | 'approved' | 'cancelled';
  postedDocumentId: number | null;
  createdAt: string;
  approvedAt: string | null;
  lineCount: number;
}

export interface CountSheetDetail extends Omit<CountSheetSummary, 'lineCount'> {
  lines: {
    id: number;
    productId: number;
    sku: string;
    productName: string;
    unitId: number;
    unit: string;
    countedQuantity: number;
    countedBaseQuantity: number;
    expectedBaseQuantity: number;
    varianceBaseQuantity: number;
  }[];
}

export interface PurchaseOrderSummary {
  id: number;
  supplierId: number;
  supplierName: string;
  warehouseId: number;
  warehouseName: string;
  reference: string;
  notes: string | null;
  status: 'draft' | 'approved' | 'partial' | 'received' | 'cancelled';
  createdAt: string;
  approvedAt: string | null;
  lineCount: number;
  totalValue: number;
}

export interface PurchaseOrderDetail extends Omit<PurchaseOrderSummary, 'lineCount'> {
  lines: {
    id: number;
    productId: number;
    sku: string;
    productName: string;
    unitId: number;
    unit: string;
    orderedQuantity: number;
    receivedQuantity: number;
    remainingQuantity: number;
    unitCost: number;
    lineTotal: number;
  }[];
  receipts: {
    documentId: number;
    reference: string | null;
    createdAt: string;
  }[];
}

export interface RequisitionSummary {
  id: number;
  kind: 'department_issue' | 'warehouse_transfer';
  warehouseId: number;
  warehouseName: string;
  departmentId: number | null;
  departmentName: string | null;
  toWarehouseId: number | null;
  toWarehouseName: string | null;
  reference: string | null;
  notes: string | null;
  status: 'pending' | 'fulfilled' | 'rejected';
  postedDocumentId: number | null;
  createdAt: string;
  fulfilledAt: string | null;
  lineCount: number;
}

export interface RequisitionDetail extends Omit<RequisitionSummary, 'lineCount'> {
  lines: {
    id: number;
    productId: number;
    sku: string;
    productName: string;
    unitId: number;
    unit: string;
    baseUnit: string;
    requestedQuantity: number;
    requestedBaseQuantity: number;
    availableBaseQuantity: number;
  }[];
}

export interface InventoryReports {
  lowStockAlerts: {
    productId: number;
    sku: string;
    productName: string;
    categoryName: string;
    unit: string;
    currentStock: number;
    reorderLevel: number;
    shortfall: number;
    unitCost: number;
    estimatedRestockCost: number;
  }[];
  valuationByCategory: {
    categoryName: string;
    productCount: number;
    totalQuantity: number;
    totalValue: number;
  }[];
  warehouseStockSummary: {
    warehouseId: number;
    warehouseName: string;
    branchName: string;
    skuCount: number;
    totalQuantity: number;
    totalValue: number;
  }[];
  departmentConsumption: {
    departmentId: number;
    departmentName: string;
    branchName: string;
    issueCount: number;
    writeOffCount: number;
    consumedQuantity: number;
    consumedValue: number;
  }[];
  movementSummary: {
    type: string;
    documentCount: number;
    lineCount: number;
    netBaseChange: number;
  }[];
}

export interface DocumentAttachmentItem {
  id: number;
  targetType: 'stock_document' | 'purchase_order' | 'requisition' | 'count_sheet';
  targetId: number;
  filename: string;
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'text/csv';
  sizeBytes: number;
  checksumSha256: string;
  uploadedBy?: number;
  uploadedByName?: string | null;
  createdAt?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  account_locked: 'Too many failed attempts. This account is locked for 15 minutes. Contact an administrator if you need help.',
  rate_limit_exceeded: 'Too many requests. Please wait a minute and try again.',
  csrf_validation_failed: 'Security validation failed. Refresh the page and try again.',
  validation_error: 'Please check your input fields and try again.',
  forbidden: 'You do not have permission to perform this action.',
  forbidden_permission: 'Your role does not have permission for this action. Contact an Executive Manager.',
  forbidden_branch_scope: 'This warehouse or record belongs to another branch outside your assigned scope.',
  separation_of_duties_violation: 'Separation of duties policy: you cannot approve or fulfill a document you created yourself.',
  po_exceeds_approval_threshold: 'This Purchase Order exceeds the Executive approval threshold and requires Executive Manager approval.',
  insufficient_stock: 'Insufficient stock on hand in the selected warehouse to complete this movement.',
  already_reversed: 'This stock document has already been reversed.',
  cannot_reverse_reversal: 'A reversal document cannot be reversed again.',
  cannot_demote_or_deactivate_self: 'You cannot deactivate or demote your own Executive Manager account.',
  email_exists: 'A user with this email address already exists.',
  duplicate_or_invalid: 'A record with this code, SKU, or name already exists.',
  invalid_or_expired_token: 'This password reset token is invalid or has expired.',
  invalid_file_signature: 'Uploaded file failed PNG/JPEG/WEBP magic-byte verification.',
  file_too_large: 'Uploaded image exceeds the maximum allowed size.',
  confirmation_phrase_mismatch: 'The confirmation phrase did not match RESTORE BACKUP.',
  internal_error: 'An unexpected server error occurred. Please try again.',
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, customMessage?: string) {
    super(customMessage ?? ERROR_MESSAGES[code] ?? code);
    this.status = status;
    this.code = code;
  }
}

export function newIdempotencyKey(): string {
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { 'X-Requested-With': 'stockroom', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (body as { error?: string }).error ?? 'request_failed';
    const detail = (body as { message?: string }).message;
    throw new ApiError(res.status, code, detail && !ERROR_MESSAGES[code] ? detail : undefined);
  }
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/api/auth/me'),
  forgotPassword: (email: string) =>
    request<{ ok: true; resetToken?: string }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),
  summary: () => request<Summary>('/api/dashboard/summary'),

  organisation: () => request<OrganisationSettings>('/api/organisation'),
  updateOrganisation: (body: {
    name?: string;
    allowNegativeStock?: boolean;
    enforceSeparationOfDuties?: boolean;
    poApprovalThreshold?: number;
    currencyCode?: string;
  }) => request<{ ok: true }>('/api/organisation', { method: 'PATCH', body: JSON.stringify(body) }),
  verifyLedger: () => request<{ ok: boolean; problems: { check: string; detail: string }[] }>('/api/stock/verify'),

  branches: () => request<{ id: number; name: string; city: string | null; active: number }[]>('/api/branches'),
  createBranch: (body: { name: string; city?: string }) =>
    request<{ id: number }>('/api/branches', { method: 'POST', body: JSON.stringify(body) }),
  updateBranch: (id: number, body: { name?: string; city?: string | null; active?: boolean }) =>
    request<{ ok: true }>(`/api/branches/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  warehouses: () => request<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>('/api/warehouses'),
  createWarehouse: (body: { branchId: number; name: string }) =>
    request<{ id: number }>('/api/warehouses', { method: 'POST', body: JSON.stringify(body) }),
  updateWarehouse: (id: number, body: { name?: string; active?: boolean }) =>
    request<{ ok: true }>(`/api/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  departments: () => request<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>('/api/departments'),
  createDepartment: (body: { branchId: number; name: string }) =>
    request<{ id: number }>('/api/departments', { method: 'POST', body: JSON.stringify(body) }),
  updateDepartment: (id: number, body: { name?: string; active?: boolean }) =>
    request<{ ok: true }>(`/api/departments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  users: () =>
    request<{ id: number; email: string; name: string; role: User['role']; branchId: number | null; branchName: string | null; active: boolean; lockedUntil: string | null }[]>('/api/users'),
  createUser: (body: { email: string; name: string; password: string; role: User['role']; branchId?: number | null }) =>
    request<{ id: number }>('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: number, body: { active?: boolean; role?: User['role']; branchId?: number | null; unlock?: boolean }) =>
    request<{ ok: true }>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  categories: () => request<{ id: number; name: string; parentId: number | null; active: number }[]>('/api/categories'),
  createCategory: (body: { name: string }) =>
    request<{ id: number }>('/api/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (id: number, body: { name?: string; active?: boolean }) =>
    request<{ ok: true }>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  units: () => request<{ id: number; code: string; name: string }[]>('/api/units'),
  createUnit: (body: { code: string; name: string }) =>
    request<{ id: number }>('/api/units', { method: 'POST', body: JSON.stringify(body) }),

  suppliers: () => request<{ id: number; name: string; email: string | null; phone: string | null; active: number }[]>('/api/suppliers'),
  createSupplier: (body: { name: string; email?: string; phone?: string }) =>
    request<{ id: number }>('/api/suppliers', { method: 'POST', body: JSON.stringify(body) }),
  updateSupplier: (id: number, body: { name?: string; email?: string | null; phone?: string | null; active?: boolean }) =>
    request<{ ok: true }>(`/api/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  products: (q = '', opts?: { categoryId?: number; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (opts?.categoryId) params.set('categoryId', String(opts.categoryId));
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<{ items: ProductItem[]; total: number }>(`/api/products${qs ? `?${qs}` : ''}`);
  },
  createProduct: (body: { sku: string; name: string; description?: string; categoryId?: number | null; baseUnitId: number; unitCost: number; reorderLevel: number }) =>
    request<{ id: number }>('/api/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: number, body: { name?: string; description?: string | null; categoryId?: number | null; unitCost?: number; reorderLevel?: number; active?: boolean }) =>
    request<{ ok: true }>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  addPackaging: (productId: number, body: { unitId: number; factor: number }) =>
    request<{ id: number }>(`/api/products/${productId}/packagings`, { method: 'POST', body: JSON.stringify(body) }),

  balances: (warehouseId?: number) =>
    request<{ items: BalanceItem[] }>(`/api/stock/balances${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  movements: (type?: string, opts?: { warehouseId?: number; productId?: number; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (opts?.warehouseId) params.set('warehouseId', String(opts.warehouseId));
    if (opts?.productId) params.set('productId', String(opts.productId));
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<{ items: MovementItem[] }>(`/api/stock/movements${qs ? `?${qs}` : ''}`);
  },

  postStock: (path: 'receipts' | 'issues' | 'transfers' | 'adjustments' | 'counts' | 'write-offs', body: unknown, key = newIdempotencyKey()) =>
    request<{ replayed: boolean; document: { id: number } }>(`/api/stock/${path}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    }),
  postReturn: (
    body: {
      returnType: 'from_department' | 'to_supplier';
      warehouseId: number;
      departmentId?: number | null;
      supplierId?: number | null;
      reference?: string;
      reason: string;
      lines: { productId: number; unitId: number; quantity: number; batchNumber?: string; expiryDate?: string }[];
    },
    key = newIdempotencyKey(),
  ) =>
    request<{ replayed: boolean; document: { id: number } }>('/api/stock/returns', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    }),
  reverseDocument: (docId: number, reason: string, key = newIdempotencyKey()) =>
    request<{ replayed: boolean; document: { id: number } }>(`/api/stock/documents/${docId}/reverse`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ reason }),
    }),

  countSheets: () => request<{ items: CountSheetSummary[] }>('/api/stock/count-sheets'),
  countSheet: (id: number) => request<CountSheetDetail>(`/api/stock/count-sheets/${id}`),
  createCountSheet: (body: { warehouseId: number; reference?: string; notes?: string; lines: { productId: number; unitId: number; countedQuantity: number }[] }) =>
    request<CountSheetDetail>('/api/stock/count-sheets', { method: 'POST', body: JSON.stringify(body) }),
  approveCountSheet: (id: number, reason?: string, key = newIdempotencyKey()) =>
    request<{ replayed: boolean; sheet: CountSheetDetail }>(`/api/stock/count-sheets/${id}/approve`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ reason }),
    }),
  cancelCountSheet: (id: number, reason?: string) =>
    request<CountSheetDetail>(`/api/stock/count-sheets/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),

  purchaseOrders: (status?: string) =>
    request<{ items: PurchaseOrderSummary[] }>(`/api/purchase-orders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  purchaseOrder: (id: number) => request<PurchaseOrderDetail>(`/api/purchase-orders/${id}`),
  createPurchaseOrder: (body: {
    supplierId: number;
    warehouseId: number;
    reference: string;
    notes?: string;
    approveImmediately?: boolean;
    lines: { productId: number; unitId: number; orderedQuantity: number; unitCost: number }[];
  }) => request<PurchaseOrderDetail>('/api/purchase-orders', { method: 'POST', body: JSON.stringify(body) }),
  approvePurchaseOrder: (id: number, reason?: string) =>
    request<PurchaseOrderDetail>(`/api/purchase-orders/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason }) }),
  cancelPurchaseOrder: (id: number, reason?: string) =>
    request<PurchaseOrderDetail>(`/api/purchase-orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  receivePurchaseOrder: (
    id: number,
    body: {
      reference?: string;
      lines: { productId: number; quantity: number; unitCost?: number; batchNumber?: string; expiryDate?: string }[];
    },
    key = newIdempotencyKey(),
  ) =>
    request<{ replayed: boolean; purchaseOrder: PurchaseOrderDetail; document: { id: number } }>(`/api/purchase-orders/${id}/receive`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    }),

  requisitions: (status?: string) =>
    request<{ items: RequisitionSummary[] }>(`/api/requisitions${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  requisition: (id: number) => request<RequisitionDetail>(`/api/requisitions/${id}`),
  createRequisition: (body: {
    kind: 'department_issue' | 'warehouse_transfer';
    warehouseId: number;
    departmentId?: number | null;
    toWarehouseId?: number | null;
    reference?: string;
    notes?: string;
    lines: { productId: number; unitId: number; requestedQuantity: number }[];
  }) => request<RequisitionDetail>('/api/requisitions', { method: 'POST', body: JSON.stringify(body) }),
  fulfillRequisition: (id: number, reason?: string, key = newIdempotencyKey()) =>
    request<{ replayed: boolean; requisition: RequisitionDetail; document: { id: number } }>(`/api/requisitions/${id}/fulfill`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ reason }),
    }),
  rejectRequisition: (id: number, reason?: string) =>
    request<RequisitionDetail>(`/api/requisitions/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  attachments: (targetType: DocumentAttachmentItem['targetType'], targetId: number) =>
    request<{ items: DocumentAttachmentItem[] }>(
      `/api/attachments?targetType=${encodeURIComponent(targetType)}&targetId=${targetId}`,
    ),
  uploadAttachment: (body: {
    targetType: DocumentAttachmentItem['targetType'];
    targetId: number;
    filename: string;
    mimeType: DocumentAttachmentItem['mimeType'];
    contentBase64: string;
  }) => request<DocumentAttachmentItem>('/api/attachments', { method: 'POST', body: JSON.stringify(body) }),

  inventoryReports: () => request<InventoryReports>('/api/reports/inventory'),

  permissions: () => request<{ role: string; permissions: GranularPermissionItem[] }>('/api/executive/permissions'),
  updatePermissions: (permissions: Partial<Record<GranularPermissionItem['key'], boolean>>) =>
    request<{ ok: true }>('/api/executive/permissions', { method: 'PATCH', body: JSON.stringify({ permissions }) }),
  approvals: () => request<ExecutiveApprovals>('/api/executive/approvals'),
  auditLogs: (opts?: { action?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.action) params.set('action', opts.action);
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<{ items: AuditLogItem[]; total: number }>(`/api/executive/audit-logs${qs ? `?${qs}` : ''}`);
  },
  notifications: () => request<{ items: NotificationItem[]; unreadCount: number }>('/api/notifications'),
  systemHealth: () => request<SystemHealthStatus>('/api/executive/system-health'),
  backups: () => request<{ items: SystemBackupItem[] }>('/api/executive/backups'),
  createBackup: (label: string) =>
    request<SystemBackupItem>('/api/executive/backups', { method: 'POST', body: JSON.stringify({ label }) }),
  verifyBackup: (id: number) =>
    request<{
      backupId: number;
      label: string;
      checksumMatch: boolean;
      expectedChecksum: string;
      computedChecksum: string;
      ledgerOk: boolean;
      readyForRestore: boolean;
    }>(`/api/executive/backups/${id}/verify`, { method: 'POST', body: JSON.stringify({}) }),
  restoreBackup: (id: number, confirmationPhrase: string) =>
    request<{ ok: boolean; backupId: number; label: string; checksumSha256: string; restoredAt: string }>(
      `/api/executive/backups/${id}/restore`,
      { method: 'POST', body: JSON.stringify({ confirmationPhrase }) },
    ),
  exportReportJson: (section: 'valuation' | 'low_stock' | 'movements' | 'audit_logs') =>
    request<{ section: string; format: string; generatedAt: string; items: Record<string, unknown>[] }>(
      `/api/reports/export?section=${encodeURIComponent(section)}&format=json`,
    ),
};
