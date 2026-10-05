# Tauri 2 desktop client

这是迁移前的桌面客户端。新的统一工程在 `client/`；本目录只为已有构建保留。网页客户端、游戏数据和战斗模拟模块会在构建前复制到
`desktop/web/`，不会在运行时从服务器下载；服务器地址通过 `SP_SERVER_URL` 写入构建产物。

在仓库根目录准备依赖和素材：

```bash
npm ci
node tools/setup.mjs --yes
cd desktop
npm install
```

开发运行：

```bash
SP_SERVER_URL=https://game.example.com npm run dev
```

构建 Windows 安装包（Windows PowerShell）：

```powershell
$env:SP_SERVER_URL = "https://game.example.com"
npm run build
```

构建产物在 `desktop/src-tauri/target/release/bundle/` 下。正式分发前使用 Tauri 的签名配置
签名；不要把签名密钥提交到仓库。Windows 构建需要 Rust、Visual Studio C++ Build Tools
和 WebView2 开发环境。
