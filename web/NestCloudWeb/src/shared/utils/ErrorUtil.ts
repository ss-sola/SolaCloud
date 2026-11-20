/**
 * 错误信息提取工具
 */
export class ErrorUtil {
  /** 从 unknown 类型的错误中提取消息，提取失败时返回 fallback */
  static getMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }
}
