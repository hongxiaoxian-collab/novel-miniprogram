import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayService } from './pay.service';
import { PayController } from './pay.controller';

@Module({
  controllers: [PayController],
  providers: [PayService, PrismaService],
  exports: [PayService],
})
export class PayModule {}
