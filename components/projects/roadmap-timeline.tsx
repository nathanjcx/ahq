'use client';

import type { CSSProperties } from 'react';
import { shortDate } from '../shared/time';
import { dependencyEdges, fraction, ROW_HEIGHT, type Timeline } from './roadmap';

/** Horizontal units of the string overlay. The axis is drawn stretched, the strokes are not. */
const TRACK_UNITS = 1000;

function percent(value: number) {
  return `${(value * 100).toFixed(3)}%`;
}

/**
 * The roadmap on a time axis: one row per instance under its floor, a bar for every task, the
 * milestones marked across the whole chart, and a string from every task to the work it waits for.
 * It scrolls sideways inside its own frame; the labels stay put.
 */
export function RoadmapTimeline({
  timeline,
  onSelectBar,
}: {
  timeline: Timeline;
  /** Opens the task a bar stands for. */
  onSelectBar: (id: string) => void;
}) {
  const edges = dependencyEdges(timeline);
  const { todayAt } = timeline;
  const today = todayAt > timeline.startAt && todayAt < timeline.endAt ? fraction(timeline, todayAt) : null;
  return (
    <div className="roadmap" style={{ '--row-h': `${ROW_HEIGHT}px` } as CSSProperties}>
      <div className="roadmap-labels">
        {timeline.rows.map((row) => (
          <div key={row.key} className="roadmap-label" data-floor-start={row.firstOfFloor}>
            {row.firstOfFloor && <small>{row.floorName}</small>}
            <strong>{row.employeeName}</strong>
          </div>
        ))}
      </div>
      <div className="roadmap-scroll">
        <div className="roadmap-track">
          <div className="roadmap-head">
            {timeline.ticks.map((at) => (
              <span key={at} className="roadmap-tick" style={{ left: percent(fraction(timeline, at)) }}>
                {shortDate(at)}
              </span>
            ))}
            {timeline.markers.map((marker) => (
              <span
                key={marker.id}
                className="roadmap-flag"
                data-behind={marker.behind}
                data-status={marker.status}
                style={{ left: percent(fraction(timeline, marker.at)) }}
              >
                {marker.title}
              </span>
            ))}
          </div>
          <div className="roadmap-rows" style={{ height: `${timeline.height}px` }}>
            {timeline.markers.map((marker) => (
              <span
                key={marker.id}
                className="roadmap-guide"
                data-behind={marker.behind}
                style={{ left: percent(fraction(timeline, marker.at)) }}
              />
            ))}
            {today !== null && <span className="roadmap-today" style={{ left: percent(today) }} />}
            <svg
              className="roadmap-strings"
              viewBox={`0 0 ${TRACK_UNITS} ${Math.max(timeline.height, 1)}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {edges.map((edge) => {
                const x1 = edge.x1 * TRACK_UNITS;
                const x2 = edge.x2 * TRACK_UNITS;
                const bend = Math.max(24, Math.abs(x2 - x1) / 2);
                return (
                  <path
                    key={edge.key}
                    d={`M ${x1} ${edge.y1} C ${x1 + bend} ${edge.y1}, ${x2 - bend} ${edge.y2}, ${x2} ${edge.y2}`}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
            {timeline.rows.flatMap((row) =>
              row.bars.map((bar) => (
                <button
                  key={bar.id}
                  type="button"
                  className="roadmap-bar"
                  data-status={bar.status ?? 'proposed'}
                  onClick={() => onSelectBar(bar.id)}
                  style={{
                    top: `${bar.row * ROW_HEIGHT}px`,
                    left: percent(fraction(timeline, bar.startAt)),
                    width: percent(
                      Math.max(0.02, fraction(timeline, bar.endAt) - fraction(timeline, bar.startAt)),
                    ),
                  }}
                >
                  <span>{bar.title}</span>
                </button>
              )),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
