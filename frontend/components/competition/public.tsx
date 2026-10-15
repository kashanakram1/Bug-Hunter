'use client';
import { useEffect, useState } from 'react';

import { rpc, message } from '@/lib/supabase';
import {
  Announcements,
  Chip,
  Empty,
  ErrorBox,
  EventIdentity,
  Leaderboard,
  Loading,
  Timer,
} from './common';
import { useControlUpdates } from '@/lib/control-updates';

export function PublicScreen({ certificate }: { certificate: boolean }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [qr, setQr] = useState(''),
    [loaded, setLoaded] = useState(false),
    [controlVersion, setControlVersion] = useState(0);
  useControlUpdates(() => {
    if (!certificate) setControlVersion((v) => v + 1);
  });
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const id = new URLSearchParams(location.search).get('certificate');
        const result = await rpc(
          certificate ? 'bh_verify_certificate' : 'bh_public_state',
          certificate ? { p_id: id } : {},
        );
        if (!cancelled) {
          setData(result);
          setError('');
          setLoaded(true);
        }
        if (certificate && result) {
          const QR = await import('qrcode');
          const src = await QR.toDataURL(`${location.origin}/?certificate=${result.id}`, {
            width: 220,
            margin: 2,
            color: { dark: '#111111', light: '#eeeae4' },
          });
          if (!cancelled) setQr(src);
        }
      } catch (e) {
        if (!cancelled) {
          setError(message(e));
          setLoaded(true);
        }
      }
      if (!cancelled && !certificate) timer = setTimeout(load, 15000 + Math.random() * 5000);
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [certificate, controlVersion]);
  if (error)
    return (
      <section className="panel padded">
        <ErrorBox error={error} />
        <button className="btn secondary" onClick={() => location.reload()}>
          Retry
        </button>
      </section>
    );
  if (!loaded) return <Loading />;
  if (certificate)
    return data ? (
      <section className="certificate">
        <EventIdentity />
        <span className="eyebrow">VERIFIED CERTIFICATE</span>
        <h1>{data.event_name}</h1>
        <p>This certificate recognizes</p>
        <div className="recipient">{data.team_name}</div>
        <h2>{data.award}</h2>
        <p>
          Issued{' '}
          {new Date(data.issued_at).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
        {qr && (
          <img
            className="qr"
            src={qr}
            width={160}
            height={160}
            alt="QR code linking to this certificate's verification page"
          />
        )}
        <p className="certificate-id">Certificate ID · {data.id}</p>
        <div className="actions" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={() => window.print()}>
            <></> Print / Save PDF
          </button>
          <a className="btn secondary" href="/">
            Return to arena
          </a>
        </div>
      </section>
    ) : (
      <Empty
        title="Certificate not found"
        text="Check the verification link or contact the event organizer."
      />
    );
  const current = data.rounds.find((r: any) => r.status === 'open' || r.status === 'paused');
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CODE CONNECT 26 / BUG HUNT ADVANCED / LIVE EVENT</span>
          <h1>Mission Control</h1>
          <p>
            {data.event.results_released
              ? 'Final results are official. Congratulations to every team.'
              : 'Follow the competition as it unfolds.'}
          </p>
        </div>
        <button
          className="btn secondary no-print"
          onClick={() =>
            document.documentElement
              .requestFullscreen()
              .catch(() => setError('Fullscreen is unavailable in this browser.'))
          }
        >
          <></> Fullscreen display
        </button>
      </div>
      <div className="mission-grid">
        <div>
          <section className="panel mission-status">
            <Chip tone={current ? 'green' : ''}>
              <></>
              {current ? current.status : 'Between rounds'}
            </Chip>
            <h2>
              {current ? `Round ${current.id}` : 'Stand by.'}
              <br />
              <span className="accent">{current?.name || 'The next hunt awaits.'}</span>
            </h2>
            <Timer
              large
              unlimited={Boolean(data.online?.testing)}
              end={data.countdown}
              serverTime={data.server_time}
              pausedAt={current?.paused_at}
            />
            <p className="muted">
              {data.active_teams} teams connected · {data.online?.testing ? 'All four rounds open for testing' : 'Timer shows the latest active team deadline'}
            </p>
          </section>
          {data.first_blood.length > 0 && (
            <section className="panel padded" style={{ marginTop: 22 }}>
              <h3 className="accent">First critical fixes</h3>
              {data.first_blood.map((f: any, i: number) => (
                <p key={i}>
                  {f.team} <Chip tone="green">+10 bonus</Chip>
                </p>
              ))}
            </section>
          )}
          <div style={{ marginTop: 22 }}>
            <Announcements items={data.announcements} />
          </div>
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h3>{data.event.results_released ? 'Final standings' : 'Live leaderboard'}</h3>
            <Chip>{data.event.leaderboard_visible ? 'Top 100' : 'Hidden'}</Chip>
          </div>
          <Leaderboard rows={data.leaderboard} visible={data.event.leaderboard_visible} />
        </section>
      </div>
    </>
  );
}
