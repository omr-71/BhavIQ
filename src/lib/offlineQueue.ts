export interface PendingTransaction {
  id: string;
  shopId: string;
  endpoint: string;
  method: 'POST';
  payload: Record<string, unknown>;
  label: string;
  createdAt: string;
  lastError?: string;
}

const STORAGE_KEY = 'bhaviq_pending_transactions_v1';

export function getPendingTransactions(shopId?: string): PendingTransaction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as PendingTransaction[]) : [];
    return shopId ? list.filter((tx) => tx.shopId === shopId) : list;
  } catch {
    return [];
  }
}

export function enqueuePendingTransaction(tx: PendingTransaction): PendingTransaction[] {
  const current = getPendingTransactions();
  if (current.some((item) => item.id === tx.id)) {
    return current;
  }
  const next = [...current, tx];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removePendingTransaction(txId: string): PendingTransaction[] {
  const next = getPendingTransactions().filter((tx) => tx.id !== txId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function updatePendingTransactionError(txId: string, error: string): void {
  const next = getPendingTransactions().map((tx) =>
    tx.id === txId ? { ...tx, lastError: error } : tx
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
