"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, ChevronDown, ChevronUp, Download, Code } from "lucide-react";
import type { VisualizationData } from "@/stores/chat-store";

// Pre-compiled HTML template — boilerplate built once, only dynamic content injected
const HTML_TEMPLATE_PREFIX = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px}
svg{max-width:100%;height:auto}</style></head><body>`;

const HTML_TEMPLATE_SUFFIX = `<script>
(function(){
  var id='%%VIS_ID%%';
  function reportHeight(){
    var h=document.body.scrollHeight;
    parent.postMessage({type:'vis-height',id:id,height:h},'*');
  }
  reportHeight();
  new ResizeObserver(function(){
    requestAnimationFrame(reportHeight);
  }).observe(document.body);
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='capture-png'||e.data.id!==id)return;
    var body=document.body;
    var w=body.scrollWidth,h=body.scrollHeight,dpr=2;
    var c=document.createElement('canvas');
    c.width=w*dpr;c.height=h*dpr;
    var ctx=c.getContext('2d');
    ctx.scale(dpr,dpr);
    ctx.fillStyle='#1a1a2e';
    ctx.fillRect(0,0,w,h);
    var svgs=document.querySelectorAll('svg');
    if(svgs.length>0){
      var promises=[];
      svgs.forEach(function(svg){
        var rect=svg.getBoundingClientRect();
        var xml=new XMLSerializer().serializeToString(svg);
        var blob=new Blob([xml],{type:'image/svg+xml;charset=utf-8'});
        var url=URL.createObjectURL(blob);
        var img=new Image();
        var p=new Promise(function(resolve){
          img.onload=function(){
            ctx.drawImage(img,rect.left,rect.top,rect.width,rect.height);
            URL.revokeObjectURL(url);
            resolve();
          };
          img.onerror=function(){URL.revokeObjectURL(url);resolve();};
        });
        img.src=url;
        promises.push(p);
      });
      Promise.all(promises).then(function(){
        parent.postMessage({type:'capture-result',id:id,dataUrl:c.toDataURL('image/png')},'*');
      });
    }else{
      parent.postMessage({type:'capture-result',id:id,dataUrl:c.toDataURL('image/png')},'*');
    }
  });
})();
</script></body></html>`;

function buildSrcDoc(visId: string, htmlContent: string): string {
  return (
    HTML_TEMPLATE_PREFIX +
    htmlContent +
    HTML_TEMPLATE_SUFFIX.replace("%%VIS_ID%%", visId)
  );
}

interface Props {
  visualization: VisualizationData;
}

export const VisualizationBlock = memo(function VisualizationBlock({
  visualization,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(300);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blobUrlRef = useRef<string | null>(null);

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

  // Build blob URL when visible
  useEffect(() => {
    if (!isVisible) return;
    const html = buildSrcDoc(visualization.id, visualization.htmlContent);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    if (iframeRef.current) {
      iframeRef.current.src = url;
    }
    return () => URL.revokeObjectURL(url);
  }, [isVisible, visualization.id, visualization.htmlContent]);

  // Listen for height reports and capture results
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.id !== visualization.id) return;

      if (e.data.type === "vis-height") {
        const h = Math.min(Math.max(e.data.height, 100), 800);
        setIframeHeight(h);
      } else if (e.data.type === "capture-result" && e.data.dataUrl) {
        const a = document.createElement("a");
        a.href = e.data.dataUrl;
        a.download = `${visualization.title || "visualization"}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [visualization.id, visualization.title]);

  const handleDownloadHtml = useCallback(() => {
    const html = buildSrcDoc(visualization.id, visualization.htmlContent);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${visualization.title || "visualization"}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [visualization]);

  const handleCapturePng = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "capture-png", id: visualization.id },
      "*"
    );
  }, [visualization.id]);

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
            {visualization.title}
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

      {/* Iframe */}
      {!collapsed && (
        <div style={{ height: iframeHeight }}>
          {isVisible ? (
            <iframe
              ref={iframeRef}
              sandbox="allow-scripts"
              style={{ width: "100%", height: "100%", border: "none" }}
              title={visualization.title}
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
