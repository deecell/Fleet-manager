import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Send, User, Loader2, X } from "lucide-react";
import sunIcon from "@assets/sun.png";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function FleetAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello 👋\nI'm Ray Ray your Fleet AI Assistant. I can help you with questions about your trucks, battery status, savings, alerts, and more. What would you like to know?",
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

      const res = await fetch("/api/v1/assistant/chat", {
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
      console.error("Chat error:", error);
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
    "How many trucks are in service?",
    "What are today's savings?",
    "Are there any low battery trucks?",
    "Show me the fleet summary"
  ];

  return (
    <>
      {open && (
        <div 
          className="fixed bottom-24 right-6 w-[380px] h-[500px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-50 overflow-hidden"
          data-testid="chat-window"
        >
          <div className="flex items-center justify-between p-4 border-b from-primary/10 to-primary/5 bg-[#ffffff]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#EBEFFA] flex items-center justify-center">
                <img src={sunIcon} alt="Ray Ray" className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-neutral-950">Ray Ray</h3>
                <p className="text-xs text-muted-foreground">Ask me anything about your fleet</p>
              </div>
            </div>
            <button 
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
              data-testid="button-close-chat"
            >
              <X className="h-4 w-4 text-gray-500" />
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
                  data-testid={`message-${message.role}-${index}`}
                >
                  {message.role === "assistant" && (
                    <div className="w-6 h-6 rounded-full bg-[#FFD7C0] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="h-3 w-3 text-[#FA4B1E]" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      message.role === "user"
                        ? "bg-[#92a6b3] text-white rounded-br-md"
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
                <div className="flex gap-2 justify-start" data-testid="message-loading">
                  <div className="w-6 h-6 rounded-full bg-[#FFD7C0] flex items-center justify-center flex-shrink-0">
                    <Bot className="h-3 w-3 text-[#FA4B1E]" />
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
                        data-testid={`button-suggestion-${index}`}
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
                placeholder="Ask about your fleet..."
                disabled={isLoading}
                className="flex-1 bg-white border-gray-200 rounded-full px-4 h-10 focus-visible:ring-0 focus-visible:ring-offset-0"
                data-testid="input-chat-message"
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                size="icon"
                className="rounded-full h-10 w-10 shrink-0 bg-[#303030] border-0 focus-visible:ring-0"
                data-testid="button-send-message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-50 bg-[#ebeffa]"
        data-testid="button-open-assistant"
      >
        <img src={sunIcon} alt="AI Assistant" className="h-8 w-8" />
      </button>
    </>
  );
}
