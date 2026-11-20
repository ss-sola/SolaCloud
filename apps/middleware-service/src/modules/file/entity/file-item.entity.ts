import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Index } from 'typeorm';
import { FILE_STATUS, FileStatus } from '../file.constants';

@Entity('middleware_file_item')
export class FileItem extends BaseEntity {
  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName!: string;

  @Index({ unique: true })
  @Column({ name: 'storage_key', type: 'varchar', length: 255 })
  storageKey!: string;

  @Column({ name: 'storage_path', type: 'varchar', length: 512 })
  storagePath!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 120 })
  mimeType!: string;

  @Column({ type: 'int' })
  size!: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  extension!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 80, nullable: true })
  scene!: string | null;

  @Index()
  @Column({
    name: 'business_type',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  businessType!: string | null;

  @Index()
  @Column({ name: 'is_temporary', type: 'boolean', default: true })
  isTemporary!: boolean;

  @Index()
  @Column({ type: 'varchar', length: 32, default: FILE_STATUS.Available })
  status!: FileStatus;

  /** zip 解压后的入口文件相对路径（用于 3D 模型等多文件资源） */
  @Column({ name: 'bundle_entry_path', type: 'varchar', length: 512, nullable: true })
  bundleEntryPath!: string | null;

  /** 是否已解压（zip 文件专用标记） */
  @Column({ name: 'is_extracted', type: 'boolean', default: false })
  isExtracted!: boolean;

  /** 附件描述（由多模态模型自动生成） */
  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;
}
