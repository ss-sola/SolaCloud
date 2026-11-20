import { ResponseUtil, BaseController } from '@nest-cloud/sdk';
import { Body, Controller, Delete, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyPermissions, RequirePermissions } from '../auth/require-permissions.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../auth/system-permission.constants';
import { ACCOUNT_CONTROLLER_ROUTE } from '../account.constants';
import { AccountIdParamForm } from '../form/account-id-param.form';
import { AccountPasswordResetForm } from '../form/account-password-reset.form';
import { AccountQueryForm } from '../form/account-query.form';
import { AccountRoleSaveForm } from '../form/account-role-save.form';
import { AccountSaveForm } from '../form/account-save.form';
import { AccountService } from '../service/account.service';
import { AccountItem } from '../entity/account.entity';
type AccountListResult = Awaited<ReturnType<AccountService['listItems']>>;
type AccountCreateResult = Awaited<ReturnType<AccountService['createItem']>>;

@RequirePermissions(SYSTEM_PERMISSION_CODES.accountManage)
@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller(ACCOUNT_CONTROLLER_ROUTE)
export class AccountController extends BaseController<AccountItem, AccountService> {
  constructor(private readonly accountService: AccountService) {
    super(accountService);
  }

  @Get('overview')
  async getOverview() {
    return ResponseUtil.success(await this.accountService.getOverview());
  }

  @Get('list')
  async listItems(@Query() query: AccountQueryForm): Promise<ResponseUtil<AccountListResult>> {
    return ResponseUtil.success(await this.accountService.listItems(query));
  }

  @RequireAnyPermissions(
    SYSTEM_PERMISSION_CODES.accountManage,
    SYSTEM_PERMISSION_CODES.notificationManage,
  )
  @Get('options')
  async listOptions() {
    return ResponseUtil.success(await this.accountService.listOptions());
  }

  @Get('item')
  async getItem(@Query() query: AccountIdParamForm) {
    return ResponseUtil.success(await this.accountService.getItem(query.id));
  }

  @Post('item')
  async createItem(@Body() body: AccountSaveForm): Promise<ResponseUtil<AccountCreateResult>> {
    return ResponseUtil.success(await this.accountService.createItem(body));
  }

  @Put('item')
  async updateItem(@Query() query: AccountIdParamForm, @Body() body: AccountSaveForm) {
    return ResponseUtil.success(await this.accountService.updateItem(query.id, body));
  }

  @Delete('item')
  async removeItem(@Query() query: AccountIdParamForm) {
    return ResponseUtil.success(await this.accountService.removeItem(query.id));
  }

  @Put('password')
  async resetPassword(@Query() query: AccountIdParamForm, @Body() body: AccountPasswordResetForm) {
    return ResponseUtil.success(await this.accountService.resetPassword(query.id, body.password));
  }

  @Get('roles')
  async listRoles(@Query() query: AccountIdParamForm) {
    const account = await this.accountService.getItem(query.id);
    return ResponseUtil.success(account.roleCodes);
  }

  @Put('roles')
  async saveRoles(@Query() query: AccountIdParamForm, @Body() body: AccountRoleSaveForm) {
    return ResponseUtil.success(await this.accountService.saveRoleCodes(query.id, body.roleCodes));
  }
}
