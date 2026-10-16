export const traceRequest = {
  noteText: '# Synthetic trace note\n\nThe test word is orchid.\n',
  selectedPassage: 'The test word is orchid.',
  conversationHistory: [],
  question: 'Reply with only the test word from the supplied note. Do not use tools.',
};

// Store only the streaming contract used by the adapters, never startup/account data.
export function modelTrace(provider, records, cliVersion) {
  const events = [];
  let requestFound = false;
  for (const { direction, message } of records) {
    if (provider === 'codex' && direction === 'input' && message.method === 'turn/start') {
      const payload = JSON.parse(message.params.input[0].text);
      if (JSON.stringify(payload) !== JSON.stringify(traceRequest))
        throw Error('Only the canonical synthetic trace request may be recorded.');
      requestFound = true;
    }
    if (direction !== 'output') continue;
    if (provider === 'codex') {
      const params = message.params;
      if (message.method === 'item/agentMessage/delta')
        events.push({
          method: message.method,
          params: {
            threadId: 'trace-thread',
            turnId: 'trace-turn',
            itemId: 'trace-answer',
            delta: params.delta,
          },
        });
      if (message.method === 'turn/completed')
        events.push({
          method: message.method,
          params: {
            threadId: 'trace-thread',
            turn: { id: 'trace-turn', status: params.turn.status },
          },
        });
    } else if (provider === 'claude') {
      if (
        message.type === 'stream_event' &&
        message.event?.type === 'content_block_delta' &&
        message.event.delta?.type === 'text_delta'
      )
        events.push({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: message.event.delta.text },
          },
        });
      if (message.type === 'result')
        events.push({ type: 'result', is_error: message.is_error, result: message.result });
    } else throw Error('Unknown trace provider.');
  }
  if (provider === 'codex' && !requestFound) throw Error('Missing synthetic request.');
  const final = events.at(-1);
  const complete =
    provider === 'codex'
      ? final?.params?.turn?.status === 'completed'
      : final?.type === 'result' && final.is_error === false;
  const text = events
    .map((event) => event.params?.delta ?? event.event?.delta?.text ?? '')
    .join('');
  if (!complete || !/^orchid[.!]?$/i.test(text.trim()))
    throw Error('Trace must contain a completed synthetic answer.');
  if (JSON.stringify(events).length > 16_384) throw Error('Synthetic trace is unexpectedly large.');
  return {
    source: 'live-synthetic',
    provider,
    cliVersion,
    capturedAt: new Date().toISOString(),
    request: traceRequest,
    events,
  };
}
