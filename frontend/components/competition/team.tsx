'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from 'sonner';
import { rpc, message, rounds, uuid } from '@/lib/supabase';
import { Announcements, Chip, Confirm, Empty, ErrorBox, Loading, Timer } from './common';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { eventTime } from '@/lib/event-plan';
import { useControlUpdates } from '@/lib/control-updates';

export function TeamPortal({ boot, refreshBoot }: { boot: any; refreshBoot: () => void }) {
  const [round, setRound] = useState(0),
    [response, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [lease, setLease] = useState(false),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(''),
    [tab, setTab] = useState('arena'),
    [offline, setOffline] = useState(false),
    [finish, setFinish] = useState(false);
  const activityQueue = useRef<{ p_round: number; p_kind: string; p_request: string }[]>([]);
  const flushingActivity = useRef(false);
  const edits = useRef<Record<string, Record<string, string>>>({});
  const requestVersion = useRef(0);
  const clockAnchor = useRef({ server: 0, local: 0 });
  const expiredRefresh = useRef('');
  const [serverNow, setServerNow] = useState(0);
  const data = response?._viewRound === round ? response : null;
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const d = await rpc('bh_team_state', { p_round: round || 1 });
      if (version !== requestVersion.current) return;
      setData({ ...d, _viewRound: round });
      setError('');
    } catch (e) {
      if (version === requestVersion.current) setError(message(e));
    }
  }, [round]);
  useControlUpdates(() => {
    refreshBoot();
    void refresh();
  });
  useEffect(() => {
    let alive = true;
    async function heartbeat() {
      try {
        const result = await rpc('bh_heartbeat');
        if (alive) {
          setLease(result.allowed);
          if (!result.allowed) setError(result.message);
        }
      } catch (e) {
        if (alive) {
          setError(message(e));
        }
      }
    }
    void heartbeat();
    const id = setInterval(heartbeat, 45000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  useEffect(() => {
    if (!lease) return;
    void refresh();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const loop = () => {
      timer = setTimeout(
        async () => {
          if (!document.hidden) await refresh();
          if (!stopped) loop();
        },
        18000 + Math.random() * 6000,
      );
    };
    loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [lease, refresh]);
  useEffect(() => {
    setActive('');
  }, [round]);
  useEffect(() => {
    const online = async () => {
      setOffline(false);
      try {
        const result = await rpc('bh_heartbeat');
        setLease(result.allowed);
        if (!result.allowed) setError(result.message);
        else await refresh();
      } catch (e) {
        setError(message(e));
      }
    };
    const off = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', off);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', off);
    };
  }, [refresh]);
  const session = data?.session;
  const current = data?.round;
  const online = data?.online || boot.online;
  const scheduled = Boolean(online?.enabled);
  const progression = scheduled || Boolean(boot.event?.self_progression || data?.self_progression);
  useEffect(() => {
    if (data?.server_time) {
      clockAnchor.current = {
        server: Date.parse(data.server_time),
        local: performance.now(),
      };
      setServerNow(clockAnchor.current.server);
    }
  }, [data?.server_time]);
  useEffect(() => {
    const id = setInterval(
      () =>
        setServerNow(clockAnchor.current.server + performance.now() - clockAnchor.current.local),
      500,
    );
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!progression || !data || round === 4) return;
    const next = data.active_round || 0;
    if (data.online_entered && next !== round) setRound(next);
  }, [progression, data?.active_round, data?.online_entered, round]);
  useEffect(() => {
    const key = String(round) + ':' + session?.ends_at;
    if (
      scheduled &&
      round &&
      session &&
      !session.completed_at &&
      serverNow >= Date.parse(session.ends_at) &&
      expiredRefresh.current !== key
    ) {
      expiredRefresh.current = key;
      void refresh();
    }
  }, [progression, round, session?.ends_at, session?.completed_at, serverNow, refresh]);
  useEffect(() => {
    if (!lease) return;
    const flush = async () => {
      if (flushingActivity.current) return;
      flushingActivity.current = true;
      try {
        while (activityQueue.current.length && navigator.onLine) {
          const entry = activityQueue.current[0];
          const result = await rpc('bh_activity', entry);
          activityQueue.current.shift();
          if (entry.p_kind === 'tab' && result.warning)
            toast.warning(
              `Tab switches recorded: ${result.tab_count}. Stay in the arena; organizers can review activity.`,
            );
        }
      } catch {
        /* Retry queued, idempotent telemetry while this page remains open. */
      } finally {
        flushingActivity.current = false;
      }
    };
    const emit = (kind: string) => {
      if (
        !round ||
        !session ||
        session.completed_at ||
        current?.status !== 'open' ||
        clockAnchor.current.server + performance.now() - clockAnchor.current.local >=
          Date.parse(session.ends_at)
      )
        return;
      if (activityQueue.current.length < 200)
        activityQueue.current.push({
          p_round: round,
          p_kind: kind,
          p_request: uuid(),
        });
      void flush();
    };
    const retry = setInterval(() => void flush(), 10000);
    window.addEventListener('online', flush);
    // Blur and visibilitychange can describe the same Alt+Tab; record it once.
    let away = false;
    const leave = () => {
      if (!away) {
        away = true;
        void emit('tab');
      }
    };
    const visibility = () => {
      if (document.hidden) leave();
      else if (document.hasFocus()) away = false;
    };
    const focus = () => {
      if (!document.hidden) away = false;
    };
    const fullscreen = () => {
      if (!document.fullscreenElement) void emit('fullscreen');
    };
    const paste = () => void emit('paste');
    window.addEventListener('blur', leave);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('fullscreenchange', fullscreen);
    document.addEventListener('paste', paste);
    return () => {
      clearInterval(retry);
      window.removeEventListener('online', flush);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('fullscreenchange', fullscreen);
      document.removeEventListener('paste', paste);
    };
  }, [round, lease, session?.started_at, session?.completed_at, current?.status]);
  async function start(id: number) {
    setBusy(true);
    setError('');
    try {
      await rpc('bh_start_round', { p_round: id });
      setRound(id);
      setTab('arena');
      if (round === id) await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function endRound() {
    setBusy(true);
    try {
      await rpc('bh_finish_round', { p_round: round });
      setFinish(false);
      await refresh();
      toast.success('Round completed. Your submissions are recorded.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!lease)
    return (
      <section className="panel padded">
        <ErrorBox error={error} />
        {!error && <Loading />}
        <p className="muted">
          Up to four devices can compete using the same team account. A disconnected device releases
          its place after two minutes; signing out releases it immediately.
        </p>
      </section>
    );
  const questions = data?.questions || [];
  const selected = questions.find((q: any) => q.id === active) || questions[0];
  const canEdit = Boolean(
    round &&
    session &&
    !session.completed_at &&
    current?.status === 'open' &&
    Date.parse(session.ends_at) > (serverNow || Date.parse(data.server_time)),
  );
  return (
    <>
      {offline && (
        <div role="alert" className="offline">
          You’re offline. Keep this page open. Unsaved input remains here; reconnect before the
          round ends to submit.
        </div>
      )}
      <ErrorBox error={error} />
      {round > 0 && (
        <div className="round-clock-bar" aria-label={`Round ${round} timer`}>
          <span className="round-clock-name">Round {round} · {current?.name || rounds[round - 1].name}</span>
          <Timer end={session?.ends_at} serverTime={data?.server_time} pausedAt={current?.paused_at} />
        </div>
      )}
      <div className="page-heading">
        <div>
          <span className="eyebrow accent">TEAM WORKSPACE / {boot.team.name.toUpperCase()}</span>
          <h1>{round ? current?.name || rounds[round - 1].name : 'Ready for the hunt?'}</h1>
          <p>
            {round
              ? 'Read carefully. Every submission is recorded against the server clock.'
              : 'Your team, your rounds, your next challenge.'}
          </p>
        </div>
        {!round && (
          <Chip tone={boot.team.status === 'approved' ? 'green' : 'orange'}>
            {boot.team.status === 'approved' ? 'Approved to compete' : boot.team.status}
          </Chip>
        )}
      </div>
      {scheduled && (
        <section className="notice" aria-label="Online competition schedule">
          <p>
            Online Rounds 1-3 open together. Each team has up to 80 minutes from entry; Round 1 is
            20 minutes, Round 2 is 30 minutes, and Round 3 is 30 minutes.
          </p>
          <p>
            Starts: {eventTime(online.starts_at, online.timezone)} | Entry closes:{' '}
            {eventTime(online.entry_closes_at, online.timezone)}
          </p>
          {data?.team_ends_at && (
            <p>
              Your competition deadline: {eventTime(data.team_ends_at, online.timezone)} | Focus
              changes recorded: {data.tab_count || 0}
            </p>
          )}
          {data?.team_ends_at && <Timer end={data.team_ends_at} serverTime={data?.server_time} />}
          <p>Round 4 is a 40-minute on-site final on {online.onsite_date || '22 October 2026'}. Only teams with published final qualification can enter.</p>
          <p>
            Move forward whenever you are ready. Previous rounds lock permanently; timers continue
            while offline.
          </p>
        </section>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="tab-strip">
          <TabsTrigger value="arena">{round ? 'Round workspace' : 'Competition lobby'}</TabsTrigger>
          <TabsTrigger value="clarifications">Clarifications</TabsTrigger>
          <TabsTrigger value="results">Results & certificates</TabsTrigger>
        </TabsList>
        <TabsContent value="arena">
          {!round ? (
            <>
              <div className="stats">
                <div className="stat">
                  <></>
                  <span>Competition format</span>
                  <strong>{scheduled ? '3 online rounds' : '4 rounds'}</strong>
                </div>
                <div className="stat">
                  <></>
                  <span>Total round time</span>
                  <strong>{scheduled ? '80 min per team' : '120 min'}</strong>
                </div>
                <div className="stat">
                  <></>
                  <span>Available points</span>
                  <strong>{scheduled ? '600 online' : '1,100'}</strong>
                </div>
                <div className="stat">
                  <></>
                  <span>{scheduled ? 'Progression' : 'Critical-fix bonus'}</span>
                  <strong>{scheduled ? 'One way' : '+30'}</strong>
                </div>
              </div>
              {boot.team.status !== 'approved' && (
                <div className="notice">
                  {boot.team.status === 'pending'
                    ? 'Your registration is waiting for organizer approval.'
                    : `Your team is ${boot.team.status}. Contact an organizer for details.`}
                  <button
                    className="btn small secondary"
                    style={{ marginLeft: 16 }}
                    onClick={refreshBoot}
                  >
                    Refresh approval
                  </button>
                </div>
              )}
              <div className="round-grid">
                {rounds
                  .filter(
                    (r) =>
                      !scheduled ||
                      r.id <= 3 ||
                      boot.rounds.find((x: any) => x.id === 4)?.status === 'open' || data?.qualifications?.some((q: any) => q.round_id === 4 && q.qualified),
                  )
                  .map((r) => {
                    const state = boot.rounds.find((x: any) => x.id === r.id);
                    const qualified =
                      (progression && r.id <= 3) ||
                      r.id === 1 ||
                      data?.qualifications?.some((q: any) => q.round_id === r.id && q.qualified);
                    const onlineRound = scheduled && r.id <= 3;
                    const teamRound = progression && r.id <= 3;
                    const entryAllowed =
                      onlineRound &&
                      serverNow >= Date.parse(online.starts_at) &&
                      serverNow < Date.parse(online.entry_closes_at);
                    const available =
                      boot.team.status === 'approved' &&
                      qualified &&
                      (teamRound
                        ? !data?.online_entered && r.id === 1 && (scheduled ? entryAllowed : state?.status === 'open')
                        : state?.status === 'open');
                    const label = onlineRound
                      ? data?.online_entered
                        ? 'Locked'
                        : serverNow < Date.parse(online.starts_at)
                          ? 'Scheduled'
                          : !entryAllowed
                            ? 'Entry closed'
                            : r.id === 1
                              ? 'Enter competition'
                              : 'Complete earlier round'
                      : teamRound
                        ? data?.online_entered ? 'Locked' : r.id > 1 ? 'Complete earlier round' : available ? 'Enter competition' : 'Waiting for start'
                        : available ? 'Enter round' : 'Qualification required';
                    return (
                      <article className={`round-card ${available ? 'available' : ''}`} key={r.id}>
                        <span className="round-index">0{r.id}</span>
                        <Chip tone={available ? 'green' : ''}>
                          {onlineRound ? label : qualified ? 'Eligible' : 'Locked'}
                        </Chip>
                        <h3>{r.name}</h3>
                        <p>{r.description}</p>
                        <div className="round-meta">
                          {r.duration} MIN · {r.points} PTS · {r.count.toUpperCase()}
                        </div>
                        <button
                          className={`btn ${available ? '' : 'secondary'}`}
                          disabled={!available || busy}
                          onClick={() => start(r.id)}
                        >
                          {available ? (
                            label
                          ) : (
                            <>
                              <></> {label}
                            </>
                          )}
                        </button>
                      </article>
                    );
                  })}
              </div>
              <div className="lobby-bottom">
                <section className="panel">
                  <div className="panel-heading">
                    <h3>
                      <></> Before you start
                    </h3>
                  </div>
                  <ol className="rules">
                    <li>
                      {scheduled
                        ? 'Enter during the scheduled 20-minute entry window. Your competition clock starts when you enter Round 1.'
                        : progression ? 'Enter through Round 1 when the competition opens. Move forward whenever you are ready; earlier answers will lock.' : 'Only start when the organizer opens your round. Your timer starts when you enter.'}
                    </li>
                    <li>
                      Round 1 answers lock after one submission. Rounds 2 and 3 allow three
                      attempts; the best counts.
                    </li>
                    <li>Drafts save while you write. A draft is not a submitted answer.</li>
                    <li>
                      Stay in this tab. Activity is logged, with warnings at 3 switches and a
                      10-point penalty at 5.
                    </li>
                    <li>
                      Scores remain hidden until the final. Use clarifications to ask organizers for
                      help.
                    </li>
                  </ol>
                </section>
                <Announcements items={data?.announcements} />
              </div>
            </>
          ) : (
            <>
              <div className="workspace-toolbar">
                <button
                  className="btn secondary small"
                  onClick={() => {
                    setRound(progression && round <= 3 ? round : 0);
                    refreshBoot();
                  }}
                >
                  <></> {progression && round <= 3 ? 'Refresh competition state' : 'Back to lobby'}
                </button>
                <div className="actions">
                  <button
                    className="btn secondary small"
                    onClick={() =>
                      document.documentElement
                        .requestFullscreen()
                        .catch(() => toast.error('Fullscreen is unavailable in this browser.'))
                    }
                  >
                    <></> Fullscreen
                  </button>
                  <button
                    className="btn secondary small"
                    disabled={busy || !session || Boolean(session.completed_at) || (round >= 3 && !canEdit)}
                    onClick={() => setFinish(true)}
                  >
                    <></>{' '}
                    {progression && round < 3
                      ? 'Move to next round'
                      : 'Finish round'}
                  </button>
                </div>
              </div>
              {current?.status === 'paused' && (
                <div className="notice">
                  The round is paused. Your remaining time is protected. Submissions resume when the
                  organizer reopens it.
                </div>
              )}
              {session?.completed_at && (
                <div className="notice">
                  Round finished. Your submitted answers are safely recorded.
                </div>
              )}
              {!questions.length ? (
                <Empty
                  title="Round unavailable"
                  text="The round may be closed. Check the lobby and organizer announcements."
                />
              ) : (
                <div className="workspace">
                  <aside className="panel question-nav" aria-label="Questions">
                    {questions.map((q: any, i: number) => (
                      <button
                        key={q.id}
                        className={selected?.id === q.id ? 'selected' : ''}
                        onClick={() => setActive(q.id)}
                      >
                        <span>{String(i + 1).padStart(2, '0')}</span>
                        <span>{q.title}</span>
                        {data.submissions.some((s: any) => s.question_id === q.id) && (
                          <span className="submitted-word">Submitted</span>
                        )}
                      </button>
                    ))}
                  </aside>
                  <section className="panel question-body">
                    {selected && (
                      <>
                        <div className="question-head">
                          <Chip tone="blue">{selected.language}</Chip>
                          <Chip>{selected.difficulty}</Chip>
                          <span className="muted mono">{selected.max_points} points</span>
                        </div>
                        <h2>{selected.title}</h2>
                        <pre className="question-prompt">
                          {selected.prompt}
                          {selected.code ? '\n\n' + selected.code : ''}
                        </pre>
                        {selected.kind === 'arena' ? (
                          <FinalClaims
                            data={data}
                            canEdit={canEdit}
                            refresh={refresh}
                            cache={edits.current}
                          />
                        ) : (
                          <QuestionEditor
                            key={selected.id}
                            question={selected}
                            draft={data.drafts.find((d: any) => d.question_id === selected.id)}
                            submissions={data.submissions.filter(
                              (s: any) => s.question_id === selected.id,
                            )}
                            canEdit={canEdit}
                            refresh={refresh}
                            cache={edits.current}
                          />
                        )}
                      </>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
        </TabsContent>
        <TabsContent value="clarifications">
          <Clarifications items={data?.clarifications || []} refresh={refresh} />
        </TabsContent>
        <TabsContent value="results">
          <Results certificates={data?.certificates || []} />
        </TabsContent>
      </Tabs>
      <Confirm
        open={finish}
        title={progression && round < 3 ? 'Lock this round and continue?' : 'Finish this round?'}
        text="Your submitted answers will count. Unsaved drafts will not be submitted, and finishing prevents further answers in this round."
        onCancel={() => setFinish(false)}
        onConfirm={endRound}
        busy={busy}
      />
    </>
  );
}

function QuestionEditor({ question: q, draft, submissions, canEdit, refresh, cache }: any) {
  const [answer, setAnswer] = useState<Record<string, string>>(
      () => cache[q.id] || draft?.answer || submissions.at(-1)?.answer || {},
    ),
    [save, setSave] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const revision = useRef(draft?.revision || 0),
    request = useRef(uuid()),
    dirty = useRef(false),
    saving = useRef(false),
    latest = useRef(answer),
    mounted = useRef(true);
  const attempts = submissions.length;
  const locked = !canEdit || attempts >= q.max_attempts;
  const saveDraft = useCallback(async () => {
    if (!dirty.current || saving.current || locked) return;
    saving.current = true;
    const snapshot = latest.current;
    try {
      if (mounted.current) setSave('Saving draft…');
      revision.current = await rpc('bh_save_draft', {
        p_question: q.id,
        p_answer: snapshot,
        p_revision: revision.current,
      });
      if (latest.current === snapshot) dirty.current = false;
      if (mounted.current) {
        setSave(dirty.current ? 'Unsaved changes' : 'Draft saved');
        if (dirty.current) setAnswer({ ...latest.current });
      }
    } catch (e) {
      if (mounted.current) {
        setSave('Draft not saved');
        setError(message(e));
      }
    } finally {
      saving.current = false;
    }
  }, [q.id, locked]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void saveDraft();
    };
  }, [saveDraft]);
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => void saveDraft(), 1800);
    return () => clearTimeout(timer);
  }, [answer, saveDraft]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  function change(key: string, value: string) {
    const next = { ...latest.current, [key]: value };
    cache[q.id] = next;
    latest.current = next;
    dirty.current = true;
    setAnswer(next);
    setSave('Unsaved changes');
  }
  async function submit() {
    if (locked || busy) return;
    setBusy(true);
    setError('');
    try {
      await rpc('bh_submit', {
        p_question: q.id,
        p_answer: latest.current,
        p_request: request.current,
      });
      dirty.current = false;
      request.current = uuid();
      setSave('Submission recorded');
      await refresh();
      toast.success('Submission recorded');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const words =
    q.kind === 'report' ? answer.report?.trim().split(/\s+/).filter(Boolean).length || 0 : 0;
  return (
    <div className="answer-section">
      <div className="workspace-toolbar">
        <h3>Your answer</h3>
        <span className="muted mono">
          {attempts}/{q.max_attempts} attempts used
        </span>
      </div>
      {q.fields.map((f: any) => (
        <label className="field" key={f.key}>
          {f.label}
          {f.multiline ? (
            <textarea
              className={f.code ? 'code-input' : ''}
              value={answer[f.key] || ''}
              disabled={locked || busy}
              maxLength={f.code ? 16000 : 8000}
              onChange={(e) => change(f.key, e.target.value)}
              spellCheck={!f.code}
              aria-label={f.label}
            />
          ) : (
            <input
              value={answer[f.key] || ''}
              disabled={locked || busy}
              maxLength={2000}
              onChange={(e) => change(f.key, e.target.value)}
              autoComplete="off"
            />
          )}
        </label>
      ))}
      {q.kind === 'report' && (
        <p className={words > 150 ? 'error-box' : 'muted'}>{words}/150 words</p>
      )}
      <ErrorBox error={error} />
      <div className="workspace-toolbar">
        <span className="save-state" role="status">
          <></>
          {save || 'Drafts save after you pause typing'}
        </span>
        <button
          className="btn"
          disabled={
            locked ||
            busy ||
            (q.kind === 'report' && words > 150) ||
            q.fields.some((f: any) => !answer[f.key]?.trim())
          }
          onClick={submit}
        >
          <></>
          {busy ? 'Submitting…' : attempts >= q.max_attempts ? 'Answer locked' : 'Submit answer'}
        </button>
      </div>
      {attempts > 0 && (
        <p className="review-note">
          Submission recorded. Solutions and scores stay hidden during the competition.
        </p>
      )}
    </div>
  );
}
function FinalClaims({ data, canEdit, refresh, cache }: any) {
  const draft = data.drafts.find((d: any) => d.question_id === 'R4-ARENA');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [answer, setAnswer] = useState<Record<string, string>>(
      cache['R4-ARENA'] || draft?.answer || {},
    ),
    [saved, setSaved] = useState('');
  const revision = useRef(draft?.revision || 0),
    request = useRef(uuid()),
    dirty = useRef(false),
    saving = useRef(false),
    latest = useRef(answer);
  const verified = data.claims.filter((c: any) => c.state === 'verified').length;
  async function save() {
    if (!dirty.current || saving.current || !canEdit) return;
    saving.current = true;
    const snapshot = latest.current;
    try {
      setSaved('Saving claim draft…');
      revision.current = await rpc('bh_save_draft', {
        p_question: 'R4-ARENA',
        p_answer: snapshot,
        p_revision: revision.current,
      });
      if (latest.current === snapshot) dirty.current = false;
      else setAnswer({ ...latest.current });
      setSaved(dirty.current ? 'Unsaved changes' : 'Claim draft saved');
    } catch (e) {
      setSaved('Draft not saved');
      setError(message(e));
    } finally {
      saving.current = false;
    }
  }
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => void save(), 1800);
    return () => clearTimeout(timer);
  }, [answer, canEdit]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  function change(key: string, value: string) {
    latest.current = { ...latest.current, [key]: value };
    cache['R4-ARENA'] = latest.current;
    dirty.current = true;
    setAnswer(latest.current);
    setSaved('Unsaved changes');
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await rpc('bh_claim', {
        p_location: answer.location,
        p_cause: answer.cause,
        p_impact: answer.impact,
        p_fix: answer.fix,
        p_request: request.current,
      });
      request.current = uuid();
      latest.current = {};
      cache['R4-ARENA'] = {};
      dirty.current = true;
      setAnswer({});
      await refresh();
      toast.success('Bug claim submitted for verification');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="health">
        <label>
          <span>MediBook recovery · verified fixes</span>
          <strong>{verified}/12</strong>
        </label>
        <Progress value={(verified / 12) * 100} />
      </div>
      <h3>Report a bug</h3>
      <p className="muted">
        Identify the location, cause, impact, and proposed fix. The third incorrect claim and each
        one after it costs 5 points.
      </p>
      <form onSubmit={submit}>
        {[
          ['location', 'File and function', 200],
          ['cause', 'What is wrong?', 4000],
          ['impact', 'Why does it matter?', 4000],
          ['fix', 'Your fix', 12000],
        ].map(([key, label, max]) => (
          <label className="field" key={key}>
            {label}
            {key === 'location' ? (
              <input
                value={answer[String(key)] || ''}
                onChange={(e) => change(String(key), e.target.value)}
                maxLength={Number(max)}
                required
                disabled={!canEdit || busy}
              />
            ) : (
              <textarea
                className={key === 'fix' ? 'code-input' : ''}
                value={answer[String(key)] || ''}
                onChange={(e) => change(String(key), e.target.value)}
                maxLength={Number(max)}
                required
                disabled={!canEdit || busy}
                spellCheck={key !== 'fix'}
              />
            )}
          </label>
        ))}
        <ErrorBox error={error} />
        <div className="workspace-toolbar">
          <span className="save-state" role="status">
            {saved || 'Claim drafts save after you pause typing'}
          </span>
          <button className="btn" disabled={!canEdit || busy}>
            {busy ? 'Recording…' : 'Submit bug claim'}
          </button>
        </div>
      </form>
      <h3 style={{ marginTop: 30 }}>Your claims</h3>
      {data.claims.map((c: any) => (
        <article className="claim-row" key={c.id}>
          <header>
            <strong>{c.location}</strong>
            <Chip tone={c.state === 'verified' ? 'green' : c.state === 'rejected' ? 'red' : ''}>
              {c.state}
            </Chip>
          </header>
          <p className="muted">{c.cause}</p>
        </article>
      ))}
    </div>
  );
}
function Clarifications({ items, refresh }: any) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    try {
      await rpc('bh_ask', { p_question: new FormData(form).get('question') });
      form.reset();
      await refresh();
      toast.success('Question sent to organizers');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="two-col">
      <section className="panel padded">
        <h2>Ask an organizer</h2>
        <p className="muted">
          Include the round and question number. Organizers can clarify wording, rules, and
          technical issues.
        </p>
        <form onSubmit={ask}>
          <label className="field">
            Your question
            <textarea name="question" maxLength={2000} required />
          </label>
          <ErrorBox error={error} />
          <button className="btn" disabled={busy}>
            Send clarification
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h3>Your conversation</h3>
        </div>
        {items.length ? (
          items.map((c: any) => (
            <div className="announcement" key={c.id}>
              <p>{c.question}</p>
              {c.answer ? <div className="notice">{c.answer}</div> : <Chip>Awaiting reply</Chip>}
            </div>
          ))
        ) : (
          <Empty title="No questions yet" text="Your private replies will appear here." />
        )}
      </section>
    </div>
  );
}
function Results({ certificates }: any) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    rpc('bh_my_results')
      .then(setData)
      .catch((e) => setError(message(e)));
  }, []);
  return (
    <section className="panel padded">
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : !data.released ? (
        <Empty
          title="Results are not published yet"
          text="Qualification appears in the lobby. Your score breakdown will be available after final judging."
        />
      ) : (
        <>
          <h2>Your competition results</h2>
          <div className="stats">
            <div className="stat">
              <span>Total score</span>
              <strong>{data.team.score}</strong>
            </div>
            <div className="stat">
              <span>Challenges solved</span>
              <strong>{data.team.solved}</strong>
            </div>
            <div className="stat">
              <span>Penalties</span>
              <strong>{data.team.penalties}</strong>
            </div>
          </div>
          {data.scores.map((s: any) => (
            <p key={s.question_id} className="mono">
              {s.question_id}: {s.score} points
            </p>
          ))}
          <h3>Certificates</h3>
          <div className="actions">
            {certificates.map((c: any) => (
              <a
                className="btn secondary"
                key={c.id}
                href={`/?certificate=${c.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {c.award} certificate
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
