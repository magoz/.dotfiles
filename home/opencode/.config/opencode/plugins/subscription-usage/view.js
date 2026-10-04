// `/quota` terminal command; the host's Solid `createComponent` is injected (see tui.js).
import { definition } from './rpc.ts';
import { rpcLocation } from '../shared/location.js';

/** CLI plugins must create keymap layers inside a rendered slot: V2 `setup` has no Keymap provider. */
export function setupUsage(ctx, createComponent) {
    const lifetime = new AbortController();
    let pending;
    const Commands = () => { ctx.keymap.layer(() => ({ commands: [{
      id: 'dotfiles.subscription-usage', title: 'Subscription allowance', palette: true,
      slash: { name: 'subscription-usage', aliases: ['quota'] },
      run: async () => {
        pending?.abort();
        const request = new AbortController();
        pending = request;
        const route = ctx.ui.router.current();
        const active = () => !lifetime.signal.aborted && !request.signal.aborted
          && ctx.ui.router.current().type === 'session' && ctx.ui.router.current().sessionID === route.sessionID;
        if (route.type !== 'session') return ctx.ui.toast.show({ variant: 'info', message: 'Select a session/model first.' });
        const session = ctx.data.session.get(route.sessionID);
        if (!session) return;
        try {
          const result = await ctx.client.rpc(definition).get({ sessionID: route.sessionID }, {
            location: rpcLocation(session.location), signal: AbortSignal.any([lifetime.signal, request.signal, AbortSignal.timeout(20000)]),
          });
          if (!active()) return;
          if (!result || !['available', 'stale', 'unavailable'].includes(result.status) || typeof result.text !== 'string' || result.text.length > 2048) throw new Error('Invalid quota result');
          await ctx.ui.dialog.alert({ title: 'Subscription allowance (cached snapshot)', message: result.text });
        } catch { if (active()) ctx.ui.toast.show({ variant: 'warning', message: 'Subscription quota unavailable.' }); }
        finally { if (pending === request) pending = undefined; }
      },
    }] })); return null; };
    const release = ctx.ui.slot({ append: 'app', render: () => createComponent(Commands, {}) });
    return () => { lifetime.abort(); try { release?.(); } catch { /* host already removed it */ } };
}

