import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { SiteNav } from "@/components/SiteNav";
import { unassignModelAction, setModelRequiredAction } from "./actions";
import { AssignModelForm } from "./AssignModelForm";
import { ORG_TIMEZONE } from "@/lib/org";

interface AssignedModel {
  id: string;
  name: string;
}

interface SessionRow {
  id: string;
  session_type: string;
  start_time: Date;
  host_username: string | null;
  model_required: boolean;
  assigned_models: AssignedModel[];
}

interface ModelOption {
  id: string;
  name: string;
}

export default async function ModelBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const ctx = await requireOpsRole(["VOL_MBR"]);
  if (!ctx) notFound();

  const { filter } = await searchParams;
  const showAll = filter === "all";

  const sessionsResult = await pool.query<SessionRow>(
    `SELECT s.id, s.session_type, s.start_time, u.username AS host_username, s.model_required,
            COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name))
                     FILTER (WHERE m.id IS NOT NULL), '[]') AS assigned_models
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     LEFT JOIN session_model_mapping smm ON smm.session_id = s.id
     LEFT JOIN models m ON m.id = smm.model_id
     WHERE s.status = 'Scheduled' AND s.start_time >= now() AND s.start_time <= now() + interval '60 days'
     GROUP BY s.id, s.session_type, s.start_time, u.username, s.model_required
     ORDER BY s.start_time`,
    [],
  );

  const modelsResult = await pool.query<ModelOption>(`SELECT id, name FROM models ORDER BY name`);

  const rows = showAll
    ? sessionsResult.rows
    : sessionsResult.rows.filter((s) => s.model_required && s.assigned_models.length === 0);

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Model booking</h1>
      <form>
        <label htmlFor="filter">Show</label>
        <select id="filter" name="filter" defaultValue={filter ?? "unassigned"}>
          <option value="unassigned">Needs a model</option>
          <option value="all">All upcoming sessions</option>
        </select>
        <button type="submit">Apply</button>
      </form>

      <div className="table-scroll">

        <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Type</th>
            <th>Host</th>
            <th>Model(s)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((session) => (
            <tr key={session.id}>
              <td>{new Date(session.start_time).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })}</td>
              <td>{session.session_type}</td>
              <td>{session.host_username ?? "Open"}</td>
              <td>
                {!session.model_required ? (
                  "Not required"
                ) : session.assigned_models.length === 0 ? (
                  "No model assigned"
                ) : (
                  <ul>
                    {session.assigned_models.map((model) => (
                      <li key={model.id}>
                        {model.name}
                        <form action={unassignModelAction} style={{ display: "inline" }}>
                          <input type="hidden" name="sessionId" value={session.id} />
                          <input type="hidden" name="modelId" value={model.id} />
                          <button type="submit">Unassign</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>
                {session.model_required ? (
                  <>
                    <AssignModelForm sessionId={session.id} models={modelsResult.rows} />
                    <form action={setModelRequiredAction}>
                      <input type="hidden" name="sessionId" value={session.id} />
                      <input type="hidden" name="required" value="false" />
                      <button type="submit">No model required</button>
                    </form>
                  </>
                ) : (
                  <form action={setModelRequiredAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <input type="hidden" name="required" value="true" />
                    <button type="submit">Actually, this needs a model</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </main>
    </>
  );
}
