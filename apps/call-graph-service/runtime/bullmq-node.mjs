export const bullMqLabel = (value) => (typeof value === 'string' ? value.slice(0, 160) : '');

export function bullMqNode(kind, queueName, jobName, attempt) {
  const queue = bullMqLabel(queueName);
  const name = bullMqLabel(jobName);
  const type = kind === 'queue' ? 'BullMQ 入队' : 'BullMQ Worker';
  return {
    id: 'bullmq:' + JSON.stringify([kind, queue, name, attempt]),
    name: type + ' · ' + queue + ' / ' + name + (attempt ? ' · 第 ' + attempt + ' 次' : ''),
    file: 'BullMQ',
    line: 0,
    kind,
    params: kind === 'queue' ? ['queue', 'jobName', 'data'] : ['job'],
  };
}
