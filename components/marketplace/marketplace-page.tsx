'use client';

import { ArrowRight, Bot, LockKeyhole, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { Connection, Employee, Listing } from '@/lib/contracts';
import { providerName } from '../shared/format';
import { ProviderMark } from '../shared/marks';
import { PageIntro } from '../shared/page-intro';
import { missingRequiredCapabilities } from './capabilities';
import { MarketplaceDetail } from './marketplace-detail';

export function MarketplacePage({
  listings,
  employees,
  connections,
  configured,
  isAdmin,
  onHire,
  onAdmin,
}: {
  listings: Listing[];
  employees: Employee[];
  connections: Connection[];
  configured: boolean;
  isAdmin: boolean;
  onHire: (id: string) => void;
  onAdmin: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<Listing | null>(null);
  const categories = [...new Set(listings.map((listing) => listing.category))].sort();
  const shown = listings.filter((listing) => {
    const haystack = `${listing.name} ${listing.role} ${listing.category} ${listing.description} ${listing.strengths.join(' ')} ${listing.capabilities.map((capability) => providerName(capability.provider)).join(' ')}`;
    return (
      haystack.toLowerCase().includes(query.toLowerCase()) &&
      (category === 'all' || listing.category === category)
    );
  });
  return (
    <div>
      <PageIntro
        eyebrow="EMPLOYEE MARKETPLACE"
        title="Meet your next hire"
        description="Published employees with versioned skills, clear limits, and no marketplace fee."
        action={
          isAdmin ? (
            <button className="secondary-button" onClick={onAdmin}>
              <ShieldCheck size={16} />
              Manage listings
            </button>
          ) : undefined
        }
      />
      <div className="market-toolbar">
        <label className="market-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by role or skill"
          />
        </label>
        <label className="category-filter">
          <SlidersHorizontal size={15} />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {shown.length ? (
        <div className="market-grid">
          {shown.map((listing) => {
            const hired = employees.some((employee) => employee.versionId === listing.versionId);
            const missing = missingRequiredCapabilities(listing, connections);
            return (
              <article className="listing-card card" key={listing.versionId}>
                <button
                  type="button"
                  className="listing-visual"
                  style={{ '--listing-color': listing.color } as CSSProperties}
                  onClick={() => setSelected(listing)}
                  aria-label={`View ${listing.name}`}
                >
                  {listing.media[0]?.type === 'image' ? (
                    <img src={listing.media[0].url} alt={listing.media[0].alt} />
                  ) : (
                    <>
                      <span className="listing-orbit">
                        <Bot size={32} />
                      </span>
                      <i className="pixel-star star-one" />
                      <i className="pixel-star star-two" />
                    </>
                  )}
                </button>
                <div className="listing-copy">
                  <span className="category-pill">{listing.category}</span>
                  <h2>{listing.name}</h2>
                  <p className="listing-role">{listing.role}</p>
                  <p className="listing-description">{listing.description}</p>
                  <div className="capability-row">
                    {listing.capabilities.slice(0, 4).map((capability) => (
                      <span key={capability.provider}>
                        <ProviderMark provider={capability.provider} small />
                        {providerName(capability.provider)}
                      </span>
                    ))}
                  </div>
                  <div className="listing-footer">
                    <span>
                      <strong>Free to hire</strong>
                      <small>Usage billed separately</small>
                    </span>
                    <button className="primary-button" onClick={() => setSelected(listing)}>
                      View details <ArrowRight size={15} />
                    </button>
                  </div>
                  {missing.length > 0 && !hired && (
                    <p className="listing-requirement">
                      <LockKeyhole size={13} /> Connect {missing.map(providerName).join(', ')} to hire
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-market card">
          <div className="market-shelves" aria-hidden="true">
            <span>
              <i />
              <i />
              <i />
            </span>
            <span>
              <i />
              <i />
            </span>
          </div>
          <span className="eyebrow">CURATED BY YOUR PLATFORM TEAM</span>
          <h2>
            {query || category !== 'all'
              ? 'No employees match these filters'
              : 'The marketplace is ready for its first employee'}
          </h2>
          <p>
            {query || category !== 'all'
              ? 'Try another role, capability, or category.'
              : 'Only reviewed, published employees appear here. Platform admins can author private instructions and publish a version when it is ready.'}
          </p>
          {isAdmin && !query && category === 'all' && (
            <button className="primary-button" onClick={onAdmin}>
              Create the first listing <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      {selected && (
        <MarketplaceDetail
          listing={selected}
          hired={employees.some((employee) => employee.versionId === selected.versionId)}
          configured={configured}
          missing={missingRequiredCapabilities(selected, connections)}
          onClose={() => setSelected(null)}
          onHire={() => onHire(selected.versionId)}
        />
      )}
    </div>
  );
}
