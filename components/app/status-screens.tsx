'use client';

import { SignInButton } from '@clerk/nextjs';
import { ArrowRight, LoaderCircle, ShieldCheck, Sparkles } from 'lucide-react';

export function SignInScreen() {
  return (
    <div className="signin-screen">
      <div className="signin-card card">
        <span className="brand-glyph large">
          <Sparkles size={25} />
        </span>
        <span className="eyebrow">ASTRA HQ</span>
        <h1>Come into the office</h1>
        <p>Sign in to see your employees, connected work, and action reviews.</p>
        <SignInButton mode="modal">
          <button className="primary-button full">
            Sign in <ArrowRight size={16} />
          </button>
        </SignInButton>
        <small>
          <ShieldCheck size={13} />
          Workspace access is checked on every request.
        </small>
      </div>
    </div>
  );
}

export function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="centered-loader">
      <span className="brand-glyph">
        <Sparkles size={19} />
      </span>
      <LoaderCircle className="spin" size={20} />
      <p>{label}</p>
    </div>
  );
}
