"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, ChevronDown, ChevronUp, Download, Code } from "lucide-react";
import { getChartJsSource } from "@/lib/chartjs-bundle";
import type { VisualConfig } from "@/stores/chat-store";

// THEME object injected into every iframe
const THEME_JS = `var THEME={
  bg:'#1a1a2e',text:'#e0e0e0',
  accent:'#6366f1',secondary:'#22d3ee',tertiary:'#f97316',
  border:'rgba(255,255,255,0.1)',
  palette:['#6366f1','#22d3ee','#f97316','#10b981','#f43f5e','#a855f7','#eab308','#ec4899']
};`;

// Helper functions available in every iframe
const HELPERS_JS = `
function svgEl(tag,attrs){
  var el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  if(attrs)Object.keys(attrs).forEach(function(k){el.setAttribute(k,attrs[k]);});
  return el;
}
function svgText(text,x,y,attrs){
  var el=svgEl('text',Object.assign({x:String(x),y:String(y),fill:THEME.text,'font-size':'12','font-family':'-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif'},attrs||{}));
  el.textContent=text;
  return el;
}
function resizeCanvas(w,h){
  var dpr=window.devicePixelRatio||1;
  canvas.width=w*dpr;canvas.height=h*dpr;
  canvas.style.width=w+'px';canvas.style.height=h+'px';
  ctx.scale(dpr,dpr);
  return {width:w,height:h,dpr:dpr};
}`;

