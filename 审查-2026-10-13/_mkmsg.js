// 写 commit message 文件（UTF-8 无 BOM），避免 PowerShell 默认 UTF-16LE。
const fs = require('fs');
const msg = `7.6.2 全面审查修复（OCR + 代码腐化扫描 + 安全审查）

审查：9 份分报告 + 汇总（审查-2026-10-13/），共 125 条发现（严重 16 / 建议 59 / 提示 50）。

已修 22 条，摘要：
- load() 坏存档不再被空数据覆盖（原会静默清空整本）
- 恢复备份：不再导入 aiBase（伪造备份可偷 API key）；补回漏读的 7 个设置字段
- 分区主键字面量 8 处改走 zoneLongKey/zoneShortKey/zoneRepeatKey
- 批量删想法 / 清收起的：撤销还原父子关系
- build.py：签名口令不进日志（SENSITIVE_FLAGS 脱敏）；同版本号重打直接拒绝
- Android：setSavePassword(false) + 混合内容 NEVER_ALLOW、handleUrl 只放行 http(s)、sRec volatile、allowBackup=false
- CSS：两个全屏 blur 进「流畅模式 / 降低透明度」降级；--faint 内容改 --muted；.pillstrip 死声明清理
- 热力图：年份下界不再一路到 1970、stBack 封顶 60 个月
- originRowHTML：rvd() 不再拼进 class（--delay 恢复生效）；aiScanBusy 死闸门修复
- 启动九步加 try/catch + window.onerror；demoFill 幂等；aiApplyZone('idea') 清时间组
- 撤销录入 / 图片录入时同步撤掉原生排期

验证：node --check 通过；31 个纯 Node 回归 0 失败；APK 鱼事-ai-v7.6.2.apk（209,591,808 字节）
sha256 59C28F6021BF53DDDE7C903936E1C229E7ECE4D8C6F87E1FCE587152B8B82ED6；
verify_apk.py --ai 全部通过（含「包内页面 == 项目 鱼事.html」）。

本机无 adb / platform-tools，原生项只做静态检查 + 编译，未做真机验证。

10 秒判别句：设置 → 数据 → 版本显示 v7.6.2；「连续打勾」子页点年月弹窗，年份滑到底只到近十年，不再一路滑到 1970。
`;
fs.writeFileSync('_ref/_7602-commit-msg.txt', msg, { encoding: 'utf8' });
console.log('written', msg.length, 'chars');
