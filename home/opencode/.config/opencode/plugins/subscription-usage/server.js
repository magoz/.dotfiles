import { definition } from './rpc.js';
import { makeUsage } from './usage.js';
export default {
  id: 'dotfiles-subscription-usage',
  async setup(ctx) {
    const usage = makeUsage(ctx);
    const registration = await ctx.rpc.register(definition, { get: async ({ sessionID }, context) => usage.get(sessionID, context.signal) });
    return async () => { usage.dispose(); await registration.dispose(); };
  },
};
