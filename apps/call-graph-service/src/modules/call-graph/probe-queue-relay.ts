import type { ProbeEvent } from './probe-session';

/** 两个 IPC 通道可能以不同顺序到达，Worker 事件必须在入队节点之后转发。 */
export class ProbeQueueRelay {
  private readonly anchors = new Set<string>();
  private readonly pending = new Map<string, ProbeEvent[]>();

  constructor(private readonly publish: (event: ProbeEvent) => void) {}

  accept(event: ProbeEvent): void {
    if (typeof event.requestId !== 'string') {
      this.publish(event);
      return;
    }
    if (typeof event.queueAnchor === 'string') {
      const key = this.key(event.requestId, event.queueAnchor);
      if (!this.anchors.has(key)) {
        const events = this.pending.get(key);
        if (events) events.push(event);
        else this.pending.set(key, [event]);
        return;
      }
    }
    this.publish(event);
    if (
      event.type !== 'enter' ||
      typeof event.callId !== 'string' ||
      (event.node as { kind?: string } | undefined)?.kind !== 'queue'
    )
      return;
    const key = this.key(event.requestId, event.callId);
    this.anchors.add(key);
    const queued = this.pending.get(key);
    this.pending.delete(key);
    for (const descendant of queued ?? []) this.accept(descendant);
  }

  private key(requestId: string, anchor: string): string {
    return requestId + '\0' + anchor;
  }
}
