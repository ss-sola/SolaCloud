import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity } from 'typeorm';

@Entity('sys_announcement')
export class AnnouncementItem extends BaseEntity {
  @Column({ type: 'varchar', length: 128, comment: '公告标题' })
  title!: string;

  @Column({ type: 'text', comment: '公告内容' })
  content!: string;

  @Column({ name: 'is_published', type: 'boolean', default: false, comment: '是否已发布' })
  isPublished!: boolean;

  @Column({
    name: 'effective_from',
    type: 'timestamp',
    nullable: true,
    comment: '公告生效开始时间',
  })
  effectiveFrom?: Date | null;

  @Column({ name: 'effective_to', type: 'timestamp', nullable: true, comment: '公告生效结束时间' })
  effectiveTo?: Date | null;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true, comment: '发布时间' })
  publishedAt?: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true, comment: '撤回时间' })
  revokedAt?: Date | null;

  @Column({ name: 'publisher_account_id', type: 'int', nullable: true, comment: '发布人账号ID' })
  publisherAccountId?: number | null;
}
