import { formatAff } from "@/lib/credit-pricing";
import { dailyImageDay, type DailyImageBillingState, type DailyImagePolicy } from "@/lib/daily-image-pricing";

export function V45LimitDailyPriceTable({ policy, state, scrollClassName }: {
  policy: DailyImagePolicy;
  state?: DailyImageBillingState;
  scrollClassName: string;
}) {
  if (!policy.enabled || !policy.v45LimitDaily) return null;
  const { afterImages, baseAff, afterBaseAff } = policy.v45LimitDaily;
  const count = state?.day === dailyImageDay() ? state.counts.v45 : 0;
  const firstTier = !!state && count < afterImages;
  const nextTier = !!state && count >= afterImages;

  return (
    <div className={scrollClassName} tabIndex={0} role="region" aria-label="V4.5 Limit 小图每日阶梯表，可横向滚动">
      <table>
        <caption>V4.5 Limit 小图每日阶梯{state ? ` · 今日 V4.5 系列 ${count} 张` : ""}</caption>
        <thead><tr><th scope="col">当天第几张</th><th scope="col">小图基础费</th></tr></thead>
        <tbody>
          {afterImages > 0 && (
            <tr data-current-tier={firstTier || undefined}>
              <th scope="row">{afterImages === 1 ? "第 1 张" : `第 1–${afterImages} 张`}{firstTier && <small>下一张</small>}</th>
              <td>{formatAff(baseAff)} AFF / 张</td>
            </tr>
          )}
          <tr data-current-tier={nextTier || undefined}>
            <th scope="row">第 {afterImages + 1} 张起{nextTier && <small>下一张</small>}</th>
            <td>{formatAff(afterBaseAff)} AFF / 张</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
