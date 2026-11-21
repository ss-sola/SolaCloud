import { ResponseUtil } from '@nest-cloud/sdk';
import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { TraceLogDetailForm } from '../form/trace-log-detail.form';
import { TraceLogQueryForm } from '../form/trace-log-query.form';
import { TraceLogService } from '../service/trace-log.service';
import { TraceLogAccessGuard } from '../trace-log-access.guard';

@UseGuards(TraceLogAccessGuard)
@Controller('system/trace-logs')
export class TraceLogController {
  constructor(private readonly traceLogService: TraceLogService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async query(@Query() { traceId }: TraceLogQueryForm) {
    return ResponseUtil.success(await this.traceLogService.query(traceId));
  }

  @Get('detail')
  @Header('Cache-Control', 'no-store')
  async detail(@Query() { traceId, entryId }: TraceLogDetailForm) {
    return ResponseUtil.success(await this.traceLogService.detail(traceId, entryId));
  }
}
