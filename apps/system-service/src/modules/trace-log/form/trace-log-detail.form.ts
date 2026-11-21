import { Matches, MaxLength } from 'class-validator';
import { TRACE_ENTRY_ID_MAX_LENGTH } from '../../../constants/trace-log.constants';
import { TraceLogQueryForm } from './trace-log-query.form';

export class TraceLogDetailForm extends TraceLogQueryForm {
  @Matches(/^[a-zA-Z0-9_-]+$/)
  @MaxLength(TRACE_ENTRY_ID_MAX_LENGTH)
  entryId!: string;
}
