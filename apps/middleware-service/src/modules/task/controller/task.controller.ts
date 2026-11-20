import { ResponseUtil } from '@nest-cloud/sdk';
import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { TaskCreateForm } from '../form/task-create.form';
import { TaskQueryForm } from '../form/task-query.form';
import { TaskQueueService } from '../service/task-queue.service';

@Controller('task')
export class TaskController {
  constructor(private readonly taskQueueService: TaskQueueService) {}

  @Post('create')
  async create(@Body() body: TaskCreateForm) {
    return ResponseUtil.success(
      await this.taskQueueService.addJob(body.name, body.data, body.delayMs),
    );
  }

  @Get('detail')
  async detail(@Query() query: TaskQueryForm) {
    return ResponseUtil.success(await this.taskQueueService.getJob(query.id, query.name));
  }

  @Delete('remove')
  async remove(@Query() query: TaskQueryForm) {
    return ResponseUtil.success(await this.taskQueueService.removeJob(query.id, query.name));
  }

  @Get('queue')
  queue() {
    const queues = this.taskQueueService.getQueueDefinitions();
    return ResponseUtil.success({
      queueName: queues[0]?.queueName,
      queues,
    });
  }
}
