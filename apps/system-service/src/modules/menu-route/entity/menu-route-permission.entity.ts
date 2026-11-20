import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Unique } from 'typeorm';

@Entity('sys_menu_route_permission')
@Unique('uk_menu_route_permission', ['menuRouteId', 'permissionId'])
export class MenuRoutePermissionItem extends BaseEntity {
  @Column({ name: 'menu_route_id', type: 'int', comment: '菜单路由ID' })
  menuRouteId!: number;

  @Column({ name: 'permission_id', type: 'int', comment: '权限ID' })
  permissionId!: number;
}
