'use client';
import { useState } from 'react';

import { supabase, configured, message, rpc, rounds } from '@/lib/supabase';
import { ErrorBox } from './common';
import { Walkthrough } from './information';
import { api, announceAuthChange } from '@/lib/auth';

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
        await api('auth/password', { password });
        onRecovered();
      } else if (mode === 'login') {
        await api('auth/login', { email, password });
        announceAuthChange();
      } else if (mode === 'signup') {
        await api('auth/signup', { email, password });
        setNotice('Request received. If this address needs confirmation, check your inbox for a link and open it in this browser. Already registered? Sign in or use Forgot password.');
      } else {
        await api('auth/recover', { email });
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
        <div className="eyebrow">CODE CONNECT 26 / BUG HUNTER MODULE-5</div>
        <h1>
          ARE YOU READY
          <br />
          TO <span>HUNT THE BUGS?</span>
        </h1>
        <p>
          Think critically. Debug efficiently. Assemble your team for four increasingly challenging
          rounds of code review, security analysis, and system debugging.
        </p>
        <div className="notice">
          <p>Online: Saturday, 17 October 2026 at 4:00 PM Pakistan time. Entry closes at 4:20 PM.</p>
          <p>Rounds 1, 2, and 3: 20, 30, and 30 minutes. Each team gets up to 80 minutes from entry.</p>
          <p>On-site final: Thursday, 22 October 2026. Round 4 lasts 40 minutes and is open only to qualified teams.</p>
        </div>
        <div className="event-numbers">
          <div>
            <strong>04</strong>
            <span>progressive rounds</span>
          </div>
          <div>
            <strong>120</strong>
            <span>80 online + 40 on-site</span>
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
                minLength={6}
                maxLength={72}
                placeholder="At least 6 characters"
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
