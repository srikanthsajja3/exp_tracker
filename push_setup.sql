-- ==========================================
-- STEP 4: WEB PUSH NOTIFICATIONS SETUP
-- ==========================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription JSONB NOT NULL,
    endpoint TEXT GENERATED ALWAYS AS (subscription->>'endpoint') STORED UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Disable Row Level Security for ease of development/testing
ALTER TABLE push_subscriptions DISABLE ROW LEVEL SECURITY;
