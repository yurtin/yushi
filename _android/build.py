# -*- coding: utf-8 -*-
"""把「鱼事.html」打成一个可安装的 Android APK。

不用 Gradle：这条链只用 JDK + Android SDK 的 build-tools/platform，
省掉 AGP 那一整套 Maven 依赖下载，构建也更快、更可控。
手工步骤：
    aapt2 compile  →  aapt2 link  →  javac  →  d8  →  塞 classes.dex  →  zipalign  →  apksigner

关于路径：所有工具都是「.exe / java -jar」直调（不经过 cmd），所以中文路径其实没问题；
但构建仍在纯 ASCII 的 D:\\Android\\build 里做 —— 少数 Java 工具会写临时文件、
老版本对非 ASCII 路径有过翻车记录，这一步保险是白送的。

跑法：
    python _android\\build.py
"""
import os
import re
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)              # D:\DSH\工作区\鱼事
SDK = r'D:\Android\Sdk'
BT_VER = '34.0.0'
PLATFORM = 'android-34'

# javac 必须是 **JDK 17 或更低**，绝不能用 21 —— 这是本工程最容易踩的一个坑：
#
#   JDK 21 的 javac 会给内部类构造器那个 synthetic 参数写一条 MethodParameters 属性，
#   而其中 name_index = 0（参数没有名字）。d8 8.2 解析到「无名参数」时会内部抛
#   NullPointerException: Cannot invoke "String.length()" because "<parameter1>" is null，
#   报错指向 com.android.tools.r8.graph.u2，跟真正的原因八竿子打不着。
#
# 实测（同一份源码，只换 javac）：
#   JDK 8  → 无 MethodParameters → d8 通过
#   JDK 17 → 无 MethodParameters → d8 通过
#   JDK 21 → 有 MethodParameters → d8 崩
#
# 注意 -g:none 关不掉它（MethodParameters 不算调试信息），所以只能换 JDK。
# 运行 d8 / apksigner 也用同一个 JDK：它们只要求 11+，17 完全够用，少一个变量少一个坑。
JDK = os.environ.get('DAIBANJI_JDK') or r'D:\java\java17'

WORK = r'D:\Android\build'
APP = os.path.join(HERE, 'app')              # 工程源（手机图标、manifest、java 都在这）
BT = os.path.join(SDK, 'build-tools', BT_VER)
ANDROID_JAR = os.path.join(SDK, 'platforms', PLATFORM, 'android.jar')

PKG = 'com.yushi.app'
# 包名原来是 com.zhiyu.daibanji —— zhiyu 是上一个项目（知屿）的名字，而安卓截图的
# 文件名会带上包名（Screenshot_20260923_135229_com_zhiyu_daibanji_MainActivity.jpg），
# 等于把"这不是这个 App"印在每一张截图上。已改成 com.yushi.app。
# 注意：改包名 = 换了一个 App，旧的安装包**不能被覆盖升级**，必须先卸载旧的那份。
VERSION_CODE = 21
VERSION_NAME = '2.1'
MIN_SDK = 24
TARGET_SDK = 34

KS_DIR = os.path.join(HERE, 'keystore')
KS = os.path.join(KS_DIR, 'daibanji.jks')
KS_ALIAS = 'daibanji'
KS_PROP = os.path.join(KS_DIR, 'keystore.properties')

# 签名口令**故意不写在这里** —— 这个仓库是公开的。
# 口令一旦进版本库，等于把签名权交出去：安卓只认签名不认人，拿到密钥+口令的人
# 可以签发包名与签名都一致的包，以"官方更新"的名义让已装机用户静默覆盖升级。
# 所以改成运行时读取，而且两个来源都被 .gitignore 排除：
#   YUSHI_KS_PASS 环境变量  →   CI / 临时构建
#   keystore/keystore.properties 的 storePassword=   →   本机长期使用
# 这里先置 None，由 resolve_keystore_pass() 在签名前填充
# （放那么晚是因为 die() 依赖 log_lines，模块导入期还不能调用）。
KS_PASS = None


