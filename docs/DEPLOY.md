# 部署指南

目标：把游戏服务部署到家用电脑、Linux VPS、Docker 或 CNB 等能运行常驻 Node.js 服务的环境，让朋友通过局域网或公网来玩。后面的 Windows、Docker、CNB 和 Linux 小节只是不同平台的具体做法。
所有命令都在项目根目录执行。遇到问题先运行 `node tools/doctor.mjs`（只读诊断）。

## 0.1 通用部署流程

无论选择哪种平台，都按下面的顺序部署。平台差异只在「如何安装依赖、如何保持进程常驻、如何配置 HTTPS」这三处。

### 0.1.1 准备程序与素材

从 Git 仓库检出指定版本，或使用已经包含依赖和素材的完整包。源码部署时执行：

```bash
npm ci
node tools/setup.mjs --yes
node tools/doctor.mjs
```

`setup` 会复制浏览器依赖并准备 `public/assets`、`public/fonts` 等素材；素材目录没有提交到 Git，需要在构建机或服务器上单独准备。Docker / CNB 可以在镜像构建阶段用 `FETCH_ASSETS=1` 下载，APK 则必须在构建 APK 前准备好素材。

### 0.1.2 配置服务

开发或局域网测试可以直接使用默认配置。熟人公网服建议使用以下配置：

```env
HOST=127.0.0.1
PORT=3000
SP_COMBAT=client
SP_VERIFY=sample
SP_AUTH=required
SP_AUTH_SECRET=随机生成的长密钥
SP_ACCOUNTS_FILE=/data/accounts.json
```

`HOST=127.0.0.1` 适用于前面有 Caddy / Nginx 的部署；没有反向代理、需要局域网直连时改为 `0.0.0.0`。账号文件和 `SP_AUTH_SECRET` 不要提交到仓库，账号文件应放在持久化目录。

### 0.1.3 启动并验证

先在本机或内网验证服务能启动：

```bash
npm start
curl http://127.0.0.1:3000/healthz
```

健康检查返回 200 后，再配置进程管理器、容器重启策略或 systemd。这个服务是单个常驻 Node.js 进程，房间和对局保存在内存中；重启会结束正在进行的对局。

### 0.1.4 配置公网访问

公网部署建议使用域名和 HTTPS：

```text
玩家浏览器 / APK  →  HTTPS / WSS 反向代理  →  Node.js:3000
```

代理必须转发 `/ws` WebSocket 升级，并把站点部署在域名根路径；`/data/`、`/shared/`、`/sim/` 和 `/vendor/` 等路径不能被改写到子路径。代理配置完成后，用 `https://域名/healthz` 检查，再从另一台设备实际登录和创建房间。

### 0.1.5 创建账号并分发客户端

服务确认可用后，在服务器上创建熟人账号：

```bash
node tools/admin.mjs user create alice '自定义密码' 爱丽丝
node tools/admin.mjs user list
```

APK 构建时把服务器地址固定为同一个 HTTPS 域名；构建完成后只向熟人分发 APK 和各自账号，不分发 `SP_AUTH_SECRET` 或管理员凭据。APK 的构建和签名见第 3.2 节。

## 0. 资源需求

| 项目 | 说明 |
|---|---|
| 服务器 CPU | 战斗在各玩家浏览器里模拟（DESIGN §14），服务器只负责回合、经济和校验：**每个房间每个作战回合约 1 ms CPU**。AI 队友 / 掉线玩家的战场由服务器模拟：作战开始时 3 个 AI 战场在开发机上约 0.2–0.5 s CPU，小主机上可能要几秒（分成 8 ms 小片执行，不会卡住其他房间）。`SP_VERIFY=all` 会复算每个真人战场，CPU 明显增加，小主机建议保持 `off` 或 `sample`。 |
| 服务器内存 | 空闲约 100 MB，每个进行中的对局再增加几 MB。 |
| 网络 | 4 人对局中服务器每回合下行约 0.25 MB（DESIGN §14 实测）。首次进入游戏时浏览器要从主机下载所需的图片 / Spine 模型 / 音频（按需加载，之后走浏览器缓存），公网隧道带宽小时第一次会慢一些。 |
| 磁盘 | 素材约 270 MB（`public/assets`）+ 依赖约 125 MB（`node_modules`）；可选的本地提取约 40 MB（`.venv-extract`）+ 70 MB 贴图（见第 6 节）。 |
| 玩家设备 | 支持 WebGL 的现代浏览器（Chrome / Edge / Firefox / Safari 最新版），电脑或手机平板（横屏）。老旧设备可在设置里调低画质或访问 `/?board=2d`。 |

