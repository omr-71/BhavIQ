-- BHAVIQ — Production PostgreSQL / Supabase Migration Schema
-- Enforces shop-level multi-tenant Row Level Security (RLS), atomic financial records, and full audit trail.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  theme TEXT NOT NULL DEFAULT 'light',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  gstin TEXT,
  address TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT,
  phone TEXT,
  tax_mode TEXT NOT NULL DEFAULT 'gst_inclusive',
  currency TEXT NOT NULL DEFAULT 'INR',
  default_margin_pct NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  low_stock_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  permissions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, user_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  location TEXT,
  categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  gstin TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,
  barcode TEXT,
  sku TEXT,
  base_unit TEXT NOT NULL,
  purchase_price NUMERIC(12,2),
  landed_cost NUMERIC(12,2),
  selling_price NUMERIC(12,2) NOT NULL,
  mrp NUMERIC(12,2),
  tax_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  mrp_restricted BOOLEAN NOT NULL DEFAULT TRUE,
  current_stock NUMERIC(14,4) NOT NULL DEFAULT 0,
  min_stock_level NUMERIC(14,4) NOT NULL DEFAULT 0,
  primary_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  expiry_date DATE,
  batch_number TEXT,
  image_url TEXT,
  pack_size TEXT,
  variety TEXT,
  market_commodity_name TEXT,
  market_coverage_status TEXT NOT NULL DEFAULT 'unsupported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  conversion_to_base NUMERIC(14,4) NOT NULL CHECK (conversion_to_base > 0),
  is_default_sell_unit BOOLEAN NOT NULL DEFAULT FALSE,
  is_default_buy_unit BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (product_id, unit_name)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'return', 'damaged', 'expiry', 'adjustment')),
  quantity_delta NUMERIC(14,4) NOT NULL,
  unit_name TEXT NOT NULL,
  unit_quantity NUMERIC(14,4) NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  note TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_limit NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  client_tx_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name_snapshot TEXT,
  subtotal NUMERIC(12,2) NOT NULL,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_authorized_by UUID,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('cash', 'upi', 'credit', 'split')),
  status TEXT NOT NULL DEFAULT 'completed',
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, client_tx_id),
  UNIQUE (shop_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  brand_snapshot TEXT,
  quantity NUMERIC(14,4) NOT NULL,
  unit_name TEXT NOT NULL,
  base_quantity_deducted NUMERIC(14,4) NOT NULL,
  unit_selling_price NUMERIC(12,2) NOT NULL,
  cost_price_snapshot NUMERIC(12,2),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('opening', 'credit_sale', 'repayment')),
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  payment_mode TEXT,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  note TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  payment_mode TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  reference_no TEXT,
  received_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  client_tx_id TEXT NOT NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  supplier_invoice_no TEXT,
  purchase_date DATE NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  freight_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  transport_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  additional_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('paid', 'partial', 'unpaid')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, client_tx_id)
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  brand TEXT,
  pack_size TEXT,
  quantity NUMERIC(14,4) NOT NULL,
  unit_name TEXT NOT NULL,
  base_quantity_added NUMERIC(14,4) NOT NULL,
  purchase_rate NUMERIC(12,2) NOT NULL,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  allocated_extra_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  landed_cost_per_base_unit NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  payment_mode TEXT NOT NULL,
  expense_date DATE NOT NULL,
  receipt_ref TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  endpoint_url TEXT,
  is_configured BOOLEAN NOT NULL DEFAULT FALSE,
  update_frequency TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  last_attempted_at TIMESTAMPTZ,
  last_data_date DATE,
  last_records_fetched INTEGER NOT NULL DEFAULT 0,
  last_records_matched INTEGER NOT NULL DEFAULT 0,
  last_sync_status TEXT NOT NULL DEFAULT 'not_configured',
  last_error TEXT,
  coverage_notes TEXT NOT NULL,
  UNIQUE (shop_id, source_key)
);

CREATE TABLE IF NOT EXISTS market_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'not_configured')),
  attempted_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  data_date DATE,
  records_fetched INTEGER NOT NULL DEFAULT 0,
  records_inserted INTEGER NOT NULL DEFAULT 0,
  records_matched INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  error_code TEXT,
  error_details TEXT
);

CREATE TABLE IF NOT EXISTS market_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES price_sources(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  commodity_or_product_name TEXT NOT NULL,
  brand TEXT,
  pack_size TEXT,
  unit TEXT NOT NULL,
  market_name TEXT NOT NULL,
  state TEXT,
  district TEXT,
  location TEXT NOT NULL,
  min_price NUMERIC(12,2),
  max_price NUMERIC(12,2),
  modal_price NUMERIC(12,2) NOT NULL,
  previous_price NUMERIC(12,2),
  price_unit_basis TEXT NOT NULL,
  normalized_per_base_unit NUMERIC(12,2),
  observation_date DATE NOT NULL,
  freshness_status TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  confidence_level TEXT NOT NULL,
  raw_payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  brand TEXT,
  pack_size TEXT,
  quantity NUMERIC(14,4) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL,
  quoted_rate NUMERIC(12,2) NOT NULL,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  freight_estimate_per_unit NUMERIC(12,2) NOT NULL DEFAULT 0,
  additional_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
  final_landed_cost NUMERIC(12,2),
  landed_estimate NUMERIC(12,2) NOT NULL,
  valid_until DATE,
  quotation_date DATE NOT NULL,
  source_evidence TEXT,
  verification_status TEXT NOT NULL,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  historical_landed_cost NUMERIC(12,2),
  replacement_landed_cost NUMERIC(12,2),
  current_selling_price NUMERIC(12,2) NOT NULL,
  mrp NUMERIC(12,2),
  target_margin_pct NUMERIC(5,2) NOT NULL,
  recommended_price NUMERIC(12,2) NOT NULL,
  strategy TEXT NOT NULL,
  alert_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'dismissed')),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security on all shop-scoped tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_shop_member(target_shop_id UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM shop_members
    WHERE shop_id = target_shop_id AND user_id = auth.uid() AND status = 'active'
  );
$$;

CREATE POLICY profiles_self ON profiles FOR ALL USING (id = auth.uid());
CREATE POLICY shops_member_read ON shops FOR SELECT USING (is_shop_member(id));
CREATE POLICY shops_owner_write ON shops FOR ALL USING (owner_id = auth.uid());
CREATE POLICY shop_members_policy ON shop_members FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY suppliers_isolation ON suppliers FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY products_isolation ON products FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY product_units_isolation ON product_units FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY stock_movements_isolation ON stock_movements FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY customers_isolation ON customers FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY invoices_isolation ON invoices FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY invoice_items_isolation ON invoice_items FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY credit_entries_isolation ON credit_entries FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY payments_isolation ON payments FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY purchases_isolation ON purchases FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY purchase_items_isolation ON purchase_items FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY expenses_isolation ON expenses FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY price_sources_isolation ON price_sources FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY market_sync_runs_isolation ON market_sync_runs FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY market_prices_isolation ON market_prices FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY supplier_quotations_isolation ON supplier_quotations FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY price_recommendations_isolation ON price_recommendations FOR ALL USING (is_shop_member(shop_id));
CREATE POLICY audit_logs_isolation ON audit_logs FOR SELECT USING (is_shop_member(shop_id));
