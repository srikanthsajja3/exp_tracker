-- ==========================================
-- STEP 1: CREATE TABLES AND ENUMS
-- ==========================================

-- Create Enum types for strict control
DO $$ BEGIN
    CREATE TYPE transaction_type AS ENUM ('inflow', 'outflow');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE behavioral_source AS ENUM ('active', 'passive', 'regular');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create Projects table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type transaction_type NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    date TIMESTAMPTZ NOT NULL DEFAULT now(),
    tier1_category TEXT NOT NULL,
    tier2_memo TEXT NOT NULL,
    behavioral_source behavioral_source,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

-- ==========================================
-- STEP 2: FIX SECURITY (RLS)
-- ==========================================

-- Option: Disable RLS for easiest development
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;

-- Note: If you ever want to re-enable it for production:
-- ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Enable all for anon" ON transactions FOR ALL TO anon USING (true) WITH CHECK (true);