服务器**无状态**：房间和对局只存在内存里，没有数据库和存档，**不需要备份**。重启服务器会结束正在进行的对局（包括断线后本可在 24 小时内回来继续的独立模拟）。

## 1. Windows 小主机：一步步

### 1.1 安装与首次启动

1. 安装 Node.js 22 LTS 和 Git（在 PowerShell 或「终端」里；用下面的完整包时不需要 Git）：
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   ```
   装完**关闭并重新打开**终端，`node -v` 应显示 v22 或更高（winget 的 LTS 目前是 v24.x，同样可用）。没有 winget 时从 <https://nodejs.org/zh-cn/download> 和 <https://git-scm.com/download/win> 下载安装。
2. 下载，二选一。建议放在一个固定、短、**不在 OneDrive 同步范围内**的目录，例如 `C:\Stronghold-Protocol`：
   - **完整包（推荐）**：在仓库的 [Releases](https://github.com/sganggs/Stronghold-Protocol/releases) 页面下载最新版本（当前为 v0.1.4）的完整包 zip（已含依赖、前端库和全部素材，包括官方 3D 棋盘），解压后把里面的 `Stronghold-Protocol` 文件夹放到上述位置。不需要 Git，首次启动也不用再下载素材。素材版权归上海鹰角网络 / Yostar，仅限非商业使用，见 [NOTICE.md](../NOTICE.md)。
   - **源码**：
     ```powershell
     git clone https://github.com/sganggs/Stronghold-Protocol.git C:\Stronghold-Protocol
     ```
3. 双击 `C:\Stronghold-Protocol\scripts\start-windows.bat`。首次会：安装依赖（`npm ci`；完整包已含，跳过）→ 复制前端库 → 下载约 270 MB 素材（完整包已含，跳过；显示进度，中断后再次启动会续传）→ 若检测到本机的明日方舟客户端，询问是否提取官方贴图（可跳过）→ 启动服务器并打开浏览器。
4. 窗口里会打印朋友可用的地址，例如 `http://192.168.1.23:3000`。用另一台设备打开它确认能进入。关闭窗口即停止服务器。

等价的手动命令：`npm ci`、`node tools/setup.mjs`、`npm start`。

#### 国内镜像下载

Setup 默认使用「GitHub 原始源 → jsDelivr」，不查询公网 IP，也不请求 gh-proxy.com。GitHub 下载失败时会提示如何手动开启镜像；仅添加提示，不自动切换到第三方代理。

镜像方法是在完整 GitHub 链接前加 `https://gh-proxy.com/`，例如：

```text
https://gh-proxy.com/https://raw.githubusercontent.com/OWNER/REPO/BRANCH/file.png
```

手动开启后顺序为「前缀镜像 → 原始源 → jsDelivr」。索引、图片、Spine、音频和字体都使用此规则（音频 voice 分支跳过 jsDelivr）。镜像是第三方代理；当前只校验格式和大小，没有内容哈希校验，请自行决定是否信任并启用。npm / pip 依赖不使用 GitHub 前缀。

```powershell
node tools/setup.mjs --asset-source=mirror  # 手动优先国内镜像
node tools/setup.mjs --asset-source=direct  # 默认：仅原始源和 jsDelivr，不使用前缀代理
$env:SP_ASSET_SOURCE = 'mirror'             # 也可用环境变量显式启用
```

