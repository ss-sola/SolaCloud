import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Unique } from 'typeorm';

@Entity('sys_dict_item')
@Unique('uk_dict_namespace_aggregate_key', ['namespace', 'aggregateKey', 'key'])
export class DictionaryItem extends BaseEntity {
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
    name: 'dict_key',
    type: 'varchar',
    length: 128,
    comment: '字典项键',
  })
  key!: string;

  @Column({
    type: 'jsonb',
    comment: '字典项值，支持字符串、数字、布尔或结构化 JSON',
  })
  value!: unknown;

  @Column({
    type: 'varchar',
    length: 128,
    nullable: true,
    comment: '字典项显示名称',
  })
  label?: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '字典项说明',
  })
  description?: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true, comment: '是否启用字典项' })
  isEnabled!: boolean;
}
