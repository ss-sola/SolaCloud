import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Index } from 'typeorm';
import { FILE_UPLOAD_SESSION_STATUS, FileUploadSessionStatus } from '../file.constants';

@Entity('middleware_file_upload_session')
export class FileUploadSession extends BaseEntity {
  @Index({ unique: true })
  @Column({ name: 'upload_id', type: 'varchar', length: 64 })
  uploadId!: string;

  @Column({
    name: 'original_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originalName!: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: true })
  mimeType!: string | null;

  @Column({ name: 'total_size', type: 'int' })
  totalSize!: number;

  @Column({ name: 'chunk_size', type: 'int' })
  chunkSize!: number;

  @Column({ name: 'chunk_count', type: 'int' })
  chunkCount!: number;

  @Column({ name: 'uploaded_bytes', type: 'int', default: 0 })
  uploadedBytes!: number;

  @Column({ name: 'uploaded_chunk_count', type: 'int', default: 0 })
  uploadedChunkCount!: number;

  @Column({ name: 'chunk_dir_path', type: 'varchar', length: 512 })
  chunkDirPath!: string;

  @Index()
  @Column({
    name: 'file_fingerprint',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  fileFingerprint!: string | null;

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
  @Column({
    type: 'varchar',
    length: 32,
    default: FILE_UPLOAD_SESSION_STATUS.Pending,
  })
  status!: FileUploadSessionStatus;

  @Column({ name: 'file_id', type: 'int', nullable: true })
  fileId!: number | null;

  @Column({
    name: 'error_message',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  errorMessage!: string | null;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt!: Date;
}
