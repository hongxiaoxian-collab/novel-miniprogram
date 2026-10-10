import { IsString, IsOptional, IsIn, IsObject, IsArray, IsNumber, IsBoolean } from 'class-validator';

export class CreateNovelDto {
  @IsIn(['fanqie', 'qimao'])
  platform: string;

  @IsString()
  title: string;

  @IsOptional() @IsString()
  penName?: string;

  @IsOptional() @IsString()
  authorIntro?: string;

  @IsOptional() @IsString()
  genre?: string;

  @IsOptional() @IsString()
  targetReader?: string;

  @IsOptional() @IsIn(['unsigned', 'signing', 'signed'])
  contractStatus?: string;

  @IsOptional() @IsString()
  contractMode?: string;

  @IsOptional()
  chapterWords?: number; // 每章目标字数（默认 2000）

  @IsOptional() @IsObject()
  tags?: Record<string, any>;
}

/**
 * 【一键开书】作者只给平台（默认番茄）和笔名，书名 / 卖点 / 男女频 / 题材 / 大纲 /
 * 时间线 / 简介 / 主角 / 签约模式 / 标签 / 封面全部由 AI 生成。
 */
export class QuickStartDto {
  @IsOptional() @IsIn(['fanqie', 'qimao'])
  platform?: string; // 不传 = 番茄（新架构默认平台）

  @IsOptional() @IsString()
  penName?: string;

  @IsOptional() @IsString()
  authorIntro?: string;

  @IsOptional() @IsString()
  opinion?: string; // 作者的一句话方向要求（可空）

  @IsOptional() @IsString()
  parentId?: string; // 被拒重开时指向被拒那本

  @IsOptional() @IsNumber()
  chapterWords?: number;

  /** 「被拒重开」专用：把上一部的书名 / 驳回原因 / 大纲带进来，强制 AI 换方向 */
  @IsOptional() @IsObject()
  avoid?: { title?: string; reason?: string; outline?: string };
}

/** 平台反馈：被拒（填驳回原话）/ 过审（可填说明）。reason 一律原文留存 */
export class RejectDto {
  @IsOptional() @IsString()
  reason?: string;
}

export class GenerateOutlineDto {
  @IsOptional() @IsString()
  opinion?: string; // 重来时附带的用户意见
}

export class GenerateBibleDto {
  @IsOptional() @IsString()
  reason?: string; // 'review_failed'(审核未过) | 'pre_review'(未审核调整) | 其他说明

  @IsOptional() @IsString()
  opinion?: string; // 调整意见（如：某条线重写、节奏放慢）

  @IsOptional()
  onlyGolden?: boolean; // true：脉络/资料已就绪，只补写黄金 1-3 章

  @IsOptional()
  acceptDup?: boolean; // true：作者已看过撞车报告并明确选择"仍要定版"（否则严重撞车一律中断）
}

export class RecommendTopicDto {
  @IsIn(['fanqie', 'qimao'])
  platform: string;
}

/** 首次引导 / 作品资料页：AI 推荐笔名、代写作者简介 */
export class AuthorAssistDto {
  @IsIn(['fanqie', 'qimao'])
  platform: string;

  @IsIn(['pen', 'intro'])
  kind: string; // pen=推荐笔名（≥3 个）｜intro=写作者简介

  @IsOptional() @IsString()
  genre?: string; // 题材（有则推荐更贴合）

  @IsOptional() @IsArray()
  exclude?: string[]; // 「换一批」时带上上一批，避免重复

  @IsOptional() @IsString()
  opinion?: string; // 重写简介时的要求
}

export class JobDto {
  @IsIn(['audit', 'fix', 'chapter', 'outline'])
  kind: string; // audit=一键体检｜fix=自动修复能确定改法的矛盾｜chapter=续写下一章｜outline=生成全书脉络

  @IsOptional() @IsString()
  opinion?: string; // 作者选定的修复方向（如"统一按魂穿写"），给了就连"需要拍板"的问题一起修；outline 时作为额外要求

  @IsOptional() @IsNumber()
  wordCount?: number; // chapter：每章目标字数

  @IsOptional() @IsString()
  instruction?: string; // chapter：写稿指令

  @IsOptional() @IsNumber()
  count?: number; // chapter：一次续更几章（1~20，默认 1）。作者不用一章一章点

  @IsOptional() @IsBoolean()
  force?: boolean; // audit：true=忽略缓存重算（稿子改过要用）

  /** audit：查什么 —— all=矛盾+撞车（默认）｜consistency=只查矛盾｜dup=只查撞车 */
  @IsOptional() @IsString()
  scope?: string;
}

export class DupFixDto {
  @IsString()
  title: string; // 作者选定的新书名

  @IsOptional() @IsString()
  plot?: string; // 该书名配套的差异化剧情方向（重出大纲时强制执行）
}

export class TitleSuggestDto {
  @IsOptional() @IsArray()
  exclude?: string[]; // 已经给过、作者不想要的书名
}

