export interface OperationLogRecord {
  id: number;
  module: string;
  action: string;
  targetType: string;
  targetId?: string;
  summary: string;
  operator?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OperationLogInput {
  module: string;
  action: string;
  targetType: string;
  targetId?: string;
  summary: string;
  operator?: string;
}
