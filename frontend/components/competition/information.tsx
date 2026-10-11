'use client';
import { useState } from 'react';

export function Walkthrough() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const steps = [
    {
      title: 'Create your account',
      text: 'Use the team leader’s email, confirm the address, and register two to four members. An organizer approves the team before competition access.',
    },
    {
      title: 'Enter an official round',
      text: 'The lobby shows your eligible rounds. During an open round, read the question, write your response, and review it before confirming a submission. Drafts save while you work.',
    },
    {
      title: 'Follow the event',
      text: 'Mission Control shows the real event status and organizer announcements. Standings appear when the organizer releases them.',
    },
  ];
  return (
    <section className="walkthrough">
      <button className="text-control" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Close walkthrough' : 'Explore the platform'}
      </button>
      {open && (
        <div className="walkthrough-body">
          <nav className="actions" aria-label="Platform walkthrough steps">
            {steps.map((s, i) => (
              <button
                key={s.title}
                className="text-control"
                aria-current={step === i ? 'step' : undefined}
                onClick={() => setStep(i)}
              >
                {String(i + 1).padStart(2, '0')} {s.title}
              </button>
            ))}
          </nav>
          <h3>{steps[step].title}</h3>
          <p>{steps[step].text}</p>
          {step === 0 && (
            <button
              className="btn secondary small"
              onClick={() => {
                const input = document.querySelector<HTMLInputElement>('input[name="email"]');
                input?.focus();
                input?.scrollIntoView({ block: 'center' });
              }}
            >
              Go to account form
            </button>
          )}
          {step === 1 && (
            <a className="btn secondary small" href="#official-rounds">
              View the four rounds
            </a>
          )}
          {step === 2 && (
            <a className="btn secondary small" href="/#mission">
              Open live Mission Control
            </a>
          )}
        </div>
      )}
    </section>
  );
}

export function LegalScreen({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <article className="information-page">
      <span className="eyebrow">BUG HUNT 2026 / PLATFORM INFORMATION</span>
      <h1>{kind === 'privacy' ? 'Privacy notice' : 'Terms of use'}</h1>
      <p className="muted">Published 9 October 2026. Applies to this competition platform.</p>
      {kind === 'privacy' ? (
        <>
          <h2>Information collected</h2>
          <p>
            Registration collects the leader’s email, team name, member names, optional registration
            numbers, university, department, and newcomer status. The platform stores submitted
            answers, saved drafts, clarifications, review decisions, scores, and certificates.
          </p>
          <h2>Purpose and access</h2>
          <p>
            The event organizer uses these records to register teams, run the competition, judge
            submissions, respond to questions, and issue results. Authorized organizers and judges
            can access information needed for their roles. Teams can access their own competition
            records.
          </p>
          <h2>Competition activity</h2>
          <p>
            During an active round, the platform records tab changes, fullscreen exits, and paste
            events for organizer review. It also tracks active competition sessions. These signals
            support the published event rules; they do not record the contents of other tabs.
          </p>
          <h2>Published information</h2>
          <p>
            Released standings can show team names and scores. Certificate verification links show
            the team name, event name, award, issue date, and certificate identifier. Share
            verification links with that visibility in mind.
          </p>
          <h2>Services and browser storage</h2>
          <p>
            Supabase provides authentication and database services; Sites hosts the website.
            Authentication sessions use encrypted HttpOnly cookies to retain sign-in. Sign out
            when using a shared device. The application does not include advertising or marketing
            analytics.
          </p>
          <h2>Retention and requests</h2>
          <p>
            The organizer manages retention of event records. A fixed deletion schedule has not been
            published. Contact your event organizer for access, correction, deletion, or retention
            questions. Signed-in teams can use Clarifications to contact competition staff. Avoid
            including unrelated sensitive personal information in answers or messages.
          </p>
        </>
      ) : (
        <>
          <h2>Participation</h2>
          <p>
            Register accurate team information and use an email address you control. Teams contain
            two to four members and require organizer approval. Keep your password private and sign
            out of shared devices.
          </p>
          <h2>Competition rules</h2>
          <p>
            The four official rounds use written responses and code review. Eligibility, timing,
            attempts, scoring, and qualification follow the event rules shown in the platform.
            Confirm a submission after reviewing it; the applicable attempt limits and round
            deadline determine whether further submissions are available.
          </p>
          <h2>Fair conduct</h2>
          <p>
            Use the permitted competition session and follow organizer instructions. Submit your
            team’s work, respect other participants, and use the platform’s clarification channel
            for questions. Organizers can review recorded competition activity and apply event-rule
            penalties.
          </p>
          <h2>Judging and questions</h2>
          <p>
            Authorized staff review submissions against the published rubrics. Contact the organizer
            through Clarifications to raise a scoring or participation question. Released results
            and issued certificates reflect the organizer’s recorded decisions.
          </p>
          <h2>Submitted material</h2>
          <p>
            Submit material you have permission to share. The organizer uses answers and messages to
            administer and judge the event. Personal registration details and competition records
            are handled as described in the privacy notice.
          </p>
          <h2>Connectivity</h2>
          <p>
            Allow time to submit before a deadline. Check the displayed save and submission status
            when a connection is interrupted. Contact staff promptly about an access or timing
            problem; organizers can record event adjustments.
          </p>
        </>
      )}
      <div className="actions">
        <a className="btn secondary" href="/">
          Return to the platform
        </a>
        <a className="text-control" href={kind === 'privacy' ? '/?legal=terms' : '/?legal=privacy'}>
          {kind === 'privacy' ? 'Terms of use' : 'Privacy notice'}
        </a>
      </div>
    </article>
  );
}
