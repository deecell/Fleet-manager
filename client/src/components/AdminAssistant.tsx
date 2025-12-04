import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, User, X } from "lucide-react";
import sunIcon from "@assets/sun.png";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function AdminAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I'm Ray Ray, your Admin AI Assistant. I can help you with cross-organization data, device status, user management, and system-wide insights. What would you like to know?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const allMessages = [...messages, userMessage];
      const chatHistory = allMessages
        .slice(1)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/v1/admin/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ messages: chatHistory }),
        headers: { "Content-Type": "application/json" },
        credentials: "include"
      });

      if (!res.ok) {
        throw new Error("Chat request failed");
      }

      const data = await res.json() as { response: string };

      const assistantMessage: Message = {
        role: "assistant",
        content: data.response,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Admin chat error:", error);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "I apologize, but I encountered an error processing your request. Please try again.",
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestedQuestions = [
    "Give me a system overview",
    "List all organizations",
    "Show offline devices",
    "How many users are there?"
  ];

  return (
    <>
      {open && (
        <div 
          className="fixed bottom-24 right-6 w-[380px] h-[500px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-50 overflow-hidden"
          data-testid="admin-chat-window"
        >
          <div className="flex items-center justify-between p-4 border-b bg-[#2d3748]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#EBEFFA] flex items-center justify-center">
                <img src={sunIcon} alt="Ray Ray" className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-white">Ray Ray (Admin)</h3>
                <p className="text-xs text-gray-300">Cross-organization insights</p>
              </div>
            </div>
            <button 
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              data-testid="button-close-admin-chat"
            >
              <X className="h-4 w-4 text-white" />
            </button>
          </div>

          <ScrollArea 
            className="flex-1 p-4" 
            ref={scrollRef}
          >
            <div className="space-y-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  data-testid={`admin-message-${message.role}-${index}`}
                >
                  {message.role === "assistant" && (
                    <div className="w-6 h-6 rounded-full bg-[#EBEFFA] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <img src={sunIcon} alt="Ray Ray" className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      message.role === "user"
                        ? "bg-[#2d3748] text-white rounded-br-md"
                        : "bg-gray-100 text-neutral-950 rounded-bl-md"
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{message.content}</div>
                    <div className={`text-[10px] mt-1 ${
                      message.role === "user" ? "text-white/60" : "text-muted-foreground"
                    }`}>
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {message.role === "user" && (
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User className="h-3 w-3 text-gray-600" />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-2 justify-start" data-testid="admin-message-loading">
                  <div className="w-6 h-6 rounded-full bg-[#EBEFFA] flex items-center justify-center flex-shrink-0">
                    <img src={sunIcon} alt="Ray Ray" className="h-4 w-4" />
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-bl-md px-3 py-2">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}

              {messages.length === 1 && messages[0].role === "assistant" && !isLoading && (
                <div className="space-y-2 mt-2">
                  <p className="text-xs text-muted-foreground">Try asking:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedQuestions.map((question, index) => (
                      <button
                        key={index}
                        className="text-xs px-2.5 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50 text-gray-700 transition-colors"
                        onClick={() => {
                          setInput(question);
                          inputRef.current?.focus();
                        }}
                        data-testid={`button-admin-suggestion-${index}`}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="p-3 border-t bg-gray-50">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about all organizations..."
                disabled={isLoading}
                className="flex-1 bg-white border-gray-200 rounded-full px-4 h-10 focus-visible:ring-0 focus-visible:ring-offset-0"
                data-testid="input-admin-chat-message"
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                size="icon"
                className="rounded-full h-10 w-10 shrink-0 bg-[#2d3748] border-0 focus-visible:ring-0"
                data-testid="button-send-admin-message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-50 bg-[#2d3748]"
        data-testid="button-open-admin-assistant"
      >
        <img src={sunIcon} alt="Admin AI Assistant" className="h-8 w-8" />
      </button>
    </>
  );
}
