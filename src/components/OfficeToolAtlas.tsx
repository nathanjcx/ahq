import { useState } from 'react';
import {
  Archive,
  BookOpen,
  Calculator,
  ClipboardCheck,
  FileText,
  Globe,
  LampDesk,
  Mail,
  Phone,
  Projector,
  Search,
  ArrowRight,
} from 'lucide-react';
import { OFFICE_TOOL_ATLAS, type OfficeStation } from '../../shared/office-tool-atlas';
import Modal from './Modal';
import './office-tool-atlas.css';

const stations = [
  { id: 'desk', label: 'Personal desk', icon: LampDesk },
  { id: 'archive', label: 'Filing cabinet', icon: Archive },
  { id: 'library', label: 'Reading desk', icon: BookOpen },
  { id: 'dispatch', label: 'Mail station', icon: Mail },
  { id: 'workbench', label: 'Drafting bench', icon: FileText },
  { id: 'research', label: 'Research terminal', icon: Globe },
  { id: 'analysis', label: 'Analysis bench', icon: Calculator },
  { id: 'connections', label: 'Service line', icon: Phone },
  { id: 'review', label: 'Your review desk', icon: ClipboardCheck },
  { id: 'recorder', label: 'Office recorder', icon: Projector },
] as const;

export function OfficeToolAtlas({
  onClose,
  initialStation,
}: {
  onClose: () => void;
  initialStation?: OfficeStation;
}) {
  const [station, setStation] = useState<OfficeStation | 'all'>(initialStation ?? 'all');
  const [query, setQuery] = useState('');
  const visible = OFFICE_TOOL_ATLAS.filter(
    (item) =>
      (station === 'all' || item.station === station) &&
      `${item.label} ${item.object} ${item.mechanism} ${item.action}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <Modal
      title="A place for every kind of work."
      subtitle="A guide to the objects in your office—and the real operations behind them."
      wide
      onClose={onClose}
    >
      <div className="office-atlas">
        <div className="atlas-intro">
          <span>
            <Archive size={25} strokeWidth={1.4} />
          </span>
          <div>
            <strong>{OFFICE_TOOL_ATLAS.length} mechanisms. One familiar office.</strong>
            <p>
              An employee files a card only after it is saved. An envelope is stamped only after it is
              acknowledged. Every visible action has a record.
            </p>
          </div>
        </div>
        <label className="atlas-search">
          <Search size={16} />
          <input
            aria-label="Search office tools"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a tool, object, or capability…"
          />
        </label>
        <div className="atlas-stations" aria-label="Filter office objects">
          <button type="button" aria-pressed={station === 'all'} onClick={() => setStation('all')}>
            Whole office
          </button>
          {stations.map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} aria-pressed={station === id} onClick={() => setStation(id)}>
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
        <p className="atlas-count">
          {visible.length} {visible.length === 1 ? 'mapping' : 'mappings'} · optional tools work only when you
          enable them
        </p>
        <div className="atlas-grid">
          {visible.map((item) => {
            const place = stations.find((entry) => entry.id === item.station)!;
            const Icon = place.icon;
            return (
              <article className="atlas-card" key={item.id}>
                <div className="atlas-card-top">
                  <span>
                    <Icon size={18} />
                  </span>
                  <small>{place.label}</small>
                  {item.availability === 'optional' && <b>Optional</b>}
                </div>
                <h3>{item.object}</h3>
                <p>{item.action}</p>
                <details>
                  <summary>
                    {item.label}
                    <ArrowRight size={12} />
                  </summary>
                  <div className="atlas-engine">
                    <span>ENGINE</span>
                    <p>{item.mechanism}</p>
                    <span>WHAT PROVES IT</span>
                    <p>{item.evidence}</p>
                    {item.toolNames.length > 0 && <code>{item.toolNames.join(' · ')}</code>}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
        {visible.length === 0 && (
          <p className="atlas-empty">
            No matching object. Try a tool name such as memory, message, or replay.
          </p>
        )}
        <p className="atlas-footnote">
          The scene represents recorded work. Opening this guide or replaying an event never runs a tool.
        </p>
      </div>
    </Modal>
  );
}
