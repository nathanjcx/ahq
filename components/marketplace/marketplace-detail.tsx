'use client';

import {
  Archive,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ExternalLink,
  LockKeyhole,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import type { Listing, ProviderId } from '@/lib/contracts';
import { providerName } from '../shared/format';
import { ProviderMark } from '../shared/marks';
import { Sheet } from '../shared/sheet';

export function MarketplaceDetail({
  listing,
  hired,
  configured,
  missing,
  onClose,
  onHire,
}: {
  listing: Listing;
  hired: boolean;
  configured: boolean;
  missing: ProviderId[];
  onClose: () => void;
  onHire: () => void;
}) {
  const [mediaIndex, setMediaIndex] = useState(0);
  const [mediaFailed, setMediaFailed] = useState(false);
  const media = listing.media[mediaIndex];
  const canHire = configured && !hired && missing.length === 0;
  useEffect(() => setMediaFailed(false), [mediaIndex]);
  return (
    <Sheet
      wide
      title={listing.name}
      subtitle={listing.role}
      onClose={onClose}
      footer={
        <div className="market-hire-bar">
          <span>
            <strong>Free</strong>
            <small>OpenAI and provider usage billed separately</small>
          </span>
          <button
            className={hired ? 'secondary-button' : 'primary-button'}
            disabled={!canHire}
            onClick={onHire}
          >
            {hired ? (
              <>
                <Check size={15} /> Already hired
              </>
            ) : (
              <>
                Hire employee <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="market-detail">
        <div className="market-gallery" style={{ '--listing-color': listing.color } as CSSProperties}>
          <div className="market-gallery-stage">
            {media && mediaFailed && (
              <div className="market-media-error">
                <Archive size={24} />
                <strong>Preview unavailable</strong>
                {media.url.startsWith('https://') && (
                  <a href={media.url} target="_blank" rel="noreferrer">
                    Open source <ExternalLink size={13} />
                  </a>
                )}
              </div>
            )}
            {media?.type === 'image' && !mediaFailed && (
              <img src={media.url} alt={media.alt} onError={() => setMediaFailed(true)} />
            )}
            {media?.type === 'video' && !mediaFailed && (
              <video
                src={media.url}
                controls
                preload="metadata"
                aria-label={media.alt}
                onError={() => setMediaFailed(true)}
              />
            )}
            {!media && (
              <span className="listing-orbit">
                <Bot size={48} />
              </span>
            )}
          </div>
          {listing.media.length > 1 && (
            <div className="market-thumbnails" aria-label="Listing media">
              {listing.media.map((item, index) => (
                <button
                  key={`${item.url}-${index}`}
                  data-active={index === mediaIndex}
                  onClick={() => setMediaIndex(index)}
                >
                  {item.type === 'image' ? (
                    <img src={item.url} alt="" />
                  ) : (
                    <span>
                      <Play size={16} />
                    </span>
                  )}
                  <span className="sr-only">{item.alt}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="market-detail-copy">
          <span className="category-pill">{listing.category}</span>
          <h2>{listing.name}</h2>
          <p className="listing-role">{listing.role}</p>
          <p className="market-description">{listing.description}</p>
          <div className="strength-grid">
            <section>
              <h3>
                <CheckCircle2 size={16} /> Strengths
              </h3>
              {listing.strengths.length ? (
                <ul>
                  {listing.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>No strengths listed.</p>
              )}
            </section>
            <section>
              <h3>
                <SlidersHorizontal size={16} /> Limits
              </h3>
              {listing.limitations.length ? (
                <ul>
                  {listing.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>No limits listed.</p>
              )}
            </section>
          </div>
          <section className="market-capabilities">
            <h3>Integration access</h3>
            <p>The employee receives only these approved MCP tools.</p>
            {listing.capabilities.length ? (
              listing.capabilities.map((capability) => (
                <div key={capability.provider}>
                  <ProviderMark provider={capability.provider} />
                  <span>
                    <strong>{providerName(capability.provider)}</strong>
                    <small>{capability.optional ? 'Optional' : 'Required'}</small>
                  </span>
                  <code>{capability.tools.join(', ') || 'No tools'}</code>
                </div>
              ))
            ) : (
              <div className="capability-empty">No integrations required</div>
            )}
          </section>
          {missing.length > 0 && (
            <div className="hire-blocked">
              <LockKeyhole size={16} />
              <span>
                <strong>Connections required</strong>
                <small>
                  Connect {missing.map(providerName).join(', ')} with every required tool before hiring.
                </small>
              </span>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