`node tools/fetch-assets.mjs` 同样支持 `--asset-source=direct|mirror`。命令行优先于 `SP_ASSET_SOURCE`。默认镜像前缀为 `https://gh-proxy.com/`，可通过 `SP_GITHUB_PROXY` 指定其他 HTTPS 前缀；仅配置前缀不会启用镜像。将 `SP_GITHUB_PROXY` 设为空字符串（或全空格）可彻底禁用前缀代理，即使选择了 `mirror` 模式；未设置此变量与显式设空不同，前者使用默认前缀。Windows PowerShell 的某些版本会将空值视为删除变量，可设置 `$env:SP_GITHUB_PROXY = ' '` 或使用 `--asset-source=direct` 来明确禁用。前缀只处理 GitHub 下载链接，不重复添加。

镜像请求每个 URL 只尝试一次，响应头超时 8 秒，响应体有独立的空闲超时，失败即尝试原始源。连续 3 次网络错误、HTTP 错误或无效内容会在本次运行中关闭镜像，后续索引、素材和字体共享该状态；正在进行的镜像请求也会中止并回退。成功会清零连续失败次数；404 / 410 是资源不存在，不触发熔断。再次运行脚本会重新尝试手动启用的镜像。原始源的重试、已有文件跳过和 0.1.1 的清单缩减保护保持不变。

从历史下载记录派生的 Spine 补充贴图也按本次设置重新选择来源，禁用后不会沿用旧代理地址。

### 1.2 防火墙

- 第一次启动时 Windows 会弹出「Windows 安全中心警报」：勾选**专用网络**并点「允许访问」。
- 没弹窗或点错了，用**管理员** PowerShell 添加规则（下面的开机自启脚本也会自动添加）：
  ```powershell
  netsh advfirewall firewall add rule name="Stronghold Protocol" dir=in action=allow protocol=TCP localport=3000 profile=private,domain
  ```
- 家里的网络要是「公用网络」，Windows 会拦截入站连接。改成专用（管理员 PowerShell；网卡名用 `Get-NetConnectionProfile` 查看）：
  ```powershell
  Set-NetConnectionProfile -InterfaceAlias "以太网" -NetworkCategory Private
  ```
- `node tools/doctor.mjs` 会显示规则是否存在、每个网络的类型，以及朋友可用的地址。

### 1.3 固定局域网 IP（推荐）

主机 IP 变了，朋友收藏的地址就失效。推荐在**路由器**后台的「DHCP 静态分配 / 地址保留」里把小主机的 MAC 地址绑定到固定 IP（如 `192.168.1.50`）。也可以在 Windows「设置 → 网络和 Internet → 属性 → IP 分配 → 编辑」里手动设置（IP、子网掩码、网关、DNS 与路由器一致，且不要与别的设备冲突）。

### 1.4 开机自动在后台运行

