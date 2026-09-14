'use client';

import { ArrowRight, Building2, LoaderCircle, MessageSquareText, ShieldCheck } from 'lucide-react';
import { OfficeStage } from '../office/office-stage';
import type { OfficeEmployee } from '../office/office-view';
import './app.css';

/** A furnished floor for the door: four figures, no workspace behind them. */
const DOOR_STAFF: OfficeEmployee[] = [
  { id: 'door-1', name: 'Ada', role: 'Operations analyst', color: '#6d5cd3', status: 'working' },
  { id: 'door-2', name: 'Bruno', role: 'Release writer', color: '#c2632d', status: 'working' },
  { id: 'door-3', name: 'Emi', role: 'Product designer', color: '#b8437a', status: 'ready' },
  { id: 'door-4', name: 'Cyrus', role: 'Data engineer', color: '#2f6fb0', status: 'working' },
];

/**
 * The door. The office is the product, so the office is what the door shows: a furnished floor in
 * the visitor's own daylight beside the one thing to do here.
 */
export function SignInScreen() {
  return (
    <div className="door">
      <section className="door-copy">
        <span className="brand" aria-hidden="true">
          Staff <i>AI</i>
        </span>
        <h1>An office of AI employees you can see working.</h1>
        <p>
          Hire from the marketplace, staff a floor, hand over the work. Every external change waits for your
          approval, and everything they do is on the record.
        </p>
        <a className="primary-button door-enter" href="/sign-in">
          Sign in <ArrowRight size={16} />
        </a>
        <ul className="door-points">
          <li>
            <Building2 size={15} aria-hidden="true" />
            <span>
              <strong>A live office.</strong> Each employee at a desk, each shift in view.
            </span>
          </li>
          <li>
            <ShieldCheck size={15} aria-hidden="true" />
            <span>
              <strong>Approval on every write.</strong> A proposal, never a surprise.
            </span>
          </li>
          <li>
            <MessageSquareText size={15} aria-hidden="true" />
            <span>
              <strong>Threads, not tickets.</strong> Answer a question, unblock a floor, in one place.
            </span>
          </li>
        </ul>
        <small>
          <ShieldCheck size={13} aria-hidden="true" />
          Access is by invitation. Workspace access is checked on every request.
        </small>
      </section>
      <section className="door-scene" aria-hidden="true">
        <OfficeStage employees={DOOR_STAFF} live={false} label="Floor 1" emptyMessage="" labels="off" />
      </section>
    </div>
  );
}

export function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="centered-loader">
      <span className="brand" aria-hidden="true">
        Staff <i>AI</i>
      </span>
      <LoaderCircle className="spin" size={20} />
      <p>{label}</p>
    </div>
  );
}