export class CoverPlanDto {
  @IsOptional() @IsString()
  opinion?: string; // 「按情节重新设计」时的额外要求，如"人物再靠近镜头一点"

  @IsOptional() @IsArray()
  exclude?: string[]; // 上一版用过的配色/道具，尽量别重复
}

export class CoverImageDto {
  /** 换一换：换 seed / 换要求时传一下，避免出同一张 */
  @IsOptional() @IsNumber()
  seed?: number;

  /** 「换一换」时给生图模型的额外要求，如"人物再靠近镜头一点""换夜景" */
  @IsOptional() @IsString()
  opinion?: string;

  /** 手动指定画面脚本（不传则 AI 按这部作品的情节写） */
  @IsOptional() @IsString()
  scene?: string;

  /** 书名（不传取作品名）。改了书名重出图时用，不用重新生图也能换字 */
  @IsOptional() @IsString()
  title?: string;

  /** 笔名（不传取作品笔名） */
  @IsOptional() @IsString()
  author?: string;

  /** 副标题/题材标签（不传按 目标读者·主分类·题材 自动拼） */
  @IsOptional() @IsString()
  sub?: string;

  /** 只换字不重新生图：复用上次的底图（省一次生图额度） */
  @IsOptional()
  reuseBase?: boolean;

  /** 书名主色 RGB，形如 "245,215,138" */
  @IsOptional() @IsString()
  color?: string;
}

export class GenerateChapterDto {
  @IsString()
  instruction: string; // 写稿指令（推进哪条线/回收哪个伏笔）

  @IsOptional()
  wordCount?: number; // 每章目标字数（硬指标，默认读 novel.chapterWords=2000）

  @IsOptional()
  volume?: number;

  @IsOptional()
  order?: number;

  /**
   * true = 写完不自检（由调用方自己安排自检时机，避免同一章被自检两遍）。
   * 续更后台任务用它：写章步骤跳过，交给后面的「发布前自检」步骤统一跑。
   */
  @IsOptional()
  skipHeal?: boolean;
}

export class RewriteChapterDto {
  @IsString()
  reason: string; // 用户不满意的原因（必须填）

  @IsOptional() @IsString()
  instruction?: string; // 附加改写指令
}

export class SaveChapterDto {
  @IsOptional() @IsString()
  title?: string;

  @IsOptional() @IsString()
  content?: string;

  @IsOptional() @IsString()
  summary?: string;

  @IsOptional() @IsIn(['draft', 'done'])
  status?: string;
}

export class UpdateNovelDto {
  @IsOptional() @IsString()
  title?: string;

  /** 作者按推荐选用并确认过的书名（配合 title 一起提交）：之后再次查重判 mid 时不再中断定版 */
  @IsOptional() @IsString()
  dupAccepted?: string;

  @IsOptional() @IsString()
  penName?: string;

  @IsOptional() @IsString()
  authorIntro?: string;

  @IsOptional() @IsString()
  coverImage?: string;

  @IsOptional() @IsString()
  genre?: string;

  @IsOptional() @IsString()
  targetReader?: string;

  @IsOptional() @IsString()
  contractStatus?: string;

  /** 作品状态：writing(在写) | rejected(被拒) | archived(已归档)。
   *  被拒/归档都不占「每平台 1 部在写」的名额，转回 writing 时才重新占位并受名额检查。 */
  @IsOptional() @IsIn(['writing', 'rejected', 'archived'])
  status?: string;

  /** 平台驳回原因（作者从平台复制的原话）；与 status=rejected 一起提交 */
  @IsOptional() @IsString()
  rejectReason?: string;

  @IsOptional() @IsString()
  contractMode?: string;

  @IsOptional() @IsString()
  sellPoint?: string;

  @IsOptional() @IsString()
  outline?: string;

  @IsOptional()
  chapterWords?: number; // 换题材 / 调字数重做时需要

  @IsOptional() @IsObject()
  tags?: Record<string, any>;
}

/** 单条矛盾已修复：拿矛盾原文（清单里每条都有）当身份证，划掉这一条并重算分数 */
export class AuditResolveDto {
  @IsString()
  quote: string;
}

/** 单条定点修复：前端把这条矛盾（原句/原因/改法/等级）原样回传，后端只改正文里的那一句 */
export class PatchIssueDto {
  @IsString() quote: string;

  @IsOptional() @IsString() why?: string;

  @IsOptional() @IsString() fix?: string;

  @IsOptional() @IsString() level?: string;

  @IsOptional() @IsString() type?: string;

  @IsOptional() chapter?: number;
}

/** AI 选题：作者只给平台（和可选的一句话想法），其余全部由 AI 定 */
export class PlanDto {
  @IsIn(['fanqie', 'qimao'])
  platform: string;

  @IsOptional() @IsString()
  opinion?: string;

  @IsOptional()
  chapterWords?: number;
}

/** 作者从 AI 给的 3-5 个方案里挑一个 */
export class PickPlanDto {
  @IsOptional()
  idx?: number;

  @IsOptional() @IsString()
  title?: string; // 也可以直接按书名挑（前端回传更稳）
}
