# -*- coding: utf-8 -*-
"""最小复现：找出 d8 8.2 到底吃不下哪种类结构。

现象：MainActivity$1.class（onBackPressed 里那个匿名 ValueCallback<String>）
让 d8 内部抛 NPE，换任何 -g / --release 组合都一样。
下面几个小样例各编译一个，逐个喂 d8，看谁挂 —— 定位到具体构造才能对症下药。
"""
import os
import subprocess

SDK = r'D:\Android\Sdk'
BT = os.path.join(SDK, 'build-tools', '34.0.0')
JDK = r'D:\java\java21'
ANDROID_JAR = os.path.join(SDK, 'platforms', 'android-34', 'android.jar')
BASE = r'D:\Android\probe2'
JAVA = os.path.join(JDK, 'bin', 'java.exe')
JAVAC = os.path.join(JDK, 'bin', 'javac.exe')
D8_JAR = os.path.join(BT, 'lib', 'd8.jar')

SAMPLES = {
    # 1 最朴素的匿名类
    's1_anon_plain': '''
package p;
public class A {
    void m() {
        Runnable r = new Runnable() { public void run() { } };
        r.run();
    }
}
''',
    # 2 匿名类访问外部类的私有字段
    's2_anon_outer_private': '''
package p;
public class A {
    private Object f;
    Object g;
    void m() {
        Runnable r = new Runnable() { public void run() { g = f; } };
        r.run();
    }
}
''',
    # 3 匿名类实现泛型接口（对应 ValueCallback<String>）
    's3_anon_generic': '''
package p;
public class A {
    interface Cb<T> { void on(T v); }
    void m() {
        Cb<String> c = new Cb<String>() { public void on(String v) { if (v != null) v.length(); } };
        c.on("x");
    }
}
''',
    # 4 匿名类实现 android 的泛型接口（最贴近真实场景）
    's4_anon_valuecallback': '''
package p;
import android.webkit.ValueCallback;
public class A {
    void m() {
        ValueCallback<String> c = new ValueCallback<String>() {
            public void onReceiveValue(String value) {
                if (value != null && value.indexOf("handled") >= 0) return;
            }
        };
        c.onReceiveValue("x");
    }
}
''',
    # 5 成员内部类（对应 AssetClient）
    's5_member_class': '''
package p;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
public class A {
    private class Inner extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
    }
    Object o = new Inner();
}
''',
    # 6 匿名类里同时有泛型签名 + 访问外部私有字段 + 泛型参数为 String
    's6_anon_generic_outerprivate': '''
package p;
import android.webkit.ValueCallback;
public class A {
    private Object web;
    void m() {
        ValueCallback<String> c = new ValueCallback<String>() {
            public void onReceiveValue(String value) {
                if (value != null) web = value;
            }
        };
        c.onReceiveValue("x");
    }
}
''',
}


def run(args):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return p.returncode, p.stdout.decode('utf-8', 'replace')


lines = ['== d8 最小复现 ==']
for name, code in SAMPLES.items():
    d = os.path.join(BASE, name)
    cls = os.path.join(d, 'classes')
    dex = os.path.join(d, 'dex')
    os.makedirs(cls, exist_ok=True)
    os.makedirs(dex, exist_ok=True)
    for fn in os.listdir(dex):
        os.remove(os.path.join(dex, fn))
    src = os.path.join(d, 'A.java')
    with open(src, 'w', encoding='utf-8') as f:
        f.write(code)
    rc, o = run([JAVAC, '-J-Duser.language=en', '--release', '8', '-encoding', 'UTF-8',
                 '-nowarn', '-cp', ANDROID_JAR, '-d', cls, src])
    if rc != 0:
        lines.append('%-28s javac 失败: %s' % (name, o.strip().splitlines()[:2]))
        continue
    classes = []
    for root, _x, files in os.walk(cls):
        classes += [os.path.join(root, f) for f in files if f.endswith('.class')]
    rc, o = run([JAVA, '-cp', D8_JAR, 'com.android.tools.r8.D8', '--min-api', '24',
                 '--lib', ANDROID_JAR, '--output', dex] + classes)
    ok = rc == 0 and os.path.exists(os.path.join(dex, 'classes.dex'))
    bad = [f for f in classes if os.path.basename(f).startswith('A$')]
    lines.append('%-28s %s   (class: %s)' % (
        name, 'PASS' if ok else 'FAIL',
        ','.join(os.path.basename(b) for b in bad) or '-'))
    if not ok:
        for l in o.splitlines():
            if 'Error in' in l:
                lines.append('        ' + l.strip())
                break

with open(os.path.join(BASE, '_result.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('\n'.join(lines))
