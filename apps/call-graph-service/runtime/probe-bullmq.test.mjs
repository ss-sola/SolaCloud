import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const port = Number(process.env.SOLA_BULLMQ_TEST_PORT);

for (const sameProcess of [true, false])
  test(
    (sameProcess ? '同进程' : '跨进程') + ' BullMQ 在 HTTP 完成后仍回传 Worker 两次尝试和内部方法',
    {
      skip: !port && '设置 SOLA_BULLMQ_TEST_PORT 以使用专用测试 Redis',
      timeout: 20000,
    },
    async (t) => {
      const target = await mkdtemp(path.join(tmpdir(), 'sola-graph-bullmq-'));
      const source = path.join(target, 'src');
      const children = [];
      t.after(async () => {
        await Promise.all(
          children.map(async (child) => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const exited = once(child, 'exit');
            child.kill();
            await exited;
          }),
        );
        await rm(target, { recursive: true, force: true });
      });
      await mkdir(source);
      const packagePath = createRequire(import.meta.url).resolve('bullmq');
      const httpFile = sameProcess ? 'http.mts' : 'http.cjs';
      const workerFile = sameProcess ? 'worker.mts' : 'worker.cjs';
      const queueName = 'trace-' + randomUUID();
      const bindings = [
        sameProcess
          ? 'import { Queue, Worker } from ' + JSON.stringify(pathToFileURL(packagePath).href) + ';'
          : 'const { Queue, Worker } = require(' + JSON.stringify(packagePath) + ');',
        'const opts = { connection: { host: "127.0.0.1", port: ' + port + ' } };',
        'const queueName = ' + JSON.stringify(queueName) + ';',
      ].join('\n');
      const httpSource =
        bindings +
        `
${sameProcess ? "import http from 'node:http';" : "const http = require('node:http');"}
const queue = new Queue(queueName, opts);
class ExportService {
  static async submit() {
    const job = await queue.add('calculate', { value: 3, token: 'private-job-input' }, { attempts: 2, jobId: 'fixture-job' });
    return job.id;
  }
}
async function handler() {
  return ExportService.submit();
}
http.createServer(async (_req, res) => res.end(await handler())).listen(0, '127.0.0.1');
${sameProcess ? "process.once('message', () => import('./worker.mts'));" : ''}
`;
      const workerSource =
        bindings +
        `
function calculate(n) { return n * 2; }
async function task(job) {
  if (job.data.token !== 'private-job-input') throw new Error('payload changed');
  const output = calculate(job.data.value);
  if (!job.attemptsMade) throw new Error('first attempt');
  return { output, token: 'private-job-output' };
}
const worker = new Worker(queueName, task, opts);
worker.on('completed', (job, result) => process.send({ type: 'fixtureComplete', jobId: job.id, output: result.output }));
`;
      await Promise.all([
        writeFile(path.join(source, httpFile), httpSource),
        writeFile(path.join(source, workerFile), workerSource),
      ]);
      const routes = [
        {
          id: 'enqueue',
          method: 'GET',
          path: '/enqueue',
          roots: ['src/' + httpFile + ':' + httpSource.indexOf('async function handler')],
        },
      ];
      const queueKey = randomUUID();
      const events = [];
      function launch(name, workerOnly) {
        const entry = path.join(source, name);
        const child = fork(entry, {
          cwd: target,
          execArgv: ['--import', new URL('./probe.mjs', import.meta.url).href],
          env: { ...process.env, SOLA_CALL_GRAPH_PROJECT: '1' },
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
        children.push(child);
        child.on('message', (message) => {
          if (message.type === 'events') events.push(...message.events);
          else events.push(message);
        });
        child.send({ type: 'configure', routes, framework: 'koa', entry, workerOnly, queueKey });
        return child;
      }
      async function until(predicate) {
        for (let i = 0; i < 500; i++) {
          const result = predicate();
          if (result) return result;
          await delay(20);
        }
        assert.fail(
          'Expected event not found. Received: ' +
            events
              .map((event) => event.type + (event.node ? ':' + event.node.name : ''))
              .join(', '),
        );
      }

      const http = launch(httpFile, false);
      const listening = await until(() => events.find((event) => event.type === 'listening'));
      const response = await fetch('http://127.0.0.1:' + listening.port + '/enqueue');
      assert.equal(response.status, 200);
      const jobId = await response.text();
      const end = await until(() => events.find((event) => event.type === 'end'));

      if (sameProcess) http.send({ type: 'start-fixture-worker' });
      else launch(workerFile, true);
      const completed = await until(() => events.find((event) => event.type === 'fixtureComplete'));
      const attempts = await until(() => {
        const worker = events.filter(
          (event) => event.type === 'enter' && event.node.kind === 'worker',
        );
        return (
          worker.length === 2 &&
          worker.every((call) =>
            events.some((event) => event.type === 'leave' && event.callId === call.callId),
          ) &&
          worker
        );
      });
      const queue = events.find((event) => event.type === 'enter' && event.node.kind === 'queue');
      assert.ok(queue);
      assert.ok(
        events.some(
          (event) =>
            event.type === 'enter' &&
            event.node.name === 'ExportService.submit' &&
            event.callId === queue.parentId,
        ),
      );
      assert.equal(
        events.find((event) => event.type === 'leave' && event.callId === queue.callId).result
          .jobId,
        jobId,
      );
      assert.equal(completed.jobId, jobId);
      assert.equal(completed.output, 6);
      for (const [index, call] of attempts.entries()) {
        assert.ok(events.indexOf(call) > events.indexOf(end));
        assert.equal(call.requestId, end.requestId);
        assert.equal(call.parentId, queue.callId);
        assert.equal(call.args[0].value.attempt, index + 1);
        assert.ok(call.args[0].value.waitMs >= 0);
        const task = events.find(
          (event) =>
            event.type === 'enter' && event.parentId === call.callId && event.node.name === 'task',
        );
        assert.ok(task);
        assert.ok(
          events.some(
            (event) =>
              event.type === 'enter' &&
              event.parentId === task.callId &&
              event.node.name === 'calculate',
          ),
        );
        const exit = events.find((event) => event.type === 'leave' && event.callId === call.callId);
        assert.equal(exit.state, index === 0 ? 'error' : 'ok');
        assert.ok(exit.durationMs >= 0);
      }
      assert.notEqual(attempts[0].callId, attempts[1].callId);
      assert.doesNotMatch(JSON.stringify(events), /private-job-(input|output)/);
    },
  );
