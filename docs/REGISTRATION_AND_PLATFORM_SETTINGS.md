# 平台配置与注册策略

> 历史验证记录中的测试数量与产物路径描述当时的本机结果；当前版本的整合范围和验证边界见 [创作工作区整合记录](./creative-workspace-integration.md)。

> 验证文件说明：文中的单元测试、浏览器检查和审计脚本保留在开发者本机，按发布要求不包含在当前 GitHub 文件中。干净检出可运行 `npm run lint` 和 `npm run build`；历史测试路径与命令仅供拥有本机验证文件的开发环境参考。


管理入口为 `/admin?tab=platform`。基础站点只保留公开地址与源码链接，其他设置分别进入：

| 页面 | 地址参数 | 内容 |
| --- | --- | --- |
| 注册与登录 | `authentication` | 登录开关、注册方式、邮箱验证、域名与别名限制、SMTP |
| 服务接入 | `services` | 账号提供者、NewAPI 管理连接、图像服务连接 |
| 端点管理 | `endpoints` | 认证、图像、钱包端点的添加、编辑与启停 |
| 额度与奖励 | `billing` | 图包、签到、邀请奖励与每日计费 |
| 模型与签名 | `image-policy` | 模型开放范围、图片来源签名 |
| 网络与存储 | `network` | 出站代理、反向代理、Cookie 与远程历史 |
| Gateway 运营 | `gateway` | 渠道池、账号健康、模型计费覆盖 |

每个设置页面只提交实际修改的字段，保留其他设置和脱敏密钥。配置继续持久化在 `LFN_DATA_DIR/platform/config.json`，保存后接口立即使用新策略。已打开的登录页在重新聚焦或最多 30 秒内刷新入口。

## 注册方式

“允许新用户注册”是总开关。现有邮箱和邀请码注册均创建密码账号，也受“允许使用密码注册”控制。邮箱与邀请码可以单独或同时启用；全部关闭后隐藏注册入口。

邮箱注册需要用户名、8–64 位密码和邮箱。邀请码注册先验证站内邀请码是否存在。关闭邮箱验证时，邀请码可以作为注册资格凭据；启用邮箱验证后，两种注册方式都需要邮箱验证码。启用邮箱域名限制时，两种方式都必须提供属于允许域名的邮箱。

站内邀请奖励与邀请码注册开关独立。邮箱注册仍可通过邀请链接记录原有邀请来源，邀请码注册则必须提供有效邀请码才会创建账户。

用户名密码登录、访问令牌登录、密码登录后的两步验证、验证码发送和注册提交都在服务端执行策略校验。公开的 `/api/auth/policy` 只返回注册策略，不包含上游连接或 SMTP 密钥。

## 邮箱验证

NewAPI 账号未配置本站 SMTP 时，沿用 NewAPI 发送和验证验证码，并先确认其 `email_verification` 已启用；验证服务不可用时拒绝创建账号。本地账号需要配置本站 SMTP 才能验证邮箱。

### NewAPI 仅限邀请时的衔接

用户只填写 LFN 邀请码。LFN 服务端查找该邀请码的邀请人，再使用服务端管理连接读取同一个 NewAPI 用户的 `aff_code`，交给 NewAPI 的公开注册接口。客户端传入的 `affCode` 不参与邀请人选择，管理令牌和上游邀请码不会返回浏览器。邮箱发送、验证码校验、上游注册开关仍由原流程执行。

在沿用 NewAPI 邮箱验证的模式下，公开登录策略会合并 NewAPI 的仅限邀请和关闭注册设置；LFN 的关闭设置始终有效。上游注册策略暂不可读时隐藏注册入口，保留登录入口。NewAPI 用户名上限为 20 个字符，本地账号仍为 32 个字符。

邀请人在 LFN 获取邀请链接时，会用其本人的上游会话准备 NewAPI 邀请码，因为 NewAPI 只在首次获取时生成该码。旧链接的邀请人若尚无上游码，需要登录 LFN 重新获取一次邀请链接；LFN 链接和站内码保持原值。邀请人被禁用、删除或上游查询不可用时，不会退回空邀请码或管理员代建。

注册后的登录结果会直接建立 LFN 会话，桌面和手机均直接进入工作台，并沿用“保持登录”的选择。登录或会话建立失败时仍返回注册成功，改为提示使用新账号登录；不会把已创建的账号当成注册失败。两步验证挑战不能直接变成正式会话。

本地验证：本机界面检查（未随发布提供），设置 `LFN_UI_BASE_URL` 为本地开发地址，并通过 `LFN_PLAYWRIGHT_MODULE` 指定 Playwright。该脚本使用浏览器接口夹具，不会创建线上账号；接口验证见 `tests/newapi-registration.test.ts`。修改需部署到 LFN 后才会改变线上行为，线上验收还需一次有效邮箱验证码。

SMTP 支持直接 TLS 与 STARTTLS，使用 Nodemailer 发送一次性验证码。验证码有效期 10 分钟，最多尝试 5 次，只保存随机盐和哈希，成功使用后不能重放。数据位于 `LFN_DATA_DIR/registration-email/`。上游发送验证码仍保留原有限流。

使用本站 SMTP 验证或关闭邮箱验证时，NewAPI 通过管理员接口创建普通账号，因此需要配置 NewAPI 管理员令牌。NewAPI 管理员创建接口不绑定邮箱；LFN 将注册邮箱、是否验证及用户名记录在 `LFN_DATA_DIR/registration-identities.json`，并检查邮箱重复。该记录不改变 NewAPI 自身的邮箱绑定或找回密码机制。

可使用管理页面配置 SMTP，或提供初始环境变量：`LFN_SMTP_HOST`、`LFN_SMTP_PORT`（默认 587）、`LFN_SMTP_USER`、`LFN_SMTP_PASSWORD`、`LFN_SMTP_FROM` 和 `LFN_SMTP_SECURE`。管理页面保存的值优先。

## 验证

认证策略、设置持久化、验证码与现有认证回归测试：

```powershell
# 仅本机保留的验证环境：npx vitest run tests/auth-policy.test.ts tests/auth-policy-routes.test.ts tests/registration-email.test.ts tests/register-rate-limit.test.ts tests/auth-login-conflict.test.ts tests/platform-batch-api.test.ts tests/admin-local-ops.test.ts tests/rewards-runtime.test.ts tests/platform-capabilities.test.ts
```

界面验收脚本 本机界面检查（未随发布提供） 使用独立的浏览器 API fixtures，在 1056px 与 390px 下验证分类布局、按页保存、重新加载回显，以及邮箱/邀请码/关闭注册等组合，不写入实际设置。需要本地开发服务和 Playwright，可通过 `LFN_PLAYWRIGHT_MODULE` 指定已安装的 Playwright。


## 全局邀请码注册门槛（2026-10-24）

新增 `requireInviteCode`（默认关闭），在注册与登录 → 注册门槛 → “注册必须填写邀请码（仅限邀请）”中配置。它独立于登录开关和 `emailRegistrationEnabled`、`inviteRegistrationEnabled`，开启后保留现有入口，只要求所有注册流程额外提供有效邀请码。

公开 policy 返回该字段；桌面与手机邮箱注册均显示必填邀请码，验证码请求与最终注册请求均携带 `inviteCode`。服务器共享注册上下文会在 PUT 发送验证码与 POST 创建账号前校验，旧客户端省略 method 时同样生效。普通登录不受影响。只保存 `{"requireInviteCode":true}` 即可启用，无需关闭邮箱注册或任何登录方式。
