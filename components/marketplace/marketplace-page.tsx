'use client';

import {
  ArrowRight,
  Bot,
  FileOutput,
  LockKeyhole,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { PageProps } from '../app/page-props';
import { providerName } from '../shared/format';
import { HireSheet, hireContext } from '../shared/hire-sheet';
import { ProviderMark } from '../shared/marks';
import { PageIntro } from '../shared/page-intro';
import { missingRequiredCapabilities } from './capabilities';
import { MarketplaceDetail } from './marketplace-detail';
import { DELIVERABLES, type Employee, type Listing } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import './marketplace.css';

type Props = PageProps & { listings: Listing[] };
type Shelf = 'all' | 'installed' | 'updates';
const SHELVES: { id: Shelf; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'updates', label: 'Updates' },
];

/** Live instances hired from one listing, and whether any of them is behind its current version. */
function installedFrom(listing: Listing, employees: Employee[]) {
  const instances = employees.filter(
    (employee) => employee.listingId === listing.listingId && employee.status !== 'retired',
  );
  return { instances, behind: instances.filter((employee) => employee.updateAvailable) };
}

export function MarketplacePage({ listings, ...props }: Props) {
  const { dashboard, actions, run, go } = props;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [shelf, setShelf] = useState<Shelf>('all');
  const [selected, setSelected] = useState<Listing | null>(null);
  const [hiring, setHiring] = useState<Listing | null>(null);

  const { needsApproval } = hireContext(dashboard);
  const categories = [...new Set(listings.map((listing) => listing.category))].sort();
  const shown = listings.filter((listing) => {
    const haystack = `${listing.name} ${listing.role} ${listing.category} ${listing.description} ${listing.strengths.join(' ')} ${listing.capabilities.map((capability) => providerName(capability.provider)).join(' ')}`;
    const { instances, behind } = installedFrom(listing, dashboard.employees);
    return (
      haystack.toLowerCase().includes(query.toLowerCase()) &&
      (category === 'all' || listing.category === category) &&
      (shelf === 'all' ||
        (shelf === 'installed' && instances.length > 0) ||
        (shelf === 'updates' && behind.length > 0))
    );
  });
  const filtered = Boolean(query) || category !== 'all' || shelf !== 'all';

  return (
    <div>
      <PageIntro
        title="Marketplace"
        description="Published employees. Each version lists its tools, what it produces, and its limits."
        action={
          dashboard.isPlatformAdmin ? (
            <button className="secondary-button" onClick={() => go('admin')}>
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
        <div className="segmented" role="group" aria-label="Filter by what you have hired">
          {SHELVES.map((entry) => (
            <button key={entry.id} data-active={shelf === entry.id} onClick={() => setShelf(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <div className="market-grid">
          {shown.map((listing) => {
            const { instances, behind } = installedFrom(listing, dashboard.employees);
            const missing = missingRequiredCapabilities(listing, dashboard.connections);
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
                  <div className="listing-head">
                    <span className="listing-mark" aria-hidden="true" style={{ background: listing.color }}>
                      <Bot size={20} />
                    </span>
                    <div>
                      <span className="category-pill">{listing.category}</span>
                      <h2>{listing.name}</h2>
                      <p className="listing-role">{listing.role}</p>
                    </div>
                  </div>
                  <p className="listing-description">{listing.description}</p>
                  <div className="capability-row">
                    {listing.capabilities.slice(0, 4).map((capability) => (
                      <span key={capability.provider}>
                        <ProviderMark provider={capability.provider} small />
                        {providerName(capability.provider)}
                      </span>
                    ))}
                    {listing.workshop?.deliverables.map((kind) => (
                      <span key={kind} className="deliverable-pill">
                        <FileOutput size={11} />
                        {DELIVERABLES[kind]}
                      </span>
                    ))}
                  </div>
                  <p className="listing-counters">
                    <Users size={12} />
                    {pluralize(listing.hires, 'hire')} · {listing.completedTasks.toLocaleString()} tasks
                    completed · version {listing.currentVersion}
                  </p>
                  <div className="listing-footer">
                    {instances.length ? (
                      <span className="listing-installed">
                        {pluralize(instances.length, 'instance')} here
                        {behind.length ? ` · ${behind.length} behind` : ''}
                      </span>
                    ) : (
                      <span>
                        <strong>Free to hire</strong>
                        <small>Usage billed separately</small>
                      </span>
                    )}
                    <button className="primary-button" onClick={() => setSelected(listing)}>
                      View details <ArrowRight size={15} />
                    </button>
                  </div>
                  {missing.length > 0 && !instances.length && (
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
          <h2>
            {filtered
              ? 'No employees match these filters'
              : 'The marketplace is ready for its first employee'}
          </h2>
          <p>
            {filtered
              ? 'Try another role, capability, or category.'
              : 'Only reviewed, published employees appear here. Platform admins can author private instructions and publish a version when it is ready.'}
          </p>
          {dashboard.isPlatformAdmin && !filtered && (
            <button className="primary-button" onClick={() => go('admin')}>
              Create the first listing <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      {selected && (
        <MarketplaceDetail
          listing={selected}
          instances={installedFrom(selected, dashboard.employees).instances}
          configured={props.configured}
          missing={missingRequiredCapabilities(selected, dashboard.connections)}
          onClose={() => setSelected(null)}
          onHire={() => {
            setHiring(selected);
            setSelected(null);
          }}
          onUpgrade={(employeeId) =>
            run(() => actions.upgradeEmployee(employeeId), 'Upgraded to the current version')
          }
        />
      )}
      {hiring && (
        <HireSheet
          listing={hiring}
          dashboard={dashboard}
          onClose={() => setHiring(null)}
          onHire={(options) =>
            run(
              () => actions.hire(hiring.listingId, options),
              needsApproval
                ? 'Requested. An owner or an administrator decides it.'
                : `Hired ${pluralize(options.count ?? 1, 'instance')} of ${hiring.name}`,
            )
          }
        />
      )}
    </div>
  );
}
