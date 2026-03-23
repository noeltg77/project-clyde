---
name: visualisation
description: Create inline data visualisations in chat — charts, diagrams, flowcharts, SVG graphics, and interactive HTML visuals. Use when the user asks for visual representations of data, processes, or concepts, or when a visual would significantly enhance your response.
---

# Visualisation Skill

Create inline visual content directly in the chat using two tools: `create_visual` (preferred) and `create_visualisation` (legacy). Visualisations render in sandboxed iframes beneath your message.

## Rendering Environment

All visuals render inside a sandboxed iframe with these constraints. **You must design for this environment:**

- **Background**: `#1a1a2e` (dark) — already applied, do not set your own body background
- **Text colour**: `#e0e0e0` (light grey) — already applied
- **Body padding**: 16px on all sides — already applied
- **Max visible width**: ~700px (the iframe fills the chat message column)
- **Height**: Auto-sized from content, clamped between 100–800px. The iframe reports its own height to the parent frame
- **No network access**: The iframe is fully sandboxed. All resources (Chart.js, fonts) are pre-loaded. Do not use external URLs, CDN links, or fetch()
- **No parent access**: sandbox="allow-scripts" only — no cookies, no DOM access to the parent page

## When to Use

- User asks for a chart, graph, diagram, flowchart, or visual representation
- Data would be significantly clearer as a visual than as text/tables
- User asks you to "show", "draw", "plot", "visualise", or "diagram" something

## Tool Selection

| Scenario | Tool | Mode |
|---|---|---|
| Standard chart (bar, line, pie, scatter, etc.) | `create_visual` | `chart` |
| Custom diagram, flowchart, interactive SVG | `create_visual` | `code` |
| Complex full-page HTML layout, rich formatting | `create_visualisation` | — |

**Always prefer `create_visual` over `create_visualisation`** unless you need full HTML control.

---

## create_visual — Chart Mode

Use for standard Chart.js charts. Provide a chart type, data object, and optional options.

**Supported chart_type values**: `bar`, `line`, `pie`, `doughnut`, `scatter`, `radar`, `polarArea`, `bubble`

**Parameters**:
- `title` (required): Display title above the chart
- `mode`: `"chart"`
- `chart_type` (required): One of the supported types above
- `data` (required): Chart.js data object as JSON string — `{"labels": [...], "datasets": [...]}`
- `options` (optional): Chart.js options object as JSON string
- `description` (optional): Brief description of what the chart shows

### CRITICAL: Chart.js Responsive Formatting

The canvas lives inside a `<div id="chart-container">` with `position: relative` and `width: 100%`. Chart.js is configured with `responsive: true` and `maintainAspectRatio: true` by default. **You MUST follow these rules for charts to render correctly:**

1. **Always include `responsive: true` and `maintainAspectRatio: true`** in your options (these are applied by default but never override them to false)
2. **Always set `plugins.legend.position`** explicitly (e.g. `"top"`, `"bottom"`, `"right"`) — do not leave it unset
3. **Always set `plugins.legend.labels.color`** to `"#e0e0e0"` for readability on the dark background
4. **For axes**: Always set `ticks.color: "#e0e0e0"` and `grid.color: "rgba(255,255,255,0.1)"` on every axis
5. **For axis titles**: Set `title.display: true`, `title.color: "#e0e0e0"` if using axis labels
6. **Never set explicit pixel dimensions** on the chart — let responsive mode handle sizing
7. **Use `padding`** in `options.layout.padding` if the chart feels cramped (e.g. `{"top": 10, "bottom": 10, "left": 10, "right": 10}`)
8. **For pie/doughnut charts**: Use `plugins.legend.position: "bottom"` to prevent the legend from being clipped

### Recommended Options Template

Always include this as a baseline in your options and extend from it:

```json
{
  "responsive": true,
  "maintainAspectRatio": true,
  "layout": {
    "padding": {"top": 10, "bottom": 10, "left": 10, "right": 10}
  },
  "plugins": {
    "legend": {
      "position": "top",
      "labels": {
        "color": "#e0e0e0",
        "padding": 16,
        "usePointStyle": true
      }
    },
    "tooltip": {
      "backgroundColor": "rgba(0,0,0,0.8)",
      "titleColor": "#ffffff",
      "bodyColor": "#e0e0e0",
      "borderColor": "rgba(255,255,255,0.1)",
      "borderWidth": 1
    }
  },
  "scales": {
    "x": {
      "ticks": {"color": "#e0e0e0"},
      "grid": {"color": "rgba(255,255,255,0.1)"},
      "title": {"display": false, "color": "#e0e0e0"}
    },
    "y": {
      "ticks": {"color": "#e0e0e0"},
      "grid": {"color": "rgba(255,255,255,0.1)"},
      "title": {"display": false, "color": "#e0e0e0"},
      "beginAtZero": true
    }
  }
}
```

