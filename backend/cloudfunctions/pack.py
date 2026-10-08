"""把 ai-write 云函数打包成 zip（保证 scf_bootstrap 为 LF 换行 + 755 可执行权限）。

用法：python backend/cloudfunctions/pack.py

为什么要专门写脚本：Windows 打 zip 会丢 Unix 权限位，而云函数要求 scf_bootstrap
必须具备 755/777，否则实例启动时报权限不足（表现为 502 / 服务起不来）。
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "ai-write")
DST = os.path.join(HERE, "ai-write.zip")
SKIP_DIRS = {"__pycache__", ".git"}
SKIP_FILES = {"ai-write.zip"}

# 启动文件内容：LF 结尾、绝对路径、监听 9000（须与函数「运行环境」版本对应）
BOOTSTRAP = "#!/bin/bash\nexport PORT=9000\n/var/lang/node18/bin/node index.js\n"

n = 0
with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f in SKIP_FILES:
                continue
            rel = os.path.relpath(os.path.join(root, f), SRC).replace(os.sep, "/")
            if rel == "scf_bootstrap":
                info = zipfile.ZipInfo("scf_bootstrap", (2026, 10, 8, 0, 0, 0))
                info.external_attr = 0o100755 << 16  # -rwxr-xr-x
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, BOOTSTRAP)
            else:
                z.write(os.path.join(root, f), rel)
            n += 1

z = zipfile.ZipFile(DST)
boot = z.read("scf_bootstrap")
print("文件数:", n)
print("zip 大小: %.1f MB" % (os.path.getsize(DST) / 1024 / 1024))
print("根目录:", sorted(x for x in z.namelist() if "/" not in x))
print("scf_bootstrap 权限: %o" % (z.getinfo("scf_bootstrap").external_attr >> 16))
print("scf_bootstrap 为 LF:", boot.endswith(b"\n") and b"\r\n" not in boot)
print("含 node-sdk 依赖:", "node_modules/@cloudbase/node-sdk/package.json" in z.namelist())
