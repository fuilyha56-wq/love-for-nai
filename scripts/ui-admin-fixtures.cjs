/* eslint-disable @typescript-eslint/no-require-imports -- Browser-only acceptance fixtures. */
const { pathToFileURL } = require('node:url');
const path = require('node:path');
async function installAdminFixtures(context, { gallery, documents, image }) {
  const now = '2026-10-23T12:00:00Z';
  const { defaultRiskSettings, RISK_FIELDS } = await import(pathToFileURL(path.resolve('src/lib/risk-settings.ts')).href);
  const risk = defaultRiskSettings();
  const campaign = { id: 'layout-campaign', name: '山间旅行创作活动', enabled: true, submissionReward: 2, weeklyRewards: [10, 5, 3], budget: 100, summary: '描绘旅途中遇见的山与天空。', description: '## 创作主题\n\n用自己的作品记录旅途。', rules: '保留原创提示词并标明内容分级。', allowedRatings: ['general', 'r13'], minWeeklyLikes: 1, submissionLimitPerUser: 5, priority: 1, createdAt: now, updatedAt: now };
  const data = {
    '/api/admin': { admin: true, capabilities: { auth: { label: '测试账号', provider: 'newapi' }, image: { label: '图像生成', enabled: true, provider: 'newapi' }, wallet: { upstreamBalance: true, credits: true, packages: true } } },
    '/api/admin/overview': { health: { status: 'ok', service: 'LFn 隔离验收', auth: 'ok', image: 'ok', sessions: { threshold: 5, totalActiveSessions: 2, usersWithActiveSessions: 1, overThresholdUsers: 0, configured: true, status: 'ok' } }, counts: { users: 1, announcements: 2, comments: 2, gallery: gallery.length, referrals: 2, creditAccounts: 1 }, credits: { personal: 100, packages: 50, checkInReward: 1, referralReward: 5 } },
    '/api/admin/users': { items: [{ id: 7777777, username: 'layout-fixture', display_name: '布局测试账号', email: 'layout@example.invalid', role: 1, status: 1, quota: 500000, group: 'default', aff: { balance: 100, packageBalance: 50 } }], total: 1, quotaPerUnit: 500000 },
    '/api/admin/sessions': { threshold: 5, items: [{ userId: 7777777, username: '布局测试', activeSessions: 2 }], totalActiveSessions: 2, upstreamError: null },
    '/api/admin/sessions/cleanup': { configured: true, policy: { enabled: false, idleHours: 24, intervalMinutes: 60 } },
    '/api/admin/credits': { items: [{ userId: 7777777, balance: 100, packageBalance: 50, totalBalance: 150, transactionCount: 1, lastTransactionAt: now, sourceTotals: { reward: 100 }, usage: { requests5h: 2, requests7d: 8, requests30d: 12, retainedRecords: 12 } }], total: 1 },
    '/api/admin/gallery': { items: gallery.slice(0, 3).map((item, i) => ({ ...item, ownerId: 7777777, submittedAt: now, status: i ? 'pending' : 'approved' })), total: 3 },
    '/api/admin/referrals': { items: [{ code: 'LAYOUT-EXAMPLE', inviterUserId: 7777777, inviterName: '布局测试', invitedCount: 2, createdAt: now }], reward: 5 },
    '/api/admin/creator-rewards': { campaigns: [campaign], campaignSpent: { 'layout-campaign': 4 }, grants: [{ id: 'layout-grant', kind: 'submission', userId: 7777777, amount: 2, description: '山间旅行创作活动 · 投稿奖励', status: 'granted', createdAt: now, referenceId: 'layout-fixture-1' }], grantTotal: 1, automation: { enabled: true, timezone: 'UTC', weekStartsOn: 'monday', lastCheckedWeek: '2026-10-19', previousWeek: '2026-10-12' } },
    '/api/admin/redeem-codes': { items: [{ id: 'layout-code', code: 'LAYOUT-****-EXAMPLE', amount: 10, maxUses: 5, usedCount: 1, enabled: true, createdAt: now }], total: 1 },
    '/api/admin/docs': { items: documents.map((item, i) => ({ ...item, id: `layout-doc-${i}`, version: 1, updatedBy: '布局测试' })) },
    '/api/admin/request-audits': { items: [{ requestId: 'layout-request-1', requestFingerprint: 'abcdef0123456789abcdef0123456789', createdAt: now, source: 'lfn', endpoint: '/api/images/generate', operation: 'generate', model: 'nai-v5-full', userId: 7777777, username: '布局测试', status: 200, durationMs: 1500, historyIds: ['layout-fixture-1'], watermarkStatus: 'signed', billing: { lfnChargedAff: 1.25, gatewayAnlasCost: 3, gatewayPromptTokens: 25 } }] },
    '/api/admin/platform/settings': { settings: { authProvider: 'newapi', newApiBaseUrl: 'https://api.example.invalid', registerGroup: 'default', quotaPerUnit: 500000, publicUrl: 'https://example.invalid', sourceCodeUrl: 'https://github.com/Aaalice233/Aaalice_NAI_Launcher', watermarkIssuer: 'LFn', watermarkLabel: 'LFn', enableV5Models: true, enableV45Models: true } },
    '/api/admin/platform/endpoints': { endpoints: [{ id: 'layout-endpoint', type: 'image', adapterType: 'openai_compat', name: '布局验收图像接口', enabled: true, config: { baseUrl: 'https://images.example.invalid' }, priority: 50, createdAt: now, updatedAt: now }] },
    '/api/admin/gateway': { accounts: [{ id: 'layout-gateway', name: '验收渠道', masked_key: 'test-****', weight: 1, enabled: true, status: 'ready', last_error: null, success_count: 8, failure_count: 0, last_used_at: 1792756800 }], models: [{ id: 'nai-v5-full', name: 'V5 完整版', type: 'image', enabled: true }], usage: null, modelBilling: {} },
    '/api/admin/billing/daily': { policy: { enabled: true, strictApiBilling: false, displayUsdPerCny: 200, v45AnlasCny: .001, v5AnlasCny: .0012, v45: [{ afterImages: 0, baseCny: 0, anlasMultiplier: 1, totalMultiplier: 1 }], v5: [{ afterImages: 0, baseCny: .04, anlasMultiplier: 1, totalMultiplier: 1 }] }, cnyPerAff: .01, counts: { v45: 20, v5: 10 }, day: '2026-10-23', packageCny: 4, affPerPackage: 400 },
    '/api/admin/risk/settings': { settings: risk, defaults: risk, fields: RISK_FIELDS, history: [], draft: null, readiness: {} },
    '/api/admin/risk/policy': { policy: { enabled: true, duplicateEnabled: true, duplicateAction: 'observe', duplicateScore: 10, duplicateWindowMs: 600000, duplicateMinRequests: 5, duplicateMinUsers: 3, sameUserEnabled: true, sameUserAction: 'observe', sameUserScore: 10, sameUserWindowMs: 600000, sameUserMaxRequests: 50, highVolumeEnabled: true, highVolumeAction: 'observe', highVolumeScore: 10, highVolume5hRequests: 200, highVolume7dRequests: 1000, watchScore: 10, riskScore: 40, criticalScore: 75, referralRiskEnabled: false, referralMaxDepth: 2, autoRateLimitCritical: false, retryAfterSeconds: 60, policyVersion: 'layout-fixture' }, readiness: { promptFingerprint: true } },
    '/api/admin/risk/overview': { counts: { cases: 1, watch: 1, banned: 0, ipEvidence: 1, promptClusters: 0, pendingRefunds: 0 }, accessEnabled: true },
    '/api/admin/risk/cases': { items: [{ caseId: 'layout-case', userId: 7777777, username: '布局测试', level: 'watch', score: 10, lastSeenAt: now, signals: [{ id: 'layout-signal', description: '隔离验收提示词摘要样本' }], usage: { requests5h: 2, requests7d: 8, requests30d: 12 }, enforcement: { blocked: false } }] },
    '/api/admin/risk/ip': { items: [{ evidenceId: 'layout-ip', userId: 7777777, username: '布局测试', family: 'ipv4', requestCount: 8, lastSeenAt: now, geo: { status: 'ok', countryName: '中国', region: '上海', city: '上海', provider: 'example' } }] },
  };
  const unknown = [];
  await context.route('**/api/admin**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/image')) return route.fulfill({ contentType: 'image/svg+xml', body: image });
    if (route.request().method() !== 'GET') return route.fulfill({ status: 409, json: { message: '隔离验收禁止管理写入' } });
    if (url.pathname === '/api/admin/credits' && url.searchParams.has('userId')) return route.fulfill({ json: { item: { userId: 7777777, username: 'layout-fixture', displayName: '布局测试', balance: 100, packageBalance: 50, totalBalance: 150, transactions: [{ id: 'layout-credit', createdAt: now, amount: 2, type: 'reward', description: '山间旅行 · 投稿奖励', source: 'lfn' }], transactionTotal: 1, page: 1, pageSize: 10, usage: { requests5h: 2, requests7d: 8, requests30d: 12, retainedRecords: 12 } } } });
    if (url.pathname.endsWith('/7777777/ips')) return route.fulfill({ json: { items: [{ evidenceId: 'layout-ip', requestId: 'layout-request-1', family: 'ipv4', firstSeenAt: now, lastSeenAt: now, requestCount: 8, masked: '192.0.2.*', sessionCount: 1, sources: ['lfn'], geo: { status: 'resolved', countryName: '中国', region: '上海', city: '上海', provider: 'example' } }], rawRevealEnabled: false } });
    if (!data[url.pathname]) unknown.push(url.pathname);
    return route.fulfill({ json: data[url.pathname] || { items: [], total: 0, page: 1, pages: 1 } });
  });
  return { unknown };
}
module.exports = { installAdminFixtures };
