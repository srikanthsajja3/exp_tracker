import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://oncwixlyyebpgzihizvn.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uY3dpeGx5eWVicGd6aWhpenZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNDgyNzcsImV4cCI6MjA5NTYyNDI3N30.oFDz9c4xiGMaMqUInoK6i4hMKxm7oVewJrzFNe3kzi8';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