先关闭 `start-windows.bat` 的窗口（否则端口冲突），然后在项目目录运行（会自动请求管理员权限）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1
```

它会：运行一次 `tools/setup.mjs` → 把设置写入 `scripts\service.env.cmd`（node.exe 路径、端口等）→ 注册计划任务 **StrongholdProtocol**（开机 20 秒后以 SYSTEM 身份运行 `scripts\run-server.cmd`，无需登录；服务器退出后 5 秒自动重启）→ 添加防火墙规则 → 立即启动并显示状态。日志在 `logs\server.log`（超过 10 MB 自动轮换）。

| 需求 | 命令（都加在 `powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1` 之后） |
|---|---|
| 换端口 / 其他设置 | `-Port 8080`、`-Verify sample`、`-Combat server`、`-BindHost 127.0.0.1`（只给反向代理用） |
| 公用网络也放行 | `-AllowPublicNetwork`（一般不需要；Tailscale 网卡被识别为公用网络时可能需要） |
| 查看状态和最近日志 | `-Status` |
| 重启（更新代码后） | `-Restart` |
| 停止 | `-Stop`（下次开机仍会自动启动） |
| 卸载 | `-Uninstall`（删除计划任务、防火墙规则和 `service.env.cmd`） |

建议同时关闭睡眠，否则小主机会在无人操作时休眠：`powercfg /change standby-timeout-ac 0`。

<details>
<summary>替代方案：用 NSSM 注册成真正的 Windows 服务</summary>

```powershell
winget install NSSM.NSSM            # 或从 https://nssm.cc 下载
nssm install StrongholdProtocol "C:\Program Files\nodejs\node.exe" server\index.js
nssm set StrongholdProtocol AppDirectory C:\Stronghold-Protocol
nssm set StrongholdProtocol AppEnvironmentExtra PORT=3000 HOST=0.0.0.0
nssm set StrongholdProtocol AppStdout C:\Stronghold-Protocol\logs\server.log
nssm set StrongholdProtocol AppStderr C:\Stronghold-Protocol\logs\server.log
nssm start StrongholdProtocol
```

防火墙规则仍需按 1.2 手动添加。两种方式只选一种。
</details>

### 1.5 更新

```powershell
cd C:\Stronghold-Protocol
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1 -Stop   # 装了开机自启时
git checkout -- data/assets.json    # 素材清单由 setup 重新生成，先还原以免 git pull 冲突
git pull
npm ci
node tools/setup.mjs                # 补下载新增的素材（已有文件会跳过）
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1 -Restart
```

没装开机自启的话，最后一步改成重新双击 `start-windows.bat`。用 Releases 完整包的：停止服务器，把新版本的完整包解压到新目录后从那里启动即可（素材已包含；装了开机自启的，在新目录重新运行一次 `install-service-windows.ps1`）。用 GitHub「Download ZIP」源码包的：解压新版本后，把旧目录里的 `public\assets`、`public\fonts`、`.cache` 和 `data\local-assets.json`（若有）复制过去，可避免重新下载。

## 2. 让不在同一网络的朋友加入

### 2.1 Tailscale / ZeroTier（推荐给家用小主机）

组一个虚拟局域网：不需要公网 IP、不需要改路由器、不暴露到互联网。

- **Tailscale**：主机和朋友都安装 <https://tailscale.com/download>（Windows：`winget install Tailscale.Tailscale`）并登录。朋友用自己的账号时，在 Tailscale 管理后台把这台主机「Share」给他们，或邀请他们加入你的 tailnet。朋友访问 `http://<主机的 100.x.y.z 地址>:3000`（`tailscale ip -4` 查看；开了 MagicDNS 也可以用 `http://<主机名>:3000`）。
- **ZeroTier**：在 <https://my.zerotier.com> 创建网络，主机和朋友安装客户端并加入同一个 Network ID，在后台勾选授权成员；访问 `http://<主机的 ZeroTier IP>:3000`。
- 连不上时运行 `node tools/doctor.mjs`：看 VPN 网卡是否被 Windows 识别为「公用网络」，是的话按 1.2 改为专用，或安装自启时加 `-AllowPublicNetwork`。

### 2.2 cloudflared 临时隧道（朋友什么都不用装）

```powershell
winget install --id Cloudflare.cloudflared      # macOS: brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

把输出的 `https://xxxx.trycloudflare.com` 发给朋友。页面是 https 时客户端自动改用 `wss://`，不需要任何配置；服务器会通过隧道转发的 `CF-Connecting-IP` 识别真实来源（`TRUST_PROXY=auto`）。临时隧道每次启动地址都不同，且没有可用性保证；需要固定地址请使用 Cloudflare 账号 + 自己域名的「命名隧道」。

### 2.3 路由器端口转发

仅当你有**公网 IPv4**（很多宽带是运营商级 NAT，没有公网 IP，此时请用 2.1 / 2.2）：

1. 先按 1.3 固定主机的局域网 IP。
2. 路由器「虚拟服务器 / 端口转发」：外部端口 3000（或任意端口）→ 内部 `主机IP:3000`，TCP。
3. 朋友访问 `http://<你的公网 IP>:外部端口`。

注意：未设置 `SP_AUTH=required` 时，知道地址的人都能进来；熟人公网服应按第 3.0 节启用封闭账号。服务器对来自互联网的连接有按网络的数量限制（每个网络最多 64 个连接，房间 / 对局数量也有上限），但仍建议不玩时关掉转发，或优先用 Tailscale。

### 2.4 反向代理与 HTTPS（有域名时）