function buildIframeSrcDoc(
  visId: string,
  chartJsSource: string,
  visual: VisualConfig
): string {
  const configJson = JSON.stringify({
    mode: visual.mode,
    chartType: visual.chartType,
    data: visual.data,
    options: visual.options,
  });

  let executionBlock = "";
  if (visual.mode === "chart") {
    executionBlock = `
      svg.style.display='none';
      root.style.display='none';
      canvas.style.display='block';
      _chartInstance=new Chart(canvas,{
        type:CONFIG.chartType,
        data:CONFIG.data,
        options:Object.assign({responsive:true,maintainAspectRatio:true},CONFIG.options||{})
      });`;
  } else {
    // Code mode — inject agent's JS directly
    executionBlock = `
      canvas.style.display='none';
      ${visual.code || ""}`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px}
canvas{display:block;max-width:100%}
svg{display:block;max-width:100%;height:auto}
#root{display:none}</style></head><body>
<canvas id="canvas" width="600" height="400"></canvas>
<svg id="svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400"></svg>
<div id="root"></div>
<script>${chartJsSource}</script>
<script>
${THEME_JS}
${HELPERS_JS}
var canvas=document.getElementById('canvas');
var ctx=canvas.getContext('2d');
var svg=document.getElementById('svg');
var root=document.getElementById('root');
var CONFIG=${configJson};
var _chartInstance=null;

Chart.defaults.color='#e0e0e0';
Chart.defaults.borderColor='rgba(255,255,255,0.1)';

try{
  ${executionBlock}
}catch(err){
  root.style.display='block';
  var errDiv=document.createElement('div');
  errDiv.style.cssText='color:#f43f5e;padding:16px;font-size:13px;';
  errDiv.textContent='Render error: '+(err.message||String(err));
  root.appendChild(errDiv);
}
</script>
<script>
(function(){
  var id='${visId}';
  function reportHeight(){
    var h=document.body.scrollHeight;
    // Also check canvas bounding rect in case it's larger than scrollHeight
    var cvs=document.getElementById('canvas');
    if(cvs&&cvs.style.display!=='none'){
      var r=cvs.getBoundingClientRect();
      var ch=r.bottom+16; // include bottom padding
      if(ch>h)h=ch;
    }
    // Check SVG bounding rect
    var s=document.getElementById('svg');
    if(s&&s.style.display!=='none'){
      var sr=s.getBoundingClientRect();
      var sh=sr.bottom+16;
      if(sh>h)h=sh;
    }
    parent.postMessage({type:'vis-height',id:id,height:Math.ceil(h)},'*');
  }
  reportHeight();
  // Re-report after Chart.js finishes rendering (async)
  setTimeout(reportHeight,100);
  setTimeout(reportHeight,500);
  new ResizeObserver(function(){
    requestAnimationFrame(reportHeight);
  }).observe(document.body);
  if(document.getElementById('canvas'))
    new ResizeObserver(function(){requestAnimationFrame(reportHeight);}).observe(document.getElementById('canvas'));
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='capture-png'||e.data.id!==id)return;
    var dataUrl=null;
    if(_chartInstance){
      dataUrl=_chartInstance.toBase64Image('image/png',1);
    }else if(canvas.style.display!=='none'&&(canvas.width>0&&canvas.height>0)){
      dataUrl=canvas.toDataURL('image/png');
    }else{
      var body=document.body;
      var w=body.scrollWidth,h=body.scrollHeight,dpr=2;
      var c=document.createElement('canvas');
      c.width=w*dpr;c.height=h*dpr;
      var cx=c.getContext('2d');
      cx.scale(dpr,dpr);
      cx.fillStyle='#1a1a2e';
      cx.fillRect(0,0,w,h);
      var svgs=document.querySelectorAll('svg');
      if(svgs.length>0){
        var promises=[];
        svgs.forEach(function(s){
          var rect=s.getBoundingClientRect();
          var xml=new XMLSerializer().serializeToString(s);
          var blob=new Blob([xml],{type:'image/svg+xml;charset=utf-8'});
          var url=URL.createObjectURL(blob);
          var img=new Image();
          var p=new Promise(function(resolve){
            img.onload=function(){cx.drawImage(img,rect.left,rect.top,rect.width,rect.height);URL.revokeObjectURL(url);resolve();};
            img.onerror=function(){URL.revokeObjectURL(url);resolve();};
          });
          img.src=url;
          promises.push(p);
        });
        Promise.all(promises).then(function(){
          parent.postMessage({type:'capture-result',id:id,dataUrl:c.toDataURL('image/png')},'*');
        });
        return;
      }
      dataUrl=c.toDataURL('image/png');
    }
    if(dataUrl)parent.postMessage({type:'capture-result',id:id,dataUrl:dataUrl},'*');
  });
})();
</script></body></html>`;
}

interface Props {
  visual: VisualConfig;
}

export const VisualBlock = memo(function VisualBlock({ visual }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(300);
  const [isVisible, setIsVisible] = useState(false);
  const [chartJsLoaded, setChartJsLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const chartJsRef = useRef<string>("");

  // Lazy loading via IntersectionObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load Chart.js bundle when visible
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    getChartJsSource().then((src) => {
      if (!cancelled) {
        chartJsRef.current = src;
        setChartJsLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isVisible]);

  // Build blob URL when Chart.js is loaded
  useEffect(() => {
    if (!chartJsLoaded) return;
    const html = buildIframeSrcDoc(visual.id, chartJsRef.current, visual);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    if (iframeRef.current) {
      iframeRef.current.src = url;
    }
    return () => URL.revokeObjectURL(url);
  }, [chartJsLoaded, visual]);

  // Listen for height reports and capture results
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.id !== visual.id) return;

      if (e.data.type === "vis-height") {
        const h = Math.min(Math.max(e.data.height, 100), 800);
        setIframeHeight(h);
      } else if (e.data.type === "capture-result" && e.data.dataUrl) {
        const a = document.createElement("a");
        a.href = e.data.dataUrl;
        a.download = `${visual.title || "visual"}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [visual.id, visual.title]);

  const handleDownloadHtml = useCallback(() => {
    if (!chartJsLoaded) return;
    const html = buildIframeSrcDoc(visual.id, chartJsRef.current, visual);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${visual.title || "visual"}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [chartJsLoaded, visual]);

  const handleCapturePng = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "capture-png", id: visual.id },
      "*"
    );
  }, [visual.id]);

  return (
    <div
      ref={containerRef}
      className="mt-3 border border-border rounded-[2px] overflow-hidden bg-bg-secondary"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-bg-tertiary border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 size={14} className="text-accent-primary shrink-0" />
          <span className="text-xs font-semibold text-text-primary truncate">
            {visual.title}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleDownloadHtml}
            className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-[2px] border border-border text-text-secondary hover:text-accent-primary hover:border-accent-primary transition-colors"
          >
            <Code size={12} />
          </button>
          <button
            onClick={handleCapturePng}
            className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-[2px] border border-border text-text-secondary hover:text-accent-primary hover:border-accent-primary transition-colors"
          >
            <Download size={12} />
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-[2px] border border-border text-text-secondary hover:text-accent-primary hover:border-accent-primary transition-colors"
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        </div>
      </div>

      {/* Content */}
      {!collapsed && (
        <div style={{ height: iframeHeight }}>
          {isVisible && chartJsLoaded ? (
            <iframe
              ref={iframeRef}
              sandbox="allow-scripts"
              style={{ width: "100%", height: "100%", border: "none" }}
              title={visual.title}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-secondary text-xs">
              Loading visualization...
            </div>
          )}
        </div>
      )}
    </div>
  );
});
