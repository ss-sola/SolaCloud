import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Unique } from 'typeorm';

@Entity('sys_role')
@Unique('uk_role_code', ['code'])
export class RoleItem extends BaseEntity {
  @Column({ type: 'varchar', length: 64, comment: '角色编码' })
  code!: string;

  @Column({ type: 'varchar', length: 64, comment: '角色名称' })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '角色说明' })
  description?: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true, comment: '是否启用角色' })
  isEnabled!: boolean;
}
