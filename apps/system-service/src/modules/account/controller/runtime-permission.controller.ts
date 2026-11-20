import { ContextService, ResponseUtil, type AccountSessionRequest } from '@nest-cloud/sdk';
import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../auth/system-permission.constants';
import { PermissionCheckForm } from '../form/permission-check.form';
import { RuntimePermissionQueryForm } from '../form/runtime-permission-query.form';
import { RuntimePermissionService } from '../service/runtime-permission.service';

@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller('system/runtime-permissions')
export class RuntimePermissionController {
  constructor(private readonly runtimePermissionService: RuntimePermissionService) {}

  @Get('current')
  async getCurrent(@Req() req: AccountSessionRequest) {
    const accountId = ContextService.getCurrentAccount().accountId;
    if (!accountId) {
      return ResponseUtil.success(undefined);
    }
    const runtime = await this.runtimePermissionService.getRuntimeByAccountId(accountId);
    return ResponseUtil.success({
      account: runtime.account,
      roleCodes: runtime.roleCodes,
      menuTree: runtime.menuTree,
    });
  }

  @Post('check')
  @HttpCode(200)
  async check(@Body() body: PermissionCheckForm, @Req() req: AccountSessionRequest) {
    const accountId = ContextService.getCurrentAccount().accountId;
    if (!accountId) {
      return ResponseUtil.success({
        allowed: false,
        missingPermissionCodes: body.permissionCodes,
      });
    }
    return ResponseUtil.success(
      await this.runtimePermissionService.checkPermissions(accountId, body.permissionCodes),
    );
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.accountManage)
  @Post('refresh')
  @HttpCode(200)
  refresh(@Query() query: RuntimePermissionQueryForm) {
    if (query.accountId) {
      this.runtimePermissionService.invalidateAccount(query.accountId);
    } else {
      this.runtimePermissionService.invalidateAll();
    }
    return ResponseUtil.success({ success: true });
  }
}