**Note**: For pie, doughnut, radar, and polarArea chart types, **do NOT include the `scales` object** — these chart types do not use axes and will error if scales are provided.

### Example — Bar chart

```json
{
  "title": "Monthly Revenue",
  "mode": "chart",
  "chart_type": "bar",
  "data": "{\"labels\":[\"Jan\",\"Feb\",\"Mar\",\"Apr\"],\"datasets\":[{\"label\":\"Revenue ($k)\",\"data\":[120,150,180,210],\"backgroundColor\":[\"#6366f1\",\"#22d3ee\",\"#f97316\",\"#10b981\"],\"borderRadius\":4}]}",
  "options": "{\"responsive\":true,\"maintainAspectRatio\":true,\"layout\":{\"padding\":{\"top\":10,\"bottom\":10}},\"plugins\":{\"legend\":{\"position\":\"top\",\"labels\":{\"color\":\"#e0e0e0\",\"usePointStyle\":true}},\"tooltip\":{\"backgroundColor\":\"rgba(0,0,0,0.8)\",\"titleColor\":\"#ffffff\",\"bodyColor\":\"#e0e0e0\"}},\"scales\":{\"x\":{\"ticks\":{\"color\":\"#e0e0e0\"},\"grid\":{\"color\":\"rgba(255,255,255,0.1)\"}},\"y\":{\"beginAtZero\":true,\"ticks\":{\"color\":\"#e0e0e0\"},\"grid\":{\"color\":\"rgba(255,255,255,0.1)\"}}}}",
  "description": "Monthly revenue for Q1 2026"
}
```

### Colour Palette

Use these THEME colours for datasets — they are designed for dark backgrounds:

| Colour | Hex | Usage |
|---|---|---|
| Indigo | `#6366f1` | Primary / accent |
| Cyan | `#22d3ee` | Secondary |
| Orange | `#f97316` | Tertiary / warnings |
| Emerald | `#10b981` | Success / positive |
| Rose | `#f43f5e` | Error / negative |
| Purple | `#a855f7` | Supplementary |
| Yellow | `#eab308` | Highlight |
| Pink | `#ec4899` | Supplementary |

For `backgroundColor` on bar/pie charts, use solid hex values. For `borderColor` on line charts, use solid hex. For `fill` areas on line charts, use rgba versions with low opacity (e.g. `rgba(99,102,241,0.15)`).

---

## create_visual — Code Mode

Use for custom diagrams, flowcharts, network graphs, interactive SVGs, or anything beyond standard charts.

**Parameters**:
- `title` (required): Display title
- `mode`: `"code"`
- `code` (required): JavaScript code string (max 30,000 chars)
- `description` (optional): Brief description

### Pre-loaded Globals

| Global | Type | Description |
|---|---|---|
| `canvas` | HTMLCanvasElement | Inside `<div id="chart-container">` — hidden by default in code mode |
| `ctx` | CanvasRenderingContext2D | 2D context of the canvas |
| `svg` | SVGSVGElement | SVG element (viewBox 0 0 600 400) — visible by default |
| `root` | HTMLDivElement | Div for arbitrary DOM content — hidden by default |
| `THEME` | Object | Dark theme colour palette (see below) |
| `Chart` | Class | Chart.js constructor (available but optional) |

### Helper Functions

| Function | Description |
|---|---|
| `svgEl(tag, attrs)` | Create an SVG element with attributes |
| `svgText(text, x, y, attrs)` | Create an SVG text element with default styling |
| `resizeCanvas(w, h)` | Resize canvas with DPI awareness, returns `{width, height, dpr}` |

### Code Mode Responsive Rules

1. **SVG mode**: The SVG has `viewBox="0 0 600 400"` and `max-width: 100%` — it scales automatically. Design your SVG content within the 600×400 coordinate space. If you need a taller SVG, update the viewBox and height: `svg.setAttribute('viewBox', '0 0 600 600'); svg.setAttribute('height', '600');`
2. **Canvas mode**: Call `resizeCanvas(w, h)` to set the canvas size with DPI awareness. The canvas is inside a container div. Show it first: `canvas.style.display='block';`
3. **DOM mode**: Show the root div first: `root.style.display='block';` Then append elements to `root`. Use `width: 100%` on elements for responsiveness.
4. **To use Chart.js in code mode**: Show the canvas, then create a chart: `canvas.style.display='block'; new Chart(canvas, { type: 'bar', data: {...}, options: {...} });`
5. **Height auto-sizes**: The iframe reports its scrollHeight. Ensure all content is visible (not overflow:hidden) so the height is reported correctly.

