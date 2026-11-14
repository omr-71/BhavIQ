import React, { useState } from 'react';
import { BhaviqLogo } from '../components/BhaviqLogo';
import { FieldLabel, SelectInput, SurfaceCard, TextInput } from '../components/ui';
import { apiRequest } from '../lib/api';
import { upsertShopProfile } from '../lib/supabaseClient';
import type { Shop } from '../lib/types';
import { CheckCircle2, Store } from 'lucide-react';

interface OnboardingPageProps {
  ownerName: string;
  onShopCreated: (shop: Shop, allShops: Shop[]) => void;
  onLogout: () => void;
}

const BUSINESS_TYPES = [
  'Kirana & General Store',
  'Supermarket / Mini-Mart',
  'Vegetables & Fruits',
  'Grains & Pulses Wholesale/Retail',
  'Beverages & Snacks',
  'Personal Care & Household',
  'Multi-Category Retail',
];

const INDIAN_STATES = [
  'Maharashtra',
  'Gujarat',
  'Karnataka',
  'Delhi',
  'Uttar Pradesh',
  'Madhya Pradesh',
  'Rajasthan',
  'Tamil Nadu',
  'Telangana',
  'West Bengal',
  'Punjab',
  'Haryana',
  'Kerala',
  'Other',
];

export const OnboardingPage: React.FC<OnboardingPageProps> = ({
  ownerName,
  onShopCreated,
  onLogout,
}) => {
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0]);
  const [city, setCity] = useState('');
  const [state, setState] = useState('Maharashtra');
  const [address, setAddress] = useState('');
  const [pincode, setPincode] = useState('');
  const [phone, setPhone] = useState('');
  const [taxMode, setTaxMode] = useState<'gst_inclusive' | 'gst_exclusive' | 'non_gst'>('gst_inclusive');
  const [gstin, setGstin] = useState('');
  const [defaultMarginPct, setDefaultMarginPct] = useState('15');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      let shopResult: Shop | null = null;
      let allShopsResult: Shop[] = [];

      // 1. Try local server endpoint if active
      try {
        const res = await apiRequest<{ shop: Shop; shops: Shop[] }>('/api/shops', {
          method: 'POST',
          body: JSON.stringify({
            name,
            businessType,
            city,
            state,
            address: address || null,
            pincode: pincode || null,
            phone: phone || null,
            taxMode,
            gstin: gstin || null,
            defaultMarginPct: Number(defaultMarginPct) || 15,
          }),
        });
        shopResult = res.shop;
        allShopsResult = res.shops;
      } catch {
        // Fallback for standalone desktop or direct Supabase configuration
      }

      // 2. Persist directly to Supabase shop_profiles vault linked to auth.uid()
      const vaultShop = await upsertShopProfile({
        name,
        businessType,
        city,
        state,
        address: address || '',
        pincode: pincode || null,
        phone: phone || null,
        taxMode,
        gstin: gstin || null,
        defaultMarginPct: Number(defaultMarginPct) || 15,
        ownerName,
      });

      const finalShop = shopResult || vaultShop;
      const finalAll = allShopsResult.length > 0 ? allShopsResult : [finalShop];
      onShopCreated(finalShop, finalAll);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create shop');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] px-4 py-6 md:px-10">
      <header className="max-w-4xl mx-auto flex items-center justify-between mb-8">
        <BhaviqLogo size="md" />
        <button
          type="button"
          onClick={onLogout}
          className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] min-h-[38px] px-3 rounded-lg"
        >
          Sign out
        </button>
      </header>

      <main className="max-w-2xl mx-auto bhaviq-page-enter">
        <div className="mb-6">
          <p className="text-xs font-medium text-[var(--accent-primary)]">
            Welcome, {ownerName}
          </p>
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-1">
            Set up your retail shop
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Your shop starts cleanly with zero sample products or transactions. Configure your tax and margin defaults to begin.
          </p>
        </div>

        <SurfaceCard className="p-6 md:p-8">
          {error && (
            <div
              role="alert"
              className="mb-5 px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <FieldLabel htmlFor="shop-name" required>
                  Shop / Business name
                </FieldLabel>
                <TextInput
                  id="shop-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Mahalaxmi Super Market"
                />
              </div>

              <div>
                <FieldLabel htmlFor="shop-type" required>
                  Business category
                </FieldLabel>
                <SelectInput
                  id="shop-type"
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                >
                  {BUSINESS_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </SelectInput>
              </div>

              <div>
                <FieldLabel htmlFor="shop-phone">Shop contact number</FieldLabel>
                <TextInput
                  id="shop-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9823012345"
                />
              </div>

              <div>
                <FieldLabel htmlFor="shop-city" required>
                  City / Town
                </FieldLabel>
                <TextInput
                  id="shop-city"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Pune"
                />
              </div>

              <div>
                <FieldLabel htmlFor="shop-state" required>
                  State
                </FieldLabel>
                <SelectInput
                  id="shop-state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                >
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </SelectInput>
              </div>

              <div className="md:col-span-2">
                <FieldLabel htmlFor="shop-address">Street address</FieldLabel>
                <TextInput
                  id="shop-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Shop No., Market Road, Landmark"
                />
              </div>

              <div>
                <FieldLabel htmlFor="shop-pincode">PIN code</FieldLabel>
                <TextInput
                  id="shop-pincode"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  placeholder="e.g. 411001"
                />
              </div>

              <div>
                <FieldLabel htmlFor="shop-margin" required>
                  Default target gross margin (%)
                </FieldLabel>
                <TextInput
                  id="shop-margin"
                  type="number"
                  min={1}
                  max={80}
                  step="0.5"
                  required
                  value={defaultMarginPct}
                  onChange={(e) => setDefaultMarginPct(e.target.value)}
                />
              </div>

              <div>
                <FieldLabel htmlFor="shop-taxmode" required>
                  Tax configuration
                </FieldLabel>
                <SelectInput
                  id="shop-taxmode"
                  value={taxMode}
                  onChange={(e) =>
                    setTaxMode(e.target.value as 'gst_inclusive' | 'gst_exclusive' | 'non_gst')
                  }
                >
                  <option value="gst_inclusive">GST Inclusive (retail shelf prices)</option>
                  <option value="gst_exclusive">GST Exclusive (tax added on bill)</option>
                  <option value="non_gst">Non-GST / Composition</option>
                </SelectInput>
              </div>

              <div>
                <FieldLabel htmlFor="shop-gstin">GSTIN (optional)</FieldLabel>
                <TextInput
                  id="shop-gstin"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  placeholder="27ABCDE1234F1Z5"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between gap-4 border-t border-[var(--border-hairline)]">
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <Store className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
                <span>Shop-level data isolation enabled</span>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="bhaviq-btn-primary px-5 py-2.5 min-h-[44px] rounded-xl disabled:opacity-60 text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{saving ? 'Creating shop...' : 'Create shop & open workspace'}</span>
              </button>
            </div>
          </form>
        </SurfaceCard>
      </main>
    </div>
  );
};
