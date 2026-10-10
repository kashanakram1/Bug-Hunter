'use client';
import { useState } from 'react';

import { supabase, configured, message, rpc, rounds } from '@/lib/supabase';
import { ErrorBox } from './common';
import { Walkthrough } from './information';

export function AuthScreen({
  recovery,
  onRecovered,
}: {
  recovery: boolean;
  onRecovered: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    setNotice('');
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') || '');
    const password = String(f.get('password') || '');
    try {
      if (recovery) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        onRecovered();
      } else if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: location.origin },
        });
        if (error) throw error;
        setNotice('Check your email to confirm your account, then sign in to register your team.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin,
        });
        if (error) throw error;
        setNotice(
          'If an account exists for this address, you will receive a password reset email.',
        );
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="intro">
        <div className="eyebrow">CODE CONNECT 26 / BUG HUNT ADVANCED</div>
        <h1>
          ARE YOU READY
          <br />
          TO <span>HUNT THE BUGS?</span>
        </h1>
        <p>
          Think critically. Debug efficiently. Assemble your team for four increasingly challenging
          rounds of code review, security analysis, and system debugging.
        </p>
        <div className="event-numbers">
          <div>
            <strong>04</strong>
            <span>progressive rounds</span>
          </div>
          <div>
            <strong>120</strong>
            <span>minutes in the arena</span>
          </div>
          <div>
            <strong>1,100</strong>
            <span>points to hunt</span>
          </div>
        </div>
        <div className="round-preview" id="official-rounds">
          {rounds.map((r) => (
            <div key={r.id}>
              <span className="round-number">0{r.id}</span>
              <div>
                <strong>{r.name}</strong>
                <small>
                  {r.count} / {r.duration} min
                </small>
              </div>
              <></>
            </div>
          ))}
        </div>
        <Walkthrough />
      </section>
      <section className="auth-card">
        <h2>
          {recovery
            ? 'Choose a new password'
            : mode === 'login'
              ? 'Enter the arena'
              : mode === 'signup'
                ? 'Create your account'
                : 'Reset your password'}
        </h2>
        <p className="muted">
          {mode === 'signup'
            ? 'Start with your team leader’s email.'
            : mode === 'reset'
              ? 'We’ll send a secure recovery link.'
              : 'Sign in to your team or staff account.'}
        </p>
        <form onSubmit={submit}>
          {!recovery && (
            <label className="field">
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="leader@university.edu"
                required
                maxLength={254}
              />
            </label>
          )}
          {(recovery || mode !== 'reset') && (
            <label className="field">
              Password
              <input
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={12}
                maxLength={128}
                placeholder="At least 12 characters"
                required
              />
            </label>
          )}
          <ErrorBox error={error} />
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {!configured && (
            <ErrorBox error="The organizer is connecting the competition backend. Sign-in will be available once setup is complete." />
          )}
          <button className="btn full" disabled={busy || !configured}>
            {busy
              ? 'Please wait…'
              : recovery
                ? 'Update password'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send recovery link'}
          </button>
        </form>
        {!recovery && (
          <div className="auth-links">
            <button
              onClick={() => {
                setMode(mode === 'signup' ? 'login' : 'signup');
                setError('');
                setNotice('');
              }}
            >
              {mode === 'signup' ? 'Already registered? Sign in' : 'New team? Create an account'}
            </button>
            <button onClick={() => setMode(mode === 'reset' ? 'login' : 'reset')}>
              {mode === 'reset' ? 'Back to sign in' : 'Forgot password?'}
            </button>
          </div>
        )}
        <div className="auth-footer">
          <></> Email confirmation · Organizer approval
        </div>
      </section>
    </div>
  );
}
export function Registration({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [newcomer, setNewcomer] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    const members = [1, 2, 3, 4]
      .map((n) => ({
        name: String(f.get(`member${n}`) || '').trim(),
        registration: String(f.get(`reg${n}`) || '').trim(),
      }))
      .filter((m) => m.name);
    try {
      await rpc('bh_register', {
        p_name: f.get('name'),
        p_leader: members[0]?.name,
        p_university: f.get('university'),
        p_department: f.get('department'),
        p_members: members,
        p_newcomer: newcomer,
      });
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="registration panel">
      <div className="section-title">
        <></>
        <div>
          <span className="eyebrow">TEAM REGISTRATION</span>
          <h1>Build your crew.</h1>
          <p className="muted">
            2–4 members, including the team leader. An organizer will review your registration.
          </p>
        </div>
      </div>
      <form onSubmit={submit}>
        <label className="field">
          Team name
          <input
            name="name"
            required
            minLength={3}
            maxLength={30}
            placeholder="Choose a unique team name"
          />
        </label>
        <div className="two-col">
          <label className="field">
            University
            <input name="university" required maxLength={150} />
          </label>
          <label className="field">
            Department
            <input name="department" required maxLength={150} />
          </label>
        </div>
        {[1, 2, 3, 4].map((n) => (
          <div className="two-col" key={n}>
            <label className="field">
              {n === 1 ? 'Team leader' : `Member ${n}${n > 2 ? ' (optional)' : ''}`}
              <input name={`member${n}`} required={n <= 2} maxLength={100} />
            </label>
            <label className="field">
              Registration number (optional)
              <input name={`reg${n}`} maxLength={80} />
            </label>
          </div>
        ))}
        <label className="check-label">
          <input
            type="checkbox"
            checked={newcomer}
            onChange={(e) => setNewcomer(e.target.checked)}
          />{' '}
          All members are in their first or second year
        </label>
        <ErrorBox error={error} />
        <button className="btn" disabled={busy}>
          {busy ? 'Registering…' : 'Submit for approval'}
        </button>
      </form>
    </section>
  );
}
