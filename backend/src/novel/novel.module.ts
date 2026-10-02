import { Module } from '@nestjs/common';
import { NovelService } from './novel.service';
import { NovelController } from './novel.controller';
import { CozeModule } from '../coze/coze.module';
import { SearchService } from './search.service';

@Module({
  imports: [CozeModule],
  controllers: [NovelController],
  providers: [NovelService, SearchService],
  exports: [NovelService, SearchService],
})
export class NovelModule {}