必须部署在**域名根路径**（客户端使用 `/data/`、`/vendor/`、`/ws` 等绝对路径，不支持挂在子路径下）。代理需要转发 WebSocket 升级（路径 `/ws`）。建议让服务器只监听本机：`HOST=127.0.0.1`（Windows 自启：`-BindHost 127.0.0.1`）。

**Caddy**（自动申请 HTTPS 证书，WebSocket 无需额外配置）：

```caddy
game.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Nginx**：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
server {
    listen 443 ssl;
    server_name game.example.com;
    ssl_certificate     /etc/letsencrypt/live/game.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/game.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;      # WebSocket 长连接
    }
}
```

https / wss 说明：页面通过 https 打开时客户端自动连接 `wss://同一域名/ws`；http 时用 `ws://`。服务器本身只提供 http，证书由代理 / 隧道负责。代理与服务器在同一台机器或内网时，`TRUST_PROXY=auto` 会信任它的 `X-Forwarded-For` / `X-Real-IP`；代理在公网另一台机器上时设 `TRUST_PROXY=1`（同时确保游戏端口只对代理开放）。

## 3. Docker

### 3.0 账号与 QQ 白名单注册（熟人分发）

账号系统默认关闭以兼容源码开发；公网部署建议打开：

```bash
export SP_AUTH=required
export SP_AUTH_SECRET="$(openssl rand -hex 32)"
export SP_REGISTRATION=on
export SP_ALLOWED_QQ_FILE=.cache/allowed-qq.txt
mkdir -p .cache
printf '12345678\n23456789\n' > .cache/allowed-qq.txt
```

客户端登录后会保存一枚 7 天有效的 HS256 JWT，同一设备在有效期内再次打开不需要重复登录。QQ 白名单从 `SP_ALLOWED_QQ_FILE` 指向的文件读取，推荐每行一个 QQ，支持空行和 `#` 注释；兼容 JSON 数组和 `{"qq":[...]}`。注册时必须填写其中一个 QQ 号，同一个 QQ 号只能注册一次。默认路径仍为 `.cache/allowed-qq.json` 以兼容已有部署，文件内容也可直接改成文本列表。注册密码不再限制最小长度，但不能为空。

白名单在注册校验和注册配置查询时重新读取；追加、删除或替换文件后，下一次请求立即生效，不需要重启，也不会中断对局。文件不存在、无法读取或 JSON 损坏时拒绝新注册，修复文件后自动恢复。移除 QQ 不会禁用已有账号。修改 `SP_ALLOWED_QQ_FILE` 路径本身仍需重启；Docker / CNB 建议挂载白名单所在的持久化目录，避免单文件挂载在原子替换后仍指向旧文件。

```text
# 熟人名单
12345678 # Alice
23456789 # Bob
```

追加一个 QQ：

```bash
printf '\n34567890\n' >> .cache/allowed-qq.txt
```

名单只放在服务端受限目录，不要放到 `public/` 或客户端安装包。注意：填写白名单中的 QQ 号并不证明用户拥有该 QQ；需要防止冒用时，应另加邀请码或身份验证。

如果不希望开放注册，保持 `SP_REGISTRATION=off`，只有能登录服务器主机的管理员可以创建、启用或禁用账号：

```bash
node tools/admin.mjs user list
node tools/admin.mjs user disable alice
node tools/admin.mjs user enable alice
```

账号数据默认保存在 `.cache/accounts.json`；生产环境应把 `SP_AUTH_SECRET` 写入服务管理器的私有环境文件，并把账号文件备份到受限目录。APK 不包含账号密码，只包含固定的 HTTPS 服务器地址。

```bash
# A) 构建时下载素材（需要联网，约 250 MB）
docker build -t stronghold-protocol --build-arg FETCH_ASSETS=1 .
docker run -d --name stronghold -p 3000:3000 --restart unless-stopped stronghold-protocol

# B) 不把素材打进镜像：先在宿主机运行 node tools/setup.mjs，然后挂载
docker build -t stronghold-protocol .
docker run -d --name stronghold -p 3000:3000 --restart unless-stopped \
  -v "$PWD/public/assets:/app/public/assets:ro" stronghold-protocol
```

