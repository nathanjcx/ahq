import { requireString, type InternalTool } from './shared';

const floorPost: InternalTool = {
  name: 'floor_post',
  description: 'Post a short note on this floor board. Use it when you finish a milestone.',
  properties: { text: { type: 'string', description: 'The note to post.' } },
  required: ['text'],
  async run(request, _context, args) {
    await request.backend.mutate('services/channels:postFromAgent', {
      runToken: request.runToken,
      text: requireString(args, 'text'),
    });
    return { posted: true };
  },
};

const floorHandoff: InternalTool = {
  name: 'floor_handoff',
  description:
    'Request a handoff to another employee on this floor. A person accepts or declines it; requesting is not accepting.',
  properties: {
    toEmployeeId: { type: 'string', description: 'The employee id to hand off to.' },
    brief: { type: 'string', description: 'What the next employee should do.' },
  },
  required: ['toEmployeeId', 'brief'],
  async run(request, _context, args) {
    await request.backend.mutate('services/channels:requestHandoffFromAgent', {
      runToken: request.runToken,
      toEmployeeId: requireString(args, 'toEmployeeId'),
      brief: requireString(args, 'brief'),
    });
    return {
      requested: true,
      status: 'pending',
      instruction: 'A person decides this handoff. Do not claim it was accepted and do not wait for it.',
    };
  },
};

export const floorTools = [floorPost, floorHandoff];
