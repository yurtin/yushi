# -*- coding: utf-8 -*-
"""对装好的 APK 做一次独立核验 —— 不看构建日志，直接查产物本身。

构建脚本说「成功」不算数，这个脚本只信 APK 文件里实际有什么：
    包名 / 版本 / minSdk / targetSdk
    权限（必须为空）
    应用名（中文，得单独按 UTF-8 读，不能被控制台编码带歪）
    签名是否通过
    里面的 assets/www/index.html 是否和项目里的 鱼事.html 逐字节一致
    resources.arsc 是不是 STORED + 4 字节对齐

跑法：python _android\\_tools\\verify_apk.py
"""
import hashlib
import os
import subprocess
import sys
import zipfile

SDK = r'D:\Android\Sdk'
BT = os.path.join(SDK, 'build-tools', '34.0.0')
JAVA = r'D:\java\java17\bin\java.exe'
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(os.path.dirname(HERE))       # ...\鱼事

APK = os.path.join(PROJECT, '鱼事-v2.1.apk')
HTML = os.path.join(PROJECT, '鱼事.html')
REPORT = os.path.join(PROJECT, '_ref', '_verify.log')

# 包名和 build.py 里必须一致。这也是"系统截图文件名里带什么"的来源
# （Screenshot_..._com_yushi_app_...），所以单独钉一个常量、单独断言。
PKG_EXPECT = 'com.yushi.app'
VER_EXPECT = '2.1'

lines = []
ok_all = True


def say(s):
    lines.append(s)


def run(args):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return p.returncode, p.stdout


def check(label, cond, detail=''):
    global ok_all
    if not cond:
        ok_all = False
    say('  [%s] %-40s %s' % ('OK' if cond else '!!', label, detail))


