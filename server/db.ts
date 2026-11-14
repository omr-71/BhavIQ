import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.BHAVIQ_DB_PATH || path.resolve(process.cwd(), 'data', 'bhaviq.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      preferred_language TEXT NOT NULL DEFAULT 'en',
      theme TEXT NOT NULL DEFAULT 'light',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      active_shop_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
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
      default_margin_pct REAL NOT NULL DEFAULT 15,
      low_stock_alert_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shop_members (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner', 'staff')),
      permissions_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      UNIQUE(shop_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      location TEXT,
      categories_json TEXT NOT NULL DEFAULT '[]',
      gstin TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT NOT NULL,
      barcode TEXT,
      sku TEXT,
      base_unit TEXT NOT NULL,
      purchase_price REAL,
      landed_cost REAL,
      selling_price REAL NOT NULL,
      mrp REAL,
      tax_rate_pct REAL NOT NULL DEFAULT 0,
      mrp_restricted INTEGER NOT NULL DEFAULT 1,
      current_stock REAL NOT NULL DEFAULT 0,
      min_stock_level REAL NOT NULL DEFAULT 0,
      primary_supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
      expiry_date TEXT,
      batch_number TEXT,
      image_url TEXT,
      pack_size TEXT,
      variety TEXT,
      market_commodity_name TEXT,
      market_coverage_status TEXT NOT NULL DEFAULT 'unsupported',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_units (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      unit_name TEXT NOT NULL,
      conversion_to_base REAL NOT NULL,
      is_default_sell_unit INTEGER NOT NULL DEFAULT 0,
      is_default_buy_unit INTEGER NOT NULL DEFAULT 0,
      UNIQUE(product_id, unit_name)
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('purchase', 'sale', 'return', 'damaged', 'expiry', 'adjustment')),
      quantity_delta REAL NOT NULL,
      unit_name TEXT NOT NULL,
      unit_quantity REAL NOT NULL,
      reference_type TEXT,
      reference_id TEXT,
      note TEXT,
      created_by TEXT NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      opening_balance REAL NOT NULL DEFAULT 0,
      current_balance REAL NOT NULL DEFAULT 0,
      credit_limit REAL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      client_tx_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      customer_name_snapshot TEXT,
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      discount_authorized_by TEXT,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      credit_amount REAL NOT NULL DEFAULT 0,
      payment_mode TEXT NOT NULL CHECK(payment_mode IN ('cash', 'upi', 'credit', 'split')),
      status TEXT NOT NULL DEFAULT 'completed',
      created_by TEXT NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL,
      UNIQUE(shop_id, client_tx_id),
      UNIQUE(shop_id, invoice_number)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      product_name_snapshot TEXT NOT NULL,
      brand_snapshot TEXT,
      quantity REAL NOT NULL,
      unit_name TEXT NOT NULL,
      base_quantity_deducted REAL NOT NULL,
      unit_selling_price REAL NOT NULL,
      cost_price_snapshot REAL,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_rate_pct REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_entries (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('opening', 'credit_sale', 'repayment')),
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      payment_mode TEXT,
      invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
      note TEXT,
      created_by TEXT NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      payment_mode TEXT NOT NULL,
      amount REAL NOT NULL,
      reference_no TEXT,
      received_by TEXT NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      client_tx_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      supplier_invoice_no TEXT,
      purchase_date TEXT NOT NULL,
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      freight_cost REAL NOT NULL DEFAULT 0,
      transport_cost REAL NOT NULL DEFAULT 0,
      additional_costs REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL CHECK(payment_status IN ('paid', 'partial', 'unpaid')),
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL,
      UNIQUE(shop_id, client_tx_id)
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      brand TEXT,
      pack_size TEXT,
      quantity REAL NOT NULL,
      unit_name TEXT NOT NULL,
      base_quantity_added REAL NOT NULL,
      purchase_rate REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      allocated_extra_cost REAL NOT NULL DEFAULT 0,
      landed_cost_per_base_unit REAL NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_mode TEXT NOT NULL,
      expense_date TEXT NOT NULL,
      receipt_ref TEXT,
      created_by TEXT NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_sources (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('official_api', 'supplier_feed', 'manual_observation')),
      endpoint_url TEXT,
      is_configured INTEGER NOT NULL DEFAULT 0,
      update_frequency TEXT NOT NULL,
      last_sync_at TEXT,
      last_attempted_at TEXT,
      last_data_date TEXT,
      last_records_fetched INTEGER NOT NULL DEFAULT 0,
      last_records_matched INTEGER NOT NULL DEFAULT 0,
      last_sync_status TEXT NOT NULL DEFAULT 'not_configured',
      last_error TEXT,
      coverage_notes TEXT NOT NULL,
      UNIQUE(shop_id, source_key)
    );

    CREATE TABLE IF NOT EXISTS market_sync_runs (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      source_name TEXT NOT NULL,
      trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual', 'scheduled')),
      status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'not_configured')),
      attempted_at TEXT NOT NULL,
      completed_at TEXT,
      data_date TEXT,
      records_fetched INTEGER NOT NULL DEFAULT 0,
      records_inserted INTEGER NOT NULL DEFAULT 0,
      records_matched INTEGER NOT NULL DEFAULT 0,
      http_status INTEGER,
      error_code TEXT,
      error_details TEXT
    );

    CREATE TABLE IF NOT EXISTS market_prices (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES price_sources(id) ON DELETE CASCADE,
      product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
      commodity_or_product_name TEXT NOT NULL,
      brand TEXT,
      pack_size TEXT,
      unit TEXT NOT NULL,
      market_name TEXT NOT NULL,
      state TEXT,
      district TEXT,
      location TEXT NOT NULL,
      min_price REAL,
      max_price REAL,
      modal_price REAL NOT NULL,
      previous_price REAL,
      price_unit_basis TEXT NOT NULL,
      normalized_per_base_unit REAL,
      observation_date TEXT NOT NULL,
      freshness_status TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      confidence_level TEXT NOT NULL,
      raw_payload_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_quotations (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      brand TEXT,
      pack_size TEXT,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT NOT NULL,
      quoted_rate REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      freight_estimate_per_unit REAL NOT NULL DEFAULT 0,
      additional_costs REAL NOT NULL DEFAULT 0,
      final_landed_cost REAL,
      landed_estimate REAL NOT NULL,
      valid_until TEXT,
      quotation_date TEXT NOT NULL,
      source_evidence TEXT,
      verification_status TEXT NOT NULL,
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_recommendations (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      historical_landed_cost REAL,
      replacement_landed_cost REAL,
      current_selling_price REAL NOT NULL,
      mrp REAL,
      target_margin_pct REAL NOT NULL,
      recommended_price REAL NOT NULL,
      strategy TEXT NOT NULL,
      alert_reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'dismissed')),
      approved_by TEXT REFERENCES profiles(id),
      approved_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS acknowledged_market_alerts (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      alert_id TEXT NOT NULL,
      acknowledged_by TEXT NOT NULL REFERENCES profiles(id),
      acknowledged_at TEXT NOT NULL,
      UNIQUE(shop_id, alert_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES profiles(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Safe idempotent migrations for existing SQLite databases
  ensureColumn('products', 'pack_size', 'TEXT');
  ensureColumn('products', 'variety', 'TEXT');

  ensureColumn('price_sources', 'last_attempted_at', 'TEXT');
  ensureColumn('price_sources', 'last_data_date', 'TEXT');
  ensureColumn('price_sources', 'last_records_fetched', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('price_sources', 'last_records_matched', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('supplier_quotations', 'quantity', 'REAL NOT NULL DEFAULT 1');
  ensureColumn('supplier_quotations', 'discount_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('supplier_quotations', 'tax_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('supplier_quotations', 'additional_costs', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('supplier_quotations', 'final_landed_cost', 'REAL');
  ensureColumn('supplier_quotations', 'source_evidence', 'TEXT');

  ensureColumn('profiles', 'auth_provider', "TEXT NOT NULL DEFAULT 'password'");
  ensureColumn('profiles', 'supabase_uid', 'TEXT');
}

function ensureColumn(tableName: string, columnName: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
}

export function withTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export function logAudit(params: {
  id: string;
  shopId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
}) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (id, shop_id, user_id, action, entity_type, entity_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    params.id,
    params.shopId,
    params.userId,
    params.action,
    params.entityType,
    params.entityId,
    JSON.stringify(params.details),
    new Date().toISOString()
  );
}
