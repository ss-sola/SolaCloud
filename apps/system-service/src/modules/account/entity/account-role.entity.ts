import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Unique } from 'typeorm';

@Entity('sys_account_role')
@Unique('uk_account_role_relation', ['accountId', 'roleId'])
export class AccountRoleItem extends BaseEntity {
  @Column({ name: 'account_id', type: 'int', comment: '账号ID' })
  accountId!: number;

  @Column({ name: 'role_id', type: 'int', comment: '角色ID' })
  roleId!: number;
}