镜像基于 `node:22-alpine`，多阶段构建，只含生产依赖；`public/vendor` 在构建时生成。`.dockerignore` 排除了 `public/assets`（不会把宿主机素材打进构建上下文）；`public/fonts`、`data/assets.json` 和 `data/local-assets.json` 若存在会被复制进去。环境变量同 README（`-e SP_VERIFY=sample` 等）。健康检查：`GET /healthz`。

docker compose 示例：

```yaml
services:
  stronghold:
    build:
      context: .
      args: { FETCH_ASSETS: "1" }
    ports: ["3000:3000"]
    restart: unless-stopped
    environment:
      SP_VERIFY: "off"
```

### 3.1 CNB：构建镜像并部署到 VPS

CNB 的构建节点负责执行 Dockerfile、安装依赖和生成镜像；线上游戏仍需要一个**长时间运行的容器服务**，并且必须支持 WebSocket。不要把 CNB 的构建节点规格当成游戏运行时规格：小团体建议运行时从 2 vCPU / 1 GB 内存起步。

仓库已有生产用 `Dockerfile`。在 CNB 项目中选择从仓库构建 Docker 镜像，构建上下文使用仓库根目录；需要把素材打进镜像时开启 `FETCH_ASSETS=1`：

```text
Dockerfile: Dockerfile
构建参数: FETCH_ASSETS=1
监听端口: 3000/TCP
```

素材下载约 250–270 MB，构建时间取决于 CNB 节点和下载线路。镜像构建完成后，将镜像推送到 CNB 镜像仓库或其他容器镜像仓库，再创建一个常驻服务运行它。线上服务需要设置：

```env
PORT=3000
HOST=0.0.0.0
SP_COMBAT=client
SP_VERIFY=sample
SP_AUTH=required
SP_AUTH_SECRET=随机生成的长密钥
SP_ACCOUNTS_FILE=/data/accounts.json
```

账号文件必须挂载到持久化磁盘；否则容器重建后账号会丢失。至少挂载：

```text
/data  → 持久化卷
```

如果 CNB 的部署环境不提供持久化卷，可以把账号文件放到外部数据库或在每次发布前恢复备份；不要把 `SP_AUTH_SECRET` 和账号文件提交进 Git。服务启动后检查 `https://你的域名/healthz`，应返回 200；反向代理必须转发 `/ws` 的 WebSocket 升级，并把服务部署在域名根路径。

线上更新流程：构建新镜像 → 停止旧版本 → 替换服务镜像 → 确认 `/healthz` → 再通知玩家。重启会结束内存中的房间和正在进行的对局，因此不要在一局进行中直接滚动更新。

### 3.2 Android APK：构建、签名与分发

Android 工程在 `android/`。它把完整的 `public/`、`shared/`、`data/` 和浏览器战斗所需的 `server/sim/` 复制进 APK；APK 启动后从本地资源加载页面，只把固定的 HTTPS 地址用于 WebSocket / API。服务器地址没有输入框，修改地址必须重新构建 APK。

构建前先准备前端库和素材（素材目录被 `.gitignore` 排除，不会从 Git 自动得到）：

```bash
node tools/setup.mjs --yes
```

然后在安装了 Android SDK、Android build-tools 和 Gradle 的环境中构建 release 包：

```bash
cd android
gradle assembleRelease -PserverUrl=https://game.example.com
```

输出文件：

```text
android/app/build/outputs/apk/release/app-release.apk
```

Gradle 会在构建时检查 `public/assets` 是否存在且非空；没有完整素材时构建会失败，不会生成缺素材的可分发包。正式分发前应使用自己的签名密钥签名 APK，并保存好 keystore；不要把 keystore、密码或服务器账号密码提交到仓库。Android Studio 用户也可以直接打开 `android/`，选择 `app` 的 `release` 变体，并在 Gradle 参数中加入 `-PserverUrl=https://game.example.com`。

熟人分发建议只发 APK，不发服务器管理员凭据；账号由服务器管理员用 `node tools/admin.mjs` 单独创建。服务器必须已经启用 HTTPS，APK 才能正常使用 `wss://` 长连接。

### 3.3 固定地址桌面 / Android 客户端

