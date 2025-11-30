import { Router, Request, Response } from "express";
import { processChat, ChatMessage } from "../services/fleet-assistant";
import { z } from "zod";

const router = Router();

const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string()
  }))
});

router.post("/chat", async (req: Request, res: Response) => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error });
    }

    const { messages } = parsed.data;

    console.log(`[Assistant] Processing chat for org ${organizationId}, ${messages.length} messages`);

    const response = await processChat(messages as ChatMessage[], organizationId);

    return res.json({ 
      response,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[Assistant] Chat error:", error);
    return res.status(500).json({ error: "Failed to process chat request" });
  }
});

export default router;