say('== APK 产物核验 ==')
say('文件: ' + APK)
if not os.path.exists(APK):
    say('!! 文件不存在')
    with open(REPORT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    sys.exit(1)

size = os.path.getsize(APK)
with open(APK, 'rb') as f:
    sha = hashlib.sha256(f.read()).hexdigest()
say('大小: {:,} 字节 ({:.2f} MB)'.format(size, size / 1048576.0))
say('SHA-256: ' + sha)

# ---- 1. badging（按 UTF-8 解，才能看到中文应用名）----
say('\n-- 清单 --')
_rc, raw = run([os.path.join(BT, 'aapt2.exe'), 'dump', 'badging', APK])
badging = raw.decode('utf-8', 'replace')
pkg = sdk = tgt = label = None
for line in badging.splitlines():
    if line.startswith('package: name='):
        pkg = line
    elif line.startswith('sdkVersion:'):
        sdk = line.split(':')[1].strip().strip("'")
    elif line.startswith('targetSdkVersion:'):
        tgt = line.split(':')[1].strip().strip("'")
    elif line.startswith('application-label:'):
        label = line.split(':', 1)[1].strip().strip("'")
say('  ' + (pkg or '?'))
check('minSdk = 24', sdk == '24', 'sdkVersion=' + str(sdk))
check('targetSdk = 34', tgt == '34', 'targetSdkVersion=' + str(tgt))
check('应用名 = 鱼事', label == '鱼事', '实际=' + repr(label))
check('包名 = ' + PKG_EXPECT, "name='%s'" % PKG_EXPECT in (pkg or ''), pkg or '')
check('版本 ' + VER_EXPECT, "versionName='%s'" % VER_EXPECT in (pkg or ''), '')
check('有可启动 Activity',
      'launchable-activity: name=\'%s.MainActivity\'' % PKG_EXPECT in badging, '')
check('自适应图标', 'mipmap-anydpi-v26/ic_launcher.xml' in badging, '')

# ---- 2. 权限：必须是空的 ----
say('\n-- 权限 --')
_rc, raw = run([os.path.join(BT, 'aapt2.exe'), 'dump', 'permissions', APK])
perms = raw.decode('utf-8', 'replace')
permlines = [l for l in perms.splitlines() if 'uses-permission' in l]
check('零权限（未声明任何 uses-permission）', not permlines,
      '命中: ' + '; '.join(permlines) if permlines else '（空）')

# ---- 3. 签名 ----
say('\n-- 签名 --')
_rc, raw = run([JAVA, '-jar', os.path.join(BT, 'lib', 'apksigner.jar'), 'verify',
                '--min-sdk-version', '24', '-v', APK])
sig = raw.decode('utf-8', 'replace')
check('apksigner verify 通过', 'Verifies' in sig, '')
check('v2 签名方案', 'v2 scheme (APK Signature Scheme v2): true' in sig, '')
check('v3 签名方案', 'v3 scheme (APK Signature Scheme v3): true' in sig, '')

def data_offset(apk, info):
    """算出这条 entry 的**数据段**偏移，而不是本地文件头偏移。

    zipalign 对齐的是数据段（Android 要 mmap 的是数据），
    所以判对齐必须用 header_offset + 30 + 文件名长度 + extra 长度，
    直接拿 header_offset 取模是错的 —— 本地文件头本身通常就不是 4 的倍数。
    """
    with open(apk, 'rb') as f:
        f.seek(info.header_offset)
        hdr = f.read(30)
    name_len = int.from_bytes(hdr[26:28], 'little')
    extra_len = int.from_bytes(hdr[28:30], 'little')
    return info.header_offset + 30 + name_len + extra_len


# ---- 4. 内容一致性 + 打包正确性 ----
# 整段包在 try 里：万一某个检查抛异常（比如文件根本不在包里），
# 也要把已经跑完的结论写进报告 —— 否则又得回头去啃控制台乱码。
say('\n-- 内容 --')
try:
    with zipfile.ZipFile(APK) as z:
        names = z.namelist()
        check('含 classes.dex', 'classes.dex' in names, '')
        has_html = 'assets/www/index.html' in names
        check('含 assets/www/index.html', has_html,
              '' if has_html else '（缺失！页面会被打成白屏，见 aapt2 link 的 -A 参数）')
        arsc = [i for i in z.infolist() if i.filename == 'resources.arsc']
        if arsc:
            check('resources.arsc 未压缩(STORED)',
                  arsc[0].compress_type == zipfile.ZIP_STORED,
                  'compress_type=' + str(arsc[0].compress_type))
            off = data_offset(APK, arsc[0])
            check('resources.arsc 数据段 4 字节对齐', off % 4 == 0,
                  'data_offset={:,} (mod 4 = {})'.format(off, off % 4))
        dex = [i for i in z.infolist() if i.filename == 'classes.dex']
        if dex:
            doff = data_offset(APK, dex[0])
            say('  classes.dex {:,} 字节, data_offset={:,}'
                .format(dex[0].file_size, doff))

        # 单点真相：包里的页面必须和项目里的 鱼事.html 一模一样
        if has_html and os.path.exists(HTML):
            in_apk = z.read('assets/www/index.html')
            with open(HTML, 'rb') as f:
                on_disk = f.read()
            check('包内页面 == 项目 鱼事.html', in_apk == on_disk,
                  '{:,} 字节 vs {:,} 字节'.format(len(in_apk), len(on_disk)))
            check('包内页面 sha256 一致',
                  hashlib.sha256(in_apk).hexdigest() == hashlib.sha256(on_disk).hexdigest(), '')
        elif not os.path.exists(HTML):
            say('  !! 找不到 ' + HTML)
except Exception as e:
    ok_all = False
    say('  !! 检查过程中出错：%r' % (e,))

# ---- 5. 让 zipalign 自己当裁判（签名之后的最终产物也再验一次）----
say('\n-- 对齐（zipalign -c，官方判据）--')
_rc, raw = run([os.path.join(BT, 'zipalign.exe'), '-c', '-v', '4', APK])
zal = raw.decode('utf-8', 'replace')
check('zipalign -c 4 校验通过', _rc == 0,
      '' if _rc == 0 else 'zipalign 报错，见 _ref/_verify.log')
for line in zal.splitlines():
    if 'resources.arsc' in line:
        say('  zipalign: ' + line.strip())
if _rc != 0:
    for line in zal.splitlines():
        if 'BAD' in line or 'FAILED' in line:
            say('  !! ' + line.strip())

say('\n结论：' + ('全部通过 ✓' if ok_all else '存在未通过项，见上面 !! 行'))

with open(REPORT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n'.join(lines))
sys.exit(0 if ok_all else 1)
