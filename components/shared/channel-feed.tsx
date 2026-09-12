'use client';

import type { ChannelsActions } from '../app/actions/channels';

/**
 * A channel's posts with a composer, rendered wherever a channel belongs: a project page, an
 * employee's feed, a floor board. Filled by the channels workstream.
 */
export function ChannelFeed(_props: {
  channelId: string;
  actions: ChannelsActions;
  /** Compact rows for a side column; the default is the full feed. */
  compact?: boolean;
  onTask?: (taskId: string) => void;
}) {
  return <p className="muted">Channel feed</p>;
}
