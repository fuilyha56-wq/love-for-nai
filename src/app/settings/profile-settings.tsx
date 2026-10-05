"use client";

import Link from "next/link";
import { ArrowUpRight, LockKeyhole, UserRound, WalletCards } from "lucide-react";

export default function ProfileSettings() {
  return <div className="settings-profile-links">
    <article className="panel rounded-md p-5 sm:p-6">
      <div className="settings-profile-link-heading">
        <span className="settings-profile-icon"><UserRound size={18} /></span>
        <div>
          <h3 className="font-semibold">个人资料中心</h3>
          <p>用户名、显示名称、邮箱和登录状态统一在个人资料中心管理。</p>
        </div>
      </div>
      <div className="settings-profile-link-grid">
        <Link href="/profile#profile-info" className="settings-secondary-button">
          <UserRound size={15} /> 编辑个人资料 <ArrowUpRight size={14} />
        </Link>
        <Link href="/profile#profile-security" className="settings-secondary-button">
          <LockKeyhole size={15} /> 密码与安全 <ArrowUpRight size={14} />
        </Link>
      </div>
    </article>
    <article className="panel rounded-md p-5 sm:p-6">
      <div className="settings-profile-link-heading">
        <span className="settings-profile-icon"><WalletCards size={18} /></span>
        <div>
          <h3 className="font-semibold">账户、奖励与创作额度</h3>
          <p>查看 NewAPI 余额、LFN AFF、签到、邀请、图包和钱包操作。</p>
        </div>
      </div>
      <Link href="/account" className="settings-primary-button mt-5">
        打开我的账号 <ArrowUpRight size={14} />
      </Link>
    </article>
  </div>;
}
