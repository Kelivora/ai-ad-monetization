/**
 * runtime 级验证（architecture.md 3.6）：不执行命令，
 * 返回人工核对清单，状态固定 requires_manual_verification。
 */
export interface RuntimeChecklistItem {
  id: string;
  title: string;
  how: string;
  expected: string;
}

export interface RuntimeChecklist {
  status: 'requires_manual_verification';
  items: RuntimeChecklistItem[];
  recommendedCommand: string;
}

export function buildRuntimeChecklist(): RuntimeChecklist {
  return {
    status: 'requires_manual_verification',
    recommendedCommand: 'flutter run -d <simulator>',
    items: [
      {
        id: 'init-log',
        title: '启动日志出现初始化完成',
        how: '运行应用并观察控制台日志（MobileAds 初始化 / ads initialized 相关输出）。',
        expected: '日志出现广告初始化完成，且没有 consent not granted / 未获得同意 的错误提示。',
      },
      {
        id: 'banner-test-label',
        title: 'Banner 显示 "Test Ad" 标签',
        how: '进入放了 AnchoredBannerAd（或 inline banner）的页面。',
        expected: '横幅区域渲染出广告并带有 "Test Ad" 标签（使用官方测试 ID 时必然出现）。',
      },
      {
        id: 'interstitial-breakpoint',
        title: '插屏在自然断点展示且频控生效',
        how: '在应用内触发自然断点（如关卡结束、返回列表）调用 showIfReady()，并在间隔内再次触发。',
        expected: '插屏在自然断点完整展示；间隔时间内的第二次触发被频控拦下（不连续弹出）。',
      },
      {
        id: 'rewarded-callback',
        title: '激励回调 onReward 触发',
        how: '完整观看一支激励视频直到关闭。',
        expected: 'onReward 回调触发并给出奖励（reward.type / reward.amount），未看完则不发放奖励。',
      },
      {
        id: 'ump-eea-form',
        title: 'EEA 调试地理下 UMP 表单弹出',
        how: '调试代码中设置 ConsentDebugSettings(debugGeography: DebugGeography.debugGeographyEea, testIdentifiers: [...])，并以 EEA 地理重新启动应用。',
        expected: '首次启动弹出 UMP 同意表单；必须先在 AdMob 后台（Privacy & messaging）创建并发布 GDPR 消息，否则表单不出现。',
      },
      {
        id: 'airplane-mode',
        title: '飞行模式下应用不崩溃且广告静默失败',
        how: '开启飞行模式后启动应用并触发各广告位加载。',
        expected: '应用正常运行不崩溃；广告加载失败走 onLoad 失败分支（静默降级），恢复网络后可重新加载。',
      },
      {
        id: 'real-ids-test-device',
        title: '替换真实 ID 后注册测试设备再验证',
        how: '把测试 ID 替换为真实广告单元 ID（--dart-define 覆盖），在真机上按日志提示注册测试设备。',
        expected: '真机上真实广告单元仍显示测试标识（测试设备模式），且账号不因开发期请求被判定违规。',
      },
    ],
  };
}
