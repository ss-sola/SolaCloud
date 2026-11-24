import { useEffect, useRef, useState } from 'react';
import { ApiCallGraph, type AgentEvent, type ProjectRoute } from '../api/apiCallGraph';
import { applyEvents, emptyRecording } from '../utils/apiCallTrace';
import { requestRouteResolver } from '../utils/apiProbeRoute';

interface Session {
  id: string;
  resolveRoute: ReturnType<typeof requestRouteResolver>;
}
const flushDelayMs = 40;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useCallGraphProbe() {
  const [session, setSession] = useState<Session>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [streamError, setStreamError] = useState('');
  const [streamWarning, setStreamWarning] = useState('');
  const [recording, setRecording] = useState(emptyRecording);
  const [retry, setRetry] = useState(0);
  const cursor = useRef(0);
  const mounted = useRef(false);
  const owned = useRef<Session>(undefined);
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const release = () => {
      const active = owned.current;
      if (active) void ApiCallGraph.stop(active.id).catch(() => undefined);
    };
    window.addEventListener('pagehide', release);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', release);
      release();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const queue: AgentEvent[] = [];
    let successes = new Set<number>();
    let successfulRequests = new Set<string>();
    let receivedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let terminal = false;
    function flush() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const batch = queue.splice(0);
      if (batch.length && mounted.current) {
        const returns = successes.size
          ? { sequences: successes, receivedAt, requestIds: successfulRequests }
          : undefined;
        successes = new Set();
        successfulRequests = new Set();
        setRecording((prev) => {
          const next = applyEvents(prev, batch);
          if (returns) next.liveReturns = returns;
          return next;
        });
      }
    }
    setStreamError('');
    void ApiCallGraph.events(session.id, cursor.current, controller.signal, (event, live) => {
      if (controller.signal.aborted || event.seq <= cursor.current) return;
      if (event.seq > cursor.current + 1)
        setStreamWarning('较早的探针事件已过期，本次记录可能不完整。');
      cursor.current = event.seq;
      if (event.type === 'request') {
        const routeId = session.resolveRoute(event);
        if (routeId === undefined) return;
        event = { ...event, routeId };
      }
      queue.push(event);
      if (live && event.type === 'leave' && event.state === 'ok') {
        successes.add(event.seq);
        successfulRequests.add(event.requestId);
        receivedAt = performance.now();
      }
      if (event.type === 'status' && (event.state === 'stopped' || event.state === 'error')) {
        terminal = true;
        owned.current = undefined;
        flush();
        setSession(undefined);
      } else if (timer === undefined) {
        timer = setTimeout(flush, flushDelayMs);
      }
    })
      .then(() => {
        if (!controller.signal.aborted && !terminal)
          setStreamError('实时连接已断开，可从上次收到的事件继续。');
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setStreamError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) flush();
      });
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [session, retry]);

  function reset() {
    setRecording(emptyRecording());
    setError('');
    setStreamError('');
    setStreamWarning('');
  }

  async function start(project: string, routes: readonly ProjectRoute[]) {
    if (pending.current || owned.current) return;
    pending.current = true;
    setBusy(true);
    reset();
    try {
      const { sessionId: id } = await ApiCallGraph.start(project);
      if (!mounted.current) {
        await ApiCallGraph.stop(id);
        return;
      }
      owned.current = { id, resolveRoute: requestRouteResolver(routes) };
      cursor.current = 0;
      setSession(owned.current);
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function stop() {
    const active = owned.current;
    if (!active || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await ApiCallGraph.stop(active.id);
      if (mounted.current && owned.current && streamError) {
        // A successful stop is authoritative when the replay cursor has already expired.
        owned.current = undefined;
        setSession(undefined);
        setStreamWarning('已停止探针。断开期间的事件可能缺失。');
        setStreamError('');
        setRecording((previous) => ({
          ...previous,
          status: { seq: cursor.current, type: 'status', state: 'stopped' },
        }));
      }
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return {
    active: Boolean(session),
    busy,
    recording,
    error,
    streamError,
    streamWarning,
    start,
    stop,
    reset,
    reconnect: () => setRetry((value) => value + 1),
  };
}
