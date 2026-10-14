'use client';
import { useEffect, useState } from 'react';

import { supabase, rpc, message } from '@/lib/supabase';
import { Brand, ErrorBox, EventIdentity, Loading } from '@/components/competition/common';
import { AuthScreen, Registration } from '@/components/competition/auth';
import { TeamPortal } from '@/components/competition/team';
import { StaffPortal } from '@/components/competition/staff';
import { PublicScreen } from '@/components/competition/public';
import { Toaster } from '@/components/ui/sonner';
import { LegalScreen } from '@/components/competition/information';
import { api, currentSession } from '@/lib/auth';

export default function Home() {
  const [session, setSession] = useState<any>(null),
    [boot, setBoot] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [recovery, setRecovery] = useState(false),
    [view, setView] = useState('home');
  const refresh = async () => {
    setError('');
    try {
      setBoot(await rpc('bh_bootstrap'));
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const syncView = () =>
      setView(
        ['privacy', 'terms'].includes(new URLSearchParams(location.search).get('legal') || '')
          ? new URLSearchParams(location.search).get('legal')!
          : new URLSearchParams(location.search).has('certificate')
            ? 'certificate'
            : location.hash === '#mission'
              ? 'mission'
              : 'home',
      );
    syncView();
    window.addEventListener('hashchange', syncView);
    if (!supabase) {
      setLoading(false);
      return () => window.removeEventListener('hashchange', syncView);
    }
    let alive = true;
    const loadSession = () => currentSession().then((data) => {
      if (alive) {
        setSession(data.session);
        setRecovery(data.recovery);
        setLoading(false);
      }
    }).catch((e) => { if(alive){setError(message(e));setLoading(false);} });
    void loadSession();
    window.addEventListener('bughunt-auth-change', loadSession);
    return () => {
      alive = false;
      window.removeEventListener('hashchange', syncView);
      window.removeEventListener('bughunt-auth-change', loadSession);
    };
  }, []);
  useEffect(() => {
    if (session && !recovery) {
      setLoading(true);
      void refresh();
    } else setBoot(null);
  }, [session?.user?.id, recovery]);
  async function signout() {
    try {
      if (boot?.team) await rpc('bh_release_session');
    } catch {
      /* Expired leases are released automatically. */
    }
    try {
      await api('auth/logout');
      setBoot(null);
      setSession(null);
    } catch(e) { setError(message(e)); }
  }
  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <div className="site-masthead">
        <EventIdentity />
      </div>
      <header className="site-header">
        <Brand />
        <nav aria-label="Main navigation">
          <button
            className={`nav-link ${view === 'mission' ? 'active' : ''}`}
            onClick={() => {
              setView(view === 'mission' ? 'home' : 'mission');
              history.replaceState(null, '', view === 'mission' ? '/' : '/#mission');
            }}
          >
            <></>
            {view === 'mission' ? 'Back to arena' : 'Mission Control'}
          </button>
          {session && (
            <>
              <span className="account-label">{boot?.team?.name || boot?.role || 'Account'}</span>
              <button className="icon-button" aria-label="Sign out" onClick={signout}>
                Sign out
              </button>
            </>
          )}
        </nav>
      </header>
      <main id="content" className={view === 'mission' ? 'main mission-main' : 'main'}>
        {view === 'privacy' || view === 'terms' ? (
          <LegalScreen kind={view} />
        ) : view === 'mission' || view === 'certificate' ? (
          <PublicScreen certificate={view === 'certificate'} />
        ) : recovery ? (
          <AuthScreen recovery onRecovered={() => setRecovery(false)} />
        ) : loading ? (
          <Loading />
        ) : !session ? (
          <AuthScreen recovery={false} onRecovered={() => {}} />
        ) : error ? (
          <section className="panel padded">
            <ErrorBox error={error} />
            <button className="btn secondary" onClick={refresh}>
              <></> Retry connection
            </button>
          </section>
        ) : boot?.role === 'admin' || boot?.role === 'judge' ? (
          <StaffPortal role={boot.role} online={boot.online} />
        ) : boot?.team ? (
          <TeamPortal boot={boot} refreshBoot={refresh} />
        ) : (
          <Registration onDone={refresh} />
        )}
      </main>
      <footer className="site-footer">
        <span>CODE CONNECT 26 / BUG HUNTER MODULE-5</span>
        <div className="actions">
          <a href="/?legal=terms">Terms of use</a>
          <a href="/?legal=privacy">Privacy notice</a>
        </div>
        <span>University of Karachi · UBIT Career Connect 26</span>
      </footer>
      <Toaster position="bottom-right" />
    </>
  );
}
