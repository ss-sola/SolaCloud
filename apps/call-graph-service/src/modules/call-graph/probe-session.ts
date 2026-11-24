import { ProjectException } from '@nest-cloud/sdk';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';

const HISTORY_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 12_000;
const HEARTBEAT_MS = 15_000;
const MAX_STREAMS = 4;
export type ProbeEvent = { type: string; [key: string]: unknown };
type StreamEntry = { seq: number; line: string; size: number; next?: StreamEntry };
type Subscriber = {
  response: Response;
  cursor: StreamEntry;
  replayThrough: number;
  live: boolean;
  blocked: boolean;
};

/** 新订阅从有界历史中回放，已连接的订阅保留其尚未送达的事件。 */
export class ProbeSession {
  readonly id = randomUUID();
  private readonly clients = new Set<Subscriber>();
  private readonly history = new Map<number, StreamEntry>();
  private tail: StreamEntry = { seq: 0, line: '', size: 0 };
  private firstSeq = 1;
  private bytes = 0;
  closed = false;
  constructor(readonly owner: number) {}

  publish(event: ProbeEvent) {
    if (this.closed) return;
    const seq = this.tail.seq + 1;
    const line = JSON.stringify({ ...event, seq }) + '\n';
    const size = Buffer.byteLength(line);
    const entry = { seq, line, size };
    this.tail.next = entry;
    this.tail = entry;
    this.history.set(seq, entry);
    this.bytes += size;
    while (
      this.history.size > 1 &&
      (this.bytes > HISTORY_BYTES || this.history.size > MAX_EVENTS)
    ) {
      this.bytes -= this.history.get(this.firstSeq)!.size;
      this.history.delete(this.firstSeq++);
    }
    for (const client of this.clients) this.flush(client);
  }

  /** write(false) 已接收当前行。drain 后沿游标继续，多个浏览器共享一份历史事件。 */
  private flush(client: Subscriber) {
    const res = client.response;
    if (res.destroyed || res.writableEnded) return;
    while (!client.blocked) {
      if (!client.live && client.cursor.seq === client.replayThrough && !this.closed) {
        client.live = true;
        client.blocked = !res.write('\n');
        continue;
      }
      const entry = client.cursor.next;
      if (!entry) break;
      client.cursor = entry;
      client.blocked = !res.write(entry.line);
    }
    if (this.closed && client.cursor === this.tail) res.end();
  }

  stream(after: number, res: Response) {
    if (after < this.firstSeq - 1)
      throw new ProjectException('历史事件已过期，请重新启动探针', 410);
    if (after > this.tail.seq) throw new ProjectException('事件游标无效', 400);
    if (this.clients.size >= MAX_STREAMS) throw new ProjectException('会话连接数达到上限', 429);
    res.set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const client = {
      response: res,
      cursor:
        after === this.tail.seq
          ? this.tail
          : (this.history.get(after) ?? {
              seq: after,
              line: '',
              size: 0,
              next: this.history.get(after + 1),
            }),
      replayThrough: this.tail.seq,
      live: false,
      blocked: false,
    };
    this.clients.add(client);
    const drain = () => {
      client.blocked = false;
      this.flush(client);
    };
    res.on('drain', drain);
    const heartbeat = setInterval(() => {
      if (client.live && !client.blocked && !res.writableEnded && !res.destroyed)
        client.blocked = !res.write('\n');
    }, HEARTBEAT_MS);
    const cleanup = () => {
      clearInterval(heartbeat);
      res.off('drain', drain);
      this.clients.delete(client);
    };
    res.once('close', cleanup);
    res.once('finish', cleanup);
    this.flush(client);
  }

  finish(state: 'stopped' | 'error', message: string) {
    if (this.closed) return;
    this.publish({ type: 'status', state, message });
    this.closed = true;
    for (const client of this.clients) this.flush(client);
  }
}
