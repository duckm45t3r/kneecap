import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Wave 3.2 R5 — chart MVP. The LLM emits chart specs as fenced code blocks
 * with language `chart` containing JSON:
 *
 *   ```chart
 *   {"type":"bar","title":"Q1-Q4 revenue achievement","data":[{"label":"Q1","value":34}]}
 *   ```
 *
 * react-markdown's components prop swaps those blocks for <ChartRenderer/>.
 * Bar / line / pie supported; fall through to a tagged-pre block on parse
 * failure so the user sees the raw JSON rather than a silent hole.
 */

export type ChartSpec = {
  type: "bar" | "line" | "pie";
  title: string;
  data: { label: string; value: number }[];
};

const PIE_COLORS = [
  "var(--vhs-gold)",
  "var(--vhs-teal)",
  "var(--vhs-crimson)",
  "var(--vhs-paper-dim)",
  "var(--vhs-gold-dim)",
  "var(--vhs-teal-deep)",
  "var(--vhs-crimson-dim)",
];

export function ChartRenderer({ spec }: { spec: ChartSpec }) {
  if (!spec || !Array.isArray(spec.data) || spec.data.length === 0) {
    return null;
  }
  return (
    <div className="kn-chart">
      <h4 className="kn-chart-title">{spec.title}</h4>
      <ResponsiveContainer width="100%" height={240}>
        {spec.type === "bar" ? (
          <BarChart data={spec.data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="var(--vhs-hairline)" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="var(--vhs-paper-mute)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--vhs-paper-mute)" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: "var(--vhs-ink-3)",
                border: "1px solid var(--vhs-hairline)",
                fontSize: 12,
              }}
            />
            <Bar dataKey="value" fill="var(--vhs-gold)" />
          </BarChart>
        ) : spec.type === "line" ? (
          <LineChart data={spec.data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="var(--vhs-hairline)" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="var(--vhs-paper-mute)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--vhs-paper-mute)" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: "var(--vhs-ink-3)",
                border: "1px solid var(--vhs-hairline)",
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--vhs-teal)"
              strokeWidth={2}
              dot={{ fill: "var(--vhs-teal)", r: 3 }}
            />
          </LineChart>
        ) : (
          <PieChart>
            <Tooltip
              contentStyle={{
                background: "var(--vhs-ink-3)",
                border: "1px solid var(--vhs-hairline)",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "var(--vhs-paper-mute)" }} />
            <Pie
              data={spec.data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label
            >
              {spec.data.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
