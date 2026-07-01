-- ==========================================
-- STEP 5: CUSTOM REMINDERS SCHEMA
-- ==========================================

-- Add timezone column to push_subscriptions
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Kolkata';

-- Create general_reminders table
CREATE TABLE IF NOT EXISTS general_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    type TEXT NOT NULL, -- 'daily' or 'one-off'
    reminder_time TIME, -- e.g. '20:00'
    reminder_date DATE, -- e.g. '2026-07-02'
    last_notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Disable Row Level Security for ease of testing
ALTER TABLE general_reminders DISABLE ROW LEVEL SECURITY;
