'use client';

import { Check, Copy, Eye, LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { webApi } from '@/lib/ui-api';

type Relay = { url: string; secret: string };

function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'blocked'>('idle');
  return (
    <label>
      {label}
      <span className="copy-field">
        <input readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
        <button
          type="button"
          className="icon-button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setState('copied');
              window.setTimeout(() => setState('idle'), 1500);
            } catch {
              setState('blocked');
            }
          }}
        >
          {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </span>
      {state === 'blocked' && (
        <small className="field-hint">Copying is blocked. Select the field instead.</small>
      )}
    </label>
  );
}

/** Owner-only relay credentials for providers that have no native inbox delivery. */
export function RelaySecret({ connectionId }: { connectionId: string }) {
  const [relay, setRelay] = useState<Relay | null>(null);
  const [busy, setBusy] = useState<'reveal' | 'rotate' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(method: 'GET' | 'POST') {
    setBusy(method === 'GET' ? 'reveal' : 'rotate');
    setError(null);
    try {
      const response = await fetch(webApi.relaySecret(connectionId), { method });
      const body = (await response.json()) as Partial<Relay> & { error?: string };
      if (!response.ok || !body.url || !body.secret)
        throw new Error(body.error || 'Could not read the relay secret.');
      setRelay({ url: body.url, secret: body.secret });
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the relay secret.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relay-secret">
      <div className="permission-heading">
        <span className="eyebrow">INBOX RELAY</span>
        <h3>Relay secret</h3>
        <p>
          This provider sends no events on its own. Post them to the relay URL and sign each request with this
          secret. Only you can see it.
        </p>
      </div>
      {relay ? (
        <>
          <CopyField label="Relay URL" value={relay.url} />
          <CopyField label="Secret" value={relay.secret} />
        </>
      ) : (
        <button
          type="button"
          className="secondary-button"
          disabled={busy !== null}
          onClick={() => load('GET')}
        >
          {busy === 'reveal' ? <LoaderCircle className="spin" size={15} /> : <Eye size={15} />}
          Reveal
        </button>
      )}
      {confirming ? (
        <div className="relay-confirm">
          <p>Rotating replaces the secret. Anything still signing with the old one stops delivering.</p>
          <div>
            <button
              type="button"
              className="secondary-button"
              disabled={busy !== null}
              onClick={() => setConfirming(false)}
            >
              Keep current secret
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy !== null}
              onClick={() => load('POST')}
            >
              {busy === 'rotate' && <LoaderCircle className="spin" size={15} />}
              Rotate now
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="text-button" onClick={() => setConfirming(true)}>
          <RefreshCw size={13} />
          Rotate secret
        </button>
      )}
      {error && <p className="field-hint">{error}</p>}
    </div>
  );
}
