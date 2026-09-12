'use client';

import {
  Archive,
  ArrowRight,
  ArrowUpCircle,
  Bot,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  LockKeyhole,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { providerName } from '../shared/format';
import { ProviderMark } from '../shared/marks';
import { Sheet } from '../shared/sheet';
import { relativeTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import type { Employee, Listing, ProviderId } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import { asId, uiApi } from '@/lib/ui-api';

/** Every version this listing has published, and what each one changed from the one before it. */
function VersionHistory({ listingId }: { listingId: string }) {
  const versions = useUiQuery(uiApi.listingVersions, { listingId: asId<'listings'>(listingId) });
  if (!versions?.length) return null;
  return (
    <section className="market-versions">
      <h3>Versions</h3>
      <ol>
        {versions.map((version) => (
          <li key={version.version}>
            <strong>
              Version {version.version}
              {version.retired ? ' · retired' : ''}
            </strong>
            <small>{relativeTime(version.publishedAt)}</small>
            <div className="change-row">
              {version.changed.map((field) => (
                <span key={field}>{field}</span>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function MarketplaceDetail({
  listing,
  instances,
  configured,
  missing,
  onClose,
  onHire,
  onUpgrade,
}: {
  listing: Listing;
  /** Live instances this workspace hired from this listing. */
  instances: Employee[];
  configured: boolean;
  missing: ProviderId[];
  onClose: () => void;
  onHire: () => void;
  onUpgrade: (employeeId: string) => void;
}) {
  const [mediaIndex, setMediaIndex] = useState(0);
  // Remembering which slide failed lets moving to the next one clear the notice on its own.
  const [failedIndex, setFailedIndex] = useState<number | null>(null);
  const mediaFailed = failedIndex === mediaIndex;
  const media = listing.media[mediaIndex];
  const canHire = configured && missing.length === 0;
  const behind = instances.filter((instance) => instance.updateAvailable);
  return (
    <Sheet
      wide
      title={listing.name}
      subtitle={listing.role}
      onClose={onClose}
      footer={
        <div className="market-hire-bar">
          <span>
            <strong>{instances.length ? `${pluralize(instances.length, 'instance')} here` : 'Free'}</strong>
            <small>OpenAI and provider usage billed separately</small>
          </span>
          <button className="primary-button" disabled={!canHire} onClick={onHire}>
            Hire instances <ArrowRight size={15} />
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
              <img src={media.url} alt={media.alt} onError={() => setFailedIndex(mediaIndex)} />
            )}
            {media?.type === 'video' && !mediaFailed && (
              <video
                src={media.url}
                controls
                preload="metadata"
                aria-label={media.alt}
                onError={() => setFailedIndex(mediaIndex)}
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
          {behind.length > 0 && (
            <section className="upgrade-prompt">
              <ArrowUpCircle size={18} />
              <div>
                <strong>
                  Version {listing.currentVersion} is available to {pluralize(behind.length, 'instance')}
                </strong>
                <small>
                  An upgrade re-checks the connections this employee needs. If one is missing, nothing
                  changes and the instance stays where it is.
                </small>
                <div className="upgrade-instances">
                  {behind.map((instance) => (
                    <button
                      key={instance.id}
                      className="secondary-button compact"
                      onClick={() => onUpgrade(instance.id)}
                    >
                      Upgrade {instance.name} from v{instance.version}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
          {listing.evidence && (
            <section className="market-evidence">
              <h3>
                <FlaskConical size={16} /> Evidence
              </h3>
              <p className="evidence-task">{listing.evidence.sampleTask}</p>
              <pre>{listing.evidence.sampleOutput}</pre>
              {listing.evidence.link && (
                <a href={listing.evidence.link} target="_blank" rel="noreferrer">
                  See the work <ExternalLink size={13} />
                </a>
              )}
            </section>
          )}
          <VersionHistory listingId={listing.listingId} />
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
