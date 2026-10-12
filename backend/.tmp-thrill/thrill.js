"use strict";
/**
 * 【爽点定位会诊】M18 —— 解决「读者为什么追」。
 *
 * 和另外两层的分工，别串味：
 * - 本文件（M18）管「爽什么」：核心爽点、双引擎、疲劳陷阱、爽点存货。
 * - 大纲/中轴线管「剧情从哪儿来」。
 * - M32（PASS_GATE_RULE 里的节奏）管「多久爽一次」。
 * - M16·坑4 管「用什么兑现」（数字化入账、打赢后拿到什么）。
 *
 * **爽点必须建立在大纲之上、按卷章走**（作者 2026-10-12 明确要求）：
 * 会诊必须在《全书脉络》生成之后跑，每条爽点存货都要绑到具体某一卷，
 * 写稿时按「本章所在卷」取该卷的爽点锚点 —— 爽点是给大纲供血的，
 * 不是让作者另想一套爽点剧情去挤掉大纲（那样中轴线就废了）。
 *
 * 为什么必须单独一层：实测里最典型的翻车是「稿子没矛盾、字数也够，但就是没人追」——
 * 因为爽点从来没被定位过，作者凭感觉写，写到第十章开场就重复了。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FATIGUE_TRAPS = exports.THRILL_MATRIX = void 0;
exports.thrillPrompt = thrillPrompt;
exports.normalizeHype = normalizeHype;
exports.hypeVolumeOf = hypeVolumeOf;
exports.parseHype = parseHype;
exports.hypeBriefForChapter = hypeBriefForChapter;
/** 爽点母题库：5 组 × 6 条。会诊时先给模型看母题，避免它凭空憋出「打脸/逆袭」这种空词 */
exports.THRILL_MATRIX = [
    {
        group: '安全感系（我比你安全）',
        items: ['绝境脱险', '物资碾压他人', '庇护弱者', '危机提前预知', '安全屋升级', '别人求我收留'],
    },
    {
        group: '信息差系（我知道你不知道）',
        items: ['预知走向', '马甲揭棺', '高手被当成废物', '提前三步布局', '情报碾压', '当众拆穿谎言'],
    },
    {
        group: '财富资源系（拿到手的东西）',
        items: ['捡漏暴富', '数字化入账', '囤货兑现', '稀缺品垄断', '投资翻盘', '旧物变天价'],
    },
    {
        group: '身份地位系（我在往上走）',
        items: ['身份反转', '当众打脸', '权威改口', '上门跪求', '阶层跨越', '被大人物敬重'],
    },
    {
        group: '关系情感系（有人站我这边）',
        items: ['被偏爱', '旧人回头后悔', '长辈护短', '强者追随结盟', '被众人需要', '误解解开'],
    },
];
/** B 顾问的已知疲劳陷阱：踩一条就废，逐条都要能答「爽到第几次开始疲劳」 */
exports.FATIGUE_TRAPS = [
    { name: '只靠灾难盲盒（随机天灾推着走）', why: '天灾和主角能力无关，读者爽不到主角身上，第三次就疲劳' },
    { name: '只囤不消耗', why: '物资没有代价就没有张力，囤货变成记账' },
    { name: '队伍无限扩编', why: '人一多就没有个体命运，读者记不住谁' },
    { name: '只靠马甲揭棺', why: '揭一次新鲜，揭五次读者开始数马甲' },
    { name: '打脸只靠嘴炮', why: '对方没有真实损失 = 没有爽感，只有噪音' },
    { name: '财富只报数字不落地', why: '数字不换成画面（谁的手在抖、谁的脸白了）就没有体感' },
    { name: '开局即无敌', why: '张力归零，后面无事可写' },
    { name: '压抑超 3 章不释放', why: '不是蓄力，是流失' },
    { name: '爽点只在大高潮出现', why: '中间断了粮，读者在平淡段流失' },
    { name: '只能爽一次的东西当核心', why: '到那个点之前没有持续供能，到之后直接空窗' },
];
const HYPE_VERSION = 1;
function str(v, max = 200) {
    return String(v ?? '').trim().slice(0, max);
}
/**
 * 会诊提示词。
 * **必须在大纲与《全书脉络》生成之后调用** —— 爽点要挂在大纲的卷上，不许另想一套。
 * 一次调用定完：A 顾问五问 → B 顾问挑刺 → 裁判双引擎 → 按卷分配 → 30 条存货。
 */
