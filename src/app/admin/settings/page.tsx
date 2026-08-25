import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { SettingForm } from "./SettingForm";
import type { SettingDataType } from "@/lib/settingsValidation";

interface SettingRow {
  key: string;
  value: string;
  data_type: SettingDataType;
  description: string | null;
}

// Design Doc §12.1's table groupings — display-only, not a schema column.
const SETTING_CATEGORIES: Record<string, string> = {
  PRICE_SINGLE_PASS_STANDARD: "Pricing",
  PRICE_SINGLE_PASS_MEMBER: "Pricing",
  PRICE_PACK_5_STANDARD: "Pricing",
  PRICE_PACK_5_MEMBER: "Pricing",
  PRICE_PACK_10_MEMBER: "Pricing",
  MEMBERSHIP_ANNUAL_FEE: "Pricing",
  CANCELLATION_CUTOFF_HOURS: "Timing",
  BOOKING_WINDOW_ACCOUNT_DAYS: "Timing",
  BOOKING_WINDOW_MEMBER_DAYS: "Timing",
  SESSION_DEFAULT_CAPACITY: "Operations",
  MODEL_FLAT_PAY_RATE: "Operations",
  VOLUNTEER_WEEKLY_PASS_ALLOWANCE: "Operations",
  MEMBERSHIP_BONUS_PASSES: "Perks",
};

function categoryFor(key: string): string {
  return SETTING_CATEGORIES[key] ?? "General";
}

export default async function AdminSettingsPage() {
  const result = await pool.query<SettingRow>(
    `SELECT key, value, data_type, description FROM system_settings ORDER BY key`,
  );

  const grouped = new Map<string, SettingRow[]>();
  for (const row of result.rows) {
    const category = categoryFor(row.key);
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push(row);
  }
  const categoryOrder = ["Pricing", "Timing", "Operations", "Perks", "General"];
  const orderedCategories = [...grouped.keys()].sort(
    (a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b),
  );

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Settings</h1>
      <p>Changes apply immediately to future activity — historical transactions and already-spent ticket values are never retroactively altered.</p>

      {orderedCategories.map((category) => (
        <section key={category}>
          <h2>{category}</h2>
          {grouped.get(category)!.map((setting) => (
            <SettingForm
              key={setting.key}
              settingKey={setting.key}
              dataType={setting.data_type}
              value={setting.value}
              description={setting.description}
            />
          ))}
        </section>
      ))}
    </main>
    </>
  );
}
