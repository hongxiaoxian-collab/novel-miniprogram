import { Controller, Get, Post, Delete, Body, Param, Query, Put, Res, Headers } from '@nestjs/common';
import { Response } from 'express';
import { NovelService } from './novel.service';
import { uidFromHeader, guestFromHeader } from '../auth/token';
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
  CoverImageDto,
  JobDto,
  TitleSuggestDto,
  DupFixDto,
  AuditResolveDto,
  PatchIssueDto,
  PlanDto,
  PickPlanDto,
  QuickStartDto,
  RejectDto,
} from './novel.dto';

@Controller('novel')
export class NovelController {
  constructor(private readonly svc: NovelService) {}

  @Get('meta')
  meta() {
    return this.svc.getMeta();
  }

  @Get()
  list(
    @Query('platform') platform?: string,
    @Headers('authorization') auth?: string,
    @Headers('x-guest-key') guest?: string,
  ) {
    return this.svc.listNovels(platform, uidFromHeader(auth), guestFromHeader(guest));
  }

  @Post('recommend-topic')
  recommendTopic(@Body() dto: RecommendTopicDto) {
    return this.svc.recommendTopic(dto.platform);
  }

  /**
   * 【一键开书】默认番茄平台；书名/卖点/男频女频/题材/大纲/时间线/简介/主角/
   * 签约模式/阅读标签/内容标签/封面全部 AI 生成。返回作品 id，用 /novel/:id/jobs 轮询进度。
   */
  @Post('quick-start')
  quickStart(
    @Body() dto: QuickStartDto,
    @Headers('authorization') auth?: string,
    @Headers('x-guest-key') guest?: string,
  ) {
    return this.svc.quickStart(dto, uidFromHeader(auth), guestFromHeader(guest));
  }

  /**
   * 【AI 选题】作者只给平台（可选一句话想法），书名 / 男频女频 / 题材 / 金手指全部由 AI 定。
   * 返回占位作品 id，前端用 /novel/:id/jobs 轮询三步进度，跑完从 result.plans 拿 3-5 个方案。
   */
  @Post('plan')
  createPlan(@Body() dto: PlanDto, @Headers('authorization') auth?: string) {
    return this.svc.createPlanDraft(dto, uidFromHeader(auth));
  }

  /** 重读方案（页面被回收后回来接着挑） */
  @Get('plan/:id')
  getPlan(@Param('id') id: string) {
    return this.svc.getPlan(id);
  }

  /** 选定第 idx 个方案（或按书名挑）→ 落到作品上，占位转正，之后走正常定版流程 */
  @Post('plan/:id/pick')
  pickPlan(@Param('id') id: string, @Body() dto: PickPlanDto) {
    return this.svc.pickPlan(id, dto);
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
    if (dto.kind === 'polish') return this.svc.startPolishJob(id);
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

  /**
   * 【真图封面】生图模型出「无字底图」→ 服务端精确叠书名/笔名/题材标签 → 落盘。
   * 返回 url 可直接喂给 <image>；换一换传 seed/opinion，只改字传 reuseBase。
   */
  @Post(':id/cover-image')
  coverImage(@Param('id') id: string, @Body() dto: CoverImageDto) {
    return this.svc.coverImageGen(id, dto);
  }

  /** 读已生成的封面（页面进来时按需拉，列表接口不带它，避免响应体积暴涨） */
  @Get(':id/cover-image')
  getCoverImage(@Param('id') id: string) {
    return this.svc.getCoverImage(id);
  }

  /** 封面图本体。不加鉴权：要给 <image> 和「保存到相册」直接用（id 是 cuid，猜不到） */
  @Get(':id/cover.jpg')
  async coverJpg(@Param('id') id: string, @Res() res: Response) {
    const abs = await this.svc.coverAbsPath(id);
    if (!abs) {
      res.status(404).json({ error: '这部作品还没有真图封面' });
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache'); // 换封面后要立刻看到新图
    res.sendFile(abs);
  }

  @Post()
  create(
    @Body() dto: CreateNovelDto,
    @Headers('authorization') auth?: string,
    @Headers('x-guest-key') guest?: string,
  ) {
    return this.svc.createNovel(dto, uidFromHeader(auth), guestFromHeader(guest));
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

  /** 读爽点卡（M18 会诊结论：核心爽点 / 双引擎 / 疲劳陷阱 / 按卷锚点 / 30 条存货） */
  @Get(':id/hype')
  hype(@Param('id') id: string) {
    return this.svc.getHype(id);
  }

  /** 重跑爽点会诊（大纲改了之后必须重跑，否则爽点还挂在旧卷上） */
  @Post(':id/hype')
  rebuildHype(@Param('id') id: string) {
    return this.svc.buildHypeCard(id);
  }

  /**
   * 【剧情平淡 · 三招救场】强设新目标 / 硬加冲突 / 借鉴飞卢文快节奏，
   * 每条都是能直接当下一章写作指令的方案。作者点哪条，就把哪条填进续更指令。
   */
  @Post(':id/rescue')
  rescue(@Param('id') id: string, @Body() dto: { situation?: string }) {
    return this.svc.runRescue(id, dto?.situation);
  }

  /**
   * 【被平台拒了】登记驳回原因（原文留存 + AI 总结，作为后续改进的原始数据），
   * 该作品转「被拒」，立刻腾出这个平台的在写名额，然后可点 /restart 自动重开一本。
   */
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.svc.rejectNovel(id, dto);
  }

  /** 【过审了】同样留一条正向样本（以后对比"过与不过"的差别，全靠这一正一反两批数据） */
  @Post(':id/pass')
  pass(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.svc.passNovel(id, dto);
  }

  /** 【被拒后自动重开一本】旧作标被拒 → 同平台新建一部 → 带上"上一部为什么被拒"让 AI 换方向 */
  @Post(':id/restart')
  restart(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.svc.restartAfterReject(id, dto);
  }

  /** 这部作品历次平台反馈（被拒 / 过审）与当时的作品快照 */
  @Get(':id/feedbacks')
  feedbacks(@Param('id') id: string) {
    return this.svc.listFeedback(id);
  }

  /**
   * 清理同一章号的重复章节（并发定版 / 中途重出大纲留下的脏数据）：同一章号只保留最新一稿。
   * 用于修「实际 3 章、列表显示 6 章」这类历史数据。
   */
  @Post(':id/dedupe')
  async dedupe(@Param('id') id: string) {
    const removed = await this.svc.dedupeChapters(id);
    const chapters = await this.svc.listChapters(id);
    return { removed, chapters };
  }

  /** 撞车检测：比对番茄/七猫热榜 */
  /** 撞车检测；?force=1 表示作者主动点「重新查重」，忽略 30 分钟内的缓存 */
  @Post(':id/check-duplicate')
  checkDuplicate(@Param('id') id: string, @Query('force') force?: string) {
    return this.svc.checkDuplicate(id, force === '1');
  }

  /**
   * 【平台过审体检】八项判据（AI 指纹 / 结构失衡 / 对话占比 / 开篇钩子…）打分。
   * 与「一致性体检」分开：那个查矛盾（故事对不对），这个查能不能签约（机器判据过不过）。
   */
  @Get(':id/pass-review')
  passReview(@Param('id') id: string) {
    return this.svc.passReview(id);
  }

  /** 【一键过审清洗】按判据逐章改写，跑「清洗 → 复检」最多 3 轮，直到过目标分 */
  @Post(':id/pass-clean')
  passClean(@Param('id') id: string, @Body() dto: { target?: number }) {
    return this.svc.startPassCleanJob(id, Number(dto?.target) || 85);
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
