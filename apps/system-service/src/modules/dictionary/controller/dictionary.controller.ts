import { ResponseUtil, BaseController } from '@nest-cloud/sdk';
import { Body, Controller, Delete, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../../account/auth/permission.guard';
import { RequirePermissions } from '../../account/auth/require-permissions.decorator';
import { SessionAuthGuard } from '../../account/auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../../account/auth/system-permission.constants';
import { DictionaryAggregateParamForm } from '../form/dictionary-aggregate-param.form';
import { DictionaryAggregateQueryForm } from '../form/dictionary-aggregate-query.form';
import { DictionaryAggregateUpsertForm } from '../form/dictionary-aggregate-upsert.form';
import { DictionaryImportForm } from '../form/dictionary-import.form';
import { DictionaryItemParamForm } from '../form/dictionary-item-param.form';
import { DictionaryItemsQueryForm } from '../form/dictionary-items-query.form';
import { DictionaryNamespaceParamForm } from '../form/dictionary-namespace-param.form';
import { DictionaryNamespaceQueryForm } from '../form/dictionary-namespace-query.form';
import { DictionaryNamespaceUpsertForm } from '../form/dictionary-namespace-upsert.form';
import { DictionaryUpsertForm } from '../form/dictionary-upsert.form';
import { DICTIONARY_CONTROLLER_ROUTE } from '../dictionary.constants';
import { DictionaryUtil } from '../dictionary.util';
import { DictionaryService } from '../service/dictionary.service';
import { DictionaryItem } from '../entity/dictionary-item.entity';

@RequirePermissions(SYSTEM_PERMISSION_CODES.dictionaryManage)
@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller(DICTIONARY_CONTROLLER_ROUTE)
export class DictionaryController extends BaseController<DictionaryItem, DictionaryService> {
  constructor(private readonly dictionaryService: DictionaryService) {
    super(dictionaryService);
  }

  @Get('overview')
  async getOverview() {
    return ResponseUtil.success(await this.dictionaryService.getOverview());
  }

  @Get('namespaces')
  async listNamespaces(@Query() query: DictionaryNamespaceQueryForm) {
    return ResponseUtil.success(await this.dictionaryService.listNamespaces(query));
  }

  @Get('namespace')
  async getNamespace(@Query() query: DictionaryNamespaceParamForm) {
    return ResponseUtil.success(await this.dictionaryService.getNamespace(query.namespace));
  }

  @Put('namespace')
  async upsertNamespace(
    @Query() query: DictionaryNamespaceParamForm,
    @Body() body: DictionaryNamespaceUpsertForm,
  ) {
    return ResponseUtil.success(
      await this.dictionaryService.upsertNamespace(query.namespace, body),
    );
  }

  @Delete('namespace')
  async removeNamespace(@Query() query: DictionaryNamespaceParamForm) {
    return ResponseUtil.success(await this.dictionaryService.removeNamespace(query.namespace));
  }

  @Get('aggregates')
  async listAggregates(@Query() query: DictionaryAggregateQueryForm) {
    return ResponseUtil.success(await this.dictionaryService.listAggregates(query));
  }

  @Get('aggregate')
  async getAggregate(@Query() query: DictionaryAggregateParamForm) {
    return ResponseUtil.success(
      await this.dictionaryService.getAggregate(query.namespace, query.aggregateKey),
    );
  }

  @Put('aggregate')
  async upsertAggregate(
    @Query() query: DictionaryAggregateParamForm,
    @Body() body: DictionaryAggregateUpsertForm,
  ) {
    return ResponseUtil.success(
      await this.dictionaryService.upsertAggregate(query.namespace, query.aggregateKey, body),
    );
  }

  @Delete('aggregate')
  async removeAggregate(@Query() query: DictionaryAggregateParamForm) {
    return ResponseUtil.success(
      await this.dictionaryService.removeAggregate(query.namespace, query.aggregateKey),
    );
  }

  @Get('items')
  async listItems(@Query() query: DictionaryItemsQueryForm) {
    return ResponseUtil.success(await this.dictionaryService.listItems(query));
  }

  @Get('item')
  async getItem(@Query() query: DictionaryItemParamForm) {
    return ResponseUtil.success(await this.dictionaryService.getItem(query));
  }

  @Put('item')
  async upsertItem(@Query() query: DictionaryItemParamForm, @Body() body: DictionaryUpsertForm) {
    return ResponseUtil.success(await this.dictionaryService.upsertItem(query, body));
  }

  @Delete('item')
  async removeItem(@Query() query: DictionaryItemParamForm) {
    return ResponseUtil.success(await this.dictionaryService.removeItem(query));
  }

  @Post('import')
  async importNamespace(@Body() body: DictionaryImportForm) {
    return ResponseUtil.success(
      await this.dictionaryService.importNamespace(
        body.namespace,
        body.items
          .map((item) => DictionaryUtil.toImportItem(item))
          .filter((item) => item !== undefined),
        {
          label: body.label,
          description: body.description,
        },
      ),
    );
  }
}
