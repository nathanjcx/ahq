'use client';

import { useEffect, useRef, useState } from 'react';
import type { EmployeeActivity } from './activity';

/** The three things worth hearing, and the pad underneath them. */
export type SoundCue = 'proposal' | 'completed' | 'failed';

const SOUND_KEY = 'ahq.sound';

type Voice = { freq: number; to: number; duration: number; gain: number; type: OscillatorType };

const CUES: Record<SoundCue, Voice[]> = {
  // A rising two-note ask.
  proposal: [
    { freq: 587, to: 587, duration: 0.14, gain: 0.16, type: 'sine' },
    { freq: 784, to: 784, duration: 0.22, gain: 0.14, type: 'sine' },
  ],
  // A settled major third.
  completed: [
    { freq: 523, to: 523, duration: 0.16, gain: 0.15, type: 'triangle' },
    { freq: 659, to: 784, duration: 0.32, gain: 0.13, type: 'triangle' },
  ],
  // One short falling tone. Never alarming.
  failed: [{ freq: 330, to: 196, duration: 0.36, gain: 0.16, type: 'sine' }],
};

let context: AudioContext | undefined;
let master: GainNode | undefined;
let ambient: { nodes: AudioScheduledSourceNode[]; gain: GainNode } | undefined;

/** Reads the stored preference. Sound is off until somebody turns it on. */
function soundStored(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
}

function store(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // A blocked storage is not worth an error; the toggle still works for this session.
  }
}

/**
 * Creates the audio graph. Browsers only allow this from a user gesture, so this
 * is called from the speaker toggle and never on mount.
 */
function open(): AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const Ctor =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  if (!context) {
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
  }
  void context.resume();
  return context;
}

/** A slow, quiet pad: two detuned saws through a low-pass filter. */
function startAmbient(audio: AudioContext, out: GainNode) {
  const gain = audio.createGain();
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(0.035, audio.currentTime + 4);
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  filter.Q.value = 0.6;
  gain.connect(out);
  filter.connect(gain);
  const nodes = [110, 110.6, 165].map((freq, index) => {
    const oscillator = audio.createOscillator();
    oscillator.type = index === 2 ? 'sine' : 'sawtooth';
    oscillator.frequency.value = freq;
    oscillator.connect(filter);
    oscillator.start();
    return oscillator;
  });
  // A slow breath on the filter so the pad does not sit perfectly still.
  const drift = audio.createOscillator();
  const depth = audio.createGain();
  drift.frequency.value = 0.06;
  depth.gain.value = 120;
  drift.connect(depth).connect(filter.frequency);
  drift.start();
  ambient = { nodes: [...nodes, drift], gain };
}

function stopAmbient() {
  if (!ambient || !context) return;
  const { nodes, gain } = ambient;
  ambient = undefined;
  gain.gain.cancelScheduledValues(context.currentTime);
  gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.4);
  const stopAt = context.currentTime + 0.5;
  nodes.forEach((node) => node.stop(stopAt));
}

/** Turns sound on or off. Must be called from a user gesture to turn it on. */
export function setSoundOn(on: boolean): boolean {
  store(on);
  if (!on) {
    stopAmbient();
    return false;
  }
  const audio = open();
  if (!audio || !master) return false;
  if (!ambient) startAmbient(audio, master);
  return true;
}

/** Plays one cue. Silent when sound has never been turned on in this session. */
export function playCue(cue: SoundCue) {
  if (!context || !master || context.state !== 'running') return;
  const audio = context;
  CUES[cue].forEach((voice, index) => {
    const at = audio.currentTime + index * 0.11;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = voice.type;
    oscillator.frequency.setValueAtTime(voice.freq, at);
    if (voice.to !== voice.freq)
      oscillator.frequency.exponentialRampToValueAtTime(voice.to, at + voice.duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(voice.gain, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + voice.duration);
    oscillator.connect(gain).connect(master!);
    oscillator.start(at);
    oscillator.stop(at + voice.duration + 0.05);
  });
}

/** The speaker toggle's state, persisted in `localStorage` under `ahq.sound`. */
export function useSound() {
  const [on, setOn] = useState(false);
  // The stored preference cannot start audio on its own: the graph waits for a click.
  useEffect(() => setOn(soundStored() && Boolean(context)), []);
  return {
    on,
    toggle: () => setOn(setSoundOn(!on)),
  };
}

/**
 * Turns activity changes into cues: a new approval to decide, a task that just
 * finished, a task that just failed.
 */
export function useActivityCues(states: Map<string, EmployeeActivity>) {
  const previous = useRef<Map<string, EmployeeActivity>>(new Map());
  useEffect(() => {
    const before = previous.current;
    previous.current = states;
    if (!before.size) return;
    for (const [id, state] of states) {
      const was = before.get(id);
      if (!was) continue;
      if (state.attention === 'approval' && was.attention !== 'approval') playCue('proposal');
      else if (state.activity === 'celebrating' && was.activity !== 'celebrating') playCue('completed');
      else if (state.activity === 'failed' && was.activity !== 'failed') playCue('failed');
    }
  }, [states]);
}
