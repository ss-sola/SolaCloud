import { EnableAutoRegister } from '@nest-cloud/sdk';
import { Module } from '@nestjs/common';

@EnableAutoRegister({ productionOnly: true })
@Module({})
export class AppModule {}
