'use client';

import { useMutation } from 'convex/react';
import type { ChannelKind } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';

/** Everything a person can do inside a channel: open one, post to it, mark it read, act on a note. */
export type ChannelsActions = {
  openChannel: (kind: ChannelKind, scopeId: string) => Promise<{ channelId: string } | undefined>;
  postToChannel: (
    channelId: string,
    text: string,
    kind: 'note' | 'decision',
    toEmployeeId?: string,
  ) => Promise<unknown>;
  markChannelRead: (channelId: string) => Promise<unknown>;
  /** Turns a note addressed to an instance into a task for it. */
  acceptAddressedNote: (postId: string) => Promise<{ taskId: string } | undefined>;
};

const unavailable = async () => undefined;

export const offlineChannelsActions: ChannelsActions = {
  openChannel: unavailable,
  postToChannel: unavailable,
  markChannelRead: unavailable,
  acceptAddressedNote: unavailable,
};

export function useChannelsActions(): ChannelsActions {
  const openChannel = useMutation(uiApi.openChannel);
  const postToChannel = useMutation(uiApi.postToChannel);
  const markChannelRead = useMutation(uiApi.markChannelRead);
  const acceptAddressedNote = useMutation(uiApi.acceptAddressedNote);

  return {
    openChannel: (kind, scopeId) => openChannel({ kind, scopeId }),
    postToChannel: (channelId, text, kind, toEmployeeId) =>
      postToChannel({
        channelId: asId(channelId),
        text,
        kind,
        toEmployeeId: toEmployeeId ? asId<'installations'>(toEmployeeId) : undefined,
      }),
    markChannelRead: (channelId) => markChannelRead({ channelId: asId(channelId) }),
    acceptAddressedNote: (postId) => acceptAddressedNote({ postId: asId(postId) }),
  };
}
