-- ====================================================================
-- BHAVIQ — Supabase Shop Profiles Vault Migration
-- Persistently stores shop and owner onboarding details linked to auth.uid()
-- ====================================================================

-- 1. Create shop_profiles table
CREATE TABLE IF NOT EXISTS public.shop_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_name TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  business_type TEXT NOT NULL DEFAULT 'Kirana & General Store',
  gstin TEXT,
  address TEXT,
  city TEXT NOT NULL DEFAULT 'Mumbai',
  state TEXT NOT NULL DEFAULT 'Maharashtra',
  pincode TEXT,
  phone TEXT,
  tax_mode TEXT NOT NULL DEFAULT 'gst_inclusive',
  currency TEXT NOT NULL DEFAULT 'INR',
  default_margin_pct NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  low_stock_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes for instant lookup
CREATE INDEX IF NOT EXISTS idx_shop_profiles_user_id ON public.shop_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_profiles_phone ON public.shop_profiles(phone);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.shop_profiles ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
DROP POLICY IF EXISTS "Users can read own shop profile" ON public.shop_profiles;
CREATE POLICY "Users can read own shop profile"
  ON public.shop_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own shop profile" ON public.shop_profiles;
CREATE POLICY "Users can insert own shop profile"
  ON public.shop_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own shop profile" ON public.shop_profiles;
CREATE POLICY "Users can update own shop profile"
  ON public.shop_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR auth.uid() = user_id)
  WITH CHECK (auth.uid() = id OR auth.uid() = user_id);

-- 5. Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_shop_profiles_updated_at ON public.shop_profiles;
CREATE TRIGGER trigger_shop_profiles_updated_at
  BEFORE UPDATE ON public.shop_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
