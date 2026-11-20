import { ResponseUtil, type AccountSessionRequest } from '@nest-cloud/sdk';
import { Body, Controller, Delete, Get, Query, Req, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../../account/auth/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../account/auth/require-permissions.decorator';
import { SessionAuthGuard } from '../../account/auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../../account/auth/system-permission.constants';
import { KickOnlineUserForm } from '../form/kick-online-user.form';
import { OnlineUserQueryForm } from '../form/online-user-query.form';
import { MONITOR_CONTROLLER_ROUTE } from '../monitor.constants';
import { OnlineUserService } from '../service/online-user.service';
import { ServiceMonitorService } from '../service/service-monitor.service';

@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller(MONITOR_CONTROLLER_ROUTE)
export class MonitorController {
  constructor(
    private readonly onlineUserService: OnlineUserService,
    private readonly serviceMonitorService: ServiceMonitorService,
  ) {}

  @RequireAnyPermissions(
    SYSTEM_PERMISSION_CODES.onlineUserMonitorQuery,
    SYSTEM_PERMISSION_CODES.serviceMonitorQuery,
  )
  @Get('overview')
  getOverview() {
    return ResponseUtil.success(this.onlineUserService.getOverview());
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.serviceMonitorQuery)
  @Get('service')
  async getServiceMetrics() {
    return ResponseUtil.success(await this.serviceMonitorService.getServiceMetrics());
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.onlineUserMonitorQuery)
  @Get('online-users')
  listOnlineUsers(@Query() query: OnlineUserQueryForm) {
    return ResponseUtil.success(this.onlineUserService.listItems(query));
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.onlineUserMonitorKick)
  @Delete('online-users')
  async kickOnlineUser(@Body() body: KickOnlineUserForm, @Req() req: AccountSessionRequest) {
    return ResponseUtil.success(
      await this.onlineUserService.kickOffline({
        sessionId: body.sessionId,
        operatorSessionId: req.sessionID,
      }),
    );
  }
}
