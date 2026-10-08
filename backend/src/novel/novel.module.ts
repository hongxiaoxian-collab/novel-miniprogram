import { Module } from '@nestjs/common';
import { NovelService } from './novel.service';
import { NovelController } from './novel.controller';
import { AiModule } from '../ai/ai.module';
import { SearchService } from './search.service';

@Module({
  imports: [AiModule],
  controllers: [NovelController],
  providers: [NovelService, SearchService],
  exports: [NovelService, SearchService],
})
export class NovelModule {}
