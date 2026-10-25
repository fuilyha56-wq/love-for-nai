/* Browser-only data: intercepted writes never reach the local or upstream API. */
async function installContentFixtures(context) {
  const now = '2026-10-23T12:00:00.000Z';
  let sequence = 2;
  const stories = [{ id: 'layout-story', title: '山间来信', model: 'sol', genre: '奇幻 · 成长', synopsis: '一封来自山间的信，带领主角寻找失落的村庄。', lorebook: '雾山：常年被云雾笼罩，山路旁开着白色的小花。', specializedPrompt: true, activeBranchId: 'layout-branch', branches: [{ id: 'layout-branch', parentId: null, name: '主线', content: Array.from({ length: 18 }, (_, i) => `第 ${i + 1} 段。清晨的风穿过山谷，信使沿着石阶向村庄走去。她在岔路口停下，展开那封写满细小字迹的信。远处有人挥手，仿佛等待了许多年。`).join('\n\n'), createdAt: now, updatedAt: now }, { id: 'layout-alternate', parentId: 'layout-branch', name: '另一条山路', content: '她选择了通往河谷的小路。', createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }];
  const writes = [];
  await context.route('**/api/wallet', route => route.fulfill({ json: { newApi: { balance: 100, used: 5, group: 'default' }, aff: { balance: 100, packageBalance: 50, totalBalance: 150, packageRateLimitRemaining: 10, checkedInToday: false, checkInEnabled: true, checkInReward: 2 }, imagePackage: { priceUsd: 10, affPerPackage: 400, rateLimit: 10, purchaseEnabled: true }, capabilities: { wallet: { upstreamBalance: true }, labels: { upstreamBalance: 'NewAPI 余额', credits: 'AFF', packages: '图包' } } } }));
  await context.route('**/api/aff/ledger', route => route.fulfill({ json: { transactions: Array.from({ length: 4 }, (_, i) => ({ id: `layout-transaction-${i}`, createdAt: now, amount: i ? 2 : -1.25, type: i ? 'check-in' : 'image', description: i ? '每日签到奖励' : '图片生成', source: i ? 'personal' : 'package' })) } }));
  await context.route('**/api/aff/referral', route => route.fulfill({ json: { enabled: true, link: 'https://example.invalid/sign-in?invite=layout-example', invitedCount: 2, registrationReward: 5 } }));
  await context.route('**/api/redeem/history', route => route.fulfill({ json: { items: [{ id: 'layout-redemption', code: 'LAYOUT-EXAMPLE', amount: 20, rewardType: 'aff', redeemedAt: now }] } }));
  await context.route('**/api/security/grant', route => route.fulfill(route.request().method() === 'GET' ? { json: { enabled: true, grade: 'normal', grant: { day: '2026-10-23', exits: 1, rebinds: 0 }, rebindPolicy: { mode: 'hybrid', maxRebinds: 12, minRebindSeconds: 7200 }, restrictions: [] } } : { status: 409, json: { message: '隔离验收禁止真实授权写入' } }));
  await context.route('**/api/security/access', route => route.fulfill({ json: { enabled: true, requests: [] } }));
  await context.route('**/api/public/catalog', route => route.fulfill({ json: { models: [
    { id: 'nai-v5-full', name: 'V5 完整版', kind: 'image', summary: '支持多角色和完整生成参数的图像模型。', capabilities: ['文生图', '图生图', '多角色'], pricing: { billingMode: 'live', liveType: 'per_request', liveUsdPerRequest: .005, liveGroupName: 'default', liveGroupRatio: 1, privatePointReference: null, note: '隔离布局示例价格' } },
    { id: 'nai-v5-full-medium', name: 'V5 标准档', kind: 'image', summary: '用于检验分档计费信息的显示。', capabilities: ['文生图'], pricing: { billingMode: 'live', liveType: 'tiered', liveUsdPerRequest: .004, liveUsdPerUsageToken: .0001, liveBaseUsdPerImage: .001, privatePointReference: null, note: '隔离布局示例价格' } },
    { id: 'nai-v4.5-full', name: 'V4.5 完整版', kind: 'image', summary: '适合构图和细节调整。', capabilities: ['文生图', '局部重绘'], pricing: { billingMode: 'live', liveType: 'per_token', liveUsdPerUsageToken: .00002, privatePointReference: null, note: '隔离布局示例价格' } },
    { id: 'nai-chat', name: 'NAI Chat', kind: 'chat', summary: '用于检验聊天模型信息。', capabilities: ['标签助手'], pricing: { billingMode: 'live', liveType: 'per_token', liveUsdPerUsageToken: .000005, privatePointReference: null, note: '隔离布局示例价格' } },
  ], asOf: now, stale: false, source: 'snapshot', currency: 'USD', conversion: '隔离验收' } }));
  let verificationMode = 'valid';
  let authMode = 'error';
  await context.route('**/api/auth/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/policy') return route.fulfill({ json: { provider: 'newapi', policy: { passwordLoginEnabled: true, tokenLoginEnabled: true, registrationEnabled: true, passwordRegistrationEnabled: true, emailRegistrationEnabled: true, inviteRegistrationEnabled: false, requireEmailVerification: true, emailDomainRestrictionEnabled: false, blockEmailAliases: false, allowedEmailDomains: '' } } });
    writes.push({ path: url.pathname, method: request.method(), input: request.postDataJSON() });
    if (url.pathname.endsWith('/register')) return route.fulfill({ json: { success: true, message: '隔离注册验收，不会发送邮件或创建账号' } });
    if (url.pathname.endsWith('/login') && authMode === 'two-factor') return route.fulfill({ json: { twoFactorRequired: true } });
    return route.fulfill(authMode === 'success' ? { json: { success: true } } : { status: 403, json: { message: '隔离验收：凭据或验证码不正确' } });
  });
  await context.route('**/api/images/verify-watermark', route => {
    if (verificationMode === 'network') return route.abort();
    if (verificationMode === 'invalid') return route.fulfill({ json: { valid: false, error: '未找到可验证的 LFn 签名' } });
    return route.fulfill({ json: { valid: true, shaMatch: true, recordFound: true, payload: { requestId: 'layout-request-20261023-abcdef0123456789abcdef0123456789', userId: 7777777, sha256: 'abcdef0123456789'.repeat(4), timestamp: '2026-10-23T12:00:00Z', model: 'nai-v5-full', domain: 'https://example.invalid', issuer: 'LFn', label: 'LFn' }, audit: { parameters: { prompt: 'landscape, mountains, blue sky, clouds', model: 'nai-v5-full', width: 832, height: 1216, steps: 28 } } } });
  });
  const notifications = Array.from({ length: 5 }, (_, i) => ({ id: `layout-notice-${i}`, userId: 7777777, type: i % 2 ? 'creator-reward' : 'announcement-reply', title: i % 2 ? '作品已获得创作奖励' : '山间来信回复了你的评论', body: '感谢你提出的手机布局建议。新的操作菜单已支持触控与键盘，请在作品详情中查看。', href: '/announcements', createdAt: now, readAt: i > 1 ? now : null }));
  await context.route('**/api/notifications', async route => {
    if (route.request().method() === 'PATCH') {
      const input = route.request().postDataJSON();
      for (const item of notifications) if (input.all || input.id === item.id) item.readAt = now;
      writes.push({ path: '/api/notifications', method: 'PATCH', input });
    }
    return route.fulfill({ json: { items: notifications, unreadCount: notifications.filter(item => !item.readAt).length } });
  });
  const documents = [{ slug: 'quick-start', title: '快速开始', category: '使用指南', summary: '创建第一张图片，并将常用参数保存为预设。', status: 'published', sortOrder: 0, createdAt: now, updatedAt: now, content: '# 开始创作\n\n1. 打开画布并输入提示词。\n2. 选择模型与图片尺寸。\n3. 点击生成，在历史中查看结果。\n\n## 请求示例\n\n```json\n{ "model": "nai-v5-full", "prompt": "landscape, blue sky, mountains, a very long continuous code value to inspect horizontal scrolling", "width": 832, "height": 1216 }\n```\n\n| 控件 | 用途 |\n| --- | --- |\n| 提示词 | 描述画面 |\n| 参数 | 尺寸、步数和种子 |\n\n图片只用于说明布局，请使用自己的创作内容。' }, ...Array.from({ length: 7 }, (_, i) => ({ slug: `reference-${i}`, title: `模型与参数参考 ${i + 1}`, category: i < 4 ? '模型说明' : 'API 参考', summary: '模型参数与示例。', status: 'published', sortOrder: i + 1, createdAt: now, updatedAt: now, content: `## 参数参考 ${i + 1}\n\n修改参数后，在生成前确认尺寸与模型。` }))];
  await context.route('**/api/docs', route => route.fulfill({ json: { items: documents } }));
  const announcements = [{ id: 'layout-announcement', title: '工作台布局更新与社区反馈', content: '## 本次更新\n\n手机端的图片操作放在同一位置，支持浏览、导入和下载。\n\n- 画布与参数\n- 图片历史与分支\n- 设置与主题\n\n欢迎留下你遇到的问题。', level: 'info', author: 'LFn', pinned: true, createdAt: now, updatedAt: now }, { id: 'layout-announcement-2', title: '服务维护时间说明', content: '维护完成后可继续使用工作台。', level: 'warning', author: 'LFn', pinned: false, createdAt: now, updatedAt: now }];
  const comments = [{ id: 'layout-comment', authorId: 8888888, authorName: '山间来信', content: '在手机上查看图片和切换参数现在方便多了，希望保留常用的分支。', parentId: null, createdAt: now, pinned: false, likes: 3, dislikes: 0, myVote: null }, { id: 'layout-reply', authorId: 7777777, authorName: '布局测试', content: '分支会保留，感谢建议。', parentId: 'layout-comment', createdAt: now, pinned: false, likes: 1, dislikes: 0, myVote: null }];
  await context.route('**/api/announcements**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') return route.fulfill({ json: { items: url.pathname.includes('/comments') ? comments : announcements } });
    const input = request.postDataJSON() || {};
    writes.push({ path: url.pathname, method: request.method(), input });
    if (request.method() === 'POST' && url.pathname.endsWith('/comments')) {
      const item = { id: `layout-comment-${sequence++}`, parentId: input.parentId || null, authorId: 7777777, authorName: '布局测试', content: input.content, createdAt: now, pinned: false, likes: 0, dislikes: 0, myVote: null };
      comments.push(item);
      return route.fulfill({ json: { item } });
    }
    if (request.method() === 'PATCH' && input.action === 'vote') {
      const item = comments.find(comment => comment.id === input.commentId);
      item.myVote = input.vote;
      item.likes = input.vote === 'up' ? 4 : 3;
      return route.fulfill({ json: { item } });
    }
    return route.fulfill({ status: 409, json: { message: '隔离验收禁止此项操作' } });
  });
  await context.addInitScript(() => localStorage.setItem('lfn-announcements-read', JSON.stringify(['layout-announcement', 'layout-announcement-2'])));
  const usage = Array.from({ length: 22 }, (_, i) => ({ id: i, model_name: 'nai-v5-full', request_id: `layout-request-${i + 1}`, created_at: 1792756800 - i * 60, status: i % 4 ? 'success' : 'failed', source: 'lfn', payment_source: 'personal', charged_aff: 1.25, content: '布局验收生成记录', width: 832, height: 1216, prompt: 'landscape, blue sky, mountains' }));
  await context.route('**/api/usage**', route => {
    const params = new URL(route.request().url()).searchParams;
    const page = Number(params.get('page') || 1);
    const filtered = usage.filter(item => (!params.get('status') || params.get('status') === item.status) && (!params.get('requestId') || item.request_id.includes(params.get('requestId'))));
    return route.fulfill({ json: { items: filtered.slice((page - 1) * 20, page * 20), total: filtered.length, hasMore: filtered.length > page * 20 } });
  });
  await context.route('**/api/stories**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === '/api/stories/models') return route.fulfill({ json: { items: [{ id: 'sol', label: 'Sol', source: 'NovelAI' }, { id: 'luna', label: 'Luna', source: 'NovelAI' }] } });
    if (method === 'GET') return route.fulfill({ json: { items: stories } });
    const input = request.postDataJSON() || {};
    writes.push({ method, path: url.pathname, input });
    if (url.pathname === '/api/stories' && method === 'POST') {
      const id = `layout-new-${sequence++}`;
      const branch = { id: `${id}-branch`, parentId: null, name: '主线', content: '', createdAt: now, updatedAt: now };
      const story = { id, title: input.title || '新故事', model: input.model || 'sol', genre: input.genre || '', synopsis: '', lorebook: '', specializedPrompt: true, activeBranchId: branch.id, branches: [branch], createdAt: now, updatedAt: now };
      stories.push(story);
      return route.fulfill({ json: { story } });
    }
    const story = stories.find(item => item.id === url.pathname.split('/')[3]);
    if (!story) return route.fulfill({ status: 404, json: { message: '验收故事不存在' } });
    if (method === 'PUT') {
      const { branch, ...patch } = input;
      Object.assign(story, patch);
      if (branch) Object.assign(story.branches.find(item => item.id === branch.id), branch);
    } else if (method === 'POST' && url.pathname.endsWith('/branches')) {
      const source = story.branches.find(item => item.id === input.sourceBranchId);
      const branch = { ...source, id: `layout-fork-${sequence++}`, parentId: source.id, name: input.name };
      story.branches.push(branch);
      story.activeBranchId = branch.id;
    } else if (method === 'POST' && url.pathname.endsWith('/generate')) {
      story.branches.find(item => item.id === input.branchId).content = input.content + '\n\n山路尽头，村庄的灯光依次亮起。（隔离验收文本）';
    } else if (method === 'DELETE') stories.splice(stories.indexOf(story), 1);
    else return route.fulfill({ status: 409, json: { message: '验收不支持此操作' } });
    return route.fulfill({ json: { story } });
  });
  return { stories, writes, documents, setVerificationMode: value => { verificationMode = value; }, setAuthMode: value => { authMode = value; } };
}
module.exports = { installContentFixtures };
