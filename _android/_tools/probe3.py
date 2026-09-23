# -*- coding: utf-8 -*-
"""验证猜想：d8 崩在「无名 MethodParameters 参数」上，而不是内部类本身。

同一份源码，分别用本机的 JDK 8 / 17 / 21 编出来，看 d8 是否通得过。
如果只有不写 MethodParameters 的那个 JDK 能过，病因就坐实了。
"""
import os
import subprocess

SDK = r'D:\Android\Sdk'
BT = os.path.join(SDK, 'build-tools', '34.0.0')
ANDROID_JAR = os.path.join(SDK, 'platforms', 'android-34', 'android.jar')
D8_JAR = os.path.join(BT, 'lib', 'd8.jar')
BASE = r'D:\Android\probe3'
RUN_JAVA = r'D:\java\java21\bin\java.exe'

SRC_CODE = '''
package p;
public class A {
    private Object f;
    void m() {
        Runnable r = new Runnable() { public void run() { f = "x"; } };
        r.run();
    }
}
'''

JDKS = [
    ('jdk8', r'D:\java\java8', ['-source', '1.8', '-target', '1.8']),
    ('jdk17', r'D:\java\java17', ['--release', '8']),
    ('jdk21', r'D:\java\java21', ['--release', '8']),
]


def run(args):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return p.returncode, p.stdout.decode('utf-8', 'replace')


lines = ['== 换 JDK 编，再看 d8 ==']
for tag, home, flags in JDKS:
    javac = os.path.join(home, 'bin', 'javac.exe')
    if not os.path.exists(javac):
        lines.append('%-8s javac 不存在：%s' % (tag, javac))
        continue
    d = os.path.join(BASE, tag)
    cls = os.path.join(d, 'classes')
    dex = os.path.join(d, 'dex')
    os.makedirs(cls, exist_ok=True)
    os.makedirs(dex, exist_ok=True)
    for fn in os.listdir(dex):
        os.remove(os.path.join(dex, fn))
    src = os.path.join(d, 'A.java')
    with open(src, 'w', encoding='utf-8') as f:
        f.write(SRC_CODE)

    rc, o = run([javac, '-J-Duser.language=en'] + flags +
                ['-encoding', 'UTF-8', '-nowarn', '-cp', ANDROID_JAR, '-d', cls, src])
    if rc != 0:
        lines.append('%-8s javac 失败：%s' % (tag, o.strip().splitlines()[:3]))
        continue

    classes = []
    for root, _x, files in os.walk(cls):
        classes += [os.path.join(root, f) for f in files if f.endswith('.class')]

    # 顺便看看这个 javac 到底写没写 MethodParameters
    javap = os.path.join(home, 'bin', 'javap.exe')
    has_mpp = '-'
    if os.path.exists(javap):
        _rc, jv = run([javap, '-v', '-p', os.path.join(cls, 'p', 'A$1.class')])
        has_mpp = 'YES' if 'MethodParameters' in jv else 'no'

    rc, o = run([RUN_JAVA, '-cp', D8_JAR, 'com.android.tools.r8.D8', '--min-api', '24',
                 '--lib', ANDROID_JAR, '--output', dex] + classes)
    ok = rc == 0 and os.path.exists(os.path.join(dex, 'classes.dex'))
    lines.append('%-8s d8:%-5s MethodParameters:%-4s' % (tag, 'PASS' if ok else 'FAIL', has_mpp))

with open(os.path.join(BASE, '_result.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n'.join(lines))
