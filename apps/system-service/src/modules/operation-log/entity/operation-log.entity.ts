import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity } from 'typeorm';

@Entity('sys_operation_log')
export class OperationLogItem extends BaseEntity {
  @Column({ type: 'varchar', length: 64, comment: '业务模块标识' })
  module!: string;

  @Column({ type: 'varchar', length: 64, comment: '操作动作标识' })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 64, comment: '操作目标类型' })
  targetType!: string;

  @Column({
    name: 'target_id',
    type: 'varchar',
    length: 128,
    nullable: true,
    comment: '操作目标ID',
  })
  targetId?: string | null;

  @Column({ type: 'text', comment: '操作摘要' })
  summary!: string;

  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: '操作人账号名称',
  })
  operator?: string | null;
}
