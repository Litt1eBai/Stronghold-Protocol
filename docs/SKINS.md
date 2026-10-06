# 干员皮肤

从 Paper-Yuan/Stronghold-Protocol 的 `0.1.6-pre-skin` 分支移植选择、渲染和同步功能；注册、登录、账号进度继续使用本仓库实现。

干员调配的「换装」页选择皮肤，保存到浏览器本地，并通过 `room.skins` 同步到当前会话、房间和对局。队友及观战者通过公共玩家信息、整备区和战斗单位信息看到该玩家的皮肤。精锐干员沿用普通干员的选择；机器人使用默认模型。当前战斗采用开始时的皮肤，局内更换在整备区和下一场战斗生效。导出、增量导入、恢复默认均包含皮肤。

## 素材与构建

`docs/research/08-skins.json` 为素材来源，`data/skins.json` 为目录（115 名干员、174 款），`data/skins-installed.json` 为构建时选择清单。素材下载到 Git 忽略的 `public/assets/`，清单及解析得到的动画角色、时长、事件和边界写入 `data/assets.json`。

```sh
node tools/build-skins.mjs
node tools/prepare-skins.mjs
# 已下载素材离线重新校验、解析和生成清单
node tools/prepare-skins.mjs --offline
```

完整资产流水线 `npm run assets` 也处理选中的皮肤。客户端打包沿用固定服务器地址，Windows 和安卓均预装皮肤头像与 Spine 模型；安卓仍从服务器加载页面、数据清单及账号接口。皮肤原生特效未移植。

## 上线

需要一起更新 `server/`、`shared/`、`public/`、`data/`，然后重启服务。只安装新 APK 而不更新服务器页面和同步协议不会出现皮肤选择功能。保留服务端已有环境配置、账号数据库及白名单文件。客户端和服务端应使用同一份资产清单。

服务端不提供运行时安装入口；同步仅接受正常干员对应的已预装皮肤。缺失或无法加载的模型会回退到该干员默认模型，安卓兼容渲染使用皮肤头像。