function thrillPrompt(n, volumes = []) {
    const matrix = exports.THRILL_MATRIX
        .map((g) => `- ${g.group}：${g.items.join('、')}`)
        .join('\n');
    const traps = exports.FATIGUE_TRAPS.map((t, i) => `${i + 1}) ${t.name} —— ${t.why}`).join('\n');
    const volList = volumes.length
        ? volumes.map((v) => `第${v.volume}卷《${v.name || ''}》（${v.chapterRange || '?'}章）：${v.keyEvent || ''}`).join('\n')
        : '（大纲还没分卷，你按 6 卷自行规划，并在 perVolume 里写出卷名）';
    return `你是网文资深责编，主持一场**爽点定位会诊**。
大纲解决"剧情从哪儿来"，这场会诊只解决一件事：**读者为什么追这本书**。

【铁律】爽点必须**按大纲走**：下面的分卷时间线是已经定稿的中轴线，
你只能给每一卷配爽点、给卷里的章配爽点场景，**不许改剧情、不许新增卷、不许把关键事件换掉**。
爽点是给大纲供血的，不是另写一套爽文剧情去挤掉大纲。

【作品底子】
平台=${n.platform || '番茄'}｜书名=${n.title || '（待定）'}｜题材=${n.genre || ''}｜目标读者=${n.targetReader || ''}
一句话卖点=${n.sellPoint || ''}
全书大纲=${(n.outline || '').slice(0, 400)}

【已定稿的分卷时间线（爽点必须挂在这些卷上）】
${volList}

【爽点母题库（参考，别照抄，要挑出适合本书的组合）】
${matrix}

=== A 顾问五问（一题不能跳，每题必须给具体答案）===
1) 核心爽点是什么？**必须写成「读者心里那句话」**（例："我就知道他藏了底牌，我就等着看他们后悔"）。
   不许答「打脸 / 逆袭 / 爽文」这类空词 —— 那等于没定位。
2) 开局用什么兑现第一次爽感（前 3 章内）？具体到场景：谁、在哪、说了什么、拿到了什么。
3) 可破局点在哪儿？同一个爽点，中期靠什么翻新，才不会重复。
4) 爆发期点什么？把爽感拉到顶的那一下，是什么画面。
5) 绝对要避开什么？至少三条，每条写清「为什么一碰就废」。

=== B 顾问挑刺（口头禅：「这条能爽几次？爽到第几次开始疲劳？」）===
下面每条已知陷阱，判断本书会不会踩；会踩的给规避写法，并填「爽到第几次开始疲劳」。
答不上"能爽几次"的爽点 = 不合格，必须换引擎重写。
${traps}

=== 裁判结论：必须是双引擎（只给一个 = 不合格）===
核心爽点 = 【引擎 A：每 3000 字就能给一点的】 + 【引擎 B：每 30000-50000 字爆一次的】
两个引擎必须在**同一条因果链**上（因为 A 所以 B，例：绝对安全感 + 信息差碾压：因为知道 → 所以安全）。
引擎 A 必须能重复兑现 100 次；答不出就换引擎。

=== 防腻三轴（给每个大爽点各进一格）===
对象轴：身边人 → 配角 → 势力 → 规则（相邻大爽点**必须升一级**）
方式轴：物资 → 情报 → 身份 → 规则（不许重复）
代价轴：越来越大

=== 按卷分配（必须逐卷给，不许只给全局）===
对上面每一卷写出 perVolume 一项：本卷爽点锚点（**与这一卷的关键事件同一个画面**）
+ 本卷三轴各进到哪一格（卷号越大，对象轴越高、代价越大）。

=== 爽点存货 ===
开书一次备 **30 条**，每条是一句能直接写成一场戏的具体场景（20-40 字，不许写"打脸"这种抽象词），
**并且必须标明它属于第几卷（v）**，同卷内按对象轴由低到高排。
30 条要摊到各卷上（卷多的多分几条），不许 30 条全堆在第 1 卷。
写到剩 10 条必须回大纲补货 —— 存货见底是"写着写着不知道写什么"的头号原因。

仅输出如下 JSON（不要代码块、不要任何说明文字）：
{"core":"读者心里那句话（≤40字）",
 "engineA":"引擎A：每3000字给一点的日常供能（≤60字）",
 "engineB":"引擎B：每3-5万字爆一次的大爆发（≤60字）",
 "opening":"开局前3章第一次兑现：谁/在哪/说了什么/拿到什么（≤120字）",
 "midRefresh":"中期靠什么翻新（≤80字）",
 "climax":"爆发期顶点画面（≤80字）",
 "avoid":["绝对避开1（含为什么废）","绝对避开2","绝对避开3"],
 "traps":[{"name":"陷阱名","why":"为什么撑不住","dodge":"本书怎么规避","times":3}],
 "axes":{"object":"对象轴起始级","method":"方式轴起始级","cost":"代价轴起始级"},
 "perVolume":[{"v":1,"name":"卷名","anchor":"本卷爽点锚点画面（≤60字）","object":"对象轴","method":"方式轴","cost":"代价轴"}],
 "stock":[{"v":1,"s":"爽点场景（20-40字）"},"...共30条"]}`;
}
/**
 * 校验并归一化会诊结果。
 * 不合格直接返回 null —— 宁可没有爽点卡（写稿退回原来的写法），
 * 也不能把「打脸」这种空词写进库里当核心爽点，那比没有更糟。
 */
