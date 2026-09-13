-- Option 1: Disable RLS completely (Simplest for local development)
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;

-- OR --

-- Option 2: Create a policy to allow all actions for anonymous users (More standard)
-- CREATE POLICY "Allow all for anon" ON transactions FOR ALL TO anon USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow all for anon" ON projects FOR ALL TO anon USING (true) WITH CHECK (true);
