import { CHAT_ROLE, ChatRole, SSE_EVENT_TYPE } from '../../constants/rag.constants';

export { CHAT_ROLE, ChatRole, SSE_EVENT_TYPE };

// ---------------------------------------------------------------------------
// Deep Agents 错误码常量
// ---------------------------------------------------------------------------

/** 内部错误 */
export const DEEP_AGENT_ERROR_CODE_INTERNAL = 'DEEP_AGENT_INTERNAL';

/** 模型不可用（配置缺失、认证失败等） */
export const DEEP_AGENT_ERROR_CODE_MODEL_UNAVAILABLE = 'DEEP_AGENT_MODEL_UNAVAILABLE';

/** 检索失败（RAG Tool 报错） */
export const DEEP_AGENT_ERROR_CODE_RETRIEVAL_FAILED = 'DEEP_AGENT_RETRIEVAL_FAILED';

/** 流式响应已取消 */
export const DEEP_AGENT_ERROR_CODE_STREAM_CANCELLED = 'DEEP_AGENT_STREAM_CANCELLED';

/** 工作区不存在 */
export const DEEP_AGENT_ERROR_CODE_WORKSPACE_NOT_FOUND = 'DEEP_AGENT_WORKSPACE_NOT_FOUND';

/** 会话不存在 */
export const DEEP_AGENT_ERROR_CODE_SESSION_NOT_FOUND = 'DEEP_AGENT_SESSION_NOT_FOUND';

/** 上下文长度超限 */
export const DEEP_AGENT_ERROR_CODE_CONTEXT_LIMIT_EXCEEDED = 'DEEP_AGENT_CONTEXT_LIMIT_EXCEEDED';

/** LLM 调用超时 */
export const DEEP_AGENT_ERROR_TIMEOUT = 'DEEP_AGENT_TIMEOUT';
