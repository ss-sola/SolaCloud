import { ResponseUtil, BaseController } from '@nest-cloud/sdk';
import { Body, Controller, Delete, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../../account/auth/permission.guard';
import { RequirePermissions } from '../../account/auth/require-permissions.decorator';
import { SessionAuthGuard } from '../../account/auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../../account/auth/system-permission.constants';
import { PERMISSION_CONTROLLER_ROUTE } from '../permission.constants';
import { PermissionIdParamForm } from '../form/permission-id-param.form';
import { PermissionListQueryForm, PermissionQueryForm } from '../form/permission-query.form';
import { PermissionSaveForm } from '../form/permission-save.form';
import { PermissionService } from '../service/permission.service';
import { PermissionItem } from '../entity/permission.entity';
type PermissionListResult = Awaited<ReturnType<PermissionService['listItems']>>;
type PermissionCreateResult = Awaited<ReturnType<PermissionService['createItem']>>;

@RequirePermissions(SYSTEM_PERMISSION_CODES.permissionManage)
@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller(PERMISSION_CONTROLLER_ROUTE)
export class PermissionController extends BaseController<PermissionItem, PermissionService> {
  constructor(private readonly permissionService: PermissionService) {
    super(permissionService);
  }

  @Get()
  override async findAll(@Query() query: PermissionQueryForm) {
    return ResponseUtil.success(await this.permissionService.queryItems(query));
  }

  @Get('overview')
  async getOverview() {
    return ResponseUtil.success(await this.permissionService.getOverview());
  }

  @Get('list')
  async listItems(
    @Query() query: PermissionListQueryForm,
  ): Promise<ResponseUtil<PermissionListResult>> {
    return ResponseUtil.success(await this.permissionService.listItems(query));
  }

  @Get('item')
  async getItem(@Query() query: PermissionIdParamForm) {
    return ResponseUtil.success(await this.permissionService.getItem(query.id));
  }

  @Post('item')
  async createItem(
    @Body() body: PermissionSaveForm,
  ): Promise<ResponseUtil<PermissionCreateResult>> {
    return ResponseUtil.success(await this.permissionService.createItem(body));
  }

  @Put('item')
  async updateItem(@Query() query: PermissionIdParamForm, @Body() body: PermissionSaveForm) {
    return ResponseUtil.success(await this.permissionService.updateItem(query.id, body));
  }

  @Delete('item')
  async removeItem(@Query() query: PermissionIdParamForm) {
    return ResponseUtil.success(await this.permissionService.removeItem(query.id));
  }
}
