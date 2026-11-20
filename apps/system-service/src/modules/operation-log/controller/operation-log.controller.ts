import { ResponseUtil, BaseController } from '@nest-cloud/sdk';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../../account/auth/permission.guard';
import { RequirePermissions } from '../../account/auth/require-permissions.decorator';
import { SessionAuthGuard } from '../../account/auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../../account/auth/system-permission.constants';
import { OPERATION_LOG_CONTROLLER_ROUTE } from '../operation-log.constants';
import { OperationLogQueryForm } from '../form/operation-log-query.form';
import { OperationLogService } from '../service/operation-log.service';
import { OperationLogItem } from '../entity/operation-log.entity';
type OperationLogListResult = Awaited<ReturnType<OperationLogService['listItems']>>;

@RequirePermissions(SYSTEM_PERMISSION_CODES.operationLogQuery)
@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller(OPERATION_LOG_CONTROLLER_ROUTE)
export class OperationLogController extends BaseController<OperationLogItem, OperationLogService> {
  constructor(private readonly operationLogService: OperationLogService) {
    super(operationLogService);
  }

  @Get('overview')
  async getOverview() {
    return ResponseUtil.success(await this.operationLogService.getOverview());
  }

  @Get('list')
  async listItems(
    @Query() query: OperationLogQueryForm,
  ): Promise<ResponseUtil<OperationLogListResult>> {
    return ResponseUtil.success(await this.operationLogService.listItems(query));
  }
}
