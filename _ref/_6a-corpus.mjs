/* 任务卡 6A · **时间表达语料表**（全表扫描的被测集合）
 *
 * 用途：`_6a-probe.mjs`（只读探针）与 `_6a-regress.mjs`（常驻回归）都只读这一份表。
 *   · regress 的契约：**断言数 == 表行数**（一行至少一条断言，不许少写）。
 *
 * 两条来源（卡面要求打标记）：
 *   · `real`  = 从用户的鱼事备份里抽出来的、他真实打过的字（`it.raw`）
 *   · `model` = 模型按正交维度枚举出来的补充（保证"不漏"）
 *
 * ⚠️ **本表的现状（2026-10-10）**：用户选择「跳过真实语料，只做模型枚举」——
 *     `_ref/_6a-backup.json` 未到位（前置闸门③不过），因此 `real` 来源为 0 条。
 *     下面的 `loadReal()` 已经写好，备份一旦放进来即自动合并；回报里登记为遗留。
 *
 * ⚠️ 两条纪律（卡面红线）：
 *   ① `it.title` **不许当期望值** —— 那是旧版解析器的结果，不是标准。
 *      它只用来（a）暴露分布、（b）找可疑样本（title 里还残留数字的 = 当时没认出来的）。
 *   ② **枚举可以用模型，判定不许用模型** —— 期望值一律由规则定义 + 人抽检，
 *      拿不准的标成 `?`（见 `_6a-regress.mjs` 的 EXPECT 表），不进断言。
 *
 * 字段：
 *   t    输入原文（一行字）
 *   src  来源 real | model
 *   dim  正交维度（哪一维覆盖到它）
 *   freq 常用度：1 = 最常用（先修）… 4 = 低频/纯反例。**修的顺序按它排，不按覆盖率排。**
 *   note 人为备注（取舍、反例、已知不做的原因）
 */
import fs from 'node:fs';
import path from 'node:path';

/* 模型枚举的那批（按正交维度穷举"中文里最常用的时间表达"，合计 200 条）。
   顺序按维度排；扫表时按 freq 升序（最常用在前）重排。 */
