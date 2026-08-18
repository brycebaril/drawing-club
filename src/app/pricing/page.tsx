import { getSettingNumber } from "@/lib/settings";
import { SiteNav } from "@/components/SiteNav";

function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}

function perTicket(total: number, count: number): string {
  return `${formatPrice(total / count)}/ticket`;
}

/**
 * Reads prices live from system_settings — the exact values resolvePrice()
 * uses at checkout (src/lib/payments/pricing.ts) — rather than CMS-authored
 * Markdown. A hand-typed price table would silently drift the moment an
 * admin changes a price in /admin/settings; this page can't drift, because
 * it's reading the same source of truth checkout does.
 */
export default async function PricingPage() {
  const [singleStandard, singleMember, pack5Standard, pack5Member, pack10Member, membershipFee] =
    await Promise.all([
      getSettingNumber("PRICE_SINGLE_PASS_STANDARD"),
      getSettingNumber("PRICE_SINGLE_PASS_MEMBER"),
      getSettingNumber("PRICE_PACK_5_STANDARD"),
      getSettingNumber("PRICE_PACK_5_MEMBER"),
      getSettingNumber("PRICE_PACK_10_MEMBER"),
      getSettingNumber("MEMBERSHIP_ANNUAL_FEE"),
    ]);

  return (
    <>
      <SiteNav />
      <main>
        <h1>Pricing</h1>
        <p>
          All studio sessions require a session ticket (or valid pass), pre-purchased and pre-registered
          online — there are no studio drop-in sales.
        </p>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Non-member</th>
                <th>Member</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Single session</td>
                <td>{formatPrice(singleStandard)}</td>
                <td>{formatPrice(singleMember)}</td>
              </tr>
              <tr>
                <td>5-pack</td>
                <td>
                  {formatPrice(pack5Standard)} ({perTicket(pack5Standard, 5)})
                </td>
                <td>
                  {formatPrice(pack5Member)} ({perTicket(pack5Member, 5)})
                </td>
              </tr>
              <tr>
                <td>10-pack</td>
                <td>Members only</td>
                <td>
                  {formatPrice(pack10Member)} ({perTicket(pack10Member, 10)})
                </td>
              </tr>
              <tr>
                <td>Annual membership</td>
                <td colSpan={2}>{formatPrice(membershipFee)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
