import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { requireService } from '../shared';
import { handoffFromRun, postFromRun } from './channels';

/**
 * The floor tool names the gateway already calls. Both writes now land in the floor's channel;
 * these stay as thin wrappers until the worker moves to `services/channels`.
 */
export const post = mutation({
  args: { secret: v.string(), runToken: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    return postFromRun(ctx, args.runToken, args.text);
  },
});

export const requestHandoff = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    toEmployeeId: v.id('installations'),
    brief: v.string(),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    return handoffFromRun(ctx, args.runToken, args.toEmployeeId, args.brief);
  },
});
