'use client';

import { Archive, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { EmptyMini } from '../shared/empty';

export type MediaRow = { rowId: string; url: string; type: 'image' | 'video'; alt: string };

export function MediaRows({
  media,
  onChange,
}: {
  media: MediaRow[];
  onChange: Dispatch<SetStateAction<MediaRow[]>>;
}) {
  return (
    <div className="editor-rows">
      {media.map((item, index) => (
        <div className="editor-row media-editor" key={item.rowId}>
          <div className="editor-row-head">
            <strong>Gallery item {index + 1}</strong>
            <button
              type="button"
              className="icon-button danger-text"
              aria-label="Remove media"
              onClick={() => onChange((items) => items.filter((entry) => entry.rowId !== item.rowId))}
            >
              <X size={16} />
            </button>
          </div>
          <div className="form-grid">
            <label>
              Type
              <select
                value={item.type}
                onChange={(event) =>
                  onChange((items) =>
                    items.map((entry) =>
                      entry.rowId === item.rowId
                        ? { ...entry, type: event.target.value as 'image' | 'video' }
                        : entry,
                    ),
                  )
                }
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>
            </label>
            <label>
              {item.type === 'video' ? 'Direct MP4/WebM URL' : 'Image URL'}
              <input
                type="url"
                required
                value={item.url}
                onChange={(event) =>
                  onChange((items) =>
                    items.map((entry) =>
                      entry.rowId === item.rowId ? { ...entry, url: event.target.value } : entry,
                    ),
                  )
                }
                placeholder="https://cdn.example.com/preview.jpg"
              />
            </label>
            <label className="full-field">
              Accessible description
              <input
                required
                value={item.alt}
                onChange={(event) =>
                  onChange((items) =>
                    items.map((entry) =>
                      entry.rowId === item.rowId ? { ...entry, alt: event.target.value } : entry,
                    ),
                  )
                }
                placeholder="Describe what this image or video shows"
              />
            </label>
          </div>
        </div>
      ))}
      {!media.length && (
        <EmptyMini
          icon={<Archive size={19} />}
          title="No gallery media"
          text="The marketplace will use the employee color and icon."
        />
      )}
    </div>
  );
}
