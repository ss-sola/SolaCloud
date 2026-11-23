import { Logger } from '@nestjs/common';
import { HttpTraceLog } from '@solacloud/http-trace-log';

export class SystemRequestLog {
  static readonly observe = HttpTraceLog.observe(new Logger(SystemRequestLog.name));
}