客户端工程在 `client/`。桌面端使用 Tauri 2，封装现有前端与资源；安卓端使用 `client/android/` 的 Kotlin + WebView 壳，加载服务器页面，并预装 `public/assets/` 的图片、动画、音频及 `public/fonts/` 的字体。两者都通过打包时的 `SP_SERVER_URL` 固定服务器地址，沿用现有注册、登录、账号会话和进度。安卓资源直接从 APK 读取，无需首次下载或解压；缺少的资源从服务器加载。网页和游戏数据仍随服务器更新，不启动本地服务器。

在 Windows 原生环境执行：

```powershell
# 桌面端先准备 Node/Rust/MSVC、npm 依赖和完整素材；安卓单独构建只需要 JDK/SDK。
npm.cmd ci
node tools/setup.mjs --yes
npm.cmd --prefix client ci
.\scripts\build-client-windows.ps1 -ServerUrl http://203.135.99.28:30089

# 只构建并签名安卓端：
.\scripts\build-client-windows.ps1 -Target Android -ServerUrl http://203.135.99.28:30089
```

安卓需要 JDK 21、Android SDK Platform 37、Build Tools 36 或更高，以及完整的本地静态资产，无需 Rust/NDK 或初始化生成工程。Gradle 打包前校验素材清单，缺资源会终止构建。HTTP 地址使用 HTTP/WS，HTTPS 地址使用 HTTPS/WSS。服务器地址改变后需重新构建客户端。替换已预装的同名素材需要更新 APK，或在服务器资源 URL 添加版本查询参数以改走服务器。

产物在 `client/artifacts/windows/` 和 `client/artifacts/android/Stronghold-Protocol-release.apk`。默认沿用 `.cache/client-signing/` 中的 release 密钥；后续更新必须保留同一密钥，密钥及密码不提交到 Git。安卓按系统返回键进入原生画质设置、日志诊断和刷新菜单。完整构建配置与旧版升级说明见 [client/README.md](../client/README.md)。

## 4. macOS / Linux 常驻

- 临时开服：`scripts/start.sh`（或 `npm start`），保持终端窗口打开。macOS 首次会询问是否允许 node 接受传入连接，选「允许」。
- Linux systemd（`/etc/systemd/system/stronghold.service`，路径与用户按实际修改）：

  ```ini
  [Unit]
  Description=Stronghold Protocol game server
  After=network-online.target
  Wants=network-online.target

  [Service]
  WorkingDirectory=/opt/Stronghold-Protocol
  ExecStart=/usr/bin/node server/index.js
  Environment=PORT=3000 HOST=0.0.0.0
  Restart=always
  RestartSec=5
  User=stronghold

  [Install]
  WantedBy=multi-user.target
  ```

  `sudo systemctl daemon-reload && sudo systemctl enable --now stronghold`；日志 `journalctl -u stronghold -f`；防火墙 `sudo ufw allow 3000/tcp`。

## 5. 排错

