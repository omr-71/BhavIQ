import React, { useMemo, useState } from 'react';
import {
  EmptyStateCard,
  FieldLabel,
  ResponsiveDialog,
  SelectInput,
  SurfaceCard,
  TextInput,
} from '../components/ui';
import { apiRequest } from '../lib/api';
import { formatINR } from '../lib/finance';
import type { CreditEntry, Customer, Shop } from '../lib/types';
import { BookOpen, Copy, Download, Plus, Search, Wallet } from 'lucide-react';

interface KhataPageProps {
  shop: Shop;
  customers: Customer[];
  isMobile: boolean;
  onRefreshAll: () => Promise<void>;
}

export const KhataPage: React.FC<KhataPageProps> = ({
  shop,
  customers,
  isMobile,
  onRefreshAll,
}) => {
  const [search, setSearch] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'due'>('all');

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [creditLimit, setCreditLimit] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<CreditEntry[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [repayAmount, setRepayAmount] = useState('');
  const [repayMode, setRepayMode] = useState('cash');
  const [repayNote, setRepayNote] = useState('');
  const [repayError, setRepayError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (balanceFilter === 'due' && c.currentBalance <= 0) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q))
      );
    });
  }, [customers, search, balanceFilter]);

  const totalReceivable = useMemo(
    () => customers.reduce((s, c) => s + c.currentBalance, 0),
    [customers]
  );

  const openCustomerLedger = async (cust: Customer) => {
    setActiveCustomer(cust);
    setLoadingLedger(true);
    setRepayError(null);
    setRepayAmount('');
    try {
      const res = await apiRequest<{ entries: CreditEntry[] }>(
        `/api/shops/${shop.id}/customers/${cust.id}/ledger`
      );
      setLedger(res.entries);
    } catch {
      setLedger([]);
    } finally {
      setLoadingLedger(false);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiRequest(`/api/shops/${shop.id}/customers`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          phone: phone || null,
          address: address || null,
          openingBalance: Number(openingBalance) || 0,
          creditLimit: creditLimit ? Number(creditLimit) : null,
        }),
      });
      setAddOpen(false);
      setName('');
      setPhone('');
      setAddress('');
      setOpeningBalance('0');
      setCreditLimit('');
      await onRefreshAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save customer');
    } finally {
      setSaving(false);
    }
  };

  const handleRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCustomer) return;
    setRepayError(null);
    try {
      const res = await apiRequest<{ currentBalance: number }>(
        `/api/shops/${shop.id}/customers/${activeCustomer.id}/repay`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: Number(repayAmount),
            paymentMode: repayMode,
            note: repayNote || undefined,
          }),
        }
      );
      setRepayAmount('');
      setRepayNote('');
      setActiveCustomer({ ...activeCustomer, currentBalance: res.currentBalance });
      await openCustomerLedger({ ...activeCustomer, currentBalance: res.currentBalance });
      await onRefreshAll();
    } catch (err) {
      setRepayError(err instanceof Error ? err.message : 'Repayment failed');
    }
  };

  const exportLedgerCsv = () => {
    if (!activeCustomer || ledger.length === 0) return;
    const rows = [
      ['Date', 'Entry Type', 'Amount (INR)', 'Balance After (INR)', 'Mode', 'Note'],
      ...ledger.map((e) => [
        e.createdAt,
        e.entryType,
        e.amount.toFixed(2),
        e.balanceAfter.toFixed(2),
        e.paymentMode || '',
        (e.note || '').replace(/,/g, ' '),
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `khata-${activeCustomer.name.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyReminder = async (cust: Customer) => {
    const msg = `Namaste ${cust.name}, this is a gentle reminder from ${shop.name}. Your current Khata balance is ${formatINR(cust.currentBalance)}. Thank you.`;
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedId(cust.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore clipboard restriction
    }
  };

  return (
    <div className="space-y-5 bhaviq-page-enter">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SurfaceCard className="px-5 py-3.5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)]">Total Khata receivable</p>
            <p className="font-mono-num text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              {formatINR(totalReceivable)}
            </p>
          </div>
        </SurfaceCard>

        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bhaviq-btn-primary px-4 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add customer</span>
        </button>
      </div>

      {customers.length === 0 ? (
        <EmptyStateCard
          icon={<BookOpen className="w-6 h-6" />}
          title="No Khata customers added yet"
          description="Record regular credit customers, track opening balances, issue credit bills, and collect partial or full repayments."
          actionLabel="Add your first customer"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <TextInput
                aria-label="Search Khata customers"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer name or phone..."
                className="pl-10"
              />
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)] self-start">
              <button
                type="button"
                onClick={() => setBalanceFilter('all')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg min-h-[36px] ${
                  balanceFilter === 'all'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                All ({customers.length})
              </button>
              <button
                type="button"
                onClick={() => setBalanceFilter('due')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg min-h-[36px] ${
                  balanceFilter === 'due'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                Outstanding due
              </button>
            </div>
          </div>

          {isMobile ? (
            <div className="space-y-3">
              {filtered.map((c) => (
                <SurfaceCard key={c.id} onClick={() => openCustomerLedger(c)} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{c.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {c.phone || 'No phone'} {c.address ? `· ${c.address}` : ''}
                      </p>
                    </div>
                    <span
                      className={`font-mono-num text-sm font-bold ${
                        c.currentBalance > 0
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {formatINR(c.currentBalance)}
                    </span>
                  </div>
                </SurfaceCard>
              ))}
            </div>
          ) : (
            <SurfaceCard className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-hairline)] bg-slate-50/70 dark:bg-slate-800/40 text-xs text-[var(--text-muted)]">
                      <th className="py-3 px-4 font-semibold">Customer</th>
                      <th className="py-3 px-4 font-semibold">Phone</th>
                      <th className="py-3 px-4 font-semibold text-right">Opening balance</th>
                      <th className="py-3 px-4 font-semibold text-right">Current outstanding</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-hairline)] text-sm">
                    {filtered.map((c) => (
                      <tr key={c.id} className="hover:bg-[var(--bg-subtle)]/50">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-[var(--text-primary)]">{c.name}</p>
                          {c.address && (
                            <p className="text-xs text-[var(--text-muted)]">{c.address}</p>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono-num text-xs text-[var(--text-secondary)]">
                          {c.phone || '—'}
                        </td>
                        <td className="py-3 px-4 font-mono-num text-right text-xs">
                          {formatINR(c.openingBalance)}
                        </td>
                        <td
                          className={`py-3 px-4 font-mono-num text-right font-semibold ${
                            c.currentBalance > 0
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {formatINR(c.currentBalance)}
                        </td>
                        <td className="py-3 px-4 text-right space-x-3">
                          {c.currentBalance > 0 && (
                            <button
                              type="button"
                              onClick={() => copyReminder(c)}
                              className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              {copiedId === c.id ? 'Copied!' : 'Copy reminder'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openCustomerLedger(c)}
                            className="text-xs font-semibold text-[var(--accent-primary)] hover:underline"
                          >
                            Ledger & Repay
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SurfaceCard>
          )}
        </>
      )}

      {/* Add Customer Dialog */}
      <ResponsiveDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Khata customer"
        subtitle="Creates an immutable customer ledger account"
      >
        <form onSubmit={handleCreateCustomer} className="space-y-4">
          {formError && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {formError}
            </div>
          )}
          <div>
            <FieldLabel htmlFor="cust-name" required>
              Customer name
            </FieldLabel>
            <TextInput
              id="cust-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ramesh Patil"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="cust-phone">Mobile number</FieldLabel>
              <TextInput
                id="cust-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 9823012345"
              />
            </div>
            <div>
              <FieldLabel htmlFor="cust-opening">Opening balance due (₹)</FieldLabel>
              <TextInput
                id="cust-opening"
                type="number"
                min="0"
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="cust-address">Address</FieldLabel>
              <TextInput
                id="cust-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="cust-limit">Credit limit (₹, optional)</FieldLabel>
              <TextInput
                id="cust-limit"
                type="number"
                min="0"
                step="1"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="px-4 py-2.5 min-h-[42px] rounded-xl border border-[var(--border-hairline)] text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bhaviq-btn-primary px-5 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold whitespace-nowrap disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save customer'}
            </button>
          </div>
        </form>
      </ResponsiveDialog>

      {/* Customer Ledger & Repayment Dialog */}
      <ResponsiveDialog
        open={Boolean(activeCustomer)}
        onClose={() => setActiveCustomer(null)}
        title={activeCustomer ? `${activeCustomer.name} · Khata Ledger` : 'Ledger'}
        subtitle={
          activeCustomer
            ? `Current outstanding: ${formatINR(activeCustomer.currentBalance)}`
            : undefined
        }
        maxWidthClass="max-w-2xl"
      >
        {activeCustomer && (
          <div className="space-y-5">
            {activeCustomer.currentBalance > 0 && (
              <form
                onSubmit={handleRepayment}
                className="p-4 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)]/60 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                    <Wallet className="w-4 h-4 text-[var(--accent-primary)]" />
                    Record partial or full repayment
                  </span>
                  <button
                    type="button"
                    onClick={() => setRepayAmount(String(activeCustomer.currentBalance))}
                    className="text-xs font-semibold text-[var(--accent-primary)] hover:underline"
                  >
                    Full balance ({formatINR(activeCustomer.currentBalance)})
                  </button>
                </div>

                {repayError && (
                  <p className="text-xs text-red-700 dark:text-red-400">{repayError}</p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <TextInput
                    aria-label="Repayment amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={repayAmount}
                    onChange={(e) => setRepayAmount(e.target.value)}
                    placeholder="Amount (₹)"
                  />
                  <SelectInput
                    aria-label="Repayment mode"
                    value={repayMode}
                    onChange={(e) => setRepayMode(e.target.value)}
                  >
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="bank">Bank Transfer</option>
                  </SelectInput>
                  <button
                    type="submit"
                    className="min-h-[42px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                  >
                    Record repayment
                  </button>
                </div>
                <TextInput
                  aria-label="Repayment note"
                  value={repayNote}
                  onChange={(e) => setRepayNote(e.target.value)}
                  placeholder="Optional reference / note"
                />
              </form>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Transaction history ({ledger.length})
              </span>
              <div className="flex items-center gap-2">
                {activeCustomer.currentBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => copyReminder(activeCustomer)}
                    className="px-3 py-1.5 rounded-lg border border-[var(--border-hairline)] text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedId === activeCustomer.id ? 'Copied' : 'Copy reminder'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={exportLedgerCsv}
                  disabled={ledger.length === 0}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border-hairline)] text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {loadingLedger ? (
              <p className="text-xs text-[var(--text-muted)] py-4 text-center">
                Loading ledger...
              </p>
            ) : ledger.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-6 text-center">
                No credit entries recorded yet for this customer.
              </p>
            ) : (
              <div className="divide-y divide-[var(--border-hairline)] border border-[var(--border-hairline)] rounded-xl">
                {ledger.map((entry) => (
                  <div key={entry.id} className="p-3.5 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-[var(--text-primary)] capitalize">
                        {entry.entryType.replace('_', ' ')}
                        {entry.paymentMode ? ` · ${entry.paymentMode.toUpperCase()}` : ''}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {entry.note || 'Ledger entry'} · {new Date(entry.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right font-mono-num">
                      <p
                        className={`text-xs font-semibold ${
                          entry.entryType === 'repayment'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {entry.entryType === 'repayment' ? '-' : '+'}
                        {formatINR(entry.amount)}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Bal: {formatINR(entry.balanceAfter)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </ResponsiveDialog>
    </div>
  );
};
