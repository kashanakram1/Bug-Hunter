'use client';
import { useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function EventIdentity() {
  return (
    <div className="event-identity">
      <img
        src="/branding/code-connect-event.jpeg"
        alt="University of Karachi, UBIT Career Connect 26, Code Connect 26"
        width={1024}
        height={1280}
      />
    </div>
  );
}
export function Brand() {
  return (
    <a href="/" className="brand" aria-label="Bug Hunter Module-5 home">
      <span>
        BUG <span className="accent">HUNTER</span> <span className="brand-year">2026</span>
        <small>MODULE-5 / CODE CONNECT 26</small>
      </span>
    </a>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-credit">
          <span className="footer-eyebrow"><span aria-hidden="true">//</span> ENGINEERED BY</span>
          <p>Designed &amp; developed by</p>
          <strong className="footer-author"><span aria-hidden="true">&lt;/&gt;</span> KASHANAKRAM</strong>
        </div>
        <div className="footer-institution">
          <span className="footer-event">© 2026 CODE//CONNECT’26</span>
          <strong>UNIVERSITY OF KARACHI</strong>
          <span>Department of Computer Science · UBIT</span>
          <nav className="footer-links" aria-label="Legal information">
            <a href="/?legal=terms">Terms of use</a>
            <span aria-hidden="true">/</span>
            <a href="/?legal=privacy">Privacy notice</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div role="alert" className="error-box">
      <></>
      <span>{error}</span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span>Connecting to competition…</span>
      <div className="loading-placeholder" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <></>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Chip({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}
export function Pick({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        className="pick"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Confirm({
  open,
  title,
  text,
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  title: string;
  text: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onCancel();
      }}
    >
      <DialogContent className="modal">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{text}</DialogDescription>
        <div className="actions">
          <button className="btn secondary" disabled={busy} onClick={onCancel}>
            Keep editing
          </button>
          <button className="btn" disabled={busy} onClick={onConfirm}>
            {busy ? 'Recording…' : 'Confirm submission'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function Timer({
  end,
  serverTime,
  pausedAt,
  large = false,
}: {
  end?: string;
  serverTime?: string;
  pausedAt?: string;
  large?: boolean;
}) {
  const [anchor, setAnchor] = useState({ server: 0, local: 0 });
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (serverTime) setAnchor({ server: Date.parse(serverTime), local: performance.now() });
  }, [serverTime]);
  useEffect(() => {
    const tick = () => {
      const now = pausedAt
        ? Date.parse(pausedAt)
        : anchor.server + performance.now() - anchor.local;
      setRemaining(end ? Math.max(0, Math.ceil((Date.parse(end) - now) / 1000)) : 0);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [end, pausedAt, anchor]);
  return (
    <div className={`timer ${large ? 'large' : ''} ${remaining < 60 && end ? 'urgent' : ''}`}>
      <span className="eyebrow">{pausedAt ? 'ROUND PAUSED' : 'TIME REMAINING'}</span>
      <strong>
        {end
          ? `${Math.floor(remaining / 60)
              .toString()
              .padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`
          : '--:--'}
      </strong>
      <small>{pausedAt ? 'Waiting for the organizer' : 'Synced with competition server'}</small>
    </div>
  );
}
export function Leaderboard({ rows, visible }: { rows: any[]; visible: boolean }) {
  if (!visible)
    return (
      <Empty
        title="Leaderboard temporarily hidden"
        text="Rankings will be revealed in the final round."
      />
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Rank</TableHead>
          <TableHead>Team</TableHead>
          <TableHead className="right">Solved</TableHead>
          <TableHead className="right">Points</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.rank}>
            <TableCell>
              <span className={`rank rank-${r.rank}`}>{String(r.rank).padStart(2, '0')}</span>
            </TableCell>
            <TableCell className="team-name">{r.name}</TableCell>
            <TableCell className="right muted">{r.solved}</TableCell>
            <TableCell className="right score">{r.total_score}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
export function Announcements({ items = [] }: { items?: any[] }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h3>
          <></> Organizer announcements
        </h3>
      </div>
      {items.length ? (
        items.slice(0, 5).map((a) => (
          <div className="announcement" key={a.id}>
            <p>{a.message}</p>
            <time>
              {new Date(a.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </div>
        ))
      ) : (
        <p className="muted padded">No announcements yet. Updates will appear here.</p>
      )}
    </section>
  );
}
