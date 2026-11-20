import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Unique } from 'typeorm';

@Entity('sys_account')
@Unique('uk_account_name', ['accountName'])
export class AccountItem extends BaseEntity {
  @Column({ name: 'account_name', type: 'varchar', length: 64, comment: '登录账号名称' })
  accountName!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 64, comment: '账号显示名称' })
  displayName!: string;

  @Column({
    name: 'avatar_url',
    type: 'varchar',
    length: 512,
    nullable: true,
    comment: '账号头像地址',
  })
  avatarUrl?: string | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, comment: '账号密码哈希' })
  passwordHash!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true, comment: '是否启用账号' })
  isEnabled!: boolean;

  @Column({ name: 'failed_login_count', type: 'int', default: 0, comment: '连续登录失败次数' })
  failedLoginCount!: number;

  @Column({ name: 'locked_until', type: 'timestamp', nullable: true, comment: '账号锁定截止时间' })
  lockedUntil?: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true, comment: '最后登录时间' })
  lastLoginAt?: Date | null;

  @Column({
    name: 'status_version',
    type: 'int',
    default: 1,
    comment: '账号状态版本号，用于会话失效判断',
  })
  statusVersion!: number;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '账号备注' })
  remark?: string | null;
}
