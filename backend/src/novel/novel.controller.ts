import { Controller, Get, Post, Delete, Body, Param, Query, Put, Res, Headers } from '@nestjs/common';
import { Response } from 'express';
import { NovelService } from './novel.service';
import { uidFromHeader } from '../auth/token';
import {
  CreateNovelDto,
  GenerateOutlineDto,
  GenerateChapterDto,
  GenerateBibleDto,
  RewriteChapterDto,
  SaveChapterDto,
  UpdateNovelDto,
  RecommendTopicDto,
  AuthorAssistDto,
  CoverPlanDto,
  JobDto,
  TitleSuggestDto,
  DupFixDto,
  AuditResolveDto,
  PatchIssueDto,
} from './novel.dto';

@Controller('novel')
export class NovelController {
  constructor(private readonly svc: NovelService) {}

  @Get('meta')
  meta() {
    return this.svc.getMeta();
  }

  @Get()
  list(@Query('platform') platform?: string, @Headers('authorization') auth?: string) {
    return this.svc.listNovels(platform, uidFromHeader(auth));
  }

  @Post('recommend-topic')
  recommendTopic(@Body() dto: RecommendTopicDto) {
    return this.svc.recommendTopic(dto.platform);
  }

  /** AI 推荐笔名（≥3 个，可换一批）/ 代写作者简介（可重写） */
  @Post('author-assist')
  authorAssist(@Body() dto: AuthorAssistDto) {
    return this.svc.authorAssist(dto);
  }

  // ---------------- 后台任务（体检 / 自动修复）：落库 + 前端轮询，退出小程序也继续跑 ----------------

  @Post(':id/jobs')
  startJob(@Param('id') id: string, @Body() dto: JobDto) {
    if (dto.kind === 'audit') {
      const sc = dto.scope === 'consistency' || dto.scope === 'dup' ? dto.scope : 'all';
      return this.svc.startAuditJob(id, !!dto.force, sc);
    }
    if (dto.kind === 'fix') return this.svc.startFixJob(id, dto.opinion);
    if (dto.kind === 'chapter') return this.svc.startChapterJob(id, dto.wordCount, dto.instruction, dto.count);
    if (dto.kind === 'outline') return this.svc.startOutlineJob(id, dto.opinion);
    throw new Error('未知任务类型');
  }

  @Get(':id/jobs')
  job(@Param('id') id: string) {
    return this.svc.getJob(id);
  }

  /** 读最近一次体检结果（退出再进来也能看到"上次体检 N 处未解决"） */
  @Get(':id/audit')
  getAudit(@Param('id') id: string) {
    return this.svc.getAudit(id);
  }

  /** 封面方案：按这部作品的情节生成「场景 / 配色 / 构图 / 人物 / 道具」 */
  @Post(':id/cover-plan')
  coverPlan(@Param('id') id: string, @Body() dto: CoverPlanDto) {
    return this.svc.coverPlan(id, dto);
  }

  @Get(':id/cover-plan')
  getCoverPlan(@Param('id') id: string) {
    return this.svc.getCoverPlan(id);
  }

