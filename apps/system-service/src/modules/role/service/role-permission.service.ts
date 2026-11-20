import { BaseService } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolePermissionItem } from '../../role/entity/role-permission.entity';

@Injectable()
export class RolePermissionService extends BaseService<RolePermissionItem> {
  constructor(
    @InjectRepository(RolePermissionItem)
    protected readonly repository: Repository<RolePermissionItem>,
  ) {
    super(repository);
  }

  /** 根据 roleId 查询所有关联权限 */
  async findByRoleId(roleId: number): Promise<RolePermissionItem[]> {
    return this.repository.find({ where: { roleId } });
  }

  /** 清除角色的所有权限关联 */
  async clearByRoleId(roleId: number): Promise<void> {
    await this.repository.delete({ roleId });
  }
}
