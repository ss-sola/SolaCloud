export interface PermissionMutationInput {
  code: string;
  name: string;
  groupKey?: string;
  description?: string;
  isEnabled?: boolean;
}

export interface PermissionRecord {
  id: number;
  code: string;
  name: string;
  groupKey?: string;
  description?: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
