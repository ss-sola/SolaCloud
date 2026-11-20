import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Unique } from 'typeorm';

@Entity('sys_permission')
@Unique('uk_permission_code', ['code'])
export class PermissionItem extends BaseEntity {
  @Column({ type: 'varchar', length: 64, comment: '权限编码' })
  code!: string;

  @Column({ type: 'varchar', length: 64, comment: '权限名称' })
  name!: string;

  @Column({
    name: 'group_key',
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: '权限分组标识',
  })
  groupKey?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '权限说明' })
  description?: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true, comment: '是否启用权限' })
  isEnabled!: boolean;
}