const MODEL = [
  /* ── D1 数字简写 · 行尾（用户最习惯的写法之一） ── */
  { t: '交作业 915', src: 'model', dim: '数字简写·行尾', freq: 1 },
  { t: '交报告 921', src: 'model', dim: '数字简写·行尾', freq: 1 },
  { t: '买书 91', src: 'model', dim: '数字简写·行尾', freq: 2 },
  { t: '取快递 105', src: 'model', dim: '数字简写·行尾', freq: 3 },
  { t: '开会 9.15', src: 'model', dim: '数字简写·行尾', freq: 2 },
  { t: '交材料 9.2', src: 'model', dim: '数字简写·行尾', freq: 2 },
  { t: '交表 12.31', src: 'model', dim: '数字简写·行尾', freq: 3 },
  { t: '复习 123', src: 'model', dim: '数字简写·行尾', freq: 3 },
  { t: '体检 56', src: 'model', dim: '数字简写·行尾', freq: 3 },
  { t: '交形策作业 916', src: 'model', dim: '数字简写·行尾', freq: 1 },

  /* ── D2 数字简写 · 行首（用户习惯：日期写最前面） ── */
  { t: '915 交作业', src: 'model', dim: '数字简写·行首', freq: 1 },
  { t: '921 交报告', src: 'model', dim: '数字简写·行首', freq: 1 },
  { t: '91 买书', src: 'model', dim: '数字简写·行首', freq: 3 },
  { t: '9.15 开会', src: 'model', dim: '数字简写·行首', freq: 2 },
  { t: '9.2 交材料', src: 'model', dim: '数字简写·行首', freq: 2 },
  { t: '1015 报名', src: 'model', dim: '数字简写·行首', freq: 3 },
  { t: '123 复习', src: 'model', dim: '数字简写·行首', freq: 3 },
  { t: '916 交形策作业', src: 'model', dim: '数字简写·行首', freq: 2 },

  /* ── D3 数字简写 · 行中 ── */
  { t: '#大 924 给植物浇水', src: 'model', dim: '数字简写·行中', freq: 3 },
  { t: '交 915 报告', src: 'model', dim: '数字简写·行中', freq: 3 },
  { t: '提醒 921 交表', src: 'model', dim: '数字简写·行中', freq: 3 },
  { t: '周三 915 交作业', src: 'model', dim: '数字简写·行中', freq: 3 },

  /* ── D4 汉字数字简写（本机语音识别几乎总吐汉字） ── */
  { t: '九一五 交作业', src: 'model', dim: '汉字数字', freq: 2 },
  { t: '九二一 交报告', src: 'model', dim: '汉字数字', freq: 3 },
  { t: '九三 交表', src: 'model', dim: '汉字数字', freq: 3 },
  { t: '九一三 做作业', src: 'model', dim: '汉字数字', freq: 2 },
  { t: '十二 交材料', src: 'model', dim: '汉字数字', freq: 4 },

  /* ── D5 全角数字（★ 卡面明令**不在本卡范围**，单独立项） ── */
  { t: '９１５ 交作业', src: 'model', dim: '全角数字·不在本卡范围', freq: 3, note: '卡面不在范围' },
  { t: '３号交材料', src: 'model', dim: '全角数字·不在本卡范围', freq: 3, note: '卡面不在范围' },
  { t: '１７号开会', src: 'model', dim: '全角数字·不在本卡范围', freq: 3, note: '卡面不在范围' },
  { t: '９.２ 交材料', src: 'model', dim: '全角数字·不在本卡范围', freq: 4, note: '卡面不在范围' },
  { t: '９：３０ 开会', src: 'model', dim: '全角数字·不在本卡范围', freq: 4, note: '卡面不在范围' },

  /* ── D6 日期锚点 · 相对词 ── */
  { t: '今天 交作业', src: 'model', dim: '日期锚点·相对词', freq: 1 },
  { t: '今日 开会', src: 'model', dim: '日期锚点·相对词', freq: 3 },
  { t: '明天 交报告', src: 'model', dim: '日期锚点·相对词', freq: 1 },
  { t: '明日 开会', src: 'model', dim: '日期锚点·相对词', freq: 4 },
  { t: '后天 交材料', src: 'model', dim: '日期锚点·相对词', freq: 2 },
  { t: '大后天 出差', src: 'model', dim: '日期锚点·相对词', freq: 3 },
  { t: '昨天 交作业', src: 'model', dim: '日期锚点·相对词', freq: 2 },
  { t: '前天 交作业', src: 'model', dim: '日期锚点·相对词', freq: 3 },
  { t: '大前天 交作业', src: 'model', dim: '日期锚点·相对词', freq: 4 },

  /* ── D7 日期锚点 · 星期 ── */
  { t: '下周三 开会', src: 'model', dim: '日期锚点·星期', freq: 1 },
  { t: '这周五 聚餐', src: 'model', dim: '日期锚点·星期', freq: 2 },
  { t: '本周一 开会', src: 'model', dim: '日期锚点·星期', freq: 3 },
  { t: '下周一 交报告', src: 'model', dim: '日期锚点·星期', freq: 2 },
  { t: '周日 休息', src: 'model', dim: '日期锚点·星期', freq: 2 },
  { t: '星期六 打球', src: 'model', dim: '日期锚点·星期', freq: 3 },
  { t: '礼拜三 开会', src: 'model', dim: '日期锚点·星期', freq: 4 },
  { t: '周三之前 交报告', src: 'model', dim: '日期锚点·星期', freq: 2 },
  { t: '周四之前 交材料', src: 'model', dim: '日期锚点·星期', freq: 2 },
  { t: '下下周三 开会', src: 'model', dim: '日期锚点·星期', freq: 4 },

  /* ── D8 日期锚点 · 月/旬/时段（多半要靠 AI 兜底，本地只有一半能定） ── */
  { t: '下个月 交房租', src: 'model', dim: '日期锚点·月旬', freq: 2, note: '锚点不唯一' },
  { t: '月底 对账', src: 'model', dim: '日期锚点·月旬', freq: 3, note: '锚点不唯一' },
  { t: '月初 交报告', src: 'model', dim: '日期锚点·月旬', freq: 3, note: '锚点不唯一' },
  { t: '年底 总结', src: 'model', dim: '日期锚点·月旬', freq: 4, note: '锚点不唯一' },
  { t: '下个月这个时候 开会', src: 'model', dim: '日期锚点·月旬', freq: 4, note: '锚点不唯一' },
  { t: '这个月 交表', src: 'model', dim: '日期锚点·月旬', freq: 3, note: '锚点不唯一' },

  /* ── D9 钟点 · 阿拉伯 ── */
  { t: '下午3点 开会', src: 'model', dim: '钟点·阿拉伯', freq: 1 },
  { t: '15:00 开会', src: 'model', dim: '钟点·阿拉伯', freq: 1 },
  { t: '3点半 开会', src: 'model', dim: '钟点·阿拉伯', freq: 2 },
  { t: '9:30 开会', src: 'model', dim: '钟点·阿拉伯', freq: 1 },
  { t: '9点30 开会', src: 'model', dim: '钟点·阿拉伯', freq: 3 },
  { t: '11点05 开会', src: 'model', dim: '钟点·阿拉伯', freq: 3 },
  { t: '11点5 开会', src: 'model', dim: '钟点·阿拉伯', freq: 4, note: '半截分钟：宁可整句不认' },
  { t: '下午5点 交表', src: 'model', dim: '钟点·阿拉伯', freq: 1 },
  { t: '晚上11:05 看书', src: 'model', dim: '钟点·阿拉伯', freq: 2 },
  { t: '中午12点 吃饭', src: 'model', dim: '钟点·阿拉伯', freq: 2 },
  { t: '凌晨2点 值班', src: 'model', dim: '钟点·阿拉伯', freq: 3 },
  { t: '早上8点 吃药', src: 'model', dim: '钟点·阿拉伯', freq: 1 },
  { t: '3:1 比例', src: 'model', dim: '钟点·阿拉伯', freq: 4, note: '反例（比例）' },
  { t: '16:9 视频', src: 'model', dim: '钟点·阿拉伯', freq: 4, note: '反例（比例）' },

  /* ── D10 钟点 · 汉字数字 ── */
  { t: '三点 开会', src: 'model', dim: '钟点·汉字', freq: 2 },
  { t: '下午三点 开会', src: 'model', dim: '钟点·汉字', freq: 2 },
  { t: '晚上九点五十一 看书', src: 'model', dim: '钟点·汉字', freq: 2 },
  { t: '九点半 开会', src: 'model', dim: '钟点·汉字', freq: 2 },
  { t: '十一点半 开会', src: 'model', dim: '钟点·汉字', freq: 3 },
  { t: '晚上八点 看电影', src: 'model', dim: '钟点·汉字', freq: 2 },
  { t: '早上七点 跑步', src: 'model', dim: '钟点·汉字', freq: 2 },

  /* ── D11 钟点 · 全角冒号 ── */
  { t: '9：30 开会', src: 'model', dim: '钟点·全角冒号', freq: 2 },
  { t: '11：05 开会', src: 'model', dim: '钟点·全角冒号', freq: 3 },

  /* ── D12 时段词单独出现 ── */
  { t: '早上 跑步', src: 'model', dim: '时段词', freq: 3 },
  { t: '上午 开会', src: 'model', dim: '时段词', freq: 3 },
  { t: '中午 吃饭', src: 'model', dim: '时段词', freq: 3 },
  { t: '下午 开会', src: 'model', dim: '时段词', freq: 3 },
  { t: '傍晚 散步', src: 'model', dim: '时段词', freq: 4 },
  { t: '晚上 看书', src: 'model', dim: '时段词', freq: 3 },
  { t: '凌晨 值班', src: 'model', dim: '时段词', freq: 4 },
  { t: '深夜 写稿', src: 'model', dim: '时段词', freq: 4 },

  /* ── D13 时段词连写 / 缩写（今晚 / 明早 / 明晚） ── */
  { t: '今晚 开会', src: 'model', dim: '时段词·缩写', freq: 1 },
  { t: '明早 跑步', src: 'model', dim: '时段词·缩写', freq: 2 },
  { t: '明晚 开会', src: 'model', dim: '时段词·缩写', freq: 2 },
  { t: '今早 跑步', src: 'model', dim: '时段词·缩写', freq: 3 },
  { t: '昨晚 加班', src: 'model', dim: '时段词·缩写', freq: 4 },

  /* ── D14 组合：日期 + 时段 + 钟点 ── */
  { t: '明天下午三点 开会', src: 'model', dim: '组合', freq: 1 },
  { t: '明天早上8点 交材料', src: 'model', dim: '组合', freq: 1 },
  { t: '今晚八点 看电影', src: 'model', dim: '组合', freq: 1 },
  { t: '后天晚上九点五十一 看书', src: 'model', dim: '组合', freq: 3 },
  { t: '周五下午5点 开会', src: 'model', dim: '组合', freq: 1 },
  { t: '明天15:00 开会', src: 'model', dim: '组合', freq: 1 },
  { t: '明天上午 交材料', src: 'model', dim: '组合', freq: 2 },
  { t: '后天早上 开会', src: 'model', dim: '组合', freq: 3 },
  { t: '明早七点 跑步', src: 'model', dim: '组合', freq: 3 },

  /* ── D15 区间 ── */
  { t: '914~919 交报告', src: 'model', dim: '区间', freq: 2 },
  { t: '920~923 交报告', src: 'model', dim: '区间', freq: 2 },
  { t: '交报告 920~923', src: 'model', dim: '区间', freq: 2 },
  { t: '9.14~9.19 交报告', src: 'model', dim: '区间', freq: 3 },
  { t: '914-919 交报告', src: 'model', dim: '区间', freq: 3 },
  { t: '914—919 交报告', src: 'model', dim: '区间', freq: 4 },
  { t: '914～919 交报告', src: 'model', dim: '区间', freq: 3 },
  { t: '读aiagent入门书91～915', src: 'model', dim: '区间', freq: 2 },
  { t: '买3~5个苹果', src: 'model', dim: '区间', freq: 4, note: '反例（非日期）' },
  { t: '第3~5章', src: 'model', dim: '区间', freq: 4, note: '反例（非日期）' },
  { t: '14号到19号 交材料', src: 'model', dim: '区间', freq: 3, note: '「到」式区间' },
  { t: '这周一到周五 值班', src: 'model', dim: '区间', freq: 3, note: '「到」式区间' },

  /* ── D16 循环 ── */
  { t: '每天 跑步', src: 'model', dim: '循环', freq: 1 },
  { t: '每2天 浇花', src: 'model', dim: '循环', freq: 2 },
  { t: '每三天 跑步', src: 'model', dim: '循环', freq: 3 },
  { t: '每隔3天 复查', src: 'model', dim: '循环', freq: 3 },
  { t: '每周三 跑步', src: 'model', dim: '循环', freq: 1 },
  { t: '每周一三五 健身', src: 'model', dim: '循环', freq: 3 },
  { t: '每月1号 交房租', src: 'model', dim: '循环', freq: 1 },
  { t: '每月一号 交房租', src: 'model', dim: '循环', freq: 2 },
  { t: '每逢周一 开会', src: 'model', dim: '循环', freq: 3 },
  { t: '每周一次 汇报', src: 'model', dim: '循环', freq: 3, note: '4A 有意不当成"每周一"' },
  { t: '每周日 打扫', src: 'model', dim: '循环', freq: 2 },
  { t: '每月31号 结算', src: 'model', dim: '循环', freq: 4 },
  { t: '每天吃药', src: 'model', dim: '循环', freq: 1 },

  /* ── D17 相对时间 ── */
  { t: '1分钟后 看书', src: 'model', dim: '相对时间', freq: 1 },
  { t: '半小时后 出发', src: 'model', dim: '相对时间', freq: 2 },
  { t: '一个小时后 开会', src: 'model', dim: '相对时间', freq: 2 },
  { t: '25分钟后 交表', src: 'model', dim: '相对时间', freq: 2 },
  { t: '90分钟后 出发', src: 'model', dim: '相对时间', freq: 3 },
  { t: '三天后 交报告', src: 'model', dim: '相对时间', freq: 4, note: '超 24h 上限：故意不认' },
  { t: '1441分钟后 开会', src: 'model', dim: '相对时间', freq: 4, note: '超 24h 上限：故意不认' },
  { t: '五分钟就到', src: 'model', dim: '相对时间', freq: 4, note: '反例（无「后」）' },
  { t: '十分后悔', src: 'model', dim: '相对时间', freq: 4, note: '反例（汉字裸「分」）' },
  { t: '一个半小时后 出发', src: 'model', dim: '相对时间', freq: 4, note: '故意整条不认' },

  /* ── D18 模糊说法（★ 卡面：默认不修，单独列一节） ── */
  { t: '早点 睡觉', src: 'model', dim: '模糊说法·故意不认', freq: 3 },
  { t: '待会儿 买菜', src: 'model', dim: '模糊说法·故意不认', freq: 3 },
  { t: '周末 爬山', src: 'model', dim: '模糊说法·故意不认', freq: 2 },
  { t: '这周末 看电影', src: 'model', dim: '模糊说法·故意不认', freq: 2 },
  { t: '有空的时候 整理', src: 'model', dim: '模糊说法·故意不认', freq: 3 },
  { t: '晚一点 再说', src: 'model', dim: '模糊说法·故意不认', freq: 3 },
  { t: '过几天 交表', src: 'model', dim: '模糊说法·故意不认', freq: 3 },
  { t: '等会儿 开会', src: 'model', dim: '模糊说法·故意不认', freq: 3 },
  { t: '尽快 交材料', src: 'model', dim: '模糊说法·故意不认', freq: 3 },

  /* ── D19 X号（5E/5G 的双闸在这儿） ── */
  { t: '17号 开会', src: 'model', dim: 'X号', freq: 1 },
  { t: '17号开会', src: 'model', dim: 'X号', freq: 2, note: '5G：白名单动词才收' },
  { t: '3号交材料', src: 'model', dim: 'X号', freq: 1 },
  { t: '3 号交材料', src: 'model', dim: 'X号', freq: 2, note: '5H 修' },
  { t: '3　号交材料', src: 'model', dim: 'X号', freq: 4, note: '全角空格；5H 修' },
  { t: '17号码头', src: 'model', dim: 'X号·反例', freq: 4, note: '名词后缀黑名单' },
  { t: '17号线', src: 'model', dim: 'X号·反例', freq: 4, note: '名词后缀黑名单' },
  { t: '17号打球', src: 'model', dim: 'X号·反例', freq: 4, note: '动词不在白名单' },
  { t: '17号准备材料', src: 'model', dim: 'X号', freq: 3 },
  { t: '看书 17号', src: 'model', dim: 'X号', freq: 2 },
  { t: '17号之前 交材料', src: 'model', dim: 'X号', freq: 2 },
  { t: '17号以前 交表', src: 'model', dim: 'X号', freq: 3 },

  /* ── D20 中文月日写法（9月15号 / 10月1日 / 2026年10月15日） ── */
  { t: '9月15号 交报告', src: 'model', dim: '中文月日', freq: 1 },
  { t: '10月1日 出行', src: 'model', dim: '中文月日', freq: 1 },
  { t: '9月15日 交报告', src: 'model', dim: '中文月日', freq: 1 },
  { t: '12月31日 年终总结', src: 'model', dim: '中文月日', freq: 3 },
  { t: '2026年10月15日 交材料', src: 'model', dim: '中文月日', freq: 3 },
  { t: '2026年10月 对账', src: 'model', dim: '中文月日', freq: 4, note: '只有月份' },
  { t: '9月 交报告', src: 'model', dim: '中文月日', freq: 4, note: '只有月份' },

  /* ── D21 路径 / 标签 / 重要度 与时间共存 ── */
  { t: '论文> 查文献 921', src: 'model', dim: '路径标签共存', freq: 1 },
  { t: '论文> 查文献 明天', src: 'model', dim: '路径标签共存', freq: 2 },
  { t: '!重要 明天 交表', src: 'model', dim: '路径标签共存', freq: 2 },
  { t: '!!紧急 今天 交材料', src: 'model', dim: '路径标签共存', freq: 3 },
  { t: '目标 写论文 1015', src: 'model', dim: '路径标签共存', freq: 3 },
  { t: '买西瓜、牛奶 明天', src: 'model', dim: '路径标签共存', freq: 2 },
  { t: '5>3 比较', src: 'model', dim: '路径标签共存', freq: 4, note: '反例（路径被拒）' },
  { t: 'A -> B 明天', src: 'model', dim: '路径标签共存', freq: 4, note: '反例（箭头不算路径）' },

  /* ── D22 早中晚连写 ── */
  { t: '早中晚吃药', src: 'model', dim: '早中晚', freq: 2 },
  { t: '早上中午晚上吃药', src: 'model', dim: '早中晚', freq: 3 },
  { t: '早上、中午、晚上吃药', src: 'model', dim: '早中晚', freq: 4 },
  { t: '早晚吃药', src: 'model', dim: '早中晚', freq: 3 },
  { t: '中晚吃药', src: 'model', dim: '早中晚', freq: 4 },
  { t: '晚上吃药', src: 'model', dim: '早中晚', freq: 3, note: '单段：不是分段列表' },
  { t: '早期晚会', src: 'model', dim: '早中晚', freq: 4, note: '反例（中间夹字）' },

  /* ── D23 指令壳 ── */
  { t: '帮我设置一个1分钟后看书的待办', src: 'model', dim: '指令壳', freq: 1 },
  { t: '帮我设置一个晚上九点五十一的提醒', src: 'model', dim: '指令壳', freq: 2 },
  { t: '提醒我早中晚吃药', src: 'model', dim: '指令壳', freq: 2 },
  { t: '提醒我 明天 交表', src: 'model', dim: '指令壳', freq: 2 },
  { t: '记得明天 交作业', src: 'model', dim: '指令壳', freq: 3 },
  { t: '帮我妈买药', src: 'model', dim: '指令壳·反例', freq: 3, note: '反例：不许剥壳' },
  { t: '设置打印机', src: 'model', dim: '指令壳·反例', freq: 4, note: '反例：不许剥壳' },
  { t: '安排会议', src: 'model', dim: '指令壳·反例', freq: 4, note: '反例：不许剥壳' },
  { t: '帮我写一封邮件', src: 'model', dim: '指令壳·反例', freq: 4, note: '反例：不许剥壳' },

  /* ── D24 边界与既有反例（一个字都不许动） ── */
  { t: '3D打印', src: 'model', dim: '边界·反例', freq: 4, note: '反例：1~2 位不粘正文' },
  { t: '5分钟健身', src: 'model', dim: '边界·反例', freq: 4, note: '反例' },
  { t: '365天计划', src: 'model', dim: '边界·反例', freq: 4, note: '反例' },
  { t: '2024年度总结', src: 'model', dim: '边界·反例', freq: 4, note: '反例' },
  { t: '24C8-姓名-学号921', src: 'model', dim: '边界', freq: 3, note: '行尾数字优先' },
  { t: '明天开会', src: 'model', dim: '边界', freq: 1 },
  { t: '明天', src: 'model', dim: '边界', freq: 3, note: '只剩日期：标题回落原文' },
  { t: '开会', src: 'model', dim: '边界', freq: 3, note: '无时间语法' },
  { t: '十二 交租', src: 'model', dim: '边界·汉字', freq: 4 },
  { t: '十号 交报告', src: 'model', dim: '边界·汉字', freq: 4, note: '「十」一律不认（猜错会吃标题）' },
  { t: '明天早上七点半 吃药', src: 'model', dim: '组合', freq: 2, note: '半 + 时段词 + 日期三件套' },
];

