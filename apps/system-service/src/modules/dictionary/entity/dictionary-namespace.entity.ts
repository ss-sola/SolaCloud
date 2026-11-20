import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Unique } from 'typeorm';

@Entity('sys_dict_namespace')
@Unique('uk_dict_namespace_name', ['namespace'])
export class DictionaryNamespaceItem extends BaseEntity {
  @Column({ type: 'varchar', length: 64, comment: '字典命名空间标识' })
  namespace!: string;

  @Column({
    type: 'varchar',
    length: 128,
    nullable: true,
    comment: '字典命名空间名称',
  })
  label?: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '字典命名空间说明',
  })
  description?: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true, comment: '是否启用字典命名空间' })
  isEnabled!: boolean;
}
