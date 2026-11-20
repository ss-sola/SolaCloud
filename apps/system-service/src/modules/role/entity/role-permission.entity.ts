import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Unique } from 'typeorm';

@Entity('sys_role_permission')
@Unique('uk_role_permission_relation', ['roleId', 'permissionId'])
export class RolePermissionItem extends BaseEntity {
  @Column({ name: 'role_id', type: 'int', comment: '角色ID' })
  roleId!: number;

  @Column({ name: 'permission_id', type: 'int', comment: '权限ID' })
  permissionId!: number;
}
