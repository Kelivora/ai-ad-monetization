#!/usr/bin/env bash
# 端到端验证：examples/flutter_demo_app（只读）复制到 .tmp/e2e，
# 用构建后的 CLI apply，然后 flutter pub get / analyze / build，再跑 validate。
#
# 用法: scripts/e2e-build.sh [ios|android|all]   （默认 all；无 Android SDK 时 android 打印 SKIPPED 不算失败）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-all}"
E2E_DIR="$ROOT/.tmp/e2e"
CLI="$ROOT/packages/mcp-server/dist/cli.js"

echo "==> [0/7] 构建 mcp-server"
(cd "$ROOT/packages/mcp-server" && npm run build)

echo "==> [1/7] 准备干净的 .tmp/e2e"
rm -rf "$E2E_DIR"
cp -R "$ROOT/examples/flutter_demo_app" "$E2E_DIR"

echo "==> [2/7] CLI apply（banner,interstitial,rewarded）"
node "$CLI" apply "$E2E_DIR" --formats banner,interstitial,rewarded --yes

# 额外写一个引用生成组件/控制器的文件，让 banner/controller 代码也被编译检查
# （仅用于 e2e 验证，不属于生成器输出）
cat > "$E2E_DIR/lib/ads_demo_usage.dart" <<'DART'
// e2e-only file: 编译检查生成代码被真实使用（不属于生成器输出）。
import 'package:flutter/material.dart';

import 'ads/ads.dart';

class AdsDemoPage extends StatefulWidget {
  const AdsDemoPage({super.key});

  @override
  State<AdsDemoPage> createState() => _AdsDemoPageState();
}

class _AdsDemoPageState extends State<AdsDemoPage> {
  final InterstitialAdController _interstitial = InterstitialAdController();
  final RewardedAdController _rewarded = RewardedAdController();

  @override
  void initState() {
    super.initState();
    _interstitial.load();
    _rewarded.load();
  }

  @override
  void dispose() {
    _interstitial.dispose();
    _rewarded.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ads demo')),
      bottomNavigationBar: const AnchoredBannerAd(),
      body: Center(
        child: Column(
          mainAxisAlignment: .center,
          children: [
            FilledButton(
              onPressed: () async {
                final shown = await _interstitial.showIfReady();
                debugPrint('interstitial shown: $shown');
              },
              child: const Text('Show interstitial'),
            ),
            ValueListenableBuilder<bool>(
              valueListenable: _rewarded.isReady,
              builder: (context, ready, _) => FilledButton(
                onPressed: ready
                    ? () => _rewarded.show(
                          onReward: (reward) => debugPrint('reward: ${reward.amount} ${reward.type}'),
                        )
                    : null,
                child: Text(ready ? 'Watch rewarded ad' : 'Loading ad…'),
              ),
            ),
            FilledButton(
              onPressed: () => AdsConsent.showPrivacyOptionsForm(),
              child: const Text('Privacy options'),
            ),
          ],
        ),
      ),
    );
  }
}
DART

echo "==> [3/7] flutter pub get"
(cd "$E2E_DIR" && flutter pub get)

echo "==> [4/7] flutter analyze（要求 0 error 0 warning）"
(cd "$E2E_DIR" && flutter analyze)

run_ios() {
  echo "==> [5/7] flutter build ios --simulator --debug --no-codesign"
  (cd "$E2E_DIR" && flutter build ios --simulator --debug --no-codesign)
}

run_android() {
  # macOS 自带 /usr/bin/java 占位（无运行时），必须验证 java -version 真正可用
  if [ ! -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}" ] || ! java -version >/dev/null 2>&1; then
    echo "==> [6/7] flutter build apk --debug: SKIPPED（无 Java/Android SDK）"
    return 0
  fi
  echo "==> [6/7] flutter build apk --debug"
  (cd "$E2E_DIR" && flutter build apk --debug)
}

case "$TARGET" in
  ios) run_ios ;;
  android) run_android ;;
  all) run_ios; run_android ;;
  *) echo "未知目标: $TARGET（可选 ios|android|all）"; exit 2 ;;
esac

echo "==> [7/7] validate（development + US,EEA / release）"
set +e
node "$CLI" validate "$E2E_DIR" --markets US,EEA; DEV_EEA=$?
node "$CLI" validate "$E2E_DIR" --profile release --markets US,EEA; REL=$?
set -e
echo ""
echo "e2e summary: validate(dev,US+EEA) exit=$DEV_EEA (warning-level results are expected; privacy options entry is a manual step); validate(release) exit=$REL (fail is expected: still using test IDs)"
echo "e2e done: OK"
