import { notFound } from "next/navigation";
import { Badge, Card } from "../../../src/components/ui";
import { adminOverview, isAdmin, shortloopUsage } from "../../../src/server/access";
import { requireUser } from "../../../src/server/auth";

export const dynamic = "force-dynamic";

const date = (iso: string) =>
  new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

/** Admins only (ADMIN_EMAILS). Everyone else gets a 404. */
export default async function AdminPage() {
  const user = await requireUser();
  if (!(await isAdmin(user.id))) notFound();
  const [o, ai] = await Promise.all([adminOverview(), shortloopUsage()]);
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return (
    <div className="space-y-6" data-testid="admin">
      <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
      <Card>
        <h2 className="font-semibold">Beta access codes</h2>
        {o.codes.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            No codes configured. Set SHORTLOOP_ACCESS_CODES (e.g. CODE:25) on the server.
          </p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm" data-testid="admin-codes">
            {o.codes.map((c) => (
              <li key={c.code}>
                <code className="rounded bg-paper px-1.5 py-0.5">{c.code}</code>: {c.used} of {c.maxUses} used
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card data-testid="admin-ai">
        <h2 className="flex items-center gap-2 font-semibold">
          ShortLoop AI {ai.enabled ? <Badge tone="good">on</Badge> : <Badge>off</Badge>}
        </h2>
        <p className="mt-2 text-sm">
          Today {usd(ai.todayUsd)} of {usd(ai.dailyBudgetUsd)} daily budget · this month {usd(ai.monthUsd)}
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          Estimated from list prices. Switch off with MANAGED_AI_ENABLED; budget MANAGED_AI_DAILY_BUDGET_USD.
        </p>
        {ai.users.length > 0 && (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="pb-2 font-medium">Top users this month</th>
                <th className="pb-2 font-medium">Calls</th>
                <th className="pb-2 font-medium">Spend</th>
              </tr>
            </thead>
            <tbody data-testid="admin-ai-users">
              {ai.users.map((u) => (
                <tr key={u.ownerId} className="border-t border-line">
                  <td className="py-2 pr-2">{u.email ?? u.ownerId}</td>
                  <td className="py-2 pr-2">{u.calls}</td>
                  <td className="py-2">{usd(u.monthUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <h2 className="font-semibold">Users ({o.users.length})</h2>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-ink-soft">
            <tr>
              <th className="pb-2 font-medium">Email</th>
              <th className="pb-2 font-medium">Access</th>
              <th className="pb-2 font-medium">Projects</th>
              <th className="pb-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody data-testid="admin-users">
            {o.users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="py-2 pr-2">{u.email}</td>
                <td className="py-2 pr-2">
                  {u.role === "admin" ? (
                    <Badge tone="brand">admin</Badge>
                  ) : u.accessCode ? (
                    <Badge tone="good">beta</Badge>
                  ) : (
                    <Badge>free</Badge>
                  )}
                </td>
                <td className="py-2 pr-2">{u.projects}</td>
                <td className="py-2">{date(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
