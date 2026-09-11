# 加密备份与隔离恢复

入口为 `scripts/backup.mjs`，运行镜像由 `Dockerfile.backup` 在已验证应用镜像之上安装 PostgreSQL 18 客户端。`compose.backup.yml` 给任务 256 MiB 内存、0.5 CPU；数据库和图片通过只读源凭据读取，恢复点写入独立私有 R2 桶。应用不挂载备份配置和加密密钥。

## 配置与运行

`SECRETS_DIR` 下的 `backup-config.json`、`backup-encryption.key` 必须为容器用户 1000 可读的 0600 文件。后者是随机 32 字节 AES-256-GCM 密钥；受保护本机副本必须保留在服务器以外。配置结构如下，值从受保护运行配置取得，禁止把真实值提交到 Git：

```json
{
  "databaseUrl": "postgres://USER:PASSWORD@postgres:5432/phoskywiki",
  "appRevision": "完整40位应用提交",
  "runtime": { "部署时运行配置": "完整受保护配置，存入加密清单" },
  "source": { "endpoint": "https://ACCOUNT.r2.cloudflarestorage.com", "bucket": "phoskywiki-images", "accessKeyId": "READ_ONLY", "secretAccessKey": "SECRET" },
  "backup": { "endpoint": "https://ACCOUNT.r2.cloudflarestorage.com", "bucket": "phoskywiki-backups", "prefix": "points/", "accessKeyId": "WRITER", "secretAccessKey": "SECRET" }
}
```

加载仅含镜像 ID 和秘密目录路径的 `/etc/phoskywiki/deployment.env` 后运行：

```sh
set -a
. /etc/phoskywiki/deployment.env
set +a
docker compose -f compose.production.yml -f compose.backup.yml --profile backup run --rm -T --interactive=false backup
```

仅 `ok:true` 且清单最终上传成功的 UUID 才是完整恢复点。数据库采用 repeatable-read 导出快照供 pg_dump 使用；清单记录迁移、应用版本、数据库版本、运行配置和文件摘要。每个恢复点复制快照引用的所有永久图片，包括历史使用的永久对象；图片复制失败时不发布完整清单。图片副本按明文 SHA-256 在备份桶内增量复用；复用前会解密并校验现有副本，源桶删除不会传播到副本。密钥轮换必须使用新的 backup.prefix，避免新密钥误读旧副本。

## 校验、离线导出与恢复

将默认命令改成 `verify`，附加同样的 `--config`、`--key-file`、`--target postgres:5432/phoskywiki/phosky`、`--bucket phoskywiki-backups` 和 `--point UUID`。校验会下载全部文件，验证 GCM 标签、SHA-256 和长度。错误目标、版本不兼容、缺失或损坏文件均非零退出。

`export` 还需要 `--output /export/新目录` 和可写输出挂载；导出目录只含加密文件，密钥另存。复制整个目录到另一台机器，保留相同的 `backup.prefix` 和恢复点 UUID；`verify --input /export/UUID` 可在不下载 R2 对象的情况下校验。不要将密钥与导出文件放在同一个未加密移动介质中。`recover-config --point UUID --input /export/UUID --output /受保护目录/runtime.json` 在完整校验后将原运行配置写入新建的 0600 文件，拒绝覆盖已有文件。

恢复必须使用独立空数据库（名称以 `_test` 或 `_restore`/`_restore_标识` 结尾）、独立 `-test`/`-restore` 图片桶以及全新 `restorePrefix`。修改配置的数据库和图片目标、更新明确的 `--target` 后执行 `restore --point UUID`，离线时增加 `--input`。工具拒绝已有数据库对象和已有目标图片前缀。校验全部文件后复制图片，数据库导入及图片键重映射在一个事务中完成。失败时目标桶可能留有本次部分图片；核对独立目标后清理该前缀，重新使用空目标，绝不能清空生产桶或数据库来重试。

恢复完成后，以清单所对应应用版本启动隔离网站，更新运行配置中的数据库、图片桶和认证域名；执行 `ops reindex`。验证两位管理员登录、公开内容、私有权限、历史修订、图片字节与搜索，再安排正式切换。CLI 不自动覆盖生产数据库，不自动切换 DNS。

## 定时与保留边界

`deploy/phoskywiki-backup.service` 和 `.timer` 提供 UTC 00:00/12:00（北京时间 08:00/20:00）执行，最多随机延后 5 分钟，关机错过后补跑。部署前设置固定 `APP_IMAGE`、`BACKUP_IMAGE`、`SECRETS_DIR` 到受保护环境文件，先手动启动 service 验证，再启用 timer。用 `journalctl -u phoskywiki-backup.service` 查看结果。

目标保留最近 14 天及 4 个周恢复点；当前不自动删除恢复点。清理凭据只在维护者本机保存，服务器没有它。Cloudflare R2 的 Object Read & Write 权限包含删除，因此写入凭据本身仍有删除备份的能力；不同凭据仅实现用途分离，不能宣称不可删除或抵御整账户失陷。不要配置按对象年龄删除图片的生命周期规则。外部失败通知、过期检测、定期保留清理和密码管理器中的独立密钥托管仍需对应运维任务完成。

实测证据见 d03-backup-evidence.json（本机原始证据，不随仓库分发：`reports/d03-backup-evidence.json`）。完整站点恢复目标为 24 小时，当前隔离恢复实测不包含采购替代服务器、账号恢复与 DNS 切换时间。
