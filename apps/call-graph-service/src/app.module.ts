import { EnableAutoRegister, EnableConfigCenter } from '@nest-cloud/sdk';
import { Module } from '@nestjs/common';

@EnableAutoRegister({ productionOnly: true })
@EnableConfigCenter()
@Module({})
export class AppModule {}
