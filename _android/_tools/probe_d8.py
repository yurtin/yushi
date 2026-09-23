# -*- coding: utf-8 -*-
"""探针：找出哪一组 javac 参数能让 d8 顺利吃下 MainActivity.class。

背景：JDK 21 的 javac 编出来的 MainActivity$1.class 让 d8 8.2 内部抛 NPE
（graph.u2.<init> 里对 null String 调 length()，像是解析调试属性时踩 bug）。
一次把几种组合都跑一遍，直接看结果，别一个个来回试。
"""
import os
import subprocess
import sys

SDK = r'D:\Android\Sdk'
BT = os.path.join(SDK, 'build-tools', '34.0.0')
JDK = r'D:\java\java21'
ANDROID_JAR = os.path.join(SDK, 'platforms', 'android-34', 'android.jar')
SRC = r'D:\Android\build\app\src\com\zhiyu\daibanji\MainActivity.java'
BASE = r'D:\Android\probe'

JAVA = os.path.join(JDK, 'bin', 'java.exe')
JAVAC = os.path.join(JDK, 'bin', 'javac.exe')
D8_JAR = os.path.join(BT, 'lib', 'd8.jar')

COMBOS = [
    ('A  -source8 -target8 -g:none', ['-source', '8', '-target', '8', '-g:none']),
    ('B  --release 8 (默认 -g)',      ['--release', '8']),
    ('C  --release 8 -g:none',        ['--release', '8', '-g:none']),
    ('D  --release 8 -g:source',      ['--release', '8', '-g:source']),
    ('E  -source11 -target11 -g:none', ['-source', '11', '-target', '11', '-g:none']),
    ('F  --release 17 -g:none',       ['--release', '17', '-g:none']),
]

out = []


def run(args):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return p.returncode, p.stdout.decode('utf-8', 'replace')


results = []
for name, flags in COMBOS:
    tag = name.split()[0]
    cls_dir = os.path.join(BASE, tag, 'classes')
    dex_dir = os.path.join(BASE, tag, 'dex')
    os.makedirs(cls_dir, exist_ok=True)
    os.makedirs(dex_dir, exist_ok=True)
    # d8 要求输出目录为空
    for fn in os.listdir(dex_dir):
        os.remove(os.path.join(dex_dir, fn))

    rc, o = run([JAVAC, '-J-Duser.language=en'] + flags +
                ['-encoding', 'UTF-8', '-nowarn', '-cp', ANDROID_JAR, '-d', cls_dir, SRC])
    if rc != 0:
        results.append((name, 'javac 失败', o.strip().splitlines()[:4]))
        continue

    classes = []
    for root, _d, files in os.walk(cls_dir):
        classes += [os.path.join(root, f) for f in files if f.endswith('.class')]

    rc, o = run([JAVA, '-cp', D8_JAR, 'com.android.tools.r8.D8',
                 '--min-api', '24', '--lib', ANDROID_JAR, '--output', dex_dir] + classes)
    ok = rc == 0 and os.path.exists(os.path.join(dex_dir, 'classes.dex'))
    head = [l for l in o.splitlines() if 'Error' in l or 'error' in l or 'NPE' in l][:3]
    results.append((name, 'PASS' if ok else 'FAIL', head))

out.append('== d8 兼容性探针 ==')
for name, verdict, detail in results:
    out.append('%-32s %s' % (name, verdict))
    for d in detail:
        out.append('      ' + d)

with open(os.path.join(BASE, '_probe_result.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))
print('\n'.join(out))