  @Post()
  create(@Body() dto: CreateNovelDto, @Headers('authorization') auth?: string) {
    return this.svc.createNovel(dto, uidFromHeader(auth));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNovelDto) {
    return this.svc.updateNovel(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.deleteNovel(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.getNovel(id);
  }

  @Post(':id/outline')
  outline(@Param('id') id: string, @Body() dto: GenerateOutlineDto) {
    return this.svc.generateOutline(id, dto);
  }

  /** 撞车一键修复（完整流水线）：换名 → 重出大纲 → 重建脉络 → 重出简介 → 重写黄金三章 → 重出封面 → 复查重 */
  @Post(':id/dup-fix')
  dupFix(@Param('id') id: string, @Body() dto: DupFixDto) {
    return this.svc.startDupFixJob(id, dto.title, dto.plot || '');
  }

  /** 预检作者自己起的书名：返回能不能用（risk）+ 该书名下的差异化剧情 */
  @Post(':id/title-check')
  titleCheck(@Param('id') id: string, @Body() dto: TitleSuggestDto & { title?: string }) {
    return this.svc.checkMyTitle(id, (dto as any).title || '');
  }

  /** 换一批推荐书名（逐个联网预检，保证 ≥3 个可点、且第一个是推荐项） */
  @Post(':id/title-suggest')
  titleSuggest(@Param('id') id: string, @Body() dto: TitleSuggestDto) {
    return this.svc.suggestTitles(id, dto.exclude || []);
  }

  /** 定版：启动异步任务链（查重 → 全书脉络+时间线 → 上架资料 → 黄金1-3章），立即返回进度 */
  @Post(':id/finalize')
  finalize(@Param('id') id: string, @Body() dto: GenerateBibleDto) {
    return this.svc.startFinalize(id, dto);
  }

  /** 兼容旧调用：与 finalize 同义 */
  @Post(':id/bible')
  bible(@Param('id') id: string, @Body() dto: GenerateBibleDto) {
    return this.svc.startFinalize(id, dto);
  }

  /** 定版任务进度（前端轮询） */
  @Get(':id/progress')
  progress(@Param('id') id: string) {
    return this.svc.getProgress(id);
  }

  /** 撞车检测：比对番茄/七猫热榜 */
  /** 撞车检测；?force=1 表示作者主动点「重新查重」，忽略 30 分钟内的缓存 */
  @Post(':id/check-duplicate')
  checkDuplicate(@Param('id') id: string, @Query('force') force?: string) {
    return this.svc.checkDuplicate(id, force === '1');
  }

  @Get(':id/bible')
  getBible(@Param('id') id: string) {
    return this.svc.getBible(id);
  }

  /** 生成上架资料包（简介/人物名/阅读标签/内容标签/签约+连载模式） */
  @Post(':id/publish')
  genPublishInfo(@Param('id') id: string) {
    return this.svc.generatePublishInfo(id);
  }

  @Get(':id/publish')
  getPublishInfo(@Param('id') id: string) {
    return this.svc.getPublishInfo(id);
  }

  /** 导出整部小说为 Word（.docx）：小程序端 downloadFile 后 openDocument 预览/转发 */
  @Get(':id/export')
  async exportDocx(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.svc.exportDocx(id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="novel.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get(':id/chapters')
  chapters(@Param('id') id: string) {
    return this.svc.listChapters(id);
  }

  /**
   * 一致性体检（只诊断，不自动改）。
   *
   * 两种口径：
   *   · 默认（收敛式复检）：代码核验旧清单（原文已不复存在 = 视为已修）+ 硬扫 + AI 只审改动过的地方。
   *     快、稳、清单只减不增 —— 治"修完又冒出一批、永远修不完"。
   *   · `?full=1`：全书重新审一遍（慢、烧额度），用于想彻底重查时。
   *   · `?force=1` 等价于 full=1（忽略指纹缓存）。
   */
  @Post(':id/audit')
  audit(
    @Param('id') id: string,
    @Query('force') force?: string,
    @Query('full') full?: string,
    @Query('scope') scope?: string, // all（默认）| consistency（只查矛盾）| dup（只查撞车）
  ) {
    const fullScan = full === '1' || force === '1';
    const sc = scope === 'consistency' || scope === 'dup' ? scope : 'all';
    return this.svc.auditConsistency(id, { fullScan, force: fullScan, scope: sc });
  }

  /**
   * 修完一条矛盾后记账：把这一条从体检清单里划掉并重算分数（矛盾 -1、分数 +N）。
   * 落库后角标也是减过的，退出小程序再进来不会又变回原样。
   */
  @Post(':id/audit-resolve')
  resolveAuditIssue(@Param('id') id: string, @Body() dto: AuditResolveDto) {
    return this.svc.resolveAuditIssue(id, dto.quote);
  }

  @Post(':id/chapter')
  chapter(@Param('id') id: string, @Body() dto: GenerateChapterDto) {
    return this.svc.generateChapter(id, dto);
  }

  /**
   * 单条定点修复：只改正文里出问题的那一句话，其余部分一个字节不动。
   * （不再整章重写 —— 那是"修一处、冒三处"的根因）
   */
  @Post(':id/chapter/:chId/patch')
  patchIssue(@Param('id') id: string, @Param('chId') chId: string, @Body() dto: PatchIssueDto) {
    return this.svc.fixOneIssue(id, chId, dto);
  }

  @Post(':id/chapter/:chId/rewrite')
  rewrite(@Param('id') id: string, @Param('chId') chId: string, @Body() dto: RewriteChapterDto) {
    return this.svc.rewriteChapter(id, chId, dto);
  }

  @Put(':id/chapter/:chId')
  saveChapter(
    @Param('id') id: string,
    @Param('chId') chId: string,
    @Body() dto: SaveChapterDto,
  ) {
    return this.svc.saveChapter(id, chId, dto);
  }
}
