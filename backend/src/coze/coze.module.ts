import { Module } from '@nestjs/common';
import { CozeService } from './coze.service';

@Module({
  providers: [CozeService],
  exports: [CozeService],
})
export class CozeModule {}
