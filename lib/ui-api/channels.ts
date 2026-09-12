import { api } from '@/convex/_generated/api';

/** Convex references for the channels domain, under the names the interface uses. */
export const channelsApi = {
  channels: api.channels.list,
  openChannel: api.channels.open,
  channelPosts: api.channels.posts,
  postToChannel: api.channels.post,
  markChannelRead: api.channels.markRead,
  employeeFeed: api.channels.employeeFeed,
  acceptAddressedNote: api.channels.acceptAddressed,
} as const;
