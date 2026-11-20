import { BaseService, ProjectException } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import { SYSTEM_SERVICE_NAME } from '../../../system-service.constants';
import { PageResult } from '../../../utils/pagination.types';
import { PaginationUtil } from '../../../utils/pagination.util';
import { RuntimePermissionService } from '../../account/service/runtime-permission.service';
import { OperationLogService } from '../../operation-log/service/operation-log.service';
import { PERMISSION_CAPABILITIES } from '../permission.constants';
import { PermissionItem } from '../entity/permission.entity';
import { PermissionQueryForm } from '../form/permission-query.form';
import { PermissionMutationInput, PermissionRecord } from '../permission.types';

@Injectable()
export class PermissionService extends BaseService<PermissionItem> {
  private readonly logger = new Logger(PermissionService.name);

  constructor(
    @InjectRepository(PermissionItem)
    protected readonly repository: Repository<PermissionItem>,
    private readonly operationLogService: OperationLogService,
    private readonly runtimePermissionService: RuntimePermissionService,
  ) {
    super(repository);
  }

  async getOverview() {
    return {
      service: SYSTEM_SERVICE_NAME,
      itemCount: await this.repository.count(),
      capabilities: [...PERMISSION_CAPABILITIES],
    };
  }

  async listItems(query: PermissionQueryForm): Promise<PageResult<PermissionRecord>> {
    const pageQuery = PaginationUtil.normalizePageQuery(query);
    const baseWhere: FindOptionsWhere<PermissionItem> = {
      ...(query.groupKey ? { groupKey: query.groupKey } : {}),
      ...(query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {}),
    };
    const where = this.buildListWhere(baseWhere, query.keyword);
    const [items, total] = await this.repository.findAndCount({
      where,
      order: PaginationUtil.buildOrder(query, {
        allowedSortFields: ['id', 'code', 'name', 'groupKey', 'createdAt', 'updatedAt'],
        defaultOrder: { groupKey: 'ASC', code: 'ASC' },
      }),
      skip: pageQuery.skip,
      take: pageQuery.take,
    });

    return PaginationUtil.buildPageResult(
      items.map((item) => this.toRecord(item)),
      total,
      pageQuery,
    );
  }

  async getItem(id: number): Promise<PermissionRecord> {
    const item = await this.findOne(id);
    if (!item) {
      throw new ProjectException(`Permission not found: ${id}`);
    }
    return this.toRecord(item);
  }

  async getByCode(code: string): Promise<PermissionItem | null> {
    return this.repository.findOne({ where: { code } });
  }

  async assertCodesExist(codes: string[]) {
    const normalizedCodes = [...new Set(codes.map((item) => item.trim()).filter(Boolean))];
    for (const code of normalizedCodes) {
      const item = await this.getByCode(code);
      if (!item || !item.isEnabled) {
        throw new ProjectException(`Permission code not found or disabled: ${code}`);
      }
    }
  }

  async assertCodesDefined(codes: string[]) {
    const normalizedCodes = [...new Set(codes.map((item) => item.trim()).filter(Boolean))];
    for (const code of normalizedCodes) {
      const item = await this.getByCode(code);
      if (!item) {
        throw new ProjectException(`Permission code not found: ${code}`);
      }
    }
  }

  async getIdsByCodes(codes: string[]): Promise<number[]> {
    const normalizedCodes = [...new Set(codes.map((item) => item.trim()).filter(Boolean))];
    if (!normalizedCodes.length) {
      return [];
    }
    const items = await this.repository.find({
      where: { code: In(normalizedCodes) },
      order: { code: 'ASC' },
    });
    return items.map((item) => item.id);
  }

  async getCodesByIds(ids: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (!ids.length) {
      return map;
    }
    const items = await this.repository.find({
      where: { id: In(ids) },
    });
    for (const item of items) {
      map.set(item.id, item.code);
    }
    return map;
  }

  /** 根据 ID 列表查询权限实体 */
  async findByIds(ids: number[], onlyEnabled = false): Promise<PermissionItem[]> {
    if (!ids.length) {
      return [];
    }
    return this.repository.find({
      where: onlyEnabled ? { id: In(ids), isEnabled: true } : { id: In(ids) },
      order: { code: 'ASC' },
    });
  }

