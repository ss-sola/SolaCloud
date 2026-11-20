import { ResponseUtil, BaseController } from '@nest-cloud/sdk';
import { Body, Controller, Delete, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../../account/auth/permission.guard';
import { RequirePermissions } from '../../account/auth/require-permissions.decorator';
import { SessionAuthGuard } from '../../account/auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../../account/auth/system-permission.constants';
import { MENU_ROUTE_CONTROLLER_ROUTE } from '../menu-route.constants';
import { MenuRouteBatchStatusForm } from '../form/menu-route-batch-status.form';
import { MenuRouteIdParamForm } from '../form/menu-route-id-param.form';
import { MenuRouteQueryForm } from '../form/menu-route-query.form';
import { MenuRouteReorderForm } from '../form/menu-route-reorder.form';
import { MenuRouteSaveForm } from '../form/menu-route-save.form';
import { MenuRouteUpdateForm } from '../form/menu-route-update.form';
import { MenuRouteService } from '../service/menu-route.service';
import { MenuRouteItem } from '../entity/menu-route.entity';
type MenuRouteListResult = Awaited<ReturnType<MenuRouteService['listItems']>>;
type MenuRouteCreateResult = Awaited<ReturnType<MenuRouteService['createItem']>>;

@RequirePermissions(SYSTEM_PERMISSION_CODES.menuRouteManage)
@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller(MENU_ROUTE_CONTROLLER_ROUTE)
export class MenuRouteController extends BaseController<MenuRouteItem, MenuRouteService> {
  constructor(private readonly menuRouteService: MenuRouteService) {
    super(menuRouteService);
  }

  @Get('overview')
  async getOverview() {
    return ResponseUtil.success(await this.menuRouteService.getOverview());
  }

  @Get('list')
  async listItems(@Query() query: MenuRouteQueryForm): Promise<ResponseUtil<MenuRouteListResult>> {
    return ResponseUtil.success(await this.menuRouteService.listItems(query));
  }

  @Get('tree')
  async listTree(@Query() query: MenuRouteQueryForm) {
    return ResponseUtil.success(await this.menuRouteService.listTree(query));
  }

  @Get('item')
  async getItem(@Query() query: MenuRouteIdParamForm) {
    return ResponseUtil.success(await this.menuRouteService.getItem(query.id));
  }

  @Post('item')
  async createItem(@Body() body: MenuRouteSaveForm): Promise<ResponseUtil<MenuRouteCreateResult>> {
    return ResponseUtil.success(await this.menuRouteService.createItem(body));
  }

  @Put('item')
  async updateItem(@Query() query: MenuRouteIdParamForm, @Body() body: MenuRouteUpdateForm) {
    return ResponseUtil.success(await this.menuRouteService.updateItem(query.id, body));
  }

  @Put('batch-status')
  async batchUpdateStatus(@Body() body: MenuRouteBatchStatusForm) {
    return ResponseUtil.success(await this.menuRouteService.batchUpdateStatus(body));
  }

  @Put('reorder')
  async reorderItems(@Body() body: MenuRouteReorderForm) {
    return ResponseUtil.success(await this.menuRouteService.reorderItems(body));
  }

  @Delete('item')
  async removeItem(@Query() query: MenuRouteIdParamForm) {
    return ResponseUtil.success(await this.menuRouteService.removeItem(query.id));
  }
}
