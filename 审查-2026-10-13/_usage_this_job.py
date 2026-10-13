# -*- coding: utf-8 -*-
"""统计某个 DSH 会话 + 它派生出的子代理会话的 token 用量（只读）。

用法：
    python _usage_this_job.py <我的 session 文件或目录> <子代理目录1> <子代理目录2> ...
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))


def iter_files(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
        else:
            for root, _dirs, files in os.walk(p):
                for f in files:
                    if f.endswith('.jsonl'):
                        yield os.path.join(root, f)


def main():
    paths = sys.argv[1:]
    steps = 0
    s_in = s_out = s_cached = s_reason = 0
    peak_ctx = 0
    t_min = t_max = None
    per_model = {}
    sessions = {}
    for fp in iter_files(paths):
        try:
            with open(fp, 'r', encoding='utf-8', errors='replace') as fh:
                for line in fh:
                    line = line.strip()
                    if not line or 'usage' not in line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    pd = rec.get('providerData') or {}
                    u = pd.get('usage') or {}
                    if not u:
                        continue
                    it = int(u.get('inputTokens') or 0)
                    ot = int(u.get('outputTokens') or 0)
                    if it == 0 and ot == 0:
                        continue
                    cached = 0
                    for d in (u.get('inputTokensDetails') or []):
                        cached += int(d.get('cached_tokens') or 0)
                    reason = 0
                    for d in (u.get('outputTokensDetails') or []):
                        reason += int(d.get('reasoning_tokens') or 0)
                    model = pd.get('model') or 'unknown'
                    steps += 1
                    s_in += it
                    s_out += ot
                    s_cached += cached
                    s_reason += reason
                    peak_ctx = max(peak_ctx, it)
                    m = per_model.setdefault(model, dict(steps=0, i=0, o=0, c=0))
                    m['steps'] += 1
                    m['i'] += it
                    m['o'] += ot
                    m['c'] += cached
                    ts = rec.get('timestamp')
                    if ts:
                        t = datetime.fromtimestamp(ts / 1000, CST)
                        t_min = t if (t_min is None or t < t_min) else t_min
                        t_max = t if (t_max is None or t > t_max) else t_max
                    sid = rec.get('sessionId')
                    if sid:
                        sessions[sid] = sessions.get(sid, 0) + 1
        except Exception as exc:  # noqa: BLE001
            print('  !! 跳过', fp, exc)

    noncached = s_in - s_cached
    print('会话数（含子代理）:', len(sessions))
    print('起止:', t_min, '->', t_max)
    print('模型调用步数:', steps)
    print('Σinput      :', f'{s_in:,}')
    print('Σoutput     :', f'{s_out:,}')
    print('  其中推理   :', f'{s_reason:,}')
    print('cached      :', f'{s_cached:,}', f'({(s_cached / s_in * 100 if s_in else 0):.1f}%)')
    print('非缓存 input:', f'{noncached:,}')
    print('峰值上下文  :', f'{peak_ctx:,}')
    print('按模型:')
    for k, v in sorted(per_model.items(), key=lambda x: -x[1]['i']):
        print(f"  {k:<24} steps={v['steps']:<5} in={v['i']:,} out={v['o']:,} cached={v['c']:,}")
    # 计费口径
    print()
    print('=== 按每百万 token 单价折算（峰时 / 闲时）===')
    for label, (p_in, p_out, p_hit) in {
        '闲时': (0.15, 0.6, 0.15 / 50),
        '峰时': (0.30, 1.2, 0.30 / 50),
    }.items():
        miss_cost = noncached / 1e6 * p_in
        hit_cost = s_cached / 1e6 * p_hit
        out_cost = s_out / 1e6 * p_out
        total = miss_cost + hit_cost + out_cost
        print(f'{label}: 未命中输入 ${miss_cost:.4f} + 缓存命中 ${hit_cost:.4f} + 输出 ${out_cost:.4f} '
              f'= ${total:.4f}  ≈ ¥{total * 7.1:.2f}')


main()
