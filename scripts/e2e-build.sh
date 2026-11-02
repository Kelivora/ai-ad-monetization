#!/usr/bin/env bash
# 端到端验证：examples/flutter_demo_app（只读）复制到 .tmp/e2e，
# 用构建后的 CLI apply，然后统一用 `cli verify`（static + build + runtime 清单）
# 替代手写的 flutter pub get / analyze / build 步骤，最后跑 validate 与 `cli report`。
#
# 用法: scripts/e2e-build.sh [ios|android|all]   （默认 all；无 Android SDK 时 android 构建自动 skipped 不算失败）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-all}"
E2E_DIR="$ROOT/.tmp/e2e"
CLI="$ROOT/packages/mcp-server/dist/cli.js"
REPORT="$ROOT/.tmp/e2e-report.md"
VERIFY_JSON="$ROOT/.tmp/e2e-verify.json"

echo "==> [0/7] 构建 mcp-server"
(cd "$ROOT/packages/mcp-server" && npm run build)

echo "==> [1/7] 准备干净的 .tmp/e2e"
rm -rf "$E2E_DIR" "$REPORT" "$VERIFY_JSON"
cp -R "$ROOT/examples/flutter_demo_app" "$E2E_DIR"

echo "==> [2/7] CLI apply（banner,interstitial,rewarded）"
node "$CLI" apply "$E2E_DIR" --formats banner,interstitial,rewarded --yes

# 额外写一个引用生成组件/控制器的文件，让 banner/controller 代码也被编译检查
# （仅用于 e2e 验证，不属于生成器输出）
cat > "$E2E_DIR/lib/ads_demo_usage.dart" <<'DART'
// e2e-only file: compiles the generated code against real usage (not generator output).
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
              onPressed: () => AdsInitializer.instance.showPrivacyOptionsAndRetry(),
              child: const Text('Privacy options'),
            ),
          ],
        ),
      ),
    );
  }
}
DART

# verify 内部依次执行：static（规则校验）→ pub get / analyze / build apk / build ios → runtime。
# runtime：冷烟测试文件由 plan/apply 生成（本脚本不再手动添加 integration_test）；
# 设置 E2E_DEVICES=<id1,id2> 时在指定设备上自动执行冷烟测试，E2E_SHOW_FULLSCREEN=1 时
# 额外验证激励回调（需要人工关闭全屏广告）。脚本不负责启动模拟器。
# ios/all 不限定 targets：无 Java/Android SDK 的机器上 android 步骤会 skipped 并写明原因（不算失败）。
VERIFY_TARGETS=""
case "$TARGET" in
  ios|all) VERIFY_TARGETS="" ;;
  android) VERIFY_TARGETS="--targets android" ;;
  *) echo "未知目标: $TARGET（可选 ios|android|all）"; exit 2 ;;
esac

VERIFY_FLAGS=""
if [ -n "${E2E_DEVICES:-}" ]; then
  VERIFY_FLAGS="$VERIFY_FLAGS --devices $E2E_DEVICES"
fi
if [ "${E2E_SHOW_FULLSCREEN:-0}" = "1" ]; then
  VERIFY_FLAGS="$VERIFY_FLAGS --show-fullscreen"
fi

echo "==> [3/7] cli verify（static + build + runtime，结果另存 JSON）"
set +e
node "$CLI" verify "$E2E_DIR" --levels static,build,runtime --json-out "$VERIFY_JSON" $VERIFY_TARGETS $VERIFY_FLAGS
VERIFY=$?
set -e
# 退出码：1 = static/build failed（真实失败）；3 = 全部 skipped（可接受的工具链缺失）；0 = 通过
if [ "$VERIFY" -eq 1 ] || [ "$VERIFY" -eq 2 ]; then
  echo "e2e verify: FAILED (exit=$VERIFY)"
  exit 1
fi

echo "==> [4/7] validate（development + US,EEA）"
set +e
node "$CLI" validate "$E2E_DIR" --markets US,EEA; DEV_EEA=$?
set -e

echo "==> [5/7] validate（release + US,EEA，测试 ID 判 fail 是预期）"
set +e
node "$CLI" validate "$E2E_DIR" --profile release --markets US,EEA; REL=$?
set -e

echo "==> [6/7] cli report → .tmp/e2e-report.md（带真实验证结果）"
node "$CLI" report "$E2E_DIR" --out "$REPORT" --verification-file "$VERIFY_JSON"

echo "==> [7/7] 汇总"
echo ""
echo "e2e summary: verify exit=$VERIFY; validate(dev,US+EEA) exit=$DEV_EEA (warning-level results are expected; privacy options entry is a manual step); validate(release) exit=$REL (fail is expected: still using test IDs)"
echo "e2e report: $REPORT"
echo "e2e done: OK"
