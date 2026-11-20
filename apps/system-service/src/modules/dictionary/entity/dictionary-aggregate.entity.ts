import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Unique } from 'typeorm';

@Entity('sys_dict_aggregate')
@Unique('uk_dict_aggregate_namespace_key', ['namespace', 'aggregateKey'])
export class DictionaryAggregateItem extends BaseEntity {
  @Column({ type: 'varchar', length: 64, comment: '字典命名空间标识' })
  namespace!: string;

  @Column({
    name: 'aggregate_key',
    type: 'varchar',
    length: 128,
    comment: '字典聚合键',
  })
  aggregateKey!: string;

  @Column({
    type: 'varchar',
    length: 128,
    nullable: true,
    comment: '字典聚合名称',
  })
  label?: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '字典聚合说明',
  })
  description?: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true, comment: '是否启用字典聚合' })
  isEnabled!: boolean;
}
