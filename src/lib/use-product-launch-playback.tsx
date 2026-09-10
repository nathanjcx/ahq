import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { TOUR_DURATION, TOUR_GOAL, tourFrame, tourTyping, tourTime } from '../components/demo-tour-model';

type Controls = {
  enabled: boolean;
  surface: RefObject<HTMLDivElement | null>;
  sync: (milliseconds: number) => void;
  notify: (message: string) => void;
  closeDialogs: () => void;
  stop: () => void;
};
// These are the same buttons, forms, and dialogs used by the live workspace.
const actions = (
  [
    [350, 'nav-employees'],
    [1000, 'employee-new'],
    [4300, 'employee-personality'],
    [5200, 'employee-create'],
    [6000, 'nav-office'],
    [6500, 'goal-open'],
    [11500, 'goal-save'],
    [16000, 'nav-office'],
    [22100, 'review-email'],
    [25700, 'review-approve'],
    [27100, 'nav-files'],
    [27600, 'file-meeting'],
    [30500, 'file-preview-close'],
    [30800, 'nav-office'],
    [32100, 'review-pr'],
    [35700, 'review-approve'],
    [37100, 'nav-files'],
    [37600, 'file-profits'],
    [40500, 'file-preview-close'],
    [41300, 'file-slogan'],
    [44500, 'file-preview-close'],
    [45400, 'file-photo'],
    [51000, 'photo-handoff'],
    [51600, 'file-preview-close'],
    [52400, 'file-app'],
    [54800, 'file-preview-close'],
    [55300, 'review-campaign'],
    [57700, 'review-approve'],
    [58400, 'nav-office'],
  ] as const
).map(([at, target]) => [tourTime(Number(at)), String(target)] as const);
const typing = [
  { target: 'employee-name', text: 'Morgan', from: 1350, to: 2250 },
  { target: 'employee-role', text: 'Marketing Intern', from: 2450, to: 3850 },
  { target: 'goal-input', text: TOUR_GOAL, from: 7300, to: 10700 },
].map((step) => ({ ...step, from: tourTime(step.from), to: tourTime(step.to) }));
const swipePlan = [
  { from: 46700, to: 47200, direction: -1 },
  { from: 48000, to: 48500, direction: -1 },
  { from: 49300, to: 49800, direction: 1 },
].map((step) => ({ ...step, from: tourTime(step.from), to: tourTime(step.to) }));

