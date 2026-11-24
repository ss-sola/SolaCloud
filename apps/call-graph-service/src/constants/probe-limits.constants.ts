export const PROBE_DICTIONARY = { namespace: 'system', aggregateKey: 'api_call_graph_probe' };

/** 已有安装缺少某个字典项时，沿用该项原有的采集行为。 */
export const DEFAULT_PROBE_LIMITS = { maxCallsPerRequest: 0, maxSnapshotValuesPerCall: 1000 };
export type ProbeLimits = typeof DEFAULT_PROBE_LIMITS;
