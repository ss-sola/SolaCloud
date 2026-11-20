import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity } from 'typeorm';

@Entity('sys_login_log')
export class LoginLogItem extends BaseEntity {
  @Column({
    name: 'account_id',
    type: 'int',
    nullable: true,
    comment: '登录账号ID，未知账号可为空',
  })
  accountId?: number | null;

  @Column({ name: 'account_name', type: 'varchar', length: 64, comment: '登录账号名称' })
  accountName!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64, comment: '登录事件类型' })
  eventType!: string;

  @Column({ type: 'boolean', comment: '登录是否成功' })
  success!: boolean;

  @Column({ type: 'varchar', length: 255, comment: '登录结果说明' })
  message!: string;

  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: '登录来源IP',
  })
  ip?: string | null;

  @Column({
    name: 'user_agent',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '登录客户端 User-Agent',
  })
  userAgent?: string | null;
}
