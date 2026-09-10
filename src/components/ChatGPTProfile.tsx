import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, UserRound } from 'lucide-react';
import type { ChatGPTAccount, CloudSettings } from '../../shared/types';
import Modal from './Modal';
import { useOfficeEnvironment } from '../lib/office-environment';
import './chatgpt-profile.css';

export default function ChatGPTProfile({
  cloud,
  onCloud,
  onClose,
}: {
  cloud: CloudSettings;
  onCloud: (cloud: CloudSettings) => void;
  onClose: () => void;
}) {
  const { api } = useOfficeEnvironment();
  const [account, setAccount] = useState<ChatGPTAccount | undefined>(cloud.account);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fallbackKey, setFallbackKey] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const request = useRef(0);
  const reading = useRef(false);
  const changing = useRef(false);
  const onCloudRef = useRef(onCloud);
  onCloudRef.current = onCloud;

  const refresh = useCallback(async () => {
    if (!mounted.current || reading.current || changing.current) return;
    if (!api) {
      setChecking(false);
      setError('Open Astra HQ on your desktop to sign in with ChatGPT.');
      return;
    }
    reading.current = true;
    const token = ++request.current;
    try {
      const next = await api.chatGPTAccount();
      const settings = await api.getCloudSettings();
      if (!mounted.current || token !== request.current) return;
      setAccount(settings.account ?? next);
      onCloudRef.current(settings);
      setError('');
    } catch (e) {
      if (mounted.current && token === request.current)
        setError(e instanceof Error ? e.message : 'Could not check your account. Please try again.');
    } finally {
      if (mounted.current && token === request.current) {
        reading.current = false;
        setChecking(false);
      }
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focused = () => void refresh();
    window.addEventListener('focus', focused);
    return () => {
      mounted.current = false;
      request.current++;
      reading.current = false;
      window.removeEventListener('focus', focused);
    };
  }, [refresh]);

  useEffect(() => {
    if (account?.status !== 'signing-in') return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [account?.status, refresh]);

  async function change(action: 'login' | 'cancel' | 'use') {
    if (!api || changing.current) return;
    changing.current = true;
    reading.current = false;
    const token = ++request.current;
    setBusy(true);
    setError('');
    let changed = false;
    try {
      if (action === 'use') {
        const settings = await api.useChatGPT();
        if (!mounted.current || token !== request.current) return;
        setAccount(settings.account);
        onCloudRef.current(settings);
      } else {
        const next = await (action === 'login' ? api.loginChatGPT() : api.cancelChatGPTLogin());
        if (!mounted.current || token !== request.current) return;
        setAccount(next);
      }
      changed = true;
    } catch (e) {
      if (mounted.current && token === request.current)
        setError(e instanceof Error ? e.message : 'Could not update your account. Please try again.');
    } finally {
      if (mounted.current && token === request.current) {
        changing.current = false;
        setBusy(false);
        setChecking(false);
        if (changed) void refresh();
      }
    }
  }

  const signedIn = account?.status === 'signed-in';
  const signingIn = account?.status === 'signing-in';
  const connected = signedIn && cloud.provider === 'chatgpt';
  const plan = account?.plan?.trim();
  const planLabel = plan ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan` : 'ChatGPT plan';
  const issue = error || account?.error;

  async function saveFallback(key: string) {
    if (!api || busy) return;
    setBusy(true);
    setError('');
    try {
      const settings = await api.configureChatGPTFallback({ key });
      onCloudRef.current(settings);
      setFallbackKey('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the API fallback key.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="ChatGPT account" onClose={onClose}>
      <div className="chatgpt-profile">
        <div className="chatgpt-profile-account">
          <span className="chatgpt-profile-avatar" aria-hidden="true">
            <UserRound size={23} strokeWidth={1.6} />
          </span>
          <div>
            <strong>{signedIn ? account.email || 'Your ChatGPT account' : 'Your ChatGPT plan'}</strong>
            <span>{signedIn ? planLabel : 'Sign in to put your employees to work.'}</span>
          </div>
        </div>
        <p className="chatgpt-profile-status" role="status" aria-live="polite">
          {checking || busy ? (
            <>
              <LoaderCircle size={15} className="chatgpt-profile-spinner" aria-hidden="true" />
              {checking ? 'Checking your account…' : 'Saving securely…'}
            </>
          ) : connected ? (
            <>
              <Check size={15} aria-hidden="true" />
              Employees are using your ChatGPT plan.
            </>
          ) : signingIn ? (
            <>Finish signing in in your browser. This window updates automatically.</>
          ) : signedIn ? (
            <>Signed in. Choose this plan for employee work.</>
          ) : (
            <>Employee work uses the Codex allowance in your ChatGPT plan.</>
          )}
        </p>
        {issue && (
          <p className="form-error" role="alert">
            {issue}
          </p>
        )}
        <div className="chatgpt-profile-fallback">
          <label htmlFor="chatgpt-fallback-key">API credit fallback key</label>
          <input
            id="chatgpt-fallback-key"
            type="password"
            autoComplete="new-password"
            value={fallbackKey}
            onChange={(event) => setFallbackKey(event.target.value)}
            placeholder={cloud.fallbackConfigured ? 'A fallback key is saved securely' : 'sk-…'}
          />
          <p>
            Used only if your ChatGPT plan reports that it is out of credits. It is encrypted on this Mac and
            never added to workspace history or exports.
          </p>
          <div className="button-group">
            <button
              className="button secondary"
              disabled={busy || !api || !fallbackKey.trim()}
              onClick={() => void saveFallback(fallbackKey.trim())}
            >
              Save fallback key
            </button>
            {cloud.fallbackConfigured && (
              <button className="text-button" disabled={busy} onClick={() => void saveFallback('')}>
                Remove saved key
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="modal-footer chatgpt-profile-footer">
        {signingIn ? (
          <button className="button secondary" disabled={busy} onClick={() => void change('cancel')}>
            Cancel sign-in
          </button>
        ) : !connected ? (
          <button
            className="button primary"
            disabled={busy || checking || !api}
            onClick={() => void change(signedIn ? 'use' : 'login')}
          >
            {!signedIn && <ExternalLink size={15} aria-hidden="true" />}
            {signedIn ? 'Use ChatGPT plan' : 'Sign in with ChatGPT'}
          </button>
        ) : null}
        {issue && api && (
          <button className="text-button" disabled={busy} onClick={() => void refresh()}>
            Try again
          </button>
        )}
        <button className={`button ${connected ? 'primary' : 'secondary'}`} onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
