---
name: visualisation
description: Create inline data visualisations in chat — charts, diagrams, flowcharts, SVG graphics, and interactive HTML visuals. Use when the user asks for visual representations of data, processes, or concepts, or when a visual would significantly enhance your response.
---

# Visualisation Skill

Create inline visual content directly in the chat using two tools: `create_visual` (preferred) and `create_visualisation` (legacy). Visualisations render in sandboxed iframes beneath your message.

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

**Example — Bar chart**:
```json
{
  "title": "Monthly Revenue",
  "mode": "chart",
  "chart_type": "bar",
  "data": "{\"labels\":[\"Jan\",\"Feb\",\"Mar\",\"Apr\"],\"datasets\":[{\"label\":\"Revenue ($k)\",\"data\":[120,150,180,210],\"backgroundColor\":[\"#6366f1\",\"#22d3ee\",\"#f97316\",\"#10b981\"]}]}",
  "options": "{\"scales\":{\"y\":{\"beginAtZero\":true}}}",
  "description": "Monthly revenue for Q1 2026"
}
```

**Tips**:
- Use THEME palette colours for datasets: `#6366f1` (indigo), `#22d3ee` (cyan), `#f97316` (orange), `#10b981` (emerald), `#f43f5e` (rose), `#a855f7` (purple), `#eab308` (yellow), `#ec4899` (pink)
- Dark theme is automatic — white text and gridlines are pre-configured
- Size limit: data + options combined must be under 20,000 characters

---

## create_visual — Code Mode

Use for custom diagrams, flowcharts, network graphs, interactive SVGs, or anything beyond standard charts.

**Parameters**:
- `title` (required): Display title
- `mode`: `"code"`
- `code` (required): JavaScript code string (max 30,000 chars)
- `description` (optional): Brief description

**Pre-loaded globals available in your code**:

| Global | Type | Description |
|---|---|---|
| `canvas` | HTMLCanvasElement | Canvas element for 2D drawing |
| `ctx` | CanvasRenderingContext2D | 2D context of the canvas |
| `svg` | SVGSVGElement | SVG element (viewBox 0 0 600 400) |
| `root` | HTMLDivElement | Div for arbitrary DOM content |
| `THEME` | Object | Dark theme colour palette |
| `Chart` | Class | Chart.js constructor |

**Helper functions**:

| Function | Description |
|---|---|
| `svgEl(tag, attrs)` | Create an SVG element with attributes |
| `svgText(text, x, y, attrs)` | Create an SVG text element with default styling |
| `resizeCanvas(w, h)` | Resize canvas with DPI awareness, returns `{width, height, dpr}` |

**THEME object**:
```javascript
THEME.bg        // '#1a1a2e'
THEME.text      // '#e0e0e0'
THEME.accent    // '#6366f1' (indigo)
THEME.secondary // '#22d3ee' (cyan)
THEME.tertiary  // '#f97316' (orange)
THEME.border    // 'rgba(255,255,255,0.1)'
THEME.palette   // Array of 8 colours
```

**Example — SVG flowchart**:
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

The HTML renders inside a sandboxed iframe with a dark background (#1a1a2e) and white text (#e0e0e0) already applied. Do not include `<html>`, `<head>`, or `<body>` tags — just the inner content.

---

## Best Practices

1. **Always use THEME colours** for consistency with the dark UI
2. **Keep payloads small** — smaller data = faster rendering
3. **Prefer chart mode** for standard charts — it's faster and more reliable than code mode
4. **Use code mode for diagrams** — SVG is ideal for flowcharts, network diagrams, architecture diagrams
5. **Test your JSON** — ensure `data` and `options` are valid JSON strings
6. **Add descriptions** — they help users understand the visual at a glance
7. **Use meaningful titles** — they appear in the header bar above the visualisation