/* ── 真实语料：从备份抽（`_6a-backup.json` → `_6a-corpus-real.json`） ──
   抽取函数的纪律（卡面）：**只留含时间语法的行**，与时间无关的部分裁掉 ——
   产出只带 {原文, 当时的 title, date, time, repeat}，不留整条原文。
   ⚠️ `title` 只用来暴露分布 / 找可疑样本，**不许当期望值**。 */
export function loadReal(){
  const p = path.join(import.meta.dirname, '_6a-corpus-real.json');
  if (!fs.existsSync(p)) return [];
  let rows;
  try { rows = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.map(r => ({
    t: String(r.raw || r['原文'] || ''),
    src: 'real',
    dim: '真实语料',
    freq: 1,
    wasTitle: r.title != null ? r.title : null,   // 旧版解析器的结果：只作分布参考
    wasDate: r.date != null ? r.date : null,
    wasTime: r.time != null ? r.time : null,
    wasRepeat: r.repeat != null ? r.repeat : null,
  })).filter(r => r.t);
}

/* 全表 = 真实语料 + 模型枚举（真实语料排在前面：它代表"用户真会这么打字"） */
export const CORPUS = loadReal().concat(MODEL);

/* 按常用度升序（1 最常用）稳定排序 —— 修的顺序按它排，不按覆盖率排 */
export function byFreq(list){
  return (list || CORPUS).slice().sort((a, b) => (a.freq || 9) - (b.freq || 9));
}

/* 全角归一化提醒：本表里 D5 那批**故意不在本卡范围**（卡面明令单独立项）。
   判据用码点，避免"看起来像"的误判。 */
export function hasFullwidthDigit(s){
  return /[\uFF10-\uFF19]/.test(String(s));
}
