# 账号、签到与自动化接入

## 网页签到与额度

登录后打开[我的账号](/profile)，在签到区域查看今天是否已签到和当前奖励，点击签到即可领取管理员配置的个人 AFF。签到按北京时间日期判断，同一天重复提交不会再次发奖；关闭签到时返回的奖励为 0。

图包 AFF、个人 AFF 和 NewAPI 余额分别显示，不是同一种余额。购买图包与兑换码入口受站点能力和配置影响。LFN 兑换码增加个人 AFF，NewAPI 兑换码由 NewAPI 核验并增加其余额，请保留兑换码原有大小写。

## “免登录”具体可以做什么

| 凭据或状态 | 可以做什么 | 不能因此获得什么 |
| --- | --- | --- |
| 无凭据 | 阅读公开文档、访问公开广场 | 私有历史、签到、出图额度 |
| NewAPI 图像 API Key | 直接调用 /v1、/ai 出图和兼容摘要，无需浏览器登录 | LfN 网页会话、签到和账户管理 |
| 已登录 LfN Cookie | 按账号权限使用 /api/wallet、签到、私有历史和投稿 | 管理员权限或上游账号秘密 |
| NewAPI 系统访问令牌 | 站点允许时通过令牌登录换取 LfN 会话 | 不能直接当作 sk- 图像密钥使用 |

目前没有“只带图像 API Key 的签到端点”。`POST /api/aff/check-in` 只读取有效登录会话，单独发送 Bearer 图像 Key 会得到 401。客户端的“免网页登录出图”与“匿名签到”不是同一项能力。

## 外部工具能否签到

可以在自己控制的 curl、Postman、Bruno 或 Python HTTP 会话中，完成正常登录后携带本站 Cookie 调用签到。它们是通用 HTTP 工具，无需专门获准的客户端名称；仍需遵守账号权限、两步验证、会话有效期和站点限制。本站没有自动授予任意插件签到权限，也没有保证某个第三方打卡插件已适配。

有会话 Cookie 文件时，最小请求为：

```bash
curl --fail-with-body -b lfn-cookies.txt \
  "$LFN_BASE_URL/api/wallet"
curl --fail-with-body -X POST -b lfn-cookies.txt \
  "$LFN_BASE_URL/api/aff/check-in"
```

`lfn-cookies.txt` 必须来自你自己对同一站点的有效登录，格式为 curl Cookie jar。更换域名、Cookie 过期或会话撤销后需重新登录。不要把 Cookie 发给不信任的托管签到服务。

## 用工具完成正常登录

1. `GET /api/auth/policy` 查看当前允许的方式；密码或令牌登录关闭时不能通过直调接口绕过。
2. 密码登录使用 `POST /api/auth/login`，JSON 为 `{"username":"你的用户名","password":"你的密码","remember":false}`；保存响应 Cookie。
3. 若返回 `twoFactorRequired=true`，继续使用同一个 Cookie jar 调用 `POST /api/auth/2fa`，JSON 为 `{"code":"本次验证码"}`。临时会话过期后重新开始。
4. 若启用系统令牌登录，可用 `POST /api/auth/token` 和 `{"token":"NewAPI系统访问令牌","remember":false}` 换取 Cookie；本地账号模式不支持这个方式。它不是图像 API Key 登录。
5. 请求 `GET /api/wallet` 确认有效会话，再调用签到。不要只根据登录接口 HTTP 200 就判断两步验证已完成。

例如，把登录 JSON 保存在权限受控的 `login.json` 后执行：

```bash
curl --fail-with-body -c lfn-cookies.txt -b lfn-cookies.txt \
  "$LFN_BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' --data-binary @login.json
```

不要上传 `login.json` 或 Cookie 文件。两步验证按账号正常流程完成，不提供绕过方法。自动化定时调度由你自己的工具安排，当前接口只负责本次签到；401 时应停止并重新认证，不能持续重试密码。

## 签到响应如何判断

响应包含 `success`、`balance`、`packageBalance`、`totalBalance`、`reward`、`checkedInToday`、`checkInEnabled`。当日重复签到可能仍成功但 `reward=0`；开关关闭时 `checkInEnabled=false`，不要把 HTTP 200 理解成一定发放了奖励。

网页登录“保持登录”仍会受管理员清理、闲置撤销、密码修改及会话策略影响。请求仅用于自己的账号；后台管理操作另需管理员会话。
