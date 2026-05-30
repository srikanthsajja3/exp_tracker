-- ==========================================
-- STEP 3: RECURRING & DEBT TRACKING
-- ==========================================

DO $$ BEGIN
    CREATE TYPE recurring_type AS ENUM ('subscription', 'debt_taken', 'debt_given');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS planned_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type recurring_type NOT NULL,
    title TEXT NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    due_date DATE NOT NULL,
    is_recurring BOOLEAN DEFAULT false, -- True for Netflix, False for one-time debt
    status TEXT DEFAULT 'pending', -- 'pending', 'paid', 'cancelled'
    reminder_days_before INTEGER DEFAULT 1,
    last_notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE planned_movements DISABLE ROW LEVEL SECURITY;
