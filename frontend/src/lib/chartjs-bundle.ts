/**
 * Chart.js UMD bundle loader — fetches and caches the Chart.js source
 * as a raw string for inlining into sandboxed iframe <script> tags.
 *
 * The bundle is fetched exactly once and held in module scope.
 * Concurrent callers share the same in-flight promise (no duplicate fetches).
 */

let _cachedSource: string | null = null;
let _loadingPromise: Promise<string> | null = null;

export async function getChartJsSource(): Promise<string> {
  if (_cachedSource) return _cachedSource;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = fetch("/vendor/chart.umd.min.js")
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load Chart.js: ${res.status}`);
      return res.text();
    })
    .then((text) => {
      _cachedSource = text;
      _loadingPromise = null;
      return text;
    })
    .catch((err) => {
      _loadingPromise = null;
      throw err;
    });

  return _loadingPromise;
}
