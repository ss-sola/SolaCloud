import { BaseService } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MenuRoutePermissionItem } from '../entity/menu-route-permission.entity';

@Injectable()
export class MenuRoutePermissionService extends BaseService<MenuRoutePermissionItem> {
  constructor(
    @InjectRepository(MenuRoutePermissionItem)
    protected readonly repository: Repository<MenuRoutePermissionItem>,
  ) {
    super(repository);
  }

  /** 根据 menuRouteId 查询所有关联权限 */
  async findByMenuRouteId(menuRouteId: number): Promise<MenuRoutePermissionItem[]> {
    return this.repository.find({ where: { menuRouteId } });
  }

  /** 批量查询多个菜单路由的权限关联 */
  async findByMenuRouteIds(menuRouteIds: number[]): Promise<MenuRoutePermissionItem[]> {
    if (!menuRouteIds.length) return [];
    return this.repository.find({ where: { menuRouteId: In(menuRouteIds) } });
  }

  /** 清除菜单路由的所有权限关联 */
  async clearByMenuRouteId(menuRouteId: number): Promise<void> {
    await this.repository.delete({ menuRouteId });
  }
}
