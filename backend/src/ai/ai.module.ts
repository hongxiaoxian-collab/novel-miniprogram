import { Module } from '@nestjs/common';
import { CozeModule } from '../coze/coze.module';
import { AiService } from './ai.service';
import { CloudBaseService } from './cloudbase.service';

@Module({
  imports: [CozeModule],
  providers: [CloudBaseService, AiService],
  exports: [AiService],
})
export class AiModule {}
