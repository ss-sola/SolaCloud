import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity } from 'typeorm';

@Entity('sys_station_message')
export class StationMessageItem extends BaseEntity {
  @Column({ type: 'varchar', length: 128, comment: '站内信标题' })
  title!: string;

  @Column({ type: 'text', comment: '站内信内容' })
  content!: string;

  @Column({ name: 'receiver_account_id', type: 'int', comment: '接收人账号ID' })
  receiverAccountId!: number;

  @Column({ name: 'sender_account_id', type: 'int', nullable: true, comment: '发送人账号ID' })
  senderAccountId?: number | null;

  @Column({ name: 'is_read', type: 'boolean', default: false, comment: '是否已读' })
  isRead!: boolean;

  @Column({ name: 'read_at', type: 'timestamp', nullable: true, comment: '阅读时间' })
  readAt?: Date | null;
}
