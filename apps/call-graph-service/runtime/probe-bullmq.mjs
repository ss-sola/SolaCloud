import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { types } from 'node:util';
import { bullMqLabel, bullMqNode } from './bullmq-node.mjs';

const marker = 'solaCallGraphLink';
const hookKey = 'solacloud.api-call-graph.bullmq';
const patched = new WeakSet();

function signer(key) {
  const sign = (payload) => createHmac('sha256', key).update(payload).digest('base64url');
  return {
    encode(value) {
      const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
      return payload + '.' + sign(payload);
    },
    decode(value) {
      if (typeof value !== 'string' || value.length > 4096) return;
      const [payload, signature, extra] = value.split('.');
      if (extra !== undefined || !payload || !/^[\w-]{43}$/.test(signature ?? '')) return;
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return;
      try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (
          typeof parsed.requestId === 'string' &&
          typeof parsed.routeId === 'string' &&
          typeof parsed.parentId === 'string'
        )
          return parsed;
      } catch {
        /* ignore metadata that does not belong to this probe */
      }
    },
  };
}

function canAttach(opts) {
  if (opts == null) return true;
  if (typeof opts !== 'object' || types.isProxy(opts)) return false;
  const proto = Object.getPrototypeOf(opts);
  return (
    (proto === Object.prototype || proto === null) &&
    !(marker in opts) &&
    Object.values(Object.getOwnPropertyDescriptors(opts)).every((property) => 'value' in property)
  );
}

/** 在目标应用正常加载 BullMQ 时接入，兼容其 CJS 与 ESM 类模块。 */
export function installBullMqHook({ key, currentLink, observeQueue, observeWorker, warn }) {
  if (!key) return;
  const links = signer(key);

  function installQueue(Queue) {
    const proto = Queue?.prototype;
    if (!proto || patched.has(proto) || typeof proto.add !== 'function') return;
    patched.add(proto);
    const add = proto.add;
    proto.add = function (...args) {
      const context = currentLink();
      const [name, data, opts] = args;
      if (!context || !canAttach(opts)) return Reflect.apply(add, this, args);
      const queue = bullMqLabel(this.name);
      return observeQueue(bullMqNode('queue', queue, name), [queue, name, data], () => {
        const parent = currentLink();
        if (!parent || parent.parentId === context.parentId) return Reflect.apply(add, this, args);
        // BullMQ serializes this additive job option with the job and keeps job.data/telemetry intact.
        const options = { ...opts, [marker]: links.encode(parent) };
        return Reflect.apply(add, this, [name, data, options, ...args.slice(3)]);
      });
    };
  }

  function installWorker(Worker) {
    const proto = Worker?.prototype;
    if (!proto || patched.has(proto)) return;
    if (typeof proto.callProcessJob !== 'function') {
      warn('当前 BullMQ 版本缺少可识别的 Worker 执行入口。');
      return;
    }
    patched.add(proto);
    const processJob = proto.callProcessJob;
    proto.callProcessJob = function (...args) {
      const run = () => Reflect.apply(processJob, this, args);
      const job = args[0];
      const link = links.decode(job?.opts?.[marker]);
      if (!link) return run();
      const queue = bullMqLabel(this.name);
      const name = bullMqLabel(job.name);
      const attempt = job.attemptsStarted || (job.attemptsMade ?? 0) + 1;
      const waitMs =
        Number.isFinite(job.timestamp) && Number.isFinite(job.processedOn)
          ? Math.max(0, job.processedOn - job.timestamp)
          : undefined;
      return observeWorker(
        link,
        bullMqNode('worker', queue, name, attempt),
        [{ queue, jobName: name, jobId: job.id, attempt, waitMs, data: job.data }],
        run,
      );
    };
  }

  Object.defineProperty(globalThis, Symbol.for(hookKey), {
    value: { installQueue, installWorker },
  });
  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      const type = /\/node_modules\/bullmq\/dist\/(?:cjs|esm)\/classes\/(queue|worker)\.js$/.exec(
        url,
      )?.[1];
      if (!type) return loaded;
      const name = type === 'queue' ? 'Queue' : 'Worker';
      try {
        const source = Buffer.from(loaded.source ?? readFileSync(new URL(url))).toString('utf8');
        return {
          ...loaded,
          source:
            source +
            `\n;globalThis[Symbol.for(${JSON.stringify(hookKey)})]?.install${name}(typeof ${name} === 'function' ? ${name} : undefined);\n`,
        };
      } catch {
        warn('无法接入当前 BullMQ 模块。');
        return loaded;
      }
    },
  });
}
