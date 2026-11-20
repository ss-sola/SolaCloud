import { ResponseUtil, BaseController } from '@nest-cloud/sdk';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../auth/system-permission.constants';
import { LoginLogQueryForm } from '../form/login-log-query.form';
import { LoginLogService } from '../service/login-log.service';
import { LoginLogItem } from '../entity/login-log.entity';
type LoginLogListResult = Awaited<ReturnType<LoginLogService['listItems']>>;

@RequirePermissions(SYSTEM_PERMISSION_CODES.loginLogQuery)
@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller('system/login-logs')
export class LoginLogController extends BaseController<LoginLogItem, LoginLogService> {
  constructor(private readonly loginLogService: LoginLogService) {
    super(loginLogService);
  }

  @Get('overview')
  async getOverview() {
    return ResponseUtil.success(await this.loginLogService.getOverview());
  }

  @Get('list')
  async listItems(@Query() query: LoginLogQueryForm): Promise<ResponseUtil<LoginLogListResult>> {
    return ResponseUtil.success(await this.loginLogService.listItems(query));
  }
}
