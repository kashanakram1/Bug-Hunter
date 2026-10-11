import { createClient } from '@supabase/supabase-js';
import { api } from './auth';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key);
export const supabase = configured
  ? createClient(url!, key!, {
      // This anonymous client is used only for the public realtime signal.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'X-Client-Info': 'bughunt-web/1.0' } },
    })
  : null;

// Supabase verifies the JWT; every RPC independently enforces roles and team scope.
export async function rpc<T = any>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('The competition connection has not been configured yet.');
  return api<T>('rpc/'+name,params);
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
export function uuid() {
  return crypto.randomUUID();
}
export const rounds = [
  {
    id: 1,
    name: 'Bug Blitz',
    duration: 20,
    points: 100,
    count: '10 puzzles',
    description: 'Small snippets. Subtle bugs. Make every answer count.',
  },
  {
    id: 2,
    name: 'Code Breaker',
    duration: 30,
    points: 200,
    count: '6 challenges',
    description: 'Locate the defect, explain the failure, write the fix.',
  },
  {
    id: 3,
    name: 'System Under Attack',
    duration: 30,
    points: 300,
    count: '5 incidents',
    description: 'Trace the failure. Protect the system. Resolve the incident.',
  },
  {
    id: 4,
    name: 'Final Debugging Arena',
    duration: 40,
    points: 500,
    count: '12 hidden bugs',
    description: 'Investigate MediBook and write your incident report.',
  },
];
