import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class ChatAttachmentForm {
  @IsInt()
  fileId!: number;

  @IsNotEmpty()
  @IsString()
  fileUrl!: string;

  @IsNotEmpty()
  @IsString()
  originalName!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  size!: number;
}

export class ChatSendForm {
  @IsInt()
  @Min(1)
  sessionId!: number;

  @IsString()
  query!: string;

  /** 聊天消息附加文件信息，由前端预上传后传入 */
  @IsOptional()
  @IsArray()
  files?: ChatAttachmentForm[];

  /** 是否为重新生成请求（true 时跳过保存用户消息） */
  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;

  /** 重新生成时，该用户消息的 ID，用于删除其之后的旧回复 */
  @IsOptional()
  @IsInt()
  @IsPositive()
  lastUserId?: number;
}

export class CreateSessionForm {
  @IsInt()
  @IsOptional()
  knowledgeBaseId?: number;
}

export class SessionMessagesForm {
  @IsInt()
  @Min(1)
  sessionId!: number;
}

export class DeleteSessionForm {
  @IsInt()
  @Min(1)
  sessionId!: number;
}

export class SimilarQueryForm {
  @IsString()
  query!: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  topK?: number = 3;
}

export class SummarizeSessionForm {
  @IsInt()
  @Min(1)
  sessionId!: number;
}
