export const definition = {
  id: 'dotfiles-subscription-usage',
  methods: { get: {
    input: { type: 'object', properties: { sessionID: { type: 'string', minLength: 1 } }, required: ['sessionID'], additionalProperties: false },
    output: { type: 'object', properties: { status: { enum: ['available', 'stale', 'unavailable'] }, text: { type: 'string' } }, required: ['status', 'text'], additionalProperties: false },
  } }, events: {},
};