export function useProductLaunchPlayback(controls: Controls) {
  const current = useRef(controls);
  current.current = controls;
  const [elapsed, setElapsed] = useState(0);
  const [cursor, setCursor] = useState({ x: 0, y: 0, clicking: false, visible: false });
  const running = controls.enabled && elapsed < TOUR_DURATION;
  useEffect(() => {
    if (!controls.enabled) return;
    let raf = 0;
    let lastPaint = -100;
    let nextAction = 0;
    let snapshotKey = '';
    let lastTarget = '';
    let clickedAt = -1000;
    const notices = new Set<number>();
    const swipes = swipePlan.map((step) => ({ ...step, started: false, finished: false }));
    const start = performance.now();
    const find = (name: string) => {
      const items = current.current.surface.current?.querySelectorAll<HTMLElement>(
        `[data-demo-target="${name}"]`,
      );
      return [...(items ?? [])].find(
        (element) => element.getClientRects().length && !element.hasAttribute('disabled'),
      );
    };
    const move = (name: string, click = false) => {
      const element = find(name);
      if (!element) return false;
      if (lastTarget !== name) {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        lastTarget = name;
      }
      const bounds = element.getBoundingClientRect();
      setCursor({
        x: bounds.left + Math.min(bounds.width * 0.55, 150),
        y: bounds.top + bounds.height * 0.55,
        clicking: click,
        visible: true,
      });
      if (click) {
        element.click();
        clickedAt = performance.now();
      }
      return true;
    };
    const announce = (storyAt: number, message: string, next: number) => {
      const at = tourTime(storyAt);
      if (next >= at && !notices.has(at)) {
        notices.add(at);
        current.current.notify(message);
      }
    };
    const tick = (now: number) => {
      const next = Math.max(0, Math.min(TOUR_DURATION, now - start));
      if (next - lastPaint >= 40 || next === TOUR_DURATION) {
        lastPaint = next;
        setElapsed(next);
        const frame = tourFrame(next);
        const key = [
          frame.phase.id,
          frame.internHired,
          frame.roadmapReady,
          Math.floor(next / 100),
          frame.emailApproved,
          frame.prApproved,
          frame.campaignApproved,
          frame.files.length,
        ].join(':');
        if (key !== snapshotKey || (next >= tourTime(19600) && next < tourTime(24000))) {
          snapshotKey = key;
          current.current.sync(next);
        }
        announce(16000, 'Four teammates are working on the Astra HQ Product Launch.', next);
        announce(
          19000,
          'Sample email from Thrive Capital: “We would love to meet.” Avery is drafting a reply and arranging the meeting.',
          next,
        );
        announce(
          31000,
          'New sample bug: an empty roadmap shows NaN%. Alex has prepared a pull request.',
          next,
        );
        announce(
          55000,
          'Morgan has the campaign ready. Review the forecast, slogan, and marketing photo.',
          next,
        );
        announce(
          60000,
          'Launch ready. Meeting scheduled, campaign selected, and landing page prepared. Reset to watch it again.',
          next,
        );
        announce(27000, 'Avery created the Thrive Capital meeting in the sample calendar.', next);
        announce(
          52000,
          'Morgan handed the selected image to Alex. The Astra HQ landing page is ready.',
          next,
        );
        for (const swipe of swipes) {
          if (swipe.finished || next < swipe.from) continue;
          const viewport = find('photo-swipe');
          if (!viewport) {
            if (next > swipe.to + 500) swipe.finished = true;
            continue;
          }
          const bounds = viewport.getBoundingClientRect();
          const fromX = bounds.left + bounds.width * (swipe.direction < 0 ? 0.78 : 0.22);
          const toX = bounds.left + bounds.width * (swipe.direction < 0 ? 0.22 : 0.78);
          const clientY = bounds.top + bounds.height * 0.52;
          const progress = Math.min(1, (next - swipe.from) / (swipe.to - swipe.from));
          const clientX = fromX + (toX - fromX) * progress;
          const dispatch = (type: string, x: number) =>
            viewport.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                pointerId: 4242,
                pointerType: 'mouse',
                isPrimary: true,
                clientX: x,
                clientY,
                button: 0,
                buttons: type === 'pointerup' ? 0 : 1,
              }),
            );
          if (!swipe.started) {
            dispatch('pointerdown', fromX);
            swipe.started = true;
          }
          dispatch('pointermove', clientX);
          setCursor({ x: clientX, y: clientY, clicking: true, visible: true });
          if (progress >= 1) {
            dispatch('pointerup', clientX);
            swipe.finished = true;
          }
        }
        const activeTyping = typing.find((item) => next >= item.from && next <= item.to + 160);
        if (activeTyping) {
          const element = find(activeTyping.target);
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const text = tourTyping(activeTyping.text, next, activeTyping.from, activeTyping.to);
            if (element.value !== text) {
              const prototype =
                element instanceof HTMLTextAreaElement
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
              Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, text);
              element.dispatchEvent(
                new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
              );
            }
            move(activeTyping.target);
          }
        } else if (nextAction < actions.length) {
          const [at, target] = actions[nextAction];
          if (next >= at - 330) move(target);
        }
        while (nextAction < actions.length && next >= actions[nextAction][0]) {
          const [at, target] = actions[nextAction];
          if (move(target, true) || next > at + 500) nextAction += 1;
          else break;
        }
        if (now - clickedAt > 280)
          setCursor((value) => (value.clicking ? { ...value, clicking: false } : value));
        if (next === TOUR_DURATION) {
          current.current.closeDialogs();
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          setCursor((value) => ({ ...value, visible: false }));
        }
      }
      if (next < TOUR_DURATION) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const preventInterference = (event: Event) => {
      if (event.isTrusted && event instanceof KeyboardEvent && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        current.current.stop();
        return;
      }
      if (
        !event.isTrusted ||
        (event.target instanceof Element && event.target.closest('[data-demo-control]'))
      )
        return;
      if (performance.now() - start >= TOUR_DURATION) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of ['click', 'pointerdown', 'keydown'])
      document.addEventListener(type, preventInterference, true);
    return () => {
      cancelAnimationFrame(raf);
      for (const type of ['click', 'pointerdown', 'keydown'])
        document.removeEventListener(type, preventInterference, true);
    };
  }, [controls.enabled]);
  return { elapsed, running, cursor };
}

export function ProductLaunchCursor({ playback }: { playback: ReturnType<typeof useProductLaunchPlayback> }) {
  if (!playback.running || !playback.cursor.visible) return null;
  return (
    <div
      className={`product-launch-cursor ${playback.cursor.clicking ? 'clicking' : ''}`}
      aria-hidden="true"
      style={{ left: playback.cursor.x, top: playback.cursor.y }}
    >
      <svg width="27" height="32" viewBox="0 0 26 31">
        <path
          d="M3 2L4 25L10 19L15 29L20 26L15 17L23 16Z"
          fill="#294833"
          stroke="#fffef6"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span>You</span>
      <i />
    </div>
  );
}
