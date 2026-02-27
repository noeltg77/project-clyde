from pydantic import BaseModel
from typing import Optional, Any


# --- Chat ---


class UserMessage(BaseModel):
    type: str = "user_message"
    content: str
    session_id: Optional[str] = None


class AgentStreamChunk(BaseModel):
    type: str  # "assistant_text", "tool_use", "tool_result", "result", "error", "init"
    data: dict[str, Any]


class SessionResponse(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    agent_name: Optional[str] = None
    content: str
    token_count: int = 0
    cost_usd: float = 0.0
    created_at: str


# --- Agent Registry ---


class AgentRegistryEntry(BaseModel):
    id: str
    name: str
    role: str
    model: str = "sonnet"
    avatar: Optional[str] = None
    system_prompt_path: Optional[str] = None
    memory_path: Optional[str] = None
    working_dir: Optional[str] = None
    status: str = "active"
    tools: list[str] = []
    skills: list[str] = []
    created_at: Optional[str] = None


class AgentCreateInput(BaseModel):
    name: str
    role: str
    model: str = "sonnet"
    gender: str = "male"
    system_prompt: str
    tools: Optional[list[str]] = None
    skills: Optional[list[str]] = None


class AgentUpdateInput(BaseModel):
    role: Optional[str] = None
    model: Optional[str] = None
    status: Optional[str] = None
    tools: Optional[list[str]] = None
    skills: Optional[list[str]] = None


# --- Permissions ---


class PermissionRequest(BaseModel):
    id: str
    tool_name: str
    tool_input: dict[str, str]
    agent_name: Optional[str] = None
    agent_id: Optional[str] = None


class PermissionResponse(BaseModel):
    id: str
    decision: str  # "allow" | "deny" | "allow_all_similar"


# --- Activity ---


class ActivityEvent(BaseModel):
    id: Optional[str] = None
    session_id: Optional[str] = None
    agent_id: str
    agent_name: str
    event_type: str  # started | stopped | tool_use | permission_request | permission_response | created | error
    description: Optional[str] = None
    metadata: dict[str, Any] = {}
    created_at: Optional[str] = None


# --- Registry API response ---


class RegistryResponse(BaseModel):
    orchestrator: dict[str, Any]
    agents: list[dict[str, Any]]