| 现象 | 处理 |
|---|---|
| 任何问题 | `node tools/doctor.mjs`：Node 版本、依赖、素材完整性、端口、局域网地址、防火墙、网络类型 |
| `端口已被占用 / EADDRINUSE` | 已经有一个服务器在运行（自启任务？）或其他程序占用 3000：换端口 `scripts\start-windows.bat --port 3001` |
| 朋友打不开页面 | 防火墙规则 / 网络类型（1.2）；确认用的是 `LAN` 地址而不是 `localhost`；访客 Wi-Fi 常开启「AP 隔离」；不在同一网络请看第 2 节 |
| 画面是占位图、没有声音 | 素材没下完：重新运行 `node tools/setup.mjs`（会续传）；缺失明细在 `.cache/assets-report.json`。默认仅原始源和 jsDelivr；可用 `--asset-source=mirror` 手动开启前缀镜像（见上文） |
| 素材下载很慢 / 失败 | 网络问题可随时中断，重新运行会跳过已完成的文件；`node tools/fetch-assets.mjs --concurrency=4` 降低并发。有文件没下载成功时，素材清单 `data/assets.json` 保持不变（脚本列出缺少的条目并以非零状态结束；游戏里缺的图片用占位图，缺的声音不播放），重新运行即可补齐 |
| 表情显示成默认图标、「玩法说明」只有文字要点 | 素材没下载完整：重新运行 `node tools/setup.mjs`（表情和教程图随其他素材一起从公开镜像下载，不需要客户端）；缺失明细在 `.cache/assets-report.json` |
| 本地提取失败 | 游戏照常运行，只是第 6 节表格里的几样换成替代样式。确认客户端已下载全部资源；Python 版本太新导致依赖安装失败时，安装 Python 3.12 后删除 `.venv-extract` 再运行 `node tools/setup.mjs --local` |
| 3D 棋盘没出现 | 需要本地提取的棋盘贴图（`node tools/doctor.mjs` 会显示「3D 棋盘可用」），以及支持 WebGL2 的浏览器。没有客户端的服务器可以从同一版本的整合包复制本地素材（第 6 节） |
| 断线 | 同盟模拟 10 分钟内、独立模拟 24 小时内（`config.constants.singleReconnectTime`）用同一浏览器重新打开页面，自动回到原座位。同盟掉线期间按原阵容自动作战、到时自动准备（不会代为购买；想让 AI 代打请用「离开模拟 → 暂离（AI 托管）」）；独立模拟不计时，等你回来 |

## 6. 本地客户端素材（可选）

`public/assets/local/` 和 `data/local-assets.json` 是从本机安装的《明日方舟》客户端里提取的官方素材（`tools/local-extract`，DESIGN §13）：`node tools/setup.mjs` 检测到客户端时会询问是否提取，之后可以用 `node tools/setup.mjs --local` 重新提取，或用 `--game "<…/StreamingAssets/AB/Windows>"` 指定客户端目录。setup 从公开镜像下载的素材不包含这部分，所以在没有客户端的电脑上（例如 Linux 服务器）从源码部署时不会有它；Releases 的完整包里已经带上了。

没有本地素材时游戏照常运行，只是下面几样换成替代样式：

| 内容 | 没有本地素材时 |
|---|---|
| 官方 3D 棋盘（贴图、模型、地图特效） | 2D 棋盘，地块由程序绘制 |
| 部分官方界面图标与底板：交流按钮和表情面板的边框、暂停面板、装备替换窗口、干员调配界面、队友状态与漏怪标记、模组类型图标等 | 样式相近的替代图形、图标或文字 |
| 灼热 / 炽焰源石虫的官方模型 | 染成橙色 / 红橙色的普通源石虫 |

表情（6 套 × 6 个）和「玩法说明」的 19 页教程图公开镜像也有：`node tools/setup.mjs` 会和其他素材一起下载（约 21 MB），不需要客户端；有本地素材时优先显示本地的。

**没有客户端的服务器**想要上表中的官方素材：从**同一版本**的完整包（[Releases](https://github.com/sganggs/Stronghold-Protocol/releases)）里，把 `public/assets/local/` 文件夹和 `data/local-assets.json` 复制到服务器项目目录下的相同位置。服务器每次请求都会重新读取这两处，不必重启，玩家刷新页面即可。一定要用与服务器代码相同版本的完整包：各版本提取的内容和清单可能不同（例如灼热 / 炽焰源石虫的模型是 0.1.0 之后才加入的），混用其他版本的文件会缺图或用错图。复制后 `node tools/doctor.mjs` 会显示本地素材的条目数和「3D 棋盘可用」。

**3D 棋盘贴图的下载量**：每位玩家进入对局时都要从开服的电脑下载 3D 棋盘的 12 张贴图。提取时会给这 12 张各写一份 WebP（颜色贴图有损、质量 95，法线和数据贴图无损），清单里列的是 WebP，同名 PNG 留在旁边给裁切工具和 setup 用。这部分下载量从约 6.7 MB 降到约 2 MB，网速慢的远程联机最明显。只有 PNG 的本地素材（例如在这一改动之前提取的）可以用提取时的 Python 环境运行 `tools/local-extract/extract.py --webp` 就地补上，只需要 Pillow，不需要客户端。