  /** 根据 code 列表查询权限实体 */
  async findByCodes(codes: string[]): Promise<PermissionItem[]> {
    const normalizedCodes = [...new Set(codes.map((item) => item.trim()).filter(Boolean))];
    if (!normalizedCodes.length) {
      return [];
    }
    return this.repository.find({
      where: { code: In(normalizedCodes) },
      order: { code: 'ASC' },
    });
  }

  async createItem(payload: PermissionMutationInput): Promise<PermissionRecord> {
    await this.assertCodeAvailable(payload.code);
    const saved = await this.create(this.toEntityPayload(payload));
    this.runtimePermissionService.invalidateAll();
    this.logger.log(`Permission created: ${saved.code}`);
    await this.operationLogService.log({
      module: 'permission',
      action: 'item-create',
      targetType: 'permission',
      targetId: saved.code,
      summary: `Permission created: ${saved.code}`,
      operator: 'system-service',
    });
    return this.toRecord(saved);
  }

  async updateItem(id: number, payload: PermissionMutationInput): Promise<PermissionRecord> {
    const current = await this.findOne(id);
    if (!current) {
      throw new ProjectException(`Permission not found: ${id}`);
    }
    await this.assertCodeAvailable(payload.code, id);
    const saved = await this.update(id, this.toEntityPayload(payload));
    if (!saved) {
      throw new ProjectException(`Permission not found: ${id}`);
    }
    this.runtimePermissionService.invalidateAll();
    this.logger.log(`Permission updated: ${saved.code}`);
    await this.operationLogService.log({
      module: 'permission',
      action: 'item-update',
      targetType: 'permission',
      targetId: saved.code,
      summary: `Permission updated: ${saved.code}`,
      operator: 'system-service',
    });
    return this.toRecord(saved);
  }

  async removeItem(id: number): Promise<PermissionRecord> {
    const current = await this.findOne(id);
    if (!current) {
      throw new ProjectException(`Permission not found: ${id}`);
    }
    await this.delete(id);
    this.runtimePermissionService.invalidateAll();
    await this.operationLogService.log({
      module: 'permission',
      action: 'item-delete',
      targetType: 'permission',
      targetId: current.code,
      summary: `Permission deleted: ${current.code}`,
      operator: 'system-service',
    });
    return this.toRecord(current);
  }

  private buildListWhere(
    baseWhere: FindOptionsWhere<PermissionItem>,
    keyword?: string,
  ): FindOptionsWhere<PermissionItem>[] {
    if (!keyword) {
      return [baseWhere];
    }

    const keywordLike = ILike(`%${keyword}%`);
    return [
      { ...baseWhere, code: keywordLike },
      { ...baseWhere, name: keywordLike },
      { ...baseWhere, groupKey: keywordLike },
      { ...baseWhere, description: keywordLike },
    ];
  }

  private async assertCodeAvailable(code: string, currentId?: number) {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new ProjectException('Permission code is required');
    }
    const existing = await this.repository.findOne({
      where: { code: normalizedCode },
    });
    if (existing && existing.id !== currentId) {
      throw new ProjectException(`Permission code already exists: ${normalizedCode}`);
    }
  }

  private toEntityPayload(payload: PermissionMutationInput): Partial<PermissionItem> {
    const normalizedCode = payload.code.trim();
    if (!normalizedCode) {
      throw new ProjectException('Permission code is required');
    }
    const normalizedName = payload.name.trim();
    if (!normalizedName) {
      throw new ProjectException('Permission name is required');
    }
    return {
      code: normalizedCode,
      name: normalizedName,
      groupKey: payload.groupKey?.trim() || null,
      description: payload.description?.trim() || null,
      isEnabled: payload.isEnabled ?? true,
    };
  }

  private toRecord(entity: PermissionItem): PermissionRecord {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      groupKey: entity.groupKey ?? undefined,
      description: entity.description ?? undefined,
      isEnabled: entity.isEnabled,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
