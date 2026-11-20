import { ResponseUtil, BaseController } from '@nest-cloud/sdk';
import { Body, Controller, Delete, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../../account/auth/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../account/auth/require-permissions.decorator';
import { SessionAuthGuard } from '../../account/auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../../account/auth/system-permission.constants';
import { ROLE_CONTROLLER_ROUTE } from '../role.constants';
import { RoleIdParamForm } from '../form/role-id-param.form';
import { RoleQueryForm } from '../form/role-query.form';
import { RoleRuntimeQueryForm } from '../form/role-runtime-query.form';
import { RoleSaveForm } from '../form/role-save.form';
import { RoleService } from '../service/role.service';
import { RoleItem } from '../entity/role.entity';
type RoleListResult = Awaited<ReturnType<RoleService['listItems']>>;
type RoleCreateResult = Awaited<ReturnType<RoleService['createItem']>>;

@RequirePermissions(SYSTEM_PERMISSION_CODES.roleManage)
@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller(ROLE_CONTROLLER_ROUTE)
export class RoleController extends BaseController<RoleItem, RoleService> {
  constructor(private readonly roleService: RoleService) {
    super(roleService);
  }

  @Get('overview')
  async getOverview() {
    return ResponseUtil.success(await this.roleService.getOverview());
  }

  @Get('list')
  async listItems(@Query() query: RoleQueryForm): Promise<ResponseUtil<RoleListResult>> {
    return ResponseUtil.success(await this.roleService.listItems(query));
  }

  @RequireAnyPermissions(SYSTEM_PERMISSION_CODES.roleManage, SYSTEM_PERMISSION_CODES.accountManage)
  @Get('options')
  async listOptions() {
    return ResponseUtil.success(await this.roleService.listOptions());
  }

  @Get('item')
  async getItem(@Query() query: RoleIdParamForm) {
    return ResponseUtil.success(await this.roleService.getItem(query.id));
  }

  @Get('runtime')
  async getRuntime(@Query() query: RoleRuntimeQueryForm) {
    return ResponseUtil.success(await this.roleService.getRuntimeByRoleCode(query.roleCode));
  }

  @Post('item')
  async createItem(@Body() body: RoleSaveForm): Promise<ResponseUtil<RoleCreateResult>> {
    return ResponseUtil.success(await this.roleService.createItem(body));
  }

  @Put('item')
  async updateItem(@Query() query: RoleIdParamForm, @Body() body: RoleSaveForm) {
    return ResponseUtil.success(await this.roleService.updateItem(query.id, body));
  }

  @Delete('item')
  async removeItem(@Query() query: RoleIdParamForm) {
    return ResponseUtil.success(await this.roleService.removeItem(query.id));
  }
}
