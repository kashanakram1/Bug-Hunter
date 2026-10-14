'use client';
import { useEffect, useRef, useState } from 'react';

import { supabase, configured, message, rpc, rounds } from '@/lib/supabase';
import { ErrorBox } from './common';
import { Walkthrough } from './information';
import { api, ApiRequestError, announceAuthChange } from '@/lib/auth';

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
  const [address, setAddress] = useState('');
  const [step, setStep] = useState<'request' | 'code'>('request');
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());
  const submitting = useRef(false);
  const scope = `${recovery ? 'password' : step === 'code' ? 'verify' : mode}:${address.trim().toLowerCase()}`;
  const sendScope = `${mode}:${address.trim().toLowerCase()}`;
  const remaining = Math.max(0, Math.ceil(((cooldowns[scope] || 0) - now) / 1000));
  const resendRemaining = Math.max(0, Math.ceil(((cooldowns[sendScope] || 0) - now) / 1000));
  useEffect(() => {
    if (!remaining && !resendRemaining) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [remaining > 0 || resendRemaining > 0]);
  useEffect(() => {
    const auth = new URLSearchParams(location.search).get('auth');
    if (auth === 'confirm' || auth === 'recovery') {
      setMode(auth === 'confirm' ? 'signup' : 'reset');
      setStep('code');
    } else if (auth === 'link-error') {
      setMode('reset');
      setError('This older email link could not be completed. Request a new email code below. You can enter the code in any browser.');
    }
    if (auth) history.replaceState(null, '', location.pathname + location.hash);
  }, []);
  function changeMode(next: 'login' | 'signup' | 'reset') {
    setMode(next);setStep('request');setError('');setNotice('');
  }
  async function resend() {
    if (submitting.current || (cooldowns[sendScope] || 0) > Date.now()) return;
    submitting.current = true;setBusy(true);setError('');
    try {
      await api(mode === 'signup' ? 'auth/resend' : 'auth/recover', {email: address});
      setNotice('Request accepted. Check your inbox and spam for the latest eight-digit code. Delivery can take a few minutes.');
      setNow(Date.now());setCooldowns(current => ({...current, [sendScope]: Date.now()+60000}));
    } catch(e) {
      setError(message(e));
      if(e instanceof ApiRequestError && e.status===429){setNow(Date.now());setCooldowns(current=>({...current,[sendScope]:Date.now()+e.retryAfter*1000}));}
    } finally {submitting.current=false;setBusy(false);}
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase || submitting.current || (cooldowns[scope] || 0) > Date.now()) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') || '');
    const password = String(f.get('password') || '');
    try {
      if (recovery) {
        await api('auth/password', { password });
        setNotice('Password updated. Sign in with your new password.');
        setStep('request');setMode('login');
        announceAuthChange();
        onRecovered();
      } else if (step === 'code') {
        await api('auth/verify-email', {email,code:String(f.get('code') || '').trim(),type:mode==='signup'?'signup':'recovery'});
        announceAuthChange();
      } else if (mode === 'login') {
        await api('auth/login', { email, password });
        announceAuthChange();
      } else if (mode === 'signup') {
        const result = await api('auth/signup', { email, password });
        setNotice(result.alreadyRegistered
          ? 'This email is already registered. Sign in, or use Forgot password to recover your account.'
          : 'Request accepted. Check your inbox and spam for an eight-digit confirmation code. Delivery can take a few minutes.');
        if (!result.alreadyRegistered) {
          setStep('code');
          setNow(Date.now());
          setCooldowns(current => ({...current, [scope]: Date.now() + 60000}));
        }
      } else {
        await api('auth/recover', { email });
        setNotice(
          'If this address has an account, a reset code has been requested. Check your inbox and spam, then enter the latest eight-digit code.',
        );
        setStep('code');
        setNow(Date.now());
        setCooldowns(current => ({...current, [scope]: Date.now() + 60000}));
      }
    } catch (e) {
      setError(message(e));
      if (e instanceof ApiRequestError && e.status === 429) {
        setNow(Date.now());
        setCooldowns(current => ({...current, [scope]: Date.now() + e.retryAfter * 1000}));
      }
    } finally {
      submitting.current = false;
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
            : step === 'code'
              ? mode === 'signup' ? 'Confirm your email' : 'Enter your reset code'
            : mode === 'login'
              ? 'Enter the arena'
              : mode === 'signup'
                ? 'Create your account'
                : 'Reset your password'}
        </h2>
        <p className="muted">
          {recovery ? 'Your email is verified. Choose your new password.' : step === 'code'
            ? 'Enter the eight-digit code from your email. It expires after 10 minutes and can be used once.'
            : mode === 'signup'
            ? 'Start with your team leader’s email.'
            : mode === 'reset'
              ? 'Request an email code to reset your password.'
              : 'Sign in to your team or staff account.'}
        </p>
        <form onSubmit={submit}>
          {!recovery && (
            <label className="field">
              Email
              <input
                name="email"
                value={address}
                onChange={e => setAddress(e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="leader@university.edu"
                required
                maxLength={254}
              />
            </label>
          )}
          {!recovery && step === 'code' && (
            <label className="field">
              Email code
              <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" minLength={8} maxLength={8} placeholder="Eight-digit code" required />
            </label>
          )}
          {(recovery || (step === 'request' && mode !== 'reset')) && (
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
          <button className="btn full" disabled={busy || !configured || remaining > 0}>
            {busy
              ? 'Please wait…'
              : remaining > 0
                ? `Try again in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
              : recovery
                ? 'Update password'
                : step === 'code'
                  ? 'Verify code'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send reset code'}
          </button>
        </form>
        {!recovery && (
          <div className="auth-links">
            {step === 'code' && (
              <button disabled={busy || !address || resendRemaining > 0} onClick={resend}>
                {resendRemaining > 0 ? `Resend code in ${Math.floor(resendRemaining / 60)}:${String(resendRemaining % 60).padStart(2, '0')}` : 'Resend code'}
              </button>
            )}
            {step === 'request' && mode !== 'login' && (
              <button disabled={busy} onClick={() => {setStep('code');setError('');setNotice('Enter the email address and latest code you received.');}}>I already have a code</button>
            )}
            <button
              disabled={busy}
              onClick={() => changeMode(mode === 'signup' ? 'login' : 'signup')}
            >
              {mode === 'signup' ? 'Already registered? Sign in' : 'New team? Create an account'}
            </button>
            <button disabled={busy} onClick={() => changeMode(mode === 'reset' ? 'login' : 'reset')}>
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
