'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from 'sonner';
import { message, rpc, uuid } from '@/lib/supabase';
import { Chip, Empty, ErrorBox, Loading, Pick } from './common';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useControlUpdates } from '@/lib/control-updates';

export function StaffPortal({ role, online }: { role: string; online?: any }) {
  const [tab, setTab] = useState('overview'),
    [offset, setOffset] = useState(0),
    [response, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<any>(null);
  const admin = role === 'admin';
  const requestVersion = useRef(0);
  const data = response?._tab === tab && response?._offset === offset ? response : null;
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const result = await rpc('bh_staff_data', { p_tab: tab, p_offset: offset });
      if (version !== requestVersion.current) return;
      setData({ ...result, _tab: tab, _offset: offset });
      setError('');
    } catch (e) {
      if (version === requestVersion.current) setError(message(e));
    }
  }, [tab, offset]);
  useControlUpdates(() => void refresh());
  useEffect(() => {
    setData(null);
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 25000);
    return () => clearInterval(timer);
  }, [refresh]);
  const act = (name: string, payload: any, label: string) => {
    setAction({ name, payload, label });
  };
  async function confirm() {
    setBusy(true);
    try {
      await rpc('bh_admin', { p_action: action.name, p_payload: action.payload, p_reason: 'Organizer action: ' + action.name });
      setAction(null);
      toast.success('Action recorded in the audit log');
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportResults() {
    setBusy(true);
    try {
      let rows: any[] = [];
      for (let start = 0; start < 10000; start += 500) {
        const d = await rpc('bh_staff_data', { p_tab: 'results', p_offset: start });
        rows.push(...d.items);
        if (d.items.length < 500) break;
      }
      const columns = ['rank', 'name', 'total_score', 'solved', 'penalties'];
      const escape = (v: any) => {
        let s = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return '"' + s.replaceAll('"', '""') + '"';
      };
      const csv = [
        columns.join(','),
        ...rows.map((r) => columns.map((c) => escape(r[c])).join(',')),
      ].join('\r\n');
      const url = URL.createObjectURL(
        new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bughunt-results.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length} teams`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const tabs = [
    ['overview', 'Control room'],
    ...(admin ? [['teams', 'Teams']] : []),
    ['queue', 'Review queue'],
    ['claims', 'Final claims'],
    ['clarifications', 'Clarifications'],
    ['questions', 'Question bank'],
    ...(admin
      ? [
          ['activity', 'Fair play'],
          ['results', 'Results'],
          ['audit', 'Audit log'],
        ]
      : []),
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow accent">{admin ? 'ORGANIZER CONSOLE' : 'JUDGE WORKSPACE'}</span>
          <h1>{admin ? 'Competition control.' : 'Every point, accounted for.'}</h1>
          <p>
            {admin
              ? 'Manage rounds, review progress, and keep the event running.'
              : 'Review against the official rubric. Every decision is recorded.'}
          </p>
        </div>
        <div className="actions">
          <Chip tone="green">{role}</Chip>
          <button className="btn secondary small" onClick={refresh}>
            <></> Refresh
          </button>
          {admin && !online?.enabled && (
            <button
              className="btn danger small"
              onClick={() => act('pause_all', {}, 'Pause every open round')}
            >
              <></> Pause all
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          setOffset(0);
        }}
      >
        <TabsList className="tab-strip">
          {tabs.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map(([value]) => (
          <TabsContent value={value} key={value}>
            {tab === value &&
              (!data ? (
                <Loading />
              ) : (
                <>
                  {tab === 'overview' && (
                    <>
                      <div className="stats">
                        {[
                          ['Registered teams', data.teams],
                          ['Approved teams', data.approved],
                          ['Active sessions', data.active],
                          ['Waiting for review', data.pending_reviews],
                        ].map(([label, count]: any) => (
                          <div className="stat" key={label}>
                            <></>
                            <span>{label}</span>
                            <strong>{count}</strong>
                          </div>
                        ))}
                      </div>
                      <div className="two-col">
                        <section>
                          <h2>Round operations</h2>
                          {data.rounds.map((r: any) => (
                            <article className="panel control-round" key={r.id}>
                              <header>
                                <div>
                                  <h3>
                                    0{r.id} · {r.name}
                                  </h3>
                                  <span className="muted">
                                    {r.duration_seconds / 60} min / {r.max_points} points
                                  </span>
                                </div>
                                <Chip
                                  tone={
                                    r.status === 'open'
                                      ? 'green'
                                      : r.status === 'paused'
                                        ? 'orange'
                                        : ''
                                  }
                                >
                                  {r.status}
                                </Chip>
                              </header>
                              {admin && (online?.enabled && r.id <= 3 ? (
                                <p>Scheduled online round. Opening, closing, extensions, and qualification are automatic.</p>
                              ) : <RoundActions round={r} act={act} />)}
                            </article>
                          ))}
                        </section>
                        <div>
                          {admin ? (
                            <>
                              <section className="panel padded">
                                <h3>
                                  <></> Broadcast an announcement
                                </h3>
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    act(
                                      'announcement',
                                      { message: new FormData(e.currentTarget).get('message') },
                                      'Publish this announcement',
                                    );
                                  }}
                                >
                                  <label className="field">
                                    Message
                                    <textarea name="message" required maxLength={2000} />
                                  </label>
                                  <button className="btn">Publish announcement</button>
                                </form>
                              </section>
                              <section className="panel padded" style={{ marginTop: 20 }}>
                                <h3>Visibility & registration</h3>
                                <div className="actions">
                                  <button
                                    className="btn secondary"
                                    onClick={() =>
                                      act(
                                        'settings',
                                        { leaderboard_visible: !data.event.leaderboard_visible },
                                        data.event.leaderboard_visible
                                          ? 'Hide leaderboard'
                                          : 'Show leaderboard',
                                      )
                                    }
                                  >
                                    {data.event.leaderboard_visible ? 'Hide' : 'Show'} leaderboard
                                  </button>
                                  <button
                                    className="btn secondary"
                                    onClick={() =>
                                      act(
                                        'settings',
                                        { registration_open: !data.event.registration_open },
                                        'Change registration availability',
                                      )
                                    }
                                  >
                                    {data.event.registration_open ? 'Close' : 'Open'} registration
                                  </button>
                                </div>
                                <p className="review-note">
                                  Scores are hidden by default during Rounds 1–3.
                                </p>
                              </section>
                            </>
                          ) : (
                            <section className="panel padded">
                              <h3>Judging priorities</h3>
                              <p className="muted">
                                Clear earlier rounds before qualification. Review both the
                                participant response and the official answer key. Accept equivalent
                                correct fixes.
                              </p>
                              <button className="btn" onClick={() => setTab('queue')}>
                                Open review queue
                              </button>
                            </section>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                  {tab === 'teams' && (
                    <div className="staff-list">
                      {data.items.map((t: any) => (
                        <article className="panel staff-item" key={t.id}>
                          <header>
                            <div>
                              <h3>{t.name}</h3>
                              <p className="muted">
                                {t.leader} · {t.email}
                              </p>
                            </div>
                            <Chip tone={t.status === 'approved' ? 'green' : 'orange'}>
                              {t.status}
                            </Chip>
                          </header>
                          <p className="muted">
                            {t.university} / {t.department} · {t.members.length} members
                          </p>
                          <details>
                            <summary>Member details</summary>
                            {t.members.map((m: any, i: number) => (
                              <p key={i}>
                                {m.name} {m.registration && `· ${m.registration}`}
                              </p>
                            ))}
                          </details>
                          <div className="actions">
                            {t.status !== 'approved' && (
                              <button
                                className="btn small"
                                onClick={() =>
                                  act(
                                    'team_status',
                                    { team_id: t.id, status: 'approved' },
                                    `Approve ${t.name}`,
                                  )
                                }
                              >
                                Approve
                              </button>
                            )}
                            <button
                              className="btn secondary small"
                              onClick={() =>
                                act(
                                  'team_status',
                                  { team_id: t.id, status: 'rejected' },
                                  `Reject ${t.name}`,
                                )
                              }
                            >
                              Reject
                            </button>
                            <button
                              className="btn danger small"
                              onClick={() =>
                                act(
                                  'team_status',
                                  { team_id: t.id, status: 'disqualified' },
                                  `Disqualify ${t.name}`,
                                )
                              }
                            >
                              Disqualify
                            </button>
                            <button
                              className="btn secondary small"
                              onClick={() =>
                                act(
                                  'sessions',
                                  { team_id: t.id, release: true },
                                  `Release active sessions for ${t.name}`,
                                )
                              }
                            >
                              Release sessions
                            </button>
                            <button
                              className="btn secondary small"
                              onClick={() =>
                                act(
                                  'sessions',
                                  { team_id: t.id, limit: t.session_limit === 1 ? 2 : 1 },
                                  `Change session limit for ${t.name}`,
                                )
                              }
                            >
                              Allow {t.session_limit === 1 ? '2' : '1'} devices
                            </button>
                          </div>
                          <TeamOverride team={t} act={act} online={online} />
                        </article>
                      ))}
                    </div>
                  )}
                  {tab === 'queue' &&
                    (data.items.length ? (
                      <div className="staff-list">
                        {data.items.map((s: any) => (
                          <SubmissionReview key={s.id} item={s} refresh={refresh} />
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="Review queue is clear"
                        text="New submissions requiring a judge will appear here."
                      />
                    ))}
                  {tab === 'claims' &&
                    (data.items.length ? (
                      <div className="staff-list">
                        {data.items.map((c: any) => (
                          <ClaimReview key={c.id} item={c} bugs={data.bugs} refresh={refresh} />
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="No claims awaiting review"
                        text="Final-round bug claims appear here after submission."
                      />
                    ))}
                  {tab === 'questions' && (
                    <div className="staff-list">
                      {data.items.map((q: any) => (
                        <article className="panel staff-item" key={q.id}>
                          <h3>
                            {q.id} · {q.title} <Chip>{q.max_points} points</Chip>
                          </h3>
                          <details>
                            <summary>Question and official marking guide</summary>
                            <pre className="question-prompt">
                              {q.prompt}
                              {q.code ? '\n' + q.code : ''}
                            </pre>
                            <div className="key-box">{q.explanation}</div>
                            <p className="muted">
                              {q.rubric.map((r: any) => `${r.label}: ${r.max}`).join(' · ')}
                            </p>
                          </details>
                        </article>
                      ))}
                    </div>
                  )}
                  {tab === 'clarifications' && (
                    <div className="staff-list">
                      {data.items.length ? (
                        data.items.map((c: any) => (
                          <article className="panel staff-item" key={c.id}>
                            <h3>{c.team_name}</h3>
                            <p className="list-text">{c.question}</p>
                            {c.answer && <div className="notice">{c.answer}</div>}
                            {admin ? (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const f = new FormData(e.currentTarget);
                                  act(
                                    'reply',
                                    {
                                      id: c.id,
                                      answer: f.get('answer'),
                                      broadcast: f.get('broadcast') === 'on',
                                    },
                                    'Answer clarification',
                                  );
                                }}
                              >
                                <label className="field">
                                  Reply
                                  <textarea
                                    name="answer"
                                    required
                                    maxLength={2000}
                                    defaultValue={c.answer || ''}
                                  />
                                </label>
                                <button className="btn small">Send private reply</button>
                                <button
                                  className="btn secondary small"
                                  style={{ marginLeft: 10 }}
                                  type="button"
                                  onClick={(e) => {
                                    const f = new FormData(e.currentTarget.closest('form')!);
                                    act(
                                      'reply',
                                      { id: c.id, answer: f.get('answer'), broadcast: true },
                                      'Reply and broadcast to all teams',
                                    );
                                  }}
                                >
                                  Reply & broadcast
                                </button>
                              </form>
                            ) : (
                              <p className="muted">
                                An administrator can respond or broadcast a clarification.
                              </p>
                            )}
                          </article>
                        ))
                      ) : (
                        <Empty
                          title="No clarification requests"
                          text="Team questions will appear here."
                        />
                      )}
                    </div>
                  )}
                  {tab === 'activity' && (
                    <div className="staff-list">
                      {data.items.length ? (
                        data.items.map((a: any) => (
                          <article className="panel staff-item" key={`${a.id}-${a.round_id}`}>
                            <header>
                              <h3>
                                {a.name} · Round {a.round_id}
                              </h3>
                              <Chip
                                tone={
                                  a.tab_switches >= 8 ? 'red' : a.tab_switches >= 3 ? 'orange' : ''
                                }
                              >
                                {a.tab_switches >= 8 ? 'Review required' : 'Recorded signals'}
                              </Chip>
                            </header>
                            <p>
                              {a.tab_switches} tab switches · {a.fullscreen_exits} fullscreen exits
                              · {a.pastes} paste events
                            </p>
                            <p className="muted">
                              Signals require context. Review with the floor marshal before taking
                              further action.
                            </p>
                          </article>
                        ))
                      ) : (
                        <Empty
                          title="No activity flags"
                          text="Activity signals from active rounds will appear here."
                        />
                      )}
                    </div>
                  )}
                  {tab === 'results' && (
                    <section className="panel padded">
                      <div className="staff-toolbar">
                        <h2>Competition standings</h2>
                        <div className="actions">
                          <button className="btn secondary" disabled={busy} onClick={exportResults}>
                            <></> Export CSV
                          </button>
                          <button
                            className="btn"
                            onClick={() =>
                              act('finalize', {}, 'Finalize results and issue certificates')
                            }
                          >
                            Finalize & issue certificates
                          </button>
                        </div>
                      </div>
                      <p className="notice">
                        Finalizing freezes scores and publishes results. All rounds must be closed
                        and all reviews completed.
                      </p>
                      {data.items.map((r: any) => (
                        <div className="workspace-toolbar" key={r.id}>
                          <span>
                            <span className="rank">{r.rank}</span> {r.name}
                          </span>
                          <strong className="score">{r.total_score} pts</strong>
                        </div>
                      ))}
                    </section>
                  )}
                  {tab === 'audit' && (
                    <div className="staff-list">
                      {data.items.map((a: any) => (
                        <article className="panel staff-item" key={a.id}>
                          <header>
                            <h3>
                              #{a.id} · {a.action}
                            </h3>
                            <time className="muted">{new Date(a.created_at).toLocaleString()}</time>
                          </header>
                          <p>{a.reason}</p>
                          <details>
                            <summary>Actor, target, and recorded changes</summary>
                            <pre className="list-text">
                              {JSON.stringify(
                                {
                                  actor: a.actor,
                                  target: a.target,
                                  before: a.old_value,
                                  after: a.new_value,
                                },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        </article>
                      ))}
                    </div>
                  )}
                  {data.items && tab !== 'questions' && (
                    <div className="pagination">
                      <button
                        className="btn secondary small"
                        disabled={!offset}
                        onClick={() =>
                          setOffset(Math.max(0, offset - (tab === 'results' ? 500 : 50)))
                        }
                      >
                        Previous
                      </button>
                      <span>Page {Math.floor(offset / (tab === 'results' ? 500 : 50)) + 1}</span>
                      <button
                        className="btn secondary small"
                        disabled={data.items.length < (tab === 'results' ? 500 : 50)}
                        onClick={() => setOffset(offset + (tab === 'results' ? 500 : 50))}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              ))}
          </TabsContent>
        ))}
      </Tabs>
      <Dialog
        open={Boolean(action)}
        onOpenChange={(v) => {
          if (!v && !busy) setAction(null);
        }}
      >
        <DialogContent className="modal">
          <DialogTitle>{action?.label}</DialogTitle>
          <DialogDescription>
            Confirm this action. Your identity and the change will be recorded automatically.
          </DialogDescription>
          <button className="btn" disabled={busy} onClick={confirm}>
            {busy ? 'Applying…' : 'Confirm action'}
          </button>
          <ErrorBox error={error} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoundActions({ round: r, act }: any) {
  const [seconds, setSeconds] = useState('300'),
    [count, setCount] = useState('');
  return (
    <>
      <div className="actions">
        {r.status !== 'open' && (
          <button
            className="btn small"
            onClick={() =>
              act(
                'round',
                { round: r.id, status: 'open', seconds: Number(seconds) },
                r.status === 'paused' ? `Resume round ${r.id}` : `Open round ${r.id}`,
              )
            }
          >
            {r.status === 'paused' ? 'Resume' : r.status === 'closed' ? 'Reopen' : 'Open round'}
          </button>
        )}
        {r.status === 'open' && (
          <button
            className="btn secondary small"
            onClick={() => act('round', { round: r.id, status: 'paused' }, `Pause round ${r.id}`)}
          >
            Pause
          </button>
        )}
        {r.status !== 'closed' && (
          <button
            className="btn secondary small"
            onClick={() => act('round', { round: r.id, status: 'closed' }, `Close round ${r.id}`)}
          >
            Close
          </button>
        )}
      </div>
      <details>
        <summary>Timing & qualification</summary>
        <div className="two-col">
          <label className="field">
            Extra time (seconds)
            <input
              type="number"
              min="1"
              max="7200"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
            />
          </label>
          <label className="field">
            Qualifiers (empty = default)
            <input
              type="number"
              min="1"
              max="10000"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </label>
        </div>
        <div className="actions">
          <button
            className="btn secondary small"
            onClick={() =>
              act('extend', { round: r.id, seconds: Number(seconds) }, `Add time to round ${r.id}`)
            }
          >
            Extend all active timers
          </button>
          {r.id === 4 && (
            <button
              className="btn secondary small"
              onClick={() =>
                act(
                  'qualify',
                  { round: r.id, ...(count ? { count: Number(count) } : {}) },
                  `Publish round ${r.id} qualification`,
                )
              }
            >
              Publish qualification
            </button>
          )}
        </div>
      </details>
    </>
  );
}
function TeamOverride({ team, act, online }: any) {
  const [amount, setAmount] = useState(''),
    [r, setR] = useState(online?.enabled ? '4' : '1'),
    [seconds, setSeconds] = useState('300');
  return (
    <details>
      <summary>Score & time override</summary>
      <div className="two-col">
        <label className="field">
          Score adjustment (negative = penalty)
          <input
            type="number"
            min="-5000"
            max="5000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <button
          className="btn secondary"
          disabled={!amount}
          onClick={() =>
            act(
              'adjust',
              { team_id: team.id, amount: Number(amount), request_id: uuid() },
              `Adjust ${team.name} by ${amount} points`,
            )
          }
        >
          Record adjustment
        </button>
      </div>
      <div className="two-col">
        <Pick
          label="Round"
          value={r}
          onChange={setR}
          options={(online?.enabled ? [4] : [1, 2, 3, 4]).map((x) => ({ value: String(x), label: `Round ${x}` }))}
        />
        <label className="field">
          Additional seconds
          <input
            type="number"
            min="1"
            max="7200"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </label>
      </div>
      <button
        className="btn secondary small"
        onClick={() =>
          act(
            'extend',
            { round: Number(r), team_id: team.id, seconds: Number(seconds) },
            `Extend ${team.name}'s timer`,
          )
        }
      >
        Extend this team's timer
      </button>
    </details>
  );
}
function SubmissionReview({ item: s, refresh }: any) {
  const [scores, setScores] = useState<Record<string, number>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function grade() {
    setBusy(true);
    try {
      await rpc('bh_grade', { p_submission: s.id, p_scores: scores, p_note: 'Rubric review' });
      toast.success('Review recorded');
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel staff-item">
      <header>
        <div>
          <span className="eyebrow">
            ROUND {s.round_id} / {s.question_id}
          </span>
          <h3>
            {s.team_name} · {s.title}
          </h3>
        </div>
        <Chip>Attempt {s.attempt}</Chip>
      </header>
      <div className="review-grid">
        <div>
          <details>
            <summary>View question</summary>
            <pre className="question-prompt">
              {s.prompt}
              {s.code}
            </pre>
          </details>
          {Object.entries(s.answer).map(([key, value]) => (
            <div key={key}>
              <span className="eyebrow">{key}</span>
              <pre className="answer-text">{String(value)}</pre>
            </div>
          ))}
        </div>
        <div className="key-box">
          <h3>Official marking guide</h3>
          {s.explanation}
          <p className="review-note">
            Suggested score: {s.suggested_score}/{s.max_points}. This is advisory; review equivalent
            answers fairly.
          </p>
        </div>
      </div>
      <div className="rubric">
        {s.rubric.map((r: any) => (
          <label className="field" key={r.key}>
            {r.label} / {r.max}
            <input
              type="number"
              min="0"
              max={r.max}
              step="1"
              value={scores[r.key] ?? ''}
              onChange={(e) =>
                setScores({
                  ...scores,
                  [r.key]: e.target.value === '' ? NaN : Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      <ErrorBox error={error} />
      <button
        className="btn"
        disabled={
          busy ||
          s.rubric.some(
            (r: any) =>
              !Number.isFinite(scores[r.key]) || scores[r.key] < 0 || scores[r.key] > r.max,
          )
        }
        onClick={grade}
      >
        {busy
          ? 'Saving review…'
          : `Confirm score · ${Object.values(scores).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)}/${s.max_points}`}
      </button>
    </article>
  );
}
function ClaimReview({ item: c, bugs, refresh }: any) {
  const [verdict, setVerdict] = useState('verified'),
    [bug, setBug] = useState(String(bugs[0]?.id || '')),
    [extra, setExtra] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function review() {
    setBusy(true);
    try {
      await rpc('bh_review_claim', {
        p_claim: c.id,
        p_verdict: verdict,
        p_bug: verdict === 'verified' ? Number(bug) : null,
        p_extra: extra || null,
        p_note: 'Claim review: ' + verdict,
      });
      await refresh();
      toast.success('Claim reviewed');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const selected = bugs.find((b: any) => String(b.id) === bug);
  return (
    <article className="panel staff-item">
      <header>
        <h3>
          {c.team_name} · {c.location}
        </h3>
        <Chip>Pending verification</Chip>
      </header>
      <div className="review-grid">
        <div>
          <h3>Cause</h3>
          <p className="list-text">{c.cause}</p>
          <h3>Impact</h3>
          <p className="list-text">{c.impact}</p>
          <pre className="answer-text">{c.fix}</pre>
        </div>
        <div>
          <Pick
            label="Verdict"
            value={verdict}
            onChange={setVerdict}
            options={[
              { value: 'verified', label: 'Verified known bug' },
              { value: 'extra', label: 'Additional valid bug (+5)' },
              { value: 'duplicate', label: 'Duplicate claim (0)' },
              { value: 'rejected', label: 'Incorrect claim' },
            ]}
          />
          {verdict === 'verified' && (
            <>
              <Pick
                label="Match official bug"
                value={bug}
                onChange={setBug}
                options={bugs.map((b: any) => ({
                  value: String(b.id),
                  label: `#${b.id} · ${b.title} (${b.points})`,
                }))}
              />
              <div className="key-box">{selected?.explanation}</div>
            </>
          )}
          {verdict === 'extra' && (
            <label className="field">
              Unique bug label
              <input value={extra} maxLength={150} onChange={(e) => setExtra(e.target.value)} />
            </label>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      <button
        className="btn"
        disabled={busy || (verdict === 'extra' && extra.trim().length < 3)}
        onClick={review}
      >
        Confirm verification
      </button>
    </article>
  );
}
