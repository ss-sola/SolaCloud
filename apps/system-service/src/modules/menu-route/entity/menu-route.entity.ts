import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Unique } from 'typeorm';

@Entity('sys_menu_route')
@Unique('uk_menu_route_code', ['code'])
export class MenuRouteItem extends BaseEntity {
  @Column({ type: 'varchar', length: 64, comment: '菜单路由编码' })
  code!: string;

  @Column({ type: 'varchar', length: 64, comment: '菜单路由名称' })
  name!: string;

  @Column({
    name: 'route_name',
    type: 'varchar',
    length: 128,
    nullable: true,
    comment: '前端路由名称，对应前端路由表的 name 字段',
  })
  routeName?: string | null;

  @Column({ name: 'parent_id', type: 'int', nullable: true, comment: '父级菜单路由ID' })
  parentId?: number | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '前端重定向路径',
  })
  redirect?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '菜单图标' })
  icon?: string | null;

  @Column({ type: 'int', default: 0, comment: '同级菜单排序值' })
  sort!: number;

  @Column({ name: 'is_enabled', type: 'boolean', default: true, comment: '是否启用菜单路由' })
  isEnabled!: boolean;

  @Column({ name: 'is_group', type: 'boolean', default: false, comment: '是否为分组容器节点' })
  isGroup!: boolean;

  @Column({
    name: 'hide_header',
    type: 'boolean',
    default: false,
    comment: '访问时隐藏顶部 Header',
  })
  hideHeader!: boolean;

  @Column({ name: 'hide_route', type: 'boolean', default: false, comment: '访问时隐藏左侧侧边栏' })
  hideRoute!: boolean;

  @Column({
    name: 'route_root',
    type: 'varchar',
    length: 32,
    nullable: true,
    comment: '产品域标识',
  })
  routeRoot?: string | null;
}
