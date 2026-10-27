# CNB Android 发布和服务端部署

`.cnb.yml` 在 `master` 推送时运行代码检查，在 `android-v*` 标签推送时构建并发布 Android APK，随后部署服务端。
Windows 构建不在此流水线范围内。云端首次运行仍需实际验证 CNB 的权限、资源下载和服务器网络连通性。
发布构建通过 `SP_MAVEN_CENTRAL_MIRROR` 优先使用 [Google Cloud Storage 的 Maven Central 镜像](https://maven-central.storage.googleapis.com/index.html)，以避开共享云端出口的源站限流；本机构建默认仍使用原有仓库。
构建环境包含 `zip`，用于上游新增的发布归档启动测试；普通检查在安装依赖前补齐，Android 镜像预装。
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
迁移后的服务器保持原主机密钥；`DEPLOY_HOST_KEY_ALIAS=[203.135.99.28]:30080` 沿用密钥仓库中原地址的已核验记录，实际连接新地址。
本机生成的私有配置位于 `.cache/cnb-release/android.yml` 和 `.cache/cnb-release/deploy.yml`，仅用于复制到密钥仓库。
签名变量只导入签名步骤；部署 SSH 变量用于读取私有场景构建输入和部署两个步骤。

仓库的 Release APK 必须可以匿名下载。流水线在部署前检查公开下载地址、长度和 ZIP 文件头；
登录页面、私有下载或 HTTP 地址会让发布失败。应用在安装前继续核验完整 SHA-256、包名、版本号和签名证书。

## 当前服务器

| 配置 | 值 |
| --- | --- |
| SSH | `root@202.189.13.223:30080`，本机别名 `shaoxing-tanggaoyun` |
| 游戏入口 | `http://202.189.13.223:30089` |
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
2. 在 `.cnb/release-notes.txt` 只填写本版本的用户可见变更；不要放发布标签、部署步骤或签名说明。服务端打包时由同一份公告生成玩家版 `CHANGELOG.md`，供应用内更新说明展示；源码中的上游开发日志不随服务端发布。提交代码并同步到 CNB。
3. 创建与源码完全匹配的标签，例如当前版本的 `android-v0.3.4-dev-1029`，推送到 CNB：

```bash
git tag android-v0.3.4-dev-1029
git push cnb android-v0.3.4-dev-1029
```

如果本机无法认证 CNB，可在 CNB 云端环境同步代码后创建并推送标签。
不要在旧源码上创建标签。流水线会拒绝与 Android 版本不匹配的标签。

流水线先恢复官方棋盘与 11 个战场场景，再下载其他素材和皮肤，验证代码和 golden，然后构建、签名并上传 APK。
APK 文件名包含应用版本和编号，例如 `Stronghold-Protocol-v0.3.4-dev-1029.apk`，方便区分下载目录中的旧包。
签名后从实际 APK 的 Manifest 核对包名、版本名、版本编号和最低 Android 版本；不一致时停止发布。
`prepare-release-assets.mjs` 保留下载器的清单缩减保护和必需素材检查，并验证下载前后两份发布清单的全部文件引用。
最新上游索引额外计划下载、但发布清单没有引用的资源，可以报告缺失；发布清单已引用的文件缺失、为空或为符号链接时必须失败。
它从 CNB API 读取实际下载地址生成 `android.json`，打包服务端依赖；先上传公告与服务端包供恢复部署使用，再校验部署包 SHA-256、切换 `current` 并重启服务。
服务端和 APK 同一发布所需的更新公告位于 `/updates/android.json`，随服务端一起切换。
内部和公网健康检查必须与新包的应用版本、构建指纹一致，公网更新公告也必须一致。
打包指纹通过 `releaseBuildTag` 纳入启用的历史版本数据；如设置 `SP_VERSIONS`，构建环境与部署环境应使用同一列表。
本次游戏入口 IP 变更，旧 APK 绑定旧地址，需要手动覆盖安装新 APK 一次；之后从新地址检查更新。
全部成功后将 CNB Release 标记为 latest。首次支持更新的 APK 仍需手动安装；以后应用提示下载并交给系统确认安装。

## 官方场景构建输入与安卓预装

场景使用本机官方客户端材质和归档赛季场景包提取，原始和提取后的美术均不进 Git。
本机客户端路径为 `E:\Games\Hypergryph Launcher\games\Arknights\Arknights_Data\StreamingAssets\AB\Windows`；
WSL 使用相应的 `/mnt/e/` 路径。Windows 客户端的 `Arknights_Data/Resources` 也参与提取，解析场景引用的 Unity 内置模型。
只补棋盘与场景时，在已安装提取依赖的环境中运行：

```bash
python3 tools/local-extract/fetch_scenes.py
.venv-extract/bin/python tools/local-extract/extract.py --game '<客户端 AB/Windows>' --only map --only mesh --only scene
node tools/crop-board-atlas.mjs
node tools/scene-assets.mjs check
node tools/scene-assets.mjs pack .cache/scene-assets/official-board-scenes.zip
```

`pack` 只收录 `map/`、`mesh/`、`scene/` 素材与这些分组的清单，输出 SHA-256、大小和提取版本。
将 ZIP 保存到部署服务器的 `/var/lib/stronghold-protocol/build-assets/`，该目录位于版本目录之外，仅通过部署 SSH 读取。
在 `.cnb/scene-assets.json` 固定 `format: 1`、`remotePath`、`sha256` 和 `size`；更换素材时同时更新文件与固定值。
要恢复同一份素材到本机，可运行 `node tools/scene-assets.mjs restore <ZIP>`。

`scripts/cnb-prepare-scenes.sh` 优先复用已校验的 `.cache/scene-assets/<sha256>.zip`，冷缓存时从服务器读取。
恢复前校验整个归档，并检查全部 11 张场景、棋盘、几何、光照和材质贴图；失败停止发布。
恢复会合并本地素材清单，保留其他 UI、角色及独立的官方特效清单。
服务器不可用且 CNB 没有缓存时，发布无法继续，已有线上服务不受影响。请同时备份该构建输入。

原生安卓打包前也会校验场景，并把模型、贴图、光照和棋盘文件放入 APK 的 `assets/preinstalled/`。
客户端请求与清单哈希一致时从 APK 读取，无需进入每张地图后再向服务器下载；变化后的文件仍从服务器加载。
服务端发布包携带同一批素材和清单，使浏览器和安卓使用一致的场景。
旧 APK 不会因为服务器补素材而自动变成预装包；需安装下一次构建的新 APK 才能得到这批预装文件。

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

## 0.3.0 插件资源与持久目录

服务端发布包按上游发布门禁排除开发用外部 AI 与手动席位，内置人机照常提供。

服务端发布包包含仓库自有的 `plugins/_template/`、Schemas、作者指南、插件 CLI 和作者测试助手。不会打包服主已安装的插件、`plugins/config.json` 或工作台密钥；工作台创建脚本和界面插件需要这些模板，不能只用健康检查代替资源校验。

部署时在现有 `/etc/stronghold-protocol/server.env` 增加 `SP_PLUGINS_DIR=/var/lib/stronghold-protocol/plugins`，并由管理员创建该目录，确保 stronghold 服务用户可读写。启动选项 pluginsDir 优先于环境变量；未指定时仍使用 packs 旁的 plugins 目录。插件配置、安装内容和工作台密钥随持久目录保留，发布切换或回滚不替换它们。插件本身的版本回退需单独管理。

模板默认从当前发布包的只读目录读取，与可写插件目录分离；另行设置 `SP_PLUGIN_RESOURCES` 时应指向包含 `_template/` 的只读资源目录。上述服务器配置需在实际部署时应用，本机合并验证不会修改线上配置。
