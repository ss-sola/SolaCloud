import { ResponseUtil } from '@nest-cloud/sdk';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../account/auth/session-auth.guard';
import { DICTIONARY_CONTROLLER_ROUTE } from '../dictionary.constants';
import { DictionaryItemsQueryForm } from '../form/dictionary-items-query.form';
import { DictionaryService } from '../service/dictionary.service';

@UseGuards(SessionAuthGuard)
@Controller(DICTIONARY_CONTROLLER_ROUTE)
export class DictionaryRuntimeController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get('runtime')
  async listRuntimeItems(@Query() query: DictionaryItemsQueryForm) {
    return ResponseUtil.success(await this.dictionaryService.listRuntimeItems(query));
  }
}