def keystore_pass():
    """取签名口令；两处都找不到就返回 None。"""
    p = os.environ.get('YUSHI_KS_PASS')
    if p:
        return p
    if os.path.exists(KS_PROP):
        with open(KS_PROP, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('storePassword='):
                    return line.split('=', 1)[1].strip()
    return None


def resolve_keystore_pass():
    global KS_PASS
    KS_PASS = keystore_pass()
    if not KS_PASS:
        die('找不到签名口令，无法签名。二选一：\n'
            '   (a) 设环境变量：YUSHI_KS_PASS=<你的口令>\n'
            '   (b) 新建 %s，写一行：storePassword=<你的口令>\n'
            '   （这个文件已在 .gitignore 里，不会进版本库）' % KS_PROP)

OUT_NAME = '鱼事-v' + VERSION_NAME + '.apk'

log_lines = []


def log(msg):
    print(msg)
    log_lines.append(msg)


def die(msg):
    log('!! ' + msg)
    write_log()
    sys.exit(1)


def write_log():
    try:
        with open(os.path.join(PROJECT, '_ref', '_build.log'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(log_lines))
    except OSError:
        pass


def run(title, args, cwd=None, allow_fail=False):
    """跑一条命令。工具是 .exe / java，直接 CreateProcess，不经过 cmd。"""
    log('>> ' + title)
    log('   ' + ' '.join('"%s"' % a if ' ' in a else a for a in args))
    p = subprocess.run(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = p.stdout.decode('utf-8', 'replace').strip()
    for line in out.splitlines():
        log('   | ' + line)
    if p.returncode != 0 and not allow_fail:
        die(title + ' 失败（exit ' + str(p.returncode) + '）')
    return p.returncode, out


def require(path, what):
    if not os.path.exists(path):
        die(what + ' 不存在：' + path)


def sync_tree(src, dst, exclude=()):
    """把 src 的目录树同步到 dst：覆盖同名、补齐新增、删掉陈旧。

    为什么不做「清空重建」：本机环境挂了一个 safe-delete 钩子，按**单轮删除次数**
    计账（阈值 50）。构建目录里有 70+ 个文件，rmtree / 逐个 unlink 只要超阈值就会
    整批被拒（SAFE_DELETE_BULK_CONFIRM_REQUIRED），脚本还没开始编就死了。
    原地刷新则完全不需要批量删除，顺带还省掉了每次重拷几十个图标的时间。

    陈旧文件（dst 有、src 没有）还是要删的 —— 否则你删掉一张图标，它还会被打进包。
    正常情况这类文件是 0 个，单个删除也远在阈值之下。

    exclude 里的相对路径属于**构建期生成物**（比如塞进去的 assets/www），
    源树里本来就没有，不该被当成陈旧文件删掉。
    """
    exclude = tuple(e.replace('\\', '/') for e in exclude)

    def generated(rel):
        return any(rel.replace('\\', '/') == e or rel.replace('\\', '/').startswith(e + '/')
                   for e in exclude)

    stale = []
    for root, _dirs, files in os.walk(dst):
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, dst)
            if generated(rel):
                continue
            if not os.path.exists(os.path.join(src, rel)):
                stale.append(full)
    for full in stale:
        os.remove(full)
    if stale:
        log('   清掉 {:,} 个陈旧文件'.format(len(stale)))

    for root, _dirs, files in os.walk(src):
        for fn in files:
            full = os.path.join(root, fn)
            target = os.path.join(dst, os.path.relpath(full, src))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copy2(full, target)


def check_no_method_parameters(cls_dir):
    """拦一道：class 文件里只要出现 MethodParameters，d8 就一定会崩。

    与其让 d8 抛一个指向自己内部的 NPE，不如在这里把话说明白 —— 这个检查存在的
    唯一目的就是「把晦涩的工具崩溃翻译成一句人话」。判据是常量池里有没有
    MethodParameters 这个 Utf8 项：属性名必须存在于常量池，所以是可靠信号。
    """
    hits = []
    for root, _dirs, files in os.walk(cls_dir):
        for fn in files:
            if not fn.endswith('.class'):
                continue
            with open(os.path.join(root, fn), 'rb') as f:
                if b'MethodParameters' in f.read():
                    hits.append(fn)
    if hits:
        die('这些 class 里带了 MethodParameters，d8 会崩：' + ', '.join(hits) +
            '\n   说明 javac 是 JDK 21+。请用 JDK 17 或更低（本脚本默认 ' + JDK + '）。')


def zip_tree(src, dst):
    if os.path.exists(dst):
        os.remove(dst)
    n = 0
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(src):
            for fn in files:
                full = os.path.join(root, fn)
                z.write(full, os.path.relpath(full, src).replace('\\', '/'))
                n += 1
    return n


def add_dex_to_apk(apk_in, dex_file, apk_out):
    """把 classes.dex 塞进 APK。

    特意自己做而不是用 aapt/jar：要**保住每个 entry 原来的压缩方式** ——
    resources.arsc 必须是 STORED（不压缩）且 4 字节对齐，否则在 Android 11+
    上安装会因为 mmap 失败而出问题。用 zipfile 读原 compress_type 再原样写回最稳。
    """
    if os.path.exists(apk_out):
        os.remove(apk_out)
    with zipfile.ZipFile(apk_in, 'r') as zin:
        with zipfile.ZipFile(apk_out, 'w') as zout:
            for item in zin.infolist():
                zout.writestr(item, zin.read(item.filename), compress_type=item.compress_type)
            zout.write(dex_file, 'classes.dex', compress_type=zipfile.ZIP_DEFLATED)
    return os.path.getsize(apk_out)


def ensure_keystore():
    """没有签名密钥就生成一个。

    刻意不用 Android 的 debug 密钥：debug 证书各家机器不同、有效期只有 1 年，
    以后想给同一台手机升级安装会失败。用自建密钥 + 长有效期，用户只要留着这个文件
    就能一直覆盖安装。
    """
    if os.path.exists(KS):
        log('>> 签名密钥已存在，直接复用：' + KS)
        return
    os.makedirs(KS_DIR, exist_ok=True)
    keytool = os.path.join(JDK, 'bin', 'keytool.exe')
    require(keytool, 'keytool')
    run('生成签名密钥（27 年有效期）', [
        keytool, '-genkeypair', '-v',
        '-keystore', KS, '-alias', KS_ALIAS,
        '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-storepass', KS_PASS, '-keypass', KS_PASS,
        '-dname', 'CN=Daibanji, OU=Personal, O=Personal, L=Beijing, ST=Beijing, C=CN',
    ])


def main():
    log('== 检查工具链 ==')
    for p, what in [(os.path.join(BT, 'aapt2.exe'), 'aapt2'),
                    (os.path.join(BT, 'zipalign.exe'), 'zipalign'),
                    (os.path.join(BT, 'lib', 'd8.jar'), 'd8.jar'),
                    (os.path.join(BT, 'lib', 'apksigner.jar'), 'apksigner.jar'),
                    (ANDROID_JAR, 'android.jar'),
                    (os.path.join(JDK, 'bin', 'javac.exe'), 'javac')]:
        require(p, what)
        log('   ok  ' + p)
    java = os.path.join(JDK, 'bin', 'java.exe')
    require(java, 'java')
    # 把版本打进日志：下面那个 MethodParameters 的坑跟 javac 版本强相关，
    # 真出问题时第一眼要看的就是这一行。
    run('javac 版本', [os.path.join(JDK, 'bin', 'javac.exe'), '-version'])

    # ---------- 1. 把源码树复制到纯 ASCII 的构建目录 ----------
    log('\n== 1/8 准备构建目录 ' + WORK + ' ==')
    os.makedirs(WORK, exist_ok=True)
    src_app = os.path.join(WORK, 'app')
    sync_tree(APP, src_app, exclude=('assets',))
    # 单一真相：每次构建都把最新的 HTML 放进 assets，绝不允许两份副本各自演化
    html_src = os.path.join(PROJECT, '鱼事.html')
    require(html_src, '鱼事.html')
    assets_www = os.path.join(src_app, 'assets', 'www')
    os.makedirs(assets_www, exist_ok=True)
    shutil.copy2(html_src, os.path.join(assets_www, 'index.html'))
    log('   页面本体：鱼事.html → assets/www/index.html（{:,} 字节）'
        .format(os.path.getsize(os.path.join(assets_www, 'index.html'))))

    manifest = os.path.join(src_app, 'AndroidManifest.xml')
    res_dir = os.path.join(src_app, 'res')
    src_dir = os.path.join(src_app, 'src')

    # ---------- 2. aapt2 compile ----------
    log('\n== 2/8 aapt2 compile（编资源）==')
    compiled = os.path.join(WORK, 'compiled.zip')
    run('aapt2 compile', [os.path.join(BT, 'aapt2.exe'), 'compile', '--dir', res_dir, '-o', compiled])
    with zipfile.ZipFile(compiled) as z:
        log('   产出 {:,} 个 .flat'.format(len(z.namelist())))

    # ---------- 3. aapt2 link ----------
    log('\n== 3/8 aapt2 link（出资源 APK）==')
    base_apk = os.path.join(WORK, 'base.apk')
    # -A 千万别漏：aapt2 link **不会**自动把 assets 打进包，必须显式指目录。
    # 漏了它 APK 一样能编出来、能装、能启动 —— 只是 WebView 打开一片白。
    # 这种「静默少了内容」的错最阴，所以后面 verify_apk.py 专门核了 assets 是否在包里。
    run('aapt2 link', [os.path.join(BT, 'aapt2.exe'), 'link',
                       '-o', base_apk,
                       '-I', ANDROID_JAR,
                       '-A', os.path.join(src_app, 'assets'),
                       '--manifest', manifest,
                       '--min-sdk-version', str(MIN_SDK),
                       '--target-sdk-version', str(TARGET_SDK),
                       '--version-code', str(VERSION_CODE),
                       '--version-name', VERSION_NAME,
                       '--no-version-vectors',
                       compiled])   # 位置参数 = 普通资源输入；-R 是「叠加包(overlay)」专用，
                                    # 用了它 aapt2 会要求每个资源都去覆盖已有项而报
                                    # "does not override an existing resource"。
    # 立刻确认页面真的进包了。这一步失败的话，后面每一步都会「成功」，
    # 最后给你一个装上去白屏的 APK —— 必须在这里就拦住。
    with zipfile.ZipFile(base_apk) as z:
        names = z.namelist()
        if 'assets/www/index.html' not in names:
            die('base.apk 里没有 assets/www/index.html（aapt2 link 的 -A 参数是不是漏了？）')
        log('   已打进 assets/www/index.html（{:,} 字节）'
            .format(z.getinfo('assets/www/index.html').file_size))

    # ---------- 4. javac ----------
    log('\n== 4/8 javac（编 Java）==')
    javac_out = os.path.join(WORK, 'classes')
    # 先清空：否则上一轮（可能是 JDK 21 编的）遗留 .class 会被一起打进包里，
    # 甚至让下面的 MethodParameters 检查误报。通常就 1~3 个文件，不触删除阈值。
    if os.path.isdir(javac_out):
        for root, _d, files in os.walk(javac_out):
            for fn in files:
                os.remove(os.path.join(root, fn))
    os.makedirs(javac_out, exist_ok=True)
    java_files = []
    for root, _d, files in os.walk(src_dir):
        java_files += [os.path.join(root, f) for f in files if f.endswith('.java')]
    if not java_files:
        die('没找到 .java 源文件：' + src_dir)
    # --release 8：锁住 Java 8 的 API 与 class 版本（d8 认这个版本）。
    # -J-Duser.language=en：javac 默认跟系统 locale 走中文，输出是 GBK，
    # 混进 UTF-8 日志里就是一坨乱码；固定英文，日志才可核对。
    run('javac', [os.path.join(JDK, 'bin', 'javac.exe'), '-J-Duser.language=en', '-J-Duser.country=US',
                  '--release', '8',
                  '-encoding', 'UTF-8', '-nowarn',
                  '-cp', ANDROID_JAR,
                  '-d', javac_out] + java_files)
    check_no_method_parameters(javac_out)

    # ---------- 5. d8 ----------
    log('\n== 5/8 d8（出 classes.dex）==')
    dex_out = os.path.join(WORK, 'dex')
    # d8 要求输出目录为空，所以这里先清掉上一次的 classes.dex（1~2 个文件，不触阈值）
    if os.path.isdir(dex_out):
        for fn in os.listdir(dex_out):
            os.remove(os.path.join(dex_out, fn))
    os.makedirs(dex_out, exist_ok=True)
    # d8 只吃 .class / .jar / .zip，**不吃目录** —— 直接给目录会报
    # "Unsupported source file type"。所以把 .class 一个个列出来传。
    class_files = []
    for root, _d, files in os.walk(javac_out):
        class_files += [os.path.join(root, f) for f in files if f.endswith('.class')]
    if not class_files:
        die('javac 没产出任何 .class：' + javac_out)
    run('d8', [java, '-cp', os.path.join(BT, 'lib', 'd8.jar'),
               'com.android.tools.r8.D8',
               '--min-api', str(MIN_SDK),
               '--lib', ANDROID_JAR,
               '--output', dex_out] + class_files)
    dex = os.path.join(dex_out, 'classes.dex')
    require(dex, 'classes.dex')
    log('   classes.dex {:,} 字节'.format(os.path.getsize(dex)))

    # ---------- 6. 合并 dex ----------
    log('\n== 6/8 把 classes.dex 塞进 APK ==')
    with_dex = os.path.join(WORK, 'withdex.apk')
    size = add_dex_to_apk(base_apk, dex, with_dex)
    log('   合并后 {:,} 字节'.format(size))
    with zipfile.ZipFile(with_dex) as z:
        arsc = [i for i in z.infolist() if i.filename == 'resources.arsc']
        if arsc:
            method = 'STORED（正确）' if arsc[0].compress_type == zipfile.ZIP_STORED \
                     else 'DEFLATED（有问题！）'
            log('   resources.arsc 压缩方式 = ' + method)

    # ---------- 7. zipalign ----------
    log('\n== 7/8 zipalign ==')
    aligned = os.path.join(WORK, 'aligned.apk')
    run('zipalign', [os.path.join(BT, 'zipalign.exe'), '-f', '-v', '4', with_dex, aligned],
        allow_fail=False)

    # ---------- 8. 签名 ----------
    log('\n== 8/8 apksigner 签名 ==')
    resolve_keystore_pass()
    ensure_keystore()
    final = os.path.join(WORK, OUT_NAME)
    run('apksigner sign', [java, '-jar', os.path.join(BT, 'lib', 'apksigner.jar'), 'sign',
                           '--ks', KS, '--ks-key-alias', KS_ALIAS,
                           '--ks-pass', 'pass:' + KS_PASS, '--key-pass', 'pass:' + KS_PASS,
                           '--min-sdk-version', str(MIN_SDK),
                           '--v1-signing-enabled', 'true',
                           '--v2-signing-enabled', 'true',
                           '--v3-signing-enabled', 'true',
                           '--out', final, aligned])

    run('apksigner verify', [java, '-jar', os.path.join(BT, 'lib', 'apksigner.jar'), 'verify',
                             '--min-sdk-version', str(MIN_SDK), '--print-certs', '-v', final])

    # ---------- 交付：拷回项目目录 ----------
    log('\n== 交付 ==')
    dest = os.path.join(PROJECT, OUT_NAME)
    shutil.copy2(final, dest)
    log('   APK: ' + dest)
    log('   大小: {:,} 字节 ({:.2f} MB)'.format(os.path.getsize(dest), os.path.getsize(dest) / 1048576.0))

    # badging / 权限，作为可核对的凭据写进日志（核对失败不该让构建挂掉）
    _rc, badging = run('aapt2 dump badging（核对包名/版本/sdk/图标）',
                       [os.path.join(BT, 'aapt2.exe'), 'dump', 'badging', dest], allow_fail=True)
    for line in badging.splitlines():
        if re.match(r'^(package|sdkVersion|targetSdkVersion|application-label|launchable-activity|application-icon)', line):
            log('   [badging] ' + line)
    _rc, perms = run('aapt2 dump permissions（应为空 = 零权限）',
                     [os.path.join(BT, 'aapt2.exe'), 'dump', 'permissions', dest], allow_fail=True)
    if 'uses-permission' not in perms:
        log('   ✓ 未声明任何权限')

    # 包名必须和脚本里写的一致 —— 包名同时决定"系统截图文件名里带什么"
    # （Screenshot_..._com_yushi_app_...），漂了用户第一眼就能看见。
    m = re.search(r"package: name='([^']+)'", badging)
    built_pkg = m.group(1) if m else '(读不到)'
    if built_pkg == PKG:
        log('   ✓ 包名正确：' + built_pkg)
    else:
        die('包名和预期不一致：实际 ' + built_pkg + '，预期 ' + PKG +
            '（AndroidManifest.xml 里的 package 属性改了吗？）')

    write_log()
    log('\n构建完成。日志：' + os.path.join(PROJECT, '_ref', '_build.log'))


if __name__ == '__main__':
    main()
