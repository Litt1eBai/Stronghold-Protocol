# CNB Android 发布和服务端部署

`.cnb.yml` 在 `master` 推送时运行代码检查，在 `android-v*` 标签推送时构建并发布 Android APK，随后部署服务端。
Windows 构建不在此流水线范围内。云端首次运行仍需实际验证 CNB 的权限、资源下载和服务器网络连通性。
发布构建通过 `SP_MAVEN_CENTRAL_MIRROR` 优先使用 [Google Cloud Storage 的 Maven Central 镜像](https://maven-central.storage.googleapis.com/index.html)，以避开共享云端出口的源站限流；本机构建默认仍使用原有仓库。
普通代码检查没有下载素材时跳过素材文件验证，仍检查皮肤元数据；发布流水线先准备完整素材，再运行包含文件验证的检查。

## 首次配置

代码仓库为 `littlebai/Stronghold-Protocol`，密钥仓库为 `littlebai/secrets`。
在密钥仓库的 **main** 分支创建以下文件。不要将这些文件加入普通代码仓库。

| 文件 | 内容 |
| --- | --- |
| `android.yml` | `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`；可选 `ANDROID_KEY_PASSWORD` |
| `deploy.yml` | `DEPLOY_SSH_KEY_BASE64`、`DEPLOY_KNOWN_HOSTS` |

两份 YAML 均在顶层设置以下使用范围，变量也放在顶层：

```yaml
allow_slugs:
  - littlebai/Stronghold-Protocol
allow_events:
  - tag_push
allow_branches:
  - android-v*
```

使用原有 Android 签名证书，后续 APK 才能覆盖安装。SSH 密钥对应的公钥需要已加入服务器。
`DEPLOY_KNOWN_HOSTS` 使用已核验的 SSH 主机公钥，流水线开启严格主机校验。
本机生成的私有配置位于 `.cache/cnb-release/android.yml` 和 `.cache/cnb-release/deploy.yml`，仅用于复制到密钥仓库。
签名和部署变量分别只导入相应脚本步骤。

仓库的 Release APK 必须可以匿名下载。流水线在部署前检查公开下载地址、长度和 ZIP 文件头；
登录页面、私有下载或 HTTP 地址会让发布失败。应用在安装前继续核验完整 SHA-256、包名、版本号和签名证书。

## 当前服务器

| 配置 | 值 |
| --- | --- |
| SSH | `root@203.135.99.28:30080`，本机别名 `shaoxing-tanggaoyun` |
| 游戏入口 | `http://203.135.99.28:30089` |
| 服务器监听 | `127.0.0.1:3000/healthz` 用于本机检查 |
| systemd 服务 | `stronghold-protocol.service` |
| 当前版本 | `/opt/stronghold-protocol/current` 符号链接 |
| 版本目录 | `/opt/stronghold-protocol/releases` |
| 环境配置 | `/etc/stronghold-protocol/server.env` |
| 持久数据 | `/var/lib/stronghold-protocol` |

SSH 端口与游戏公网端口不同。流水线复用现有服务、Node.js 和账号目录，不把账号或密钥打进发布包。
SSH 连接和握手最多等待 15 秒；连接后定期检测服务端响应，避免服务器故障时一直等待。
修改游戏地址时同时更新流水线的 `SP_SERVER_URL`；修改 SSH 地址时还需要同步主机公钥配置。

## 发布流程

1. 修改 `client/android/app/build.gradle.kts` 的 `versionName` 和递增的 `versionCode`；每次原生发布都必须增加编号。
2. 在 `.cnb/release-notes.txt` 只填写本版本的用户可见变更；不要放发布标签、部署步骤或签名说明。提交代码并同步到 CNB。
3. 创建与源码完全匹配的标签，例如当前版本的 `android-v0.2.6-1022`，推送到 CNB：

```bash
git tag android-v0.2.6-1022
git push cnb android-v0.2.6-1022
```

如果本机无法认证 CNB，可在 CNB 云端环境同步代码后创建并推送标签。
不要在旧源码上创建标签。流水线会拒绝与 Android 版本不匹配的标签。

流水线先下载素材和皮肤，再验证代码和 golden，然后构建、签名并上传 APK。
APK 文件名包含应用版本和编号，例如 `Stronghold-Protocol-v0.2.6-1022.apk`，方便区分下载目录中的旧包。
签名后从实际 APK 的 Manifest 核对包名、版本名、版本编号和最低 Android 版本；不一致时停止发布。
`prepare-release-assets.mjs` 保留下载器的清单缩减保护和必需素材检查，并验证下载前后两份发布清单的全部文件引用。
最新上游索引额外计划下载、但发布清单没有引用的资源，可以报告缺失；发布清单已引用的文件缺失、为空或为符号链接时必须失败。
它从 CNB API 读取实际下载地址生成 `android.json`，打包服务端依赖，校验上传包 SHA-256 后切换 `current` 并重启服务。
服务端和 APK 同一发布所需的更新公告位于 `/updates/android.json`，随服务端一起切换。
内部和公网健康检查必须与新包的应用版本、构建指纹一致，公网更新公告也必须一致。
全部成功后将 CNB Release 标记为 latest。首次支持更新的 APK 仍需手动安装；以后应用提示下载并交给系统确认安装。

## 部署失败和回退

流水线和服务器各有部署锁。服务器存在进行中的对局时拒绝部署，管理员应等对局结束后重试失败流水线。
检查与切换之间仍存在短暂窗口，适合在低流量时发布。
切换后检查失败会恢复之前的符号链接并尝试重启旧服务，保留旧版本目录和发布日志；仍应确认旧服务恢复健康。
发布失败可能留下一个已经上传的 APK Release，失败流水线不会将它标记为最新。

手动回退时将 `current` 原子切回保留的版本目录并重启服务，随后检查 `/healthz` 和更新公告。
回退到较低 `versionCode` 不会让已经升级的 Android 应用自动降级。

CNB 参考：[构建语法](https://docs.cnb.cool/zh/build/grammar.html)、
[密钥仓库](https://docs.cnb.cool/zh/repo/secret.html)、
[Release 步骤](https://docs.cnb.cool/zh/build/internal-steps/git/release.html)。