function normalizeHype(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const core = str(raw.core, 60);
    // 空词黑名单：模型偷懒只给套路词 = 没做定位
    if (!core || /^(打脸|逆袭|爽文|爽点|升级|变强|复仇|装逼)$/.test(core))
        return null;
    const engineA = str(raw.engineA, 120);
    const engineB = str(raw.engineB, 120);
    if (!engineA || !engineB)
        return null;
    const avoid = Array.isArray(raw.avoid)
        ? raw.avoid.map((x) => str(x, 120)).filter(Boolean).slice(0, 8)
        : [];
    const traps = Array.isArray(raw.traps)
        ? raw.traps
            .map((t) => ({
            name: str(t?.name, 60),
            why: str(t?.why, 120),
            dodge: str(t?.dodge, 160),
            times: Number.isFinite(Number(t?.times)) ? Number(t.times) : null,
        }))
            .filter((t) => t.name)
            .slice(0, 12)
        : [];
    // 存货兼容两种写法：模型有时给纯字符串数组（那就按卷均摊），规范写法是 {v,s}
    const stock = Array.isArray(raw.stock)
        ? raw.stock
            .map((x, i) => typeof x === 'string'
            ? { v: Math.floor(i / 5) + 1, s: str(x, 80) }
            : { v: Number(x?.v) || 1, s: str(x?.s, 80) })
            .filter((x) => x.s)
            .slice(0, 30)
        : [];
    // 存货少于 10 条：这卡没法支撑全书，直接判不合格
    if (stock.length < 10)
        return null;
    const perVolume = Array.isArray(raw.perVolume)
        ? raw.perVolume
            .map((v) => ({
            v: Number(v?.v) || 0,
            name: str(v?.name, 40),
            anchor: str(v?.anchor, 120),
            object: str(v?.object, 40),
            method: str(v?.method, 40),
            cost: str(v?.cost, 40),
        }))
            .filter((v) => v.v > 0)
            .slice(0, 24)
        : [];
    const axes = raw.axes && typeof raw.axes === 'object' ? raw.axes : {};
    return {
        core,
        engineA,
        engineB,
        opening: str(raw.opening, 240),
        midRefresh: str(raw.midRefresh, 200),
        climax: str(raw.climax, 200),
        avoid,
        traps,
        axes: {
            object: str(axes.object, 40),
            method: str(axes.method, 40),
            cost: str(axes.cost, 40),
        },
        perVolume,
        stock,
        version: HYPE_VERSION,
    };
}
/** 取某卷的爽点锚点；没有该卷就退回全局三轴 */
function hypeVolumeOf(h, volume) {
    if (!h)
        return null;
    const hit = (h.perVolume || []).find((v) => v.v === Number(volume));
    if (hit)
        return hit;
    // 卷号超出规划范围（写到后面加卷了）：用最后一卷的三轴继续，别让爽点断供
    const last = (h.perVolume || []).slice(-1)[0];
    return last || null;
}
/** 存库/读库的包装：解析失败或版本不符一律当没有 */
function parseHype(json) {
    if (!json)
        return null;
    try {
        const o = JSON.parse(json);
        if (!o || o.version !== HYPE_VERSION)
            return null;
        return normalizeHype(o);
    }
    catch {
        return null;
    }
}
/**
 * 写稿时注入的爽点约束块。**按本章所在卷取**，保证爽点跟着大纲走。
 *
 * 只挑「本卷该用的那几条存货」，不把 30 条全塞进提示词 —— 全塞会让模型在长上下文里
 * 抓不住重点，实测表现是"每条都沾一点，一条都没写透"。
 * @param order 本章章号：同卷内轮转取，保证相邻两章不重复
 * @param volume 本章所在卷：决定用哪一段爽点锚点
 */
