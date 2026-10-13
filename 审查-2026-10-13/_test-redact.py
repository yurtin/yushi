# -*- coding: utf-8 -*-
"""_redact_args 的行为测试（只读以外不改任何东西）。"""
import importlib.util
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
spec = importlib.util.spec_from_file_location('bld', os.path.join(root, '_android', 'build.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
r = m._redact_args

cases = [
    (['java', '-jar', 'apksigner.jar', 'sign', '--ks-pass', 'pass:SECRET1', '--key-pass', 'pass:SECRET2', '--out', 'a.apk'],
     ['java', '-jar', 'apksigner.jar', 'sign', '--ks-pass', '***', '--key-pass', '***', '--out', 'a.apk']),
    (['--ks-pass=pass:X'], ['--ks-pass=pass:X']),          # 这种写法本项目不用，保持原样即可
    (['--storepass', 'hunter2'], ['--storepass', '***']),
    (['zipalign', '-f', '-v', '4', 'in.apk', 'out.apk'], ['zipalign', '-f', '-v', '4', 'in.apk', 'out.apk']),
]

bad = 0
for src, want in cases:
    got = r(src)
    ok = got == want
    if not ok:
        bad += 1
    print(('ok  ' if ok else 'FAIL'), src, '->', got)

# 必须确保没有任何一个输出里还带着真口令
leak = []
for src, _ in cases:
    for a in r(src):
        if 'SECRET1' in a or 'SECRET2' in a or 'hunter2' in a:
            leak.append(a)
print('leak:', leak)
print('syntax/redaction test', '全部通过' if (bad == 0 and not leak) else ('失败 ' + str(bad)))
sys.exit(0 if (bad == 0 and not leak) else 1)
