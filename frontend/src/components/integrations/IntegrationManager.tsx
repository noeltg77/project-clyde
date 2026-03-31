"use client";

import { useEffect, useState, useCallback } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type Integration = {
  id: string;
  name: string;
  type: "api" | "webhook" | "mcp";
  base_url: string;
  method: string;
  auth_type: string;
  credential_env_key: string | null;
  headers: Record<string, string>;
  description: string;
  documentation_url: string | null;
  assigned_agents: string[];
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/* ---------- API / Webhook form ---------- */

type FormData = {
  name: string;
  base_url: string;
  method: string;
  auth_type: string;
  credential_env_key: string;
  credential_value: string;
  headers_json: string;
  description: string;
  documentation_url: string;
};

const defaultFormData: FormData = {
  name: "",
  base_url: "",
  method: "GET",
  auth_type: "none",
  credential_env_key: "",
  credential_value: "",
  headers_json: "{}",
  description: "",
  documentation_url: "",
};

/* ---------- MCP form ---------- */

type McpFormData = {
  name: string;
  description: string;
  server_type: "stdio" | "sse";
  command: string;
  args_json: string;
  url: string;
  env_json: string;
};

const defaultMcpFormData: McpFormData = {
  name: "",
  description: "",
  server_type: "stdio",
  command: "",
  args_json: "[]",
  url: "",
  env_json: "{}",
};

/* ---------- Constants ---------- */

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const AUTH_TYPES = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer Token" },
  { value: "api_key", label: "API Key" },
  { value: "basic", label: "Basic Auth" },
];

type TabType = "api" | "webhook" | "mcp";

