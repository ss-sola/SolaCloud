import express from 'express';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { expect, it } from 'vitest';
import { DEFAULT_PROBE_LIMITS } from '../constants/probe-limits.constants';
import { ProbeProcessService } from '../modules/call-graph/probe-process.service';
import type { ProbeEvent } from '../modules/call-graph/probe-session';

const iterations = 16_000;
const file = 'src/index.ts';
const source = `
  import { createServer } from 'node:http';
  function step(n: number) { return n + 1; }
  function tail(n: number) { return n * 2; }
  function burst() {
    let n = 0;
    for (let i = 0; i < ${iterations}; i++) n = step(n);
    return tail(n);
  }
  function label(id: string) { return 'item-' + id; }
  function readItem(id: string) { return label(id); }
  createServer((req, res) => {
    res.end(req.url === '/burst' ? String(burst()) : readItem(req.url.slice('/items/'.length)));
  }).listen(0, '127.0.0.1');
`;

function route(pathname: string, handler: string) {
  const offset = source.indexOf('function ' + handler + '(');
  return {
    id: 'GET ' + pathname,
    method: 'GET',
    path: pathname,
    roots: [file + ':' + offset],
  };
}

interface Frame extends ProbeEvent {
  seq: number;
  callId?: string;
  requestId?: string;
  node?: { name: string };
}

async function readBothRequests(
  stream: IncomingMessage,
  onListening: (port: number) => void,
  stop: () => Promise<unknown>,
) {
  const frames: Frame[] = [];
  let ended = 0;
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line) continue;
    const frame: Frame = JSON.parse(line);
    frames.push(frame);
    if (frame.type === 'status' && frame.state === 'listening') onListening(Number(frame.port));
    if (frame.type === 'end' && ++ended === 2) await stop();
  }
  if (ended === 2) return frames;
  throw new Error('NDJSON 连接在请求结束事件到达前断开');
}

it('同一项目探针通过 HTTP 实时完整记录高频同步调用、尾部方法和第二个参数化接口', async () => {
  const project = await realpath(await mkdtemp(path.join(os.tmpdir(), 'call-graph-volume-')));
  const probes = new ProbeProcessService();
  const owner = 41;
  const burst = route('/burst', 'burst');
  const item = route('/items/:id', 'readItem');
  const app = express();
  const server = createServer(app);
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(35_000)]);
  try {
    await mkdir(path.join(project, 'src'));
    await Promise.all([
      writeFile(path.join(project, file), source),
      writeFile(path.join(project, 'package.json'), '{"type":"module"}'),
    ]);
    const target = {
      project,
      framework: 'koa' as const,
      entry: file,
      routes: [burst, item],
      computations: () => undefined,
    };
    const { sessionId } = probes.start(owner, target, DEFAULT_PROBE_LIMITS);
    app.get('/events', (_req, res) => probes.owned(owner, sessionId).stream(0, res));
    const bound = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await bound;
    const eventsUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/events';
    const stream = await new Promise<IncomingMessage>((resolve, reject) => {
      get(eventsUrl, { signal }, resolve).once('error', reject);
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('application/x-ndjson');

    let onListening!: (port: number) => void;
    const listening = new Promise<number>((resolve) => {
      onListening = resolve;
    });
    const [frames, responses] = await Promise.all([
      readBothRequests(stream, onListening, () => probes.stop(owner, sessionId)),
      listening.then(async (port) => {
        const origin = 'http://127.0.0.1:' + port;
        const first = await fetch(origin + '/burst', { signal });
        const result = await first.text();
        const second = await fetch(origin + '/items/42', { signal });
        return [result, await second.text()];
      }),
    ]);
    expect(responses).toEqual([String(iterations * 2), 'item-42']);
    expect(frames.every((frame, index) => frame.seq === index + 1)).toBe(true);
    const requests = frames.filter((frame) => frame.type === 'request');
    expect(requests.map((frame) => frame.routeId)).toEqual([burst.id, item.id]);
    expect(requests.map((frame) => frame.path)).toEqual(['/burst', '/items/42']);
    expect(new Set(requests.map((frame) => frame.requestId)).size).toBe(2);
    const traces = requests.map((request) =>
      frames.filter((frame) => frame.requestId === request.requestId),
    );
    for (const trace of traces) {
      const enters = trace.filter((frame) => frame.type === 'enter');
      const leaves = trace.filter((frame) => frame.type === 'leave');
      expect(trace.at(-1)).toMatchObject({ type: 'end', status: 200, dropped: 0 });
      const starts = new Map(enters.map((frame) => [frame.callId, frame.seq]));
      expect(starts.size).toBe(enters.length);
      expect(leaves).toHaveLength(starts.size);
      expect(new Set(leaves.map((frame) => frame.callId)).size).toBe(starts.size);
      expect(
        leaves.every((frame) => frame.state === 'ok' && starts.get(frame.callId)! < frame.seq),
      ).toBe(true);
    }
    const repeated = traces[0].filter((frame) => frame.type === 'enter');
    expect(repeated).toHaveLength(iterations + 2);
    expect(repeated[0]).toMatchObject({ node: { name: 'burst' }, parentId: null });
    expect(
      repeated
        .slice(1, -1)
        .every((frame) => frame.node?.name === 'step' && frame.parentId === repeated[0].callId),
    ).toBe(true);
    const last = repeated.at(-1)!;
    expect(last).toMatchObject({
      node: { name: 'tail' },
      parentId: repeated[0].callId,
      args: [{ name: 'n', value: iterations }],
    });
    expect(
      traces[0].find((frame) => frame.type === 'leave' && frame.callId === last.callId),
    ).toMatchObject({ result: iterations * 2, durationMs: expect.any(Number) });
    const distinct = traces[1].filter((frame) => frame.type === 'enter');
    expect(distinct.map((frame) => frame.node?.name)).toEqual(['readItem', 'label']);
    expect(distinct[1]).toMatchObject({
      parentId: distinct[0].callId,
      args: [{ name: 'id', value: '42' }],
    });
  } finally {
    abort.abort();
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await probes.onModuleDestroy();
    await rm(project, { recursive: true, force: true });
  }
}, 45_000);
