# 安装指南

本仓库同时是一个 MCP 服务器、一组 Agent Skills 和一个 Claude Code / Codex / Cursor 插件。三者可以一起装，也可以只装其中一部分。

## 1. 前置条件

| 组件 | 版本 | 用途 | 是否必须 |
| --- | --- | --- | --- |
| Node.js | ≥ 20 | 运行 MCP 服务器与 CLI | 必须 |
| Flutter | ≥ 3.38.1（Dart ≥ 3.10.0） | google_mobile_ads 9.2.0 的最低要求；构建验证需要 | 构建验证需要 |
| Xcode + CocoaPods | Xcode 16+ | iOS 模拟器构建验证 | iOS 构建验证需要 |
| JDK 17 + Android SDK（compileSdk 36） | — | Android debug 构建验证 | Android 构建验证需要 |

在 macOS 上不装 Android Studio 也可以准备 Android 环境（验收时就是这样装的）：

```bash
brew install openjdk@17
brew install --cask android-commandlinetools
export SDKMANAGER_OPTS="-Djava.net.preferIPv4Stack=true"   # 部分网络下 sdkmanager 走 IPv6 会卡住
SDK=$HOME/Library/Android/sdk
sdkmanager --sdk_root=$SDK "platform-tools" "platforms;android-36" "build-tools;36.0.0" "cmdline-tools;latest" \
  "emulator" "system-images;android-36;google_apis;arm64-v8a"
flutter config --android-sdk $SDK --jdk-dir /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
yes | flutter doctor --android-licenses
$SDK/cmdline-tools/latest/bin/avdmanager create avd -n ads_api36 -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7
```

缺少 Flutter、Xcode 或 Android SDK 时，只读分析、方案生成、写入和静态校验都能正常运行，对应的构建步骤会显示 `skipped`，并说明缺什么。工具不会把跳过当成通过。

## 2. 构建 MCP 服务器

```bash
git clone <this-repo> ai-ad-monetization
cd ai-ad-monetization
npm install
npm run build        # 输出 packages/mcp-server/dist
npm test             # 可选：运行单元测试
npm run kb:check     # 可选：检查知识库是否过期、插件版本是否有更新（需要网络）
```

`scripts/run-mcp.mjs` 是插件使用的启动脚本。如果还没构建，它会在 stderr 打印提示后退出，不会自动安装依赖。

## 3. 接入到 Agent

### 3.1 Claude Code（插件方式，推荐）

先试用（只对当前会话生效，已在 Claude Code 2.1.304 上验证）：

```bash
claude --plugin-dir /path/to/ai-ad-monetization
```

长期安装：

```bash
claude plugin marketplace add /path/to/ai-ad-monetization
claude plugin install ai-ad-monetization@ai-ad-monetization
```

插件会同时注册 `skills/` 下的 8 个 Skill，以及 `.mcp.json` 中的 `ad-monetization` MCP 服务器。在非交互模式（`claude -p`）下需要用 `--allowedTools` 放行工具，名称形如 `mcp__plugin_ai-ad-monetization_ad-monetization__analyze_project`。

### 3.2 只装 MCP 服务器（任意 MCP 客户端）

```json
{
  "mcpServers": {
    "ad-monetization": {
      "command": "node",
      "args": ["/path/to/ai-ad-monetization/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Cursor 写到 `~/.cursor/mcp.json` 或项目内的 `.cursor/mcp.json`；Claude Code 也可以执行 `claude mcp add ad-monetization -- node /path/to/.../dist/index.js`。

### 3.3 只装 Skills

把 `skills/` 下的目录复制或软链到客户端的 skills 目录（例如 `~/.claude/skills/`、`~/.cursor/skills/`）。Skills 在没有 MCP 服务器时会退化为“按文档引导”，但无法自动写入和校验。

### 3.4 官方 Skill（按需）

本项目不会重复实现官方已覆盖的场景，遇到时会提示你安装：

```bash
npx skills add google/skills/skills/ads          # AdMob 原生 Android / iOS / Unity
npx skills add Unity-Technologies/skills          # Unity LevelPlay（Unity 引擎项目）
```

## 4. 环境变量

| 变量 | 作用 |
| --- | --- |
| `AD_MONETIZATION_KB` | 指定知识库目录（默认从安装位置向上查找 `knowledge/index.json`） |
| `ADMOB_ACCESS_TOKEN` | 可选。`get_ad_revenue` 以 `source=admob_api` 调用 AdMob Reporting API 时使用。需要你自己通过 OAuth 获取（scope `https://www.googleapis.com/auth/admob.readonly`）。工具不会代你登录，也不会记录或返回令牌。 |

## 5. CLI（不经过 Agent 直接使用）

```bash
node packages/mcp-server/dist/cli.js analyze  <project>
node packages/mcp-server/dist/cli.js plan     <project> --formats banner,interstitial,rewarded
node packages/mcp-server/dist/cli.js apply    <project> --formats banner,interstitial,rewarded --yes
node packages/mcp-server/dist/cli.js validate <project> --profile development --markets US,EEA
node packages/mcp-server/dist/cli.js verify   <project> --levels static,build,runtime
node packages/mcp-server/dist/cli.js report   <project> --out report.md
node packages/mcp-server/dist/cli.js perf     --file admob_export.csv
```

## 6. 安装后自检

```bash
node packages/mcp-server/scripts/smoke-stdio.mjs   # 通过 stdio 列出全部工具
bash scripts/e2e-build.sh ios                      # 在示例工程副本上完整跑一遍接入和 iOS 构建
```

`e2e-build.sh` 只修改 `.tmp/e2e` 里的副本，`examples/flutter_demo_app` 保持原样。