export function IntegrationManager() {
  const [activeTab, setActiveTab] = useState<TabType>("api");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [mcpFormData, setMcpFormData] = useState<McpFormData>({ ...defaultMcpFormData });
  const [formError, setFormError] = useState<string | null>(null);

  const fetchIntegrations = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/integrations`);
      const data = await res.json();
      setIntegrations(data.integrations || []);
    } catch (err) {
      console.error("Failed to fetch integrations:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const filtered = integrations.filter((i) => i.type === activeTab);

  /* ---------- API / Webhook handlers ---------- */

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);
      if (!formData.name.trim()) {
        setFormError("Name is required");
        return;
      }

      let headers = {};
      try {
        headers = JSON.parse(formData.headers_json);
      } catch {
        setFormError("Headers must be valid JSON");
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/integrations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name,
            type: activeTab,
            base_url: formData.base_url,
            method: formData.method,
            auth_type: formData.auth_type,
            credential_env_key: formData.credential_env_key || null,
            credential_value: formData.credential_value || null,
            headers,
            description: formData.description,
            documentation_url: formData.documentation_url || null,
          }),
        });
        const data = await res.json();
        if (data.error) {
          setFormError(data.error);
          return;
        }
        setFormData({ ...defaultFormData });
        setShowForm(false);
        await fetchIntegrations();
      } catch (err) {
        console.error("Failed to create integration:", err);
        setFormError("Failed to create integration");
      }
    },
    [formData, activeTab, fetchIntegrations]
  );

  const handleUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingId) return;
      setFormError(null);

      let headers = {};
      try {
        headers = JSON.parse(formData.headers_json);
      } catch {
        setFormError("Headers must be valid JSON");
        return;
      }

      try {
        const res = await fetch(
          `${API_URL}/api/integrations/${editingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: formData.name,
              base_url: formData.base_url,
              method: formData.method,
              auth_type: formData.auth_type,
              credential_env_key: formData.credential_env_key || null,
              credential_value: formData.credential_value || null,
              headers,
              description: formData.description,
              documentation_url: formData.documentation_url || null,
            }),
          }
        );
        const data = await res.json();
        if (data.error) {
          setFormError(data.error);
          return;
        }
        setFormData({ ...defaultFormData });
        setEditingId(null);
        setShowForm(false);
        await fetchIntegrations();
      } catch (err) {
        console.error("Failed to update integration:", err);
        setFormError("Failed to update integration");
      }
    },
    [editingId, formData, fetchIntegrations]
  );

  /* ---------- MCP handlers ---------- */

  const handleMcpCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);
      if (!mcpFormData.name.trim()) {
        setFormError("Name is required");
        return;
      }

      let mcpArgs: string[] = [];
      try {
        mcpArgs = JSON.parse(mcpFormData.args_json);
      } catch {
        setFormError("Args must be valid JSON array");
        return;
      }

      let mcpEnv: Record<string, string> = {};
      try {
        mcpEnv = JSON.parse(mcpFormData.env_json);
      } catch {
        setFormError("Environment variables must be valid JSON");
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/integrations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: mcpFormData.name,
            type: "mcp",
            base_url: mcpFormData.server_type === "sse" ? mcpFormData.url : "",
            method: "MCP",
            auth_type: "none",
            description: mcpFormData.description,
            metadata: {
              server_type: mcpFormData.server_type,
              command: mcpFormData.command,
              args: mcpArgs,
              url: mcpFormData.url,
              env: mcpEnv,
            },
          }),
        });
        const data = await res.json();
        if (data.error) {
          setFormError(data.error);
          return;
        }
        setMcpFormData({ ...defaultMcpFormData });
        setShowForm(false);
        await fetchIntegrations();
      } catch (err) {
        console.error("Failed to create MCP server:", err);
        setFormError("Failed to create MCP server");
      }
    },
    [mcpFormData, fetchIntegrations]
  );

  const handleMcpUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingId) return;
      setFormError(null);

      let mcpArgs: string[] = [];
      try {
        mcpArgs = JSON.parse(mcpFormData.args_json);
      } catch {
        setFormError("Args must be valid JSON array");
        return;
      }

      let mcpEnv: Record<string, string> = {};
      try {
        mcpEnv = JSON.parse(mcpFormData.env_json);
      } catch {
        setFormError("Environment variables must be valid JSON");
        return;
      }

      try {
        const res = await fetch(
          `${API_URL}/api/integrations/${editingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: mcpFormData.name,
              base_url: mcpFormData.server_type === "sse" ? mcpFormData.url : "",
              method: "MCP",
              description: mcpFormData.description,
              metadata: {
                server_type: mcpFormData.server_type,
                command: mcpFormData.command,
                args: mcpArgs,
                url: mcpFormData.url,
                env: mcpEnv,
              },
            }),
          }
        );
        const data = await res.json();
        if (data.error) {
          setFormError(data.error);
          return;
        }
        setMcpFormData({ ...defaultMcpFormData });
        setEditingId(null);
        setShowForm(false);
        await fetchIntegrations();
      } catch (err) {
        console.error("Failed to update MCP server:", err);
        setFormError("Failed to update MCP server");
      }
    },
    [editingId, mcpFormData, fetchIntegrations]
  );

  /* ---------- Shared handlers ---------- */

  const handleToggle = useCallback(
    async (id: string) => {
      try {
        await fetch(`${API_URL}/api/integrations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toggle_enabled: true }),
        });
        await fetchIntegrations();
      } catch (err) {
        console.error("Failed to toggle integration:", err);
      }
    },
    [fetchIntegrations]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await fetch(`${API_URL}/api/integrations/${id}`, {
          method: "DELETE",
        });
        await fetchIntegrations();
      } catch (err) {
        console.error("Failed to delete integration:", err);
      }
    },
    [fetchIntegrations]
  );

  const handleEdit = useCallback((i: Integration) => {
    setEditingId(i.id);
    setFormError(null);

    if (i.type === "mcp") {
      const meta = i.metadata || {};
      setMcpFormData({
        name: i.name,
        description: i.description,
        server_type: (meta.server_type as "stdio" | "sse") || "stdio",
        command: (meta.command as string) || "",
        args_json: JSON.stringify(meta.args || [], null, 2),
        url: (meta.url as string) || "",
        env_json: JSON.stringify(meta.env || {}, null, 2),
      });
    } else {
      setFormData({
        name: i.name,
        base_url: i.base_url,
        method: i.method,
        auth_type: i.auth_type,
        credential_env_key: i.credential_env_key || "",
        credential_value: "",
        headers_json: JSON.stringify(i.headers || {}, null, 2),
        description: i.description,
        documentation_url: i.documentation_url || "",
      });
    }
    setShowForm(true);
  }, []);

  const handleCancelForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ ...defaultFormData });
    setMcpFormData({ ...defaultMcpFormData });
    setFormError(null);
  }, []);

  const authLabel = (type: string) =>
    AUTH_TYPES.find((a) => a.value === type)?.label || type;

  const tabLabel = (tab: TabType) =>
    tab === "api" ? "APIs" : tab === "webhook" ? "webhooks" : "MCP servers";

  /* ---------- Determine which submit handler to use ---------- */
  const getSubmitHandler = () => {
    if (activeTab === "mcp") {
      return editingId ? handleMcpUpdate : handleMcpCreate;
    }
    return editingId ? handleUpdate : handleCreate;
  };

  const inputClass =
    "w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent-primary/40";
  const labelClass = "block text-[11px] text-text-secondary/60 mb-1";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary font-display">
              Integrations
            </h2>
            <button
              onClick={() => {
                if (showForm) {
                  handleCancelForm();
                } else {
                  setShowForm(true);
                }
              }}
              className={`px-3 py-1.5 text-sm font-medium rounded-[2px] transition-colors ${
                showForm
                  ? "text-text-secondary hover:text-text-primary"
                  : "border border-accent-primary text-accent-primary hover:bg-accent-primary/10"
              }`}
            >
              {showForm ? "Cancel" : "+ New Integration"}
            </button>
          </div>

          {/* Tab toggle */}
          <div className="flex gap-0 border border-border rounded-[2px] w-fit">
            <button
              onClick={() => {
                setActiveTab("api");
                if (showForm && !editingId) {
                  setFormData({ ...defaultFormData });
                }
              }}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "api"
                  ? "bg-accent-primary/10 text-accent-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              APIs
            </button>
            <button
              onClick={() => {
                setActiveTab("webhook");
                if (showForm && !editingId) {
                  setFormData({ ...defaultFormData });
                }
              }}
              className={`px-4 py-1.5 text-sm font-medium transition-colors border-l border-border ${
                activeTab === "webhook"
                  ? "bg-accent-primary/10 text-accent-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Webhooks
            </button>
            <button
              onClick={() => {
                setActiveTab("mcp");
                if (showForm && !editingId) {
                  setMcpFormData({ ...defaultMcpFormData });
                }
              }}
              className={`px-4 py-1.5 text-sm font-medium transition-colors border-l border-border ${
                activeTab === "mcp"
                  ? "bg-accent-primary/10 text-accent-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              MCP Servers
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 pt-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Form */}
          {showForm && (
            <form
              onSubmit={getSubmitHandler()}
              className="p-4 rounded-[2px] bg-bg-tertiary border border-border space-y-3"
            >
              {formError && (
                <div className="flex items-center justify-between px-3 py-2 text-sm bg-error/10 text-error border border-error/20 rounded-[2px]">
                  <span>{formError}</span>
                  <button
                    type="button"
                    onClick={() => setFormError(null)}
                    className="text-error/60 hover:text-error ml-2"
                  >
                    &times;
                  </button>
                </div>
              )}

              {/* ---------- MCP Form ---------- */}
              {activeTab === "mcp" ? (
                <>
                  {/* Row 1: Name + Server Type */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Name</label>
                      <input
                        type="text"
                        value={mcpFormData.name}
                        onChange={(e) =>
                          setMcpFormData({ ...mcpFormData, name: e.target.value })
                        }
                        placeholder="filesystem-server"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Server Type</label>
                      <select
                        value={mcpFormData.server_type}
                        onChange={(e) =>
                          setMcpFormData({
                            ...mcpFormData,
                            server_type: e.target.value as "stdio" | "sse",
                          })
                        }
                        className={inputClass}
                      >
                        <option value="stdio">stdio</option>
                        <option value="sse">SSE (Server-Sent Events)</option>
                      </select>
                    </div>
                  </div>

                  {/* Row 2: Command (stdio) or URL (sse) */}
                  {mcpFormData.server_type === "stdio" ? (
                    <div>
                      <label className={labelClass}>Command</label>
                      <input
                        type="text"
                        value={mcpFormData.command}
                        onChange={(e) =>
                          setMcpFormData({ ...mcpFormData, command: e.target.value })
                        }
                        placeholder="npx -y @modelcontextprotocol/server-filesystem"
                        className={`${inputClass} font-mono`}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className={labelClass}>Server URL</label>
                      <input
                        type="text"
                        value={mcpFormData.url}
                        onChange={(e) =>
                          setMcpFormData({ ...mcpFormData, url: e.target.value })
                        }
                        placeholder="http://localhost:3001/sse"
                        className={`${inputClass} font-mono`}
                      />
                    </div>
                  )}

                  {/* Row 3: Args (JSON array) */}
                  {mcpFormData.server_type === "stdio" && (
                    <div>
                      <label className={labelClass}>Arguments (JSON array)</label>
                      <textarea
                        value={mcpFormData.args_json}
                        onChange={(e) =>
                          setMcpFormData({ ...mcpFormData, args_json: e.target.value })
                        }
                        placeholder='["/path/to/allowed/dir"]'
                        rows={2}
                        className={`${inputClass} font-mono resize-none`}
                      />
                    </div>
                  )}

                  {/* Row 4: Description */}
                  <div>
                    <label className={labelClass}>Description</label>
                    <textarea
                      value={mcpFormData.description}
                      onChange={(e) =>
                        setMcpFormData({ ...mcpFormData, description: e.target.value })
                      }
                      placeholder="What does this MCP server provide?"
                      rows={2}
                      className={`${inputClass} resize-none`}
                    />
                  </div>

                  {/* Row 5: Environment Variables */}
                  <div>
                    <label className={labelClass}>Environment Variables (JSON)</label>
                    <textarea
                      value={mcpFormData.env_json}
                      onChange={(e) =>
                        setMcpFormData({ ...mcpFormData, env_json: e.target.value })
                      }
                      placeholder='{"API_KEY": "sk-..."}'
                      rows={2}
                      className={`${inputClass} font-mono resize-none`}
                    />
                  </div>
                </>
              ) : (
                /* ---------- API / Webhook Form ---------- */
                <>
                  {/* Row 1: Name + Base URL */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Name</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        placeholder={
                          activeTab === "api" ? "Stripe API" : "Slack Webhook"
                        }
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Base URL</label>
                      <input
                        type="text"
                        value={formData.base_url}
                        onChange={(e) =>
                          setFormData({ ...formData, base_url: e.target.value })
                        }
                        placeholder="https://api.example.com/v1"
                        className={inputClass}
                      />
                    </div>
                  </div>

                  {/* Row 2: Method + Auth Type */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Default Method</label>
                      <select
                        value={formData.method}
                        onChange={(e) =>
                          setFormData({ ...formData, method: e.target.value })
                        }
                        className={inputClass}
                      >
                        {METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Auth Type</label>
                      <select
                        value={formData.auth_type}
                        onChange={(e) =>
                          setFormData({ ...formData, auth_type: e.target.value })
                        }
                        className={inputClass}
                      >
                        {AUTH_TYPES.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Row 3: Credential Env Key + Credential Value */}
                  {formData.auth_type !== "none" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Credential Env Key</label>
                        <input
                          type="text"
                          value={formData.credential_env_key}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              credential_env_key: e.target.value,
                            })
                          }
                          placeholder="STRIPE_API_KEY"
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Credential Value</label>
                        <input
                          type="password"
                          autoComplete="off"
                          value={formData.credential_value}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              credential_value: e.target.value,
                            })
                          }
                          placeholder={
                            editingId
                              ? "Enter new value to update"
                              : "sk-..."
                          }
                          className={inputClass}
                        />
                      </div>
                    </div>
                  )}

                  {/* Row 4: Description */}
                  <div>
                    <label className={labelClass}>Description</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({ ...formData, description: e.target.value })
                      }
                      placeholder="What does this integration do?"
                      rows={2}
                      className={`${inputClass} resize-none`}
                    />
                  </div>

                  {/* Row 5: Documentation URL + Headers */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Documentation URL</label>
                      <input
                        type="text"
                        value={formData.documentation_url}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            documentation_url: e.target.value,
                          })
                        }
                        placeholder="https://docs.example.com"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Custom Headers (JSON)</label>
                      <textarea
                        value={formData.headers_json}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            headers_json: e.target.value,
                          })
                        }
                        rows={2}
                        className={`${inputClass} font-mono resize-none`}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Submit */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  className="px-4 py-1.5 text-sm font-medium bg-accent-primary text-bg-primary rounded-[2px] hover:opacity-90 transition-opacity"
                >
                  {editingId ? "Save Changes" : "Create"}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={handleCancelForm}
                    className="px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}

          {/* Loading */}
          {loading && (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-24 bg-bg-tertiary animate-pulse rounded-[2px]"
                />
              ))}
            </div>
          )}

          {/* Empty */}
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-text-secondary/50">
                No {tabLabel(activeTab)} yet
              </p>
              <p className="text-[11px] text-text-secondary/30 mt-1">
                Create one above or ask Clyde to register an integration
              </p>
            </div>
          )}

          {/* Cards */}
          {filtered.map((i) => {
            const meta = (i.metadata || {}) as Record<string, unknown>;
            const isMcp = i.type === "mcp";

            return (
              <div
                key={i.id}
                className="group p-4 rounded-[2px] bg-bg-tertiary border border-border hover:border-accent-primary/20 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-medium text-text-primary">
                        {i.name}
                      </p>

                      {/* MCP cards: show server_type + command/url */}
                      {isMcp ? (
                        <>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-[2px] text-accent-secondary/80 bg-accent-secondary/10">
                            {(meta.server_type as string) || "stdio"}
                          </span>
                          {meta.command && (
                            <span className="text-[10px] text-text-secondary/60 font-mono px-1.5 py-0.5 bg-bg-secondary rounded-[2px] truncate max-w-[300px]">
                              {meta.command as string}
                            </span>
                          )}
                          {meta.server_type === "sse" && meta.url && (
                            <span className="text-[10px] text-text-secondary/60 font-mono px-1.5 py-0.5 bg-bg-secondary rounded-[2px] truncate max-w-[300px]">
                              {meta.url as string}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {/* API/Webhook cards: show base_url + method */}
                          {i.base_url && (
                            <span className="text-[10px] text-text-secondary/60 font-mono px-1.5 py-0.5 bg-bg-secondary rounded-[2px] truncate max-w-[300px]">
                              {i.base_url}
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-[2px] ${
                              i.method === "GET"
                                ? "text-accent-tertiary/80 bg-accent-tertiary/10"
                                : i.method === "POST"
                                ? "text-accent-primary/80 bg-accent-primary/10"
                                : i.method === "PUT"
                                ? "text-accent-secondary/80 bg-accent-secondary/10"
                                : i.method === "DELETE"
                                ? "text-error/80 bg-error/10"
                                : "text-text-secondary/60 bg-bg-secondary"
                            }`}
                          >
                            {i.method}
                          </span>
                          {i.auth_type !== "none" && (
                            <span className="text-[10px] text-text-secondary/60 px-1.5 py-0.5 bg-bg-secondary rounded-[2px]">
                              {authLabel(i.auth_type)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {i.description && (
                      <p className="text-[12px] text-text-secondary/50 mt-1">
                        {i.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    {/* Toggle */}
                    <button
                      onClick={() => handleToggle(i.id)}
                      className={`w-9 h-5 rounded-full relative transition-colors ${
                        i.enabled
                          ? "bg-accent-primary/30"
                          : "bg-text-secondary/20"
                      }`}
                      title={i.enabled ? "Disable" : "Enable"}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${
                          i.enabled
                            ? "bg-accent-primary"
                            : "bg-text-secondary/50"
                        }`}
                        style={{ left: i.enabled ? "18px" : "3px" }}
                      />
                    </button>

                    {/* Edit */}
                    <button
                      onClick={() => handleEdit(i)}
                      className="w-6 h-6 flex items-center justify-center rounded-[2px] text-text-secondary/40 hover:text-accent-primary hover:bg-accent-primary/10 opacity-0 group-hover:opacity-100 transition-all"
                      title="Edit"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(i.id)}
                      className="w-6 h-6 flex items-center justify-center rounded-[2px] text-text-secondary/40 hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Footer metadata */}
                <div className="flex items-center gap-4 mt-2">
                  {isMcp && Array.isArray(meta.args) && (meta.args as string[]).length > 0 && (
                    <span className="text-[11px] text-text-secondary/40 font-mono">
                      args: {String((meta.args as string[]).length)}
                    </span>
                  )}
                  {isMcp && meta.env != null && Object.keys(meta.env as Record<string, string>).length > 0 && (
                    <span className="text-[11px] text-text-secondary/40 font-mono">
                      {`env: ${Object.keys(meta.env as Record<string, string>).length} var${Object.keys(meta.env as Record<string, string>).length !== 1 ? "s" : ""}`}
                    </span>
                  )}
                  {!isMcp && i.credential_env_key && (
                    <span className="text-[11px] text-text-secondary/40 font-mono">
                      ${i.credential_env_key}
                    </span>
                  )}
                  {i.assigned_agents.length > 0 && (
                    <span className="text-[11px] text-accent-primary/70 font-medium">
                      {i.assigned_agents.length} agent
                      {i.assigned_agents.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {!isMcp && i.documentation_url && (
                    <a
                      href={i.documentation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-text-secondary/40 hover:text-accent-primary transition-colors"
                    >
                      Docs
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
