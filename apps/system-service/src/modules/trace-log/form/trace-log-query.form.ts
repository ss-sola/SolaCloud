import { Matches } from 'class-validator';
import { TRACE_ID_PATTERN } from '../../../constants/trace-log.constants';

export class TraceLogQueryForm {
  @Matches(TRACE_ID_PATTERN, { message: 'traceId 必须是 32 位非全零十六进制字符' })
  traceId!: string;
}
