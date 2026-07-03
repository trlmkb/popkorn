import { LocalStore } from './local';
import { SupabaseStore } from './supabase';
import type { Store } from './types';

export * from './types';

export function env(name: string): string | undefined {
  const meta = (import.meta as { env?: Record<string, string | undefined> }).env;
  return meta?.[name] ?? process.env[name];
}

let store: Store | null = null;

export function getStore(): Store {
  if (!store) {
    const url = env('SUPABASE_URL');
    const key = env('SUPABASE_SERVICE_KEY');
    store = url && key ? new SupabaseStore(url, key) : new LocalStore();
  }
  return store;
}
