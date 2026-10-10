import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key);
export const supabase = configured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { headers: { 'X-Client-Info': 'bughunt-web/1.0' } },
    })
  : null;

// Supabase verifies the JWT; every RPC independently enforces roles and team scope.
export async function rpc<T = any>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('The competition connection has not been configured yet.');
  const { data, error } = await supabase.rpc(name, params).abortSignal(AbortSignal.timeout(15000));
  if (error) {
    if (error.code === 'PGRST202' || error.code === 'PGRST205')
      throw new Error(
        'The competition database is not initialized yet. Please contact the organizer.',
      );
    if (error.code === '23505')
      throw new Error('That name or record already exists. Please choose another.');
    if (error.code === '23514')
      throw new Error('Please check the field lengths and required information.');
    throw new Error(
      error.message || 'Connection interrupted. Your input is still here; please retry.',
    );
  }
  return data as T;
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
