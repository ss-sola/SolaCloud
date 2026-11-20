import { BaseService } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountRoleItem } from '../entity/account-role.entity';

@Injectable()
export class AccountRoleService extends BaseService<AccountRoleItem> {
  /** 公开 repository 供外部查询 */
  get repo(): Repository<AccountRoleItem> {
    return this.repository;
  }

  constructor(
    @InjectRepository(AccountRoleItem)
    protected readonly repository: Repository<AccountRoleItem>,
  ) {
    super(repository);
  }

  /** 根据 accountId 查询所有关联角色 */
  async findByAccountId(accountId: number): Promise<AccountRoleItem[]> {
    return this.repository.find({ where: { accountId } });
  }

  /** 根据 roleId 查询所有关联账户 */
  async findByRoleId(roleId: number): Promise<AccountRoleItem[]> {
    return this.repository.find({ where: { roleId } });
  }

  /** 清除账户的所有角色关联 */
  async clearByAccountId(accountId: number): Promise<void> {
    await this.repository.delete({ accountId });
  }
}
