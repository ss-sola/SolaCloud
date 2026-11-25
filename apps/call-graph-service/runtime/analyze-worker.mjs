import { parentPort, workerData } from 'node:worker_threads';
import { createAnalyzer } from './analyzer.mjs';

// 类型检查器保留在独立线程内，暂停图计算不会阻塞事件流或心跳。
let analyzer;
parentPort.on('message', ({ id, routeId, probeRoutes }) => {
  try {
    if (!routeId && !probeRoutes) analyzer = createAnalyzer(workerData);
    if (!analyzer) throw new Error('请先扫描项目目录');
    let value;
    if (probeRoutes) value = analyzer.probeRoutes();
    else if (routeId) value = analyzer.graph(routeId);
    else
      value = {
        framework: analyzer.framework,
        entry: analyzer.entry,
        workerEntries: analyzer.workerEntries,
        routes: analyzer.routes,
        warnings: analyzer.warnings,
      };
    parentPort.postMessage({ id, value });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
