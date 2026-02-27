import { ChatStoreProvider } from "@/stores/chat-store-provider";
import { SettingsStoreProvider } from "@/stores/settings-store-provider";
import { AgentStoreProvider } from "@/stores/agent-store-provider";
import { InsightStoreProvider } from "@/stores/insight-store-provider";
import { AppShell } from "@/components/layout/AppShell";

export default function Home() {
  return (
    <SettingsStoreProvider>
      <ChatStoreProvider>
        <AgentStoreProvider>
          <InsightStoreProvider>
            <AppShell />
          </InsightStoreProvider>
        </AgentStoreProvider>
      </ChatStoreProvider>
    </SettingsStoreProvider>
  );
}
