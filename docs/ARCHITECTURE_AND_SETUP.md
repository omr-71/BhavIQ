# BHAVIQ — Architecture, Market Integrations & Deployment Guide

## 1. Architecture Overview
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, custom SVG charts, and `motion` (`MotionConfig reducedMotion="user"`).
- **Backend**: Express (`server.ts`) running on port 3000 with `node:sqlite` (`server/db.ts`) for local ACID persistence (`BEGIN IMMEDIATE`), plus a production PostgreSQL + Row Level Security migration in `supabase/migrations/001_bhaviq_schema.sql`.
- **Distinct Dual Experience**:
  - **Desktop (`>= 768px`)**: Collapsible left sidebar with 10 modules, 3-zone top header, full tabular data grids, side-by-side POS counter, and multi-column Market Intelligence workbench.
  - **Mobile (`< 768px`)**: Native retail app shell with 52px top bar, 64px 5-tab bottom navigation (`Home`, `Billing`, `Stock`, `Market`, `More`), thumb-friendly quick actions, slide-up bottom sheets, and card-based records.

## 2. Official Market Intelligence Integrations
1. **AGMARKNET / data.gov.in Open Government Data**:
   - Endpoint: `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070`
   - Server-side env var: `DATA_GOV_IN_API_KEY` (never exposed to browser clients).
   - Coverage: Agricultural commodities (vegetables, fruits, grains, pulses, oilseeds, spices) quoted in ₹ per Quintal (100 kg), automatically converted to ₹/kg alongside raw quintal values.
   - Honest limitation: AGMARKNET does not cover packaged FMCG brands. Packaged FMCG products use **Verified Supplier Quotations** and **Owner-Verified Wholesale Observations**.

## 3. Running & Testing Locally
```bash
npm install
npm test          # Runs deterministic node:test domain suite
npm run lint      # Runs tsc --noEmit
npm run build     # Builds production frontend bundle
npm run start     # Starts BHAVIQ server on http://localhost:3000
```

## 4. Supabase PostgreSQL Production Deployment
1. Run `supabase/migrations/001_bhaviq_schema.sql` in your Supabase SQL Editor.
2. Configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only), and `DATA_GOV_IN_API_KEY` in your hosting environment.
3. Deploy server-side scheduled sync or Supabase Edge Function invoking `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070`.
