'use client';

import { Check, Copy, Minus } from 'lucide-react';
import { useCopy } from '../shared/use-copy';
import { useUiQuery } from '../shared/use-ui-query';
import { uiApi } from '@/lib/ui-api';

/**
 * How alerts reach this workspace: the signed endpoint any prober can post to, the GitHub rules that
 * turn a delivery into an incident, and whether mail is being classified. The signing secret is
 * never shown — it is written once through the admin route and only ever stored sealed.
 */
export function TriageIntake() {
  const intake = useUiQuery(uiApi.triageIntake, {});
  const { state, copy } = useCopy();

  if (intake === undefined) return <p className="muted-note">Loading intake…</p>;

  return (
    <div className="triage-intake">
      <section className="card intake-card">
        <div className="section-title">
          <div>
            <span className="eyebrow">SIGNED ENDPOINT</span>
            <h3>Uptime, error trackers, cloud health</h3>
          </div>
          <Ready on={intake.signedEndpointReady} yes="Secret set" no="No secret yet" />
        </div>
        <p>
          Post a normalized alert here. Sign the timestamp and the exact body so a replayed body does not
          verify.
        </p>
        <div className="intake-endpoint">
          <code>POST /api/alerts</code>
          <button
            className="secondary-button compact"
            onClick={() => copy(`${window.location.origin}/api/alerts`)}
          >
            {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
            {state === 'copied' ? 'Copied' : state === 'blocked' ? 'Copy blocked' : 'Copy'}
          </button>
        </div>
        <dl className="intake-headers">
          <dt>x-astra-workspace</dt>
          <dd>This workspace&rsquo;s id</dd>
          <dt>x-astra-timestamp</dt>
          <dd>Milliseconds since the epoch, no more than five minutes old</dd>
          <dt>x-astra-signature</dt>
          <dd>
            <code>
              HMAC-SHA256(secret, `${'${timestamp}'}.${'${body}'}`)
            </code>{' '}
            in lowercase hex
          </dd>
        </dl>
        <p className="muted-note">
          The signing secret is set once by a platform administrator and is never read back. Rotating it
          replaces it.
        </p>
      </section>

      <section className="card intake-card">
        <div className="section-title">
          <div>
            <span className="eyebrow">GITHUB</span>
            <h3>Issues and comments by rule</h3>
          </div>
          <Ready on={intake.github.length > 0} yes="Connected" no="Not connected" />
        </div>
        <p>
          Connect GitHub on the Integrations page and choose the repositories to watch. A delivery becomes an
          incident when a label or any word in it matches one of the triage rules below.
        </p>
        {intake.github.length > 0 && (
          <ul className="intake-repos">
            {intake.github.map((repository) => (
              <li key={repository}>{repository}</li>
            ))}
          </ul>
        )}
        <div className="intake-rules">
          {intake.rules.length ? (
            intake.rules.map((rule) => (
              <span key={rule} className="rule-pill">
                {rule}
              </span>
            ))
          ) : (
            <p className="muted-note">No triage rules yet, so no GitHub delivery becomes an incident.</p>
          )}
        </div>
        <p className="muted-note">Triage rules and the two allow-lists live in Settings, under Policies.</p>
      </section>

      <section className="card intake-card">
        <div className="section-title">
          <div>
            <span className="eyebrow">GMAIL</span>
            <h3>Classified once an hour</h3>
          </div>
          <Ready on={intake.emailClassification} yes="On" no="Off" />
        </div>
        <p>
          {intake.emailClassification
            ? 'New mail on the connected Google Workspace mailboxes runs through a classifier turn; anything it reads as an incident opens an alert.'
            : 'Connect Google Workspace and choose the mailboxes to watch on the Integrations page. Classification follows the mailboxes.'}
        </p>
      </section>
    </div>
  );
}

function Ready({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return (
    <span className="intake-state" data-on={on}>
      {on ? <Check size={13} /> : <Minus size={13} />} {on ? yes : no}
    </span>
  );
}
