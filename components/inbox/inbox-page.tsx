'use client';

import { ArrowRight, ExternalLink, Inbox, MessageSquareText, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { EmptyPane } from '../shared/empty';
import { providerName } from '../shared/format';
import { ProviderMark } from '../shared/marks';
import { MasterDetail, useMasterDetail } from '../shared/master-detail';
import { PageIntro } from '../shared/page-intro';
import { relativeTime } from '../shared/time';
import type { Employee, InboxItem, Floor } from '@/lib/contracts';
import './inbox.css';

export function InboxPage({
  items,
  employees,
  floors,
  configured,
  onRead,
  onAssign,
}: {
  items: InboxItem[];
  employees: Employee[];
  floors: Floor[];
  configured: boolean;
  onRead: (id: string) => void;
  onAssign: (itemId: string, employeeId: string, floorId?: string) => void;
}) {
  const [selected, setSelected] = useState(items[0]?.id ?? null);
  const { open, openDetail, closeDetail } = useMasterDetail();
  const item = items.find((entry) => entry.id === selected);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  // The assignment draft names the item it belongs to, so opening another starts it empty.
  const [draft, setDraft] = useState({ itemId: selected, floorId: '', employeeId: '' });
  const mine = draft.itemId === selected;
  const floorId = mine ? draft.floorId : '';
  const shown = filter === 'unread' ? items.filter((entry) => entry.status === 'unread') : items;
  const activeFloors = floors.filter((floor) => !floor.archivedAt);
  const selectedFloor = activeFloors.find((floor) => floor.id === floorId);
  const eligibleEmployees = selectedFloor
    ? employees.filter((employee) => selectedFloor.employeeIds.includes(employee.id))
    : employees;
  // Narrowing to a floor drops a person who is not on it.
  const employeeId =
    mine && eligibleEmployees.some((employee) => employee.id === draft.employeeId) ? draft.employeeId : '';
  return (
    <div>
      <PageIntro
        eyebrow="CONNECTED WORK"
        title="Inbox"
        description="New work from your approved integrations, ready to review or assign."
      />
      <MasterDetail
        className="split-card card"
        open={open}
        backLabel="Inbox"
        onBack={closeDetail}
        list={
          <div className="list-pane">
            <div className="pane-toolbar">
              <div className="segmented">
                <button data-active={filter === 'all'} onClick={() => setFilter('all')}>
                  All
                </button>
                <button data-active={filter === 'unread'} onClick={() => setFilter('unread')}>
                  Unread
                </button>
              </div>
              <button className="icon-button" aria-label="Refresh inbox">
                <RefreshCw size={15} />
              </button>
            </div>
            {shown.length ? (
              <div className="inbox-list">
                {shown.map((entry) => (
                  <button
                    key={entry.id}
                    data-active={selected === entry.id}
                    onClick={() => {
                      setSelected(entry.id);
                      openDetail();
                      if (entry.status === 'unread') onRead(entry.id);
                    }}
                  >
                    <ProviderMark provider={entry.provider} />
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{entry.preview}</small>
                      <time>{relativeTime(entry.createdAt)}</time>
                    </span>
                    {entry.status === 'unread' && <i className="unread-dot" />}
                  </button>
                ))}
              </div>
            ) : (
              <EmptyPane
                icon={<Inbox size={23} />}
                title="Inbox zero"
                text={
                  configured
                    ? 'New items from connected services will arrive here.'
                    : 'Connect the backend, then add an integration to receive work.'
                }
              />
            )}
          </div>
        }
        detail={
          <div className="detail-pane">
            {item ? (
              <>
                <div className="detail-heading">
                  <ProviderMark provider={item.provider} />
                  <div>
                    <span className="eyebrow">{providerName(item.provider)}</span>
                    <h2>{item.title}</h2>
                    <p>{relativeTime(item.createdAt)}</p>
                  </div>
                </div>
                <div className="inbox-preview">{item.preview}</div>
                <div className="detail-actions">
                  {item.taskId ? (
                    <a className="secondary-button" href="#tasks">
                      Already assigned · View tasks <ArrowRight size={15} />
                    </a>
                  ) : (
                    <>
                      <label>
                        Floor
                        <select
                          value={floorId}
                          onChange={(event) =>
                            setDraft({ itemId: selected, floorId: event.target.value, employeeId })
                          }
                        >
                          <option value="">Lobby · Unassigned</option>
                          {activeFloors.map((floor) => (
                            <option key={floor.id} value={floor.id}>
                              {floor.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Employee
                        <select
                          value={employeeId}
                          onChange={(event) =>
                            setDraft({ itemId: selected, floorId, employeeId: event.target.value })
                          }
                        >
                          <option value="">Choose an employee</option>
                          {eligibleEmployees.map((employee) => (
                            <option key={employee.id} value={employee.id}>
                              {employee.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="primary-button compact"
                        disabled={
                          !employeeId ||
                          !configured ||
                          Boolean(floorId && !selectedFloor) ||
                          item.status === 'assigned'
                        }
                        onClick={() => onAssign(item.id, employeeId, floorId || undefined)}
                      >
                        {item.status === 'assigned' ? 'Assigned' : 'Assign'}
                      </button>
                    </>
                  )}
                  {item.sourceUrl && (
                    <a className="secondary-button" href={item.sourceUrl} target="_blank" rel="noreferrer">
                      Open source <ExternalLink size={15} />
                    </a>
                  )}
                </div>
              </>
            ) : (
              <EmptyPane
                icon={<MessageSquareText size={25} />}
                title="Choose an item"
                text="The source, details, and assignment controls will appear here."
              />
            )}
          </div>
        }
      />
    </div>
  );
}