### THEME Object

```javascript
THEME.bg        // '#1a1a2e'
THEME.text      // '#e0e0e0'
THEME.accent    // '#6366f1' (indigo)
THEME.secondary // '#22d3ee' (cyan)
THEME.tertiary  // '#f97316' (orange)
THEME.border    // 'rgba(255,255,255,0.1)'
THEME.palette   // ['#6366f1','#22d3ee','#f97316','#10b981','#f43f5e','#a855f7','#eab308','#ec4899']
```

### Example — SVG Flowchart

```json
{
  "title": "User Onboarding Flow",
  "mode": "code",
  "code": "svg.style.display='block';\nvar box=function(x,y,w,h,label,color){\n  var r=svgEl('rect',{x:String(x),y:String(y),width:String(w),height:String(h),rx:'8',fill:color,stroke:THEME.border,'stroke-width':'1'});\n  svg.appendChild(r);\n  svg.appendChild(svgText(label,x+w/2,y+h/2+4,{'text-anchor':'middle','font-weight':'600'}));\n};\nvar arrow=function(x1,y1,x2,y2){\n  svg.appendChild(svgEl('line',{x1:String(x1),y1:String(y1),x2:String(x2),y2:String(y2),stroke:THEME.text,'stroke-width':'2','marker-end':'url(#arrowhead)'}));\n};\nvar defs=svgEl('defs');\nvar marker=svgEl('marker',{id:'arrowhead',markerWidth:'10',markerHeight:'7',refX:'10',refY:'3.5',orient:'auto'});\nmarker.appendChild(svgEl('polygon',{points:'0 0, 10 3.5, 0 7',fill:THEME.text}));\ndefs.appendChild(marker);\nsvg.appendChild(defs);\nbox(200,20,200,50,'Sign Up',THEME.accent);\narrow(300,70,300,100);\nbox(200,100,200,50,'Verify Email',THEME.secondary);\narrow(300,150,300,180);\nbox(200,180,200,50,'Complete Profile',THEME.tertiary);\narrow(300,230,300,260);\nbox(200,260,200,50,'Dashboard',THEME.palette[3]);",
  "description": "Four-step onboarding flow diagram"
}
```

---

## create_visualisation (Legacy)

Use only when you need full HTML control — complex layouts, embedded CSS animations, multi-section pages.

**Parameters**:
- `title` (required): Display title
- `html_content` (required): Complete HTML/CSS/SVG content (max 50,000 chars)
- `description` (optional): Brief description

The HTML renders inside a sandboxed iframe with dark background and white text already applied. **Do not include `<html>`, `<head>`, or `<body>` tags** — just the inner content. The body already has 16px padding.

### Legacy Mode Responsive Rules

1. Use `width: 100%` or `max-width: 100%` on root elements — the iframe is ~700px wide
2. Do not set fixed widths larger than 650px
3. Use relative units (%, em, rem) instead of fixed px where possible
4. SVGs should have a `viewBox` and `max-width: 100%` for responsive scaling
5. The iframe height auto-sizes — do not use `overflow: hidden` on your content

---

## Best Practices

1. **Always use the recommended options template** for chart mode — it ensures proper dark theme styling, readable labels, and correct responsive behaviour
2. **Always use THEME colours** — they are designed for the dark background
3. **Never hardcode white (#ffffff) for text** — use `#e0e0e0` (THEME.text) instead
4. **Keep payloads small** — smaller data = faster rendering
5. **Prefer chart mode** for standard charts — it handles responsive sizing automatically
6. **Use code mode for diagrams** — SVG with viewBox is ideal for flowcharts, network diagrams, architecture diagrams
7. **Test your JSON** — ensure `data` and `options` are valid JSON strings
8. **Add descriptions** — they help users understand the visual at a glance
9. **Use meaningful titles** — they appear in the header bar above the visualisation
10. **Do not use external resources** — no CDN links, no fetch(), no external images. Everything must be inline.

## Common Mistakes to Avoid

- **Missing axis colours**: Forgetting `ticks.color` and `grid.color` makes labels invisible on dark background
- **Omitting legend config**: Unpositioned legends can overlap the chart or get clipped
- **Using scales with pie/doughnut**: These chart types do not use axes — omit the `scales` object entirely
- **Fixed pixel widths**: Using `width: 800px` breaks the layout — use `100%` or let Chart.js responsive mode handle it
- **Using `overflow: hidden` in custom HTML**: This prevents the iframe from reporting its true height, causing content to be clipped