function hypeBriefForChapter(h, order, volume) {
    if (!h)
        return '';
    const v = Number(volume) || 1;
    const hv = hypeVolumeOf(h, v);
    const object = hv?.object || h.axes.object || '身边人';
    const method = hv?.method || h.axes.method || '物资';
    const cost = hv?.cost || h.axes.cost || '小';
    // 本卷的存货优先；该卷没分到（模型漏了）就退回全库轮转，保证不断供
    const inVol = h.stock.filter((x) => Number(x.v) === v);
    const pool = inVol.length ? inVol : h.stock;
    const i = Math.max(0, Number(order) - 1);
    const pick = [0, 1, 2].map((k) => pool[(i + k * 3) % pool.length]).filter(Boolean);
    const avoid = h.avoid.slice(0, 3).map((a, k) => `${k + 1}) ${a}`).join('\n') || '（无）';
    return `=== 爽点卡（M18：本章必须兑现的"爽"，优先级仅次于事实台账）===
核心爽点（读者心里那句话）：${h.core}
引擎 A（日常供能，每 3000 字给一点）：${h.engineA} —— **本章必须至少兑现一次**
引擎 B（大爆发，每 3-5 万字一次）：${h.engineB} —— 未到爆发期只铺垫、不许提前透支
本卷（第${v}卷${hv?.name ? `《${hv.name}》` : ''}）爽点锚点：${hv?.anchor || '（按中轴线推进）'}
  → 本章的爽点必须服务于这个锚点，**不许跳出大纲另造爽点剧情**。
防腻三轴（本卷）：对象轴=${object}｜方式轴=${method}｜代价轴=${cost}
  → 相邻两章的大爽点**不许同格**：对象轴至少升一级或换方式轴，重复就是读者犯困的开始。
本章可挑的爽点场景（挑 1 条写成一场戏，写透，别三条都沾一点）：
${pick.map((x, k) => `${k + 1}) ${x.s}`).join('\n')}
绝对避开：
${avoid}`;
}
